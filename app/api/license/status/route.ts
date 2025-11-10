// app/api/license/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { list } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------- Per-project settings (from env) ----------
const ALLOWED_PRICE_IDS = (process.env.ALLOWED_PRICE_IDS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean); // e.g. "price_123,price_456"

const EXPECTED_BLOB_SUBDOMAIN = process.env.EXPECTED_BLOB_SUBDOMAIN || ""; // e.g. "yortzkpqfilo9jvz"

type LicenseStatus = {
  status: "active" | "inactive";
  plan: "pro" | "free";
  expiresAt: string | null;
};

type PayloadShape = {
  status: "active" | "inactive";
  plan: "pro" | "free";
  expiresAt: string | null;
  features: string[];
  error?: string;
  note?: string;
  proThemes?: string[];
};

// -------- Stripe init --------
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key, { apiVersion: "2024-06-20" });
}

// Extract customer id from new license format: LIC-PRO-cus_XXXX-ABCDEFGH
function customerIdFromLicense(licenseKey: string): string | null {
  const parts = String(licenseKey || "").trim().split("-");
  const candidate = parts.find(p => p.startsWith("cus_"));
  return candidate || null;
}

// ---------- Blob isolation (hard check; no writes here, just guard) ----------
function assertBlobStoreIsolation() {
  const token = process.env.BLOB_READ_WRITE_TOKEN || "";
  if (
    EXPECTED_BLOB_SUBDOMAIN &&
    !token.toLowerCase().includes(EXPECTED_BLOB_SUBDOMAIN.toLowerCase())
  ) {
    // This guards against accidentally reading from the wrong store via a wrong token
    throw new Error("BLOB token mismatch — check EXPECTED_BLOB_SUBDOMAIN.");
  }
}

// ---------- Read latest license record from THIS project's blob store ----------
async function readLicenseRecordFromBlob(customerId: string): Promise<null | {
  licenseKey?: string | null;
  email?: string | null;
  source?: string;
  savedAt?: string;
  // Most recent webhook "extra" fields we stored:
  subscriptionId?: string | null;
  status?: string | null;
  current_period_end?: number | null;
}> {
  assertBlobStoreIsolation();

  const token = process.env.BLOB_READ_WRITE_TOKEN || "";
  // We write stable: licenses/<customerId>.json
  const li = await list({
    prefix: `licenses/${customerId}.json`,
    limit: 1,
    token: token || undefined,
  });

  const item = li.blobs?.[0];
  if (!item?.url) return null;

  try {
    const res = await fetch(item.url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    // Flatten stored shape { customerId, licenseKey, email, source, savedAt, ...extra }
    const { licenseKey, email, source, savedAt, ...extra } = json || {};
    return {
      licenseKey,
      email,
      source,
      savedAt,
      subscriptionId: extra?.subscriptionId ?? null,
      status: extra?.status ?? null,
      current_period_end: extra?.current_period_end ?? null,
    };
  } catch {
    return null;
  }
}

// ---------- Compute plan from a blob record (project-scoped) ----------
function planFromBlobRecord(rec: NonNullable<Awaited<ReturnType<typeof readLicenseRecordFromBlob>>>): LicenseStatus {
  const rawStatus = (rec.status || "").toString();
  const isActiveLike = ["active", "trialing"].includes(rawStatus);
  const expiresAt =
    typeof rec.current_period_end === "number" && rec.current_period_end > 0
      ? new Date(rec.current_period_end * 1000).toISOString()
      : null;

  if (isActiveLike) {
    return { status: "active", plan: "pro", expiresAt };
  }
  // If we don't have a subscription status yet (e.g., immediate post-checkout),
  // treat as inactive here; the Stripe fallback below can upgrade the status.
  return { status: "inactive", plan: "free", expiresAt: null };
}

// ---------- Stripe fallback (SKU-gated) ----------
async function planFromStripeAllowlisted(stripe: Stripe, customerId: string): Promise<LicenseStatus> {
  // If you didn't set ALLOWED_PRICE_IDS, we will NOT treat Stripe results as active
  // to avoid cross-project leakage. Configure ALLOWED_PRICE_IDS per project.
  if (ALLOWED_PRICE_IDS.length === 0) {
    return { status: "inactive", plan: "free", expiresAt: null };
  }

  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    expand: ["data.items.data.price", "data.items.data.plan"],
    limit: 50,
  });

  // Find any sub that has an allow-listed price id
  for (const s of subs.data) {
    const priceIds = (s.items?.data || [])
      .map(it => it.price?.id || (it as any).plan?.id)
      .filter(Boolean) as string[];

    const matchesProject = priceIds.some(id => ALLOWED_PRICE_IDS.includes(id));
    if (!matchesProject) continue;

    const activeLike = ["active", "trialing"].includes(s.status);
    const expiresAt =
      s.current_period_end ? new Date(s.current_period_end * 1000).toISOString() : null;

    if (activeLike) {
      return { status: "active", plan: "pro", expiresAt };
    }
  }

  return { status: "inactive", plan: "free", expiresAt: null };
}

// ---------- Handler ----------
export async function GET(req: NextRequest) {
  // Default safe payload
  let payload: PayloadShape = {
    status: "inactive",
    plan: "free",
    expiresAt: null,
    features: ["beliefs_scan", "themes_preview", "tips_only"],
    note: "This toolkit is part of Pro. Unlock to access.",
    proThemes: [
      "health_discipline",
      "leadership_imposter",
      "money_beliefs",
      "relationships_boundaries",
      "entrepreneur_risk_tolerance",
    ],
  };

  try {
    // Prefer ?key=...; fallback to X-License-Key header
    const key =
      (req.nextUrl.searchParams.get("key") ||
        req.headers.get("x-license-key") ||
        "").trim();

    if (!key) {
      // No key → Free
      return NextResponse.json(payload);
    }

    const cusId = customerIdFromLicense(key);
    if (!cusId) {
      payload.error = "LEGACY_LICENSE_FORMAT";
      return NextResponse.json(payload);
    }

    // 1) Try THIS project's blob store (token-scoped; no cross-project leakage)
    const rec = await readLicenseRecordFromBlob(cusId);
    let plan: LicenseStatus | null = null;

    if (rec) {
      plan = planFromBlobRecord(rec);
    }

    // 2) If still inactive, Stripe fallback BUT gated by ALLOWED_PRICE_IDS
    if (!plan || plan.status === "inactive") {
      const stripe = getStripe();
      const viaStripe = await planFromStripeAllowlisted(stripe, cusId);
      plan = viaStripe;
    }

    // Finalize payload
    payload = {
      status: plan.status,
      plan: plan.plan,
      expiresAt: plan.expiresAt,
      features:
        plan.status === "active"
          ? ["beliefs_scan", "beliefs_reframe", "actions_plan", "libraries_full"]
          : ["beliefs_scan", "themes_preview", "tips_only"],
      note: plan.status === "active" ? undefined : "This toolkit is part of Pro. Unlock to access.",
      proThemes: payload.proThemes, // keep same list
    };

    return NextResponse.json(payload);
  } catch (e: any) {
    console.error("license/status error:", e?.message || e);
    // Never 5xx to the caller for UX; return a safe "free" payload with error hint
    payload.error = "STATUS_CHECK_FAILED";
    return NextResponse.json(payload);
  }
}
