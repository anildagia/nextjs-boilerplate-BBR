// app/api/_lib/paywall.ts
import Stripe from "stripe";

// ---- Types ----
export type ProGateFail = {
  ok: false;
  status: number; // 402, 401, etc.
  body: { error?: string; message: string; upgradeUrl?: string };
};

export type ProGateOk = {
  ok: true;
  customerId: string; // cus_XXXX extracted from the license
};

export type ProGateResult = ProGateFail | ProGateOk;

// ---- Stripe (lazy init; no Search API used) ----
function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key, { apiVersion: "2024-06-20" });
}

// Extract customer id from license format: LIC-PRO-cus_XXXX-ABCDEFGH
export function customerIdFromLicense(licenseKey: string): string | null {
  const parts = (licenseKey || "").trim().split("-");
  const candidate = parts.find((p) => p.startsWith("cus_"));
  return candidate || null;
}

// Check if the customer has an active/trialing subscription
export async function hasActiveSubscription(stripe: Stripe, customerId: string): Promise<boolean> {
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    expand: ["data.items"],
  });
  const active = subs.data.find((s) =>
    ["active", "trialing", "past_due", "unpaid"].includes(s.status)
  );
  return !!active && (active.status === "active" || active.status === "trialing");
}

// Read license key from either query (?key=...) or header (X-License-Key)
export function readLicenseFrom(req: Request): string {
  // `req.url` exists in Next.js runtime (both Edge/Node). Safe to parse.
  const url = new URL(req.url);
  const qp = url.searchParams.get("key");
  const header = req.headers.get("x-license-key");
  return (qp || header || "").trim();
}

// Main guard: ensure Pro subscription
export async function requirePro(req: Request): Promise<ProGateResult> {
  try {
    const licenseKey = readLicenseFrom(req);

    if (!licenseKey) {
      return {
        ok: false,
        status: 402,
        body: {
          error: "UPGRADE_REQUIRED",
          message: "Pro is required for this feature. Visit /pricing and paste your license key.",
          upgradeUrl: "/pricing",
        },
      };
    }

    const cusId = customerIdFromLicense(licenseKey);
    if (!cusId) {
      return {
        ok: false,
        status: 402,
        body: {
          error: "LEGACY_LICENSE_FORMAT",
          message:
            "Your license key is from an older format. Please regenerate your license from the latest checkout success page or contact support.",
          upgradeUrl: "/pricing",
        },
      };
    }

    const stripe = getStripe();
    const active = await hasActiveSubscription(stripe, cusId);
    if (!active) {
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

    return { ok: true, customerId: cusId };
  } catch (e: any) {
    console.error("requirePro error:", e?.message || e);
    return {
      ok: false,
      status: 401,
      body: {
        error: "PAYWALL_ERROR",
        message: "Could not verify license at the moment. Please try again shortly.",
      },
    };
    // Note: we intentionally do NOT throw; callers can safely return JSON with this.
  }
}
