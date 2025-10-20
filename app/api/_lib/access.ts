// app/api/_lib/access.ts
import Stripe from "stripe";
import { list, put } from "@vercel/blob";

/* =========================
   Env + constants
   ========================= */

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key, { apiVersion: "2024-06-20" });
}

function readTrialDays(): number {
  const n = Number(process.env.TRIAL_DAYS || "7");
  return Number.isFinite(n) && n > 0 ? Math.min(n, 60) : 7;
}

/** Exposed so routes can show consistent totals */
export const TRIAL_DAYS = readTrialDays();
/** Cookie name used by the cookie-fallback flow (trial by device/session) */
export const TRIAL_COOKIE = "db_trial_started_at";

/* =========================
   Blob helpers
   ========================= */

function blobListOpts(prefix: string) {
  const opts: Parameters<typeof list>[0] = { prefix };
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    (opts as any).token = process.env.BLOB_READ_WRITE_TOKEN;
  }
  return opts;
}

function blobPutOpts(contentType = "application/json") {
  const base: Parameters<typeof put>[2] = {
    access: "public",
    contentType,
    addRandomSuffix: false,
  };
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    (base as any).token = process.env.BLOB_READ_WRITE_TOKEN;
  }
  return base;
}

async function getJson<T = any>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/* =========================
   Small utils
   ========================= */

/** normalize email to a blob-safe key: lowercased + only [a-z0-9._-] */
export function emailKey(emailRaw: string) {
  const e = String(emailRaw || "").trim().toLowerCase();
  return e.replace(/[^a-z0-9._-]+/g, "_");
}

function customerIdFromLicense(licenseKey: string): string | null {
  const parts = (licenseKey || "").trim().split("-");
  const hit = parts.find((p) => p.startsWith("cus_"));
  return hit || null;
}

/* =========================
   License lookup (email → license → active sub?)
   ========================= */

export async function findLicenseByEmail(email: string) {
  const ek = emailKey(email);
  const pathname = `licenses_by_email/${ek}.json`;
  const { blobs } = await list(blobListOpts(pathname));
  const hit = blobs.find((b) => b.pathname === pathname);
  if (!hit) return null;

  const rec = await getJson<any>(hit.url);
  if (!rec?.licenseKey) return null;

  const cusId = customerIdFromLicense(rec.licenseKey);
  return cusId ? { licenseKey: rec.licenseKey as string, customerId: cusId } : null;
}

export async function hasActiveSub(customerId: string) {
  const stripe = getStripe();
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    expand: ["data.items"],
  });
  const active = subs.data.find((s) =>
    ["active", "trialing", "past_due", "unpaid"].includes(s.status)
  );
  return !!active && (active?.status === "active" || active?.status === "trialing");
}

/* =========================
   Trial (email based) — trials/<emailKey>.json
   ========================= */

export type TrialInfo = {
  startedAt: string; // ISO
  expiresAt: string; // ISO
  daysUsed: number;
  daysTotal: number;
  active: boolean;
};

export async function readTrialByEmail(email: string): Promise<TrialInfo | null> {
  const ek = emailKey(email);
  const pathname = `trials/${ek}.json`;
  const { blobs } = await list(blobListOpts(pathname));
  const hit = blobs.find((b) => b.pathname === pathname);
  if (!hit) return null;

  const rec = await getJson<{ startedAt?: string }>(hit.url);
  const startedAt = rec?.startedAt ? new Date(rec.startedAt) : null;
  if (!startedAt || isNaN(startedAt.getTime())) return null;

  const total = TRIAL_DAYS;
  const expiresAt = new Date(startedAt.getTime() + total * 86400 * 1000);
  const now = new Date();
  const daysUsed = Math.max(
    0,
    Math.floor((now.getTime() - startedAt.getTime()) / (86400 * 1000))
  );
  const active = now < expiresAt;

  return {
    startedAt: startedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    daysUsed,
    daysTotal: total,
    active,
  };
}

