// app/api/license/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LicenseStatus = {
  status: "active" | "inactive";
  plan: "pro" | "free";
  expiresAt: string | null;
};

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key, { apiVersion: "2024-06-20" });
}

// Extract customer id from new license format: LIC-PRO-cus_XXXX-ABCDEFGH
function customerIdFromLicense(licenseKey: string): string | null {
  const parts = licenseKey.trim().split("-");
  const candidate = parts.find((p) => p.startsWith("cus_"));
  return candidate || null;
}

// Check if customer has an active/trialing sub
async function getPlanStatus(
  stripe: Stripe,
  customerId: string
): Promise<LicenseStatus> {
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    expand: ["data.items"],
  });

  const active = subs.data.find((s) =>
    ["active", "trialing", "past_due", "unpaid"].includes(s.status)
  );

  if (!active) {
    return { status: "inactive", plan: "free", expiresAt: null };
  }

  const expiresAt = active.current_period_end
    ? new Date(active.current_period_end * 1000).toISOString()
    : null;

  const isActive = active.status === "active" || active.status === "trialing";
  return {
    status: isActive ? "active" : "inactive",
    plan: "pro",
    expiresAt,
  };
}

export async function GET(req: NextRequest) {
  // Default safe response (never 5xx to caller)
  let payload: {
    status: "active" | "inactive";
    plan: "pro" | "free";
    expiresAt: string | null;
    features: string[];
    error?: string;
    // --- NEW (optional, non-breaking) ---
    note?: string;
    proThemes?: string[];
  } = {
    status: "inactive",
    plan: "free",
    expiresAt: null,
    features: ["beliefs_scan", "themes_preview", "tips_only"],
    // Surface your UX copy for free/inactive users
    note:
      "This toolkit is part of Pro. Unlock to access.",
    // Handy for UI badges / lists
    proThemes: ["health_discipline", "leadership_imposter", "money_beliefs", "relationships_boundaries", "entrepreneur_risk_tolerance"],
  };

  try {
    // Prefer ?key=...; fallback to X-License-Key header
    const key =
      (req.nextUrl.searchParams.get("key") ||
        req.headers.get("x-license-key") ||
        "").trim();

    if (!key) return NextResponse.json(payload); // free if no key

    const cusId = customerIdFromLicense(key);
    if (!cusId) {
      // Legacy key without cus_ — prompt user to regenerate
      payload.error = "LEGACY_LICENSE_FORMAT";
      return NextResponse.json(payload);
    }

    const stripe = getStripe();
    const plan = await getPlanStatus(stripe, cusId);

    payload = {
      status: plan.status,
      plan: plan.plan,
      expiresAt: plan.expiresAt,
      features:
        plan.status === "active"
          ? ["beliefs_scan", "beliefs_reframe", "actions_plan", "libraries_full", "exports_pdf"]
          : ["beliefs_scan", "themes_preview", "tips_only"],
      // Keep the UX note only when user is not actively Pro
      note:
        plan.status === "active"
          ? undefined
          : "This toolkit is part of Pro. Unlock to access.",
      proThemes: ["health_discipline", "leadership_imposter", "money_beliefs", "relationships_boundaries", "entrepreneur_risk_tolerance"],
    };

    return NextResponse.json(payload);
  } catch (e: any) {
    console.error("license/status error:", e?.message || e);
    payload.error = "STATUS_CHECK_FAILED";
    return NextResponse.json(payload);
  }
}