/** Idempotently creates a trial file if none exists; otherwise returns current status */
export async function ensureTrialByEmail(email: string): Promise<TrialInfo> {
  const existing = await readTrialByEmail(email);
  if (existing) return existing;

  const ek = emailKey(email);
  const nowIso = new Date().toISOString();
  await put(
    `trials/${ek}.json`,
    Buffer.from(JSON.stringify({ startedAt: nowIso }, null, 2)),
    blobPutOpts()
  );

  // return computed view
  const total = TRIAL_DAYS;
  const started = new Date(nowIso);
  const expiresAt = new Date(started.getTime() + total * 86400 * 1000);
  return {
    startedAt: nowIso,
    expiresAt: expiresAt.toISOString(),
    daysUsed: 0,
    daysTotal: total,
    active: true,
  };
}

/* =========================
   Trial (cookie fallback) — for devices without email
   ========================= */

export function computeCookieTrial(startIso: string): TrialInfo {
  const started = new Date(startIso);
  const total = TRIAL_DAYS;
  const expiresAt = new Date(started.getTime() + total * 86400 * 1000);
  const now = new Date();
  const daysUsed = Math.max(
    0,
    Math.floor((now.getTime() - started.getTime()) / (86400 * 1000))
  );
  const active = now < expiresAt;
  return {
    startedAt: started.toISOString(),
    expiresAt: expiresAt.toISOString(),
    daysUsed,
    daysTotal: total,
    active,
  };
}

/* =========================
   Central gate for Pro routes (license or trial)
   ========================= */
/**
 * requireAccess(req, { allowTrial: true })
 * Resolution order:
 * 1) ?key=...               → verify Stripe sub
 * 2) ?email=... → license   → verify Stripe sub
 * 3) if allowTrial && email → active trial? allow
 */
export async function requireAccess(
  req: Request,
  opts: { allowTrial?: boolean } = {}
): Promise<
  | { ok: true; customerId?: string; via: "license" | "trial"; trial?: TrialInfo }
  | { ok: false; status: 402; body: any }
> {
  const url = new URL(req.url);
  const key = (url.searchParams.get("key") || "").trim();
  const email = (url.searchParams.get("email") || "").trim();

  // 1) License key flow
  if (key) {
    const cusId = customerIdFromLicense(key);
    if (!cusId) {
      return {
        ok: false,
        status: 402,
        body: {
          error: "LEGACY_LICENSE_FORMAT",
          message:
            "Your license key is from an older format. Please regenerate your license.",
          upgradeUrl: "/pricing",
        },
      };
    }
    if (await hasActiveSub(cusId)) {
      return { ok: true, customerId: cusId, via: "license" };
    }
    return {
      ok: false,
      status: 402,
      body: {
        error: "SUB_INACTIVE",
        message:
          "Your subscription isn’t active. Please renew in the billing portal or purchase a plan.",
        upgradeUrl: "/pricing",
      },
    };
  }

  // 2) Email → license link
  if (email) {
    const link = await findLicenseByEmail(email);
    if (link && (await hasActiveSub(link.customerId))) {
      return { ok: true, customerId: link.customerId, via: "license" };
    }

    // 3) Trial allowance
    if (opts.allowTrial) {
      const trial = await readTrialByEmail(email);
      if (trial?.active) {
        return { ok: true, via: "trial", trial };
      }
    }
  }

  // No access
  return {
    ok: false,
    status: 402,
    body: {
      error: "UPGRADE_REQUIRED",
      message:
        "This feature requires Pro or an active trial. Provide your email (to continue trial) or purchase a license at /pricing.",
      upgradeUrl: "/pricing",
    },
  };
}

/* =========================
   Back-compat aliases (to satisfy existing imports)
   ========================= */

// Older routes may import these names:
export const readLicenseByEmail = findLicenseByEmail;     // alias
export const verifyStripeActive = hasActiveSub;           // alias
export const computeTrialStatusFromISO = computeCookieTrial; // alias
