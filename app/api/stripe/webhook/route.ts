// app/api/stripe/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import crypto from "crypto";
import { put } from "@vercel/blob";

export const runtime = "nodejs"; // Stripe SDK needs Node

// ---------- Per-project routing guards (configure in Vercel env) ----------
const ALLOWED_PRICE_IDS = (process.env.ALLOWED_PRICE_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean); // e.g. "price_123,price_456"

const EXPECTED_BLOB_SUBDOMAIN = process.env.EXPECTED_BLOB_SUBDOMAIN || ""; // e.g. "yortzkpqfilo9jvz"

// -------- Stripe init --------
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key, { apiVersion: "2024-06-20" });
}

function ok() {
  return NextResponse.json({ received: true }, { status: 200 });
}
function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

// -------- License helpers --------
function issueLicenseForCustomerId(customerId: string) {
  const short = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `LIC-PRO-${customerId}-${short}`;
}

function isDeletedCustomer(
  c: Stripe.Customer | Stripe.DeletedCustomer
): c is Stripe.DeletedCustomer {
  return (c as any).deleted === true;
}

function emailKey(emailRaw: string) {
  const e = String(emailRaw || "").trim().toLowerCase();
  return e.replace(/[^a-z0-9._-]+/g, "_");
}

// ---------- Blob routing preflight (HARD ISOLATION) ----------
let preflightPassedThisRequest = false;

async function assertBlobStoreIsolation() {
  const token = process.env.BLOB_READ_WRITE_TOKEN || "";

  // Case-insensitive match to handle mixed-case tokens/subdomains
  if (
    !token.toLowerCase().includes(EXPECTED_BLOB_SUBDOMAIN.toLowerCase())
  ) {
    throw new Error("BLOB token mismatch — check EXPECTED_BLOB_SUBDOMAIN.");
  }

  if (preflightPassedThisRequest) return;
  preflightPassedThisRequest = true;

  const subHint = EXPECTED_BLOB_SUBDOMAIN
    ? `expected: ${EXPECTED_BLOB_SUBDOMAIN}`
    : "(no expectation set)";

  console.log("[BLOB][preflight] skip probe write (hard isolation assumed)", {
    subHint,
    hasToken: !!token,
  });
}

// ---- Persist license record to Vercel Blob ----
async function saveLicenseRecord(params: {
  customerId: string;
  licenseKey: string | null;
  email?: string | null;
  source: string;
  extra?: Record<string, any>;
  writeLatest?: boolean;
  writeHistory?: boolean;
}) {
  const {
    customerId,
    licenseKey,
    email = null,
    source,
    extra = {},
    writeLatest = true,
    writeHistory = true,
  } = params;

  // Enforce isolation before any writes
  await assertBlobStoreIsolation();

  const record = {
    customerId,
    licenseKey,
    email,
    source,
    savedAt: new Date().toISOString(),
    ...extra,
  };

  const token = process.env.BLOB_READ_WRITE_TOKEN || "";
  const putOpts: Parameters<typeof put>[2] = {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false, // stable file names
    ...(token ? { token } : {}),
  };

  const logWrite = (label: string, url: string) => {
    try {
      const u = new URL(url);
      const sub = u.host.split(".")[0];
      console.log(`[BLOB] ${label}`, { url, storeSubdomain: sub });
    } catch {
      console.log(`[BLOB] ${label}`, { url });
    }
  };

  if (writeLatest) {
    const latest = await put(
      `licenses/${customerId}.json`,
      Buffer.from(JSON.stringify(record, null, 2)),
      putOpts
    );
    logWrite("wrote latest", latest.url);

    if (email) {
      const ek = emailKey(email);
      const byEmail = await put(
        `licenses_by_email/${ek}.json`,
        Buffer.from(JSON.stringify(record, null, 2)),
        putOpts
      );
      logWrite("wrote email index", byEmail.url);
    }
  }

  if (writeHistory) {
    const hist = await put(
      `licenses_history/${customerId}-${Date.now()}.json`,
      Buffer.from(JSON.stringify(record, null, 2)),
      putOpts
    );
    logWrite("wrote history", hist.url);
  }
}

// ---------- Webhook ----------
export async function POST(req: NextRequest) {
  const stripe = getStripe();

  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) return bad("STRIPE_WEBHOOK_SECRET not set", 500);
  if (!sig) return bad("Missing Stripe signature header");

  // Simple env trace
  console.log("[stripe:webhook] env", {
    projectUrl: process.env.VERCEL_URL || null,
    hasBlobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
    priceAllowlistSize: ALLOWED_PRICE_IDS.length,
    expectedBlobSubdomain: EXPECTED_BLOB_SUBDOMAIN || "(none)",
  });

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err?.message || err);
    return ok(); // acknowledge to avoid retries
  }

  try {
    switch (event.type) {
      // ----------------------------------------------------------
      // 1) Checkout completes: create license (allowlist-enforced)
      // ----------------------------------------------------------
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // --- Option A: fetch line items to enforce price allow-list ---
        let priceIds = new Set<string>();
        try {
          const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
          for (const li of items.data) {
            // Stripe.LineItem has price?.id. Avoid direct li.plan (not typed).
            const id =
              li.price?.id ??
              (li as any)?.plan?.id ?? // legacy/older shapes (if any)
              (li as any)?.price ??    // raw id fallback (rare)
              null;
            if (typeof id === "string") priceIds.add(id);
          }
        } catch (e) {
          console.warn("[stripe:webhook] listLineItems failed", { sessionId: session.id, e });
        }

        if (ALLOWED_PRICE_IDS.length > 0) {
          const allowed = [...priceIds].some((id) => ALLOWED_PRICE_IDS.includes(id));
          if (!allowed) {
            console.log("[stripe:webhook] skipped checkout.session.completed (no allowed price ids)", {
              sessionId: session.id,
              priceIds: [...priceIds],
              allowedList: ALLOWED_PRICE_IDS,
            });
            return ok();
          }
        }

        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id;

        if (!customerId) {
          console.error("checkout.session.completed: missing customer id");
          return ok();
        }

        const licenseKey = issueLicenseForCustomerId(customerId);
        await stripe.customers.update(customerId, {
          metadata: { license_key: licenseKey },
        });

        let email: string | null = session.customer_details?.email ?? null;
        if (!email) {
          try {
            const cust = await stripe.customers.retrieve(customerId);
            email = isDeletedCustomer(cust) ? null : cust.email ?? null;
          } catch {
            email = null;
          }
        }

        await saveLicenseRecord({
          customerId,
          licenseKey,
          email,
          source: "checkout.session.completed",
          extra: {
            sessionId: session.id,
            mode: session.mode,
            currency: session.currency,
            amount_total: session.amount_total,
          },
          writeLatest: true,
          writeHistory: true,
        });

        console.log("Issued license:", licenseKey, "for", customerId);
        return ok();
      }

      // ----------------------------------------------------------
      // 2) Subscription created: backfill license if missing (allowlist)
      // ----------------------------------------------------------
      case "customer.subscription.created": {
        const sub = event.data.object as Stripe.Subscription;

        if (ALLOWED_PRICE_IDS.length > 0) {
          const ids = (sub.items?.data || [])
            .map((it) => it.price?.id || (it as any).plan?.id)
            .filter(Boolean) as string[];
          const allowed = ids.some((id) => ALLOWED_PRICE_IDS.includes(id));
          if (!allowed) {
            console.log("[stripe:webhook] skipped subscription.created (no allowed price ids)", {
              subId: sub.id,
              priceIds: ids,
              allowedList: ALLOWED_PRICE_IDS,
            });
            return ok();
          }
        }

        const customerId =
          typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
        if (!customerId) return ok();

        let email: string | null = null;
        let licenseKey: string | null = null;

        try {
          const customer = await stripe.customers.retrieve(customerId);
          if (!isDeletedCustomer(customer)) {
            email = customer.email ?? null;
            licenseKey = (customer.metadata?.license_key as string | undefined) ?? null;
          }
        } catch {
          // ignore
        }

        if (!licenseKey) {
          licenseKey = issueLicenseForCustomerId(customerId);
          await stripe.customers.update(customerId, {
            metadata: { license_key: licenseKey },
          });
          console.log("Backfilled license:", licenseKey, "for", customerId);
        }

        await saveLicenseRecord({
          customerId,
          licenseKey,
          email,
          source: "customer.subscription.created",
          extra: {
            subscriptionId: sub.id,
            status: sub.status,
            current_period_end: sub.current_period_end,
          },
          writeLatest: true,
          writeHistory: true,
        });

        return ok();
      }

      // ----------------------------------------------------------
      // 3) Subscription updated: history-only (allowlist)
      // ----------------------------------------------------------
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;

        if (ALLOWED_PRICE_IDS.length > 0) {
          const ids = (sub.items?.data || [])
            .map((it) => it.price?.id || (it as any).plan?.id)
            .filter(Boolean) as string[];
          const allowed = ids.some((id) => ALLOWED_PRICE_IDS.includes(id));
          if (!allowed) {
            console.log("[stripe:webhook] skipped subscription.updated (no allowed price ids)", {
              subId: sub.id,
              priceIds: ids,
              allowedList: ALLOWED_PRICE_IDS,
            });
            return ok();
          }
        }

        const customerId =
          typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
        if (!customerId) return ok();

        let email: string | null = null;
        let licenseKey: string | null = null;

        try {
          const customer = await stripe.customers.retrieve(customerId);
          if (!isDeletedCustomer(customer)) {
            email = customer.email ?? null;
            licenseKey = (customer.metadata?.license_key as string | undefined) ?? null;
          }
        } catch {
          // ignore
        }

        await saveLicenseRecord({
          customerId,
          licenseKey: licenseKey ?? null,
          email,
          source: "customer.subscription.updated",
          extra: {
            subscriptionId: sub.id,
            status: sub.status,
            current_period_end: sub.current_period_end,
          },
          writeLatest: false, // history only
          writeHistory: true,
        });

        return ok();
      }

      // ----------------------------------------------------------
      // 4) Subscription canceled/deleted: history-only (allowlist)
      // ----------------------------------------------------------
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;

        if (ALLOWED_PRICE_IDS.length > 0) {
          const ids = (sub.items?.data || [])
            .map((it) => it.price?.id || (it as any).plan?.id)
            .filter(Boolean) as string[];
          const allowed = ids.some((id) => ALLOWED_PRICE_IDS.includes(id));
          if (!allowed) {
            console.log("[stripe:webhook] skipped subscription.deleted (no allowed price ids)", {
              subId: sub.id,
              priceIds: ids,
              allowedList: ALLOWED_PRICE_IDS,
            });
            return ok();
          }
        }

        const customerId =
          typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
        if (!customerId) return ok();

        let email: string | null = null;
        let licenseKey: string | null = null;

        try {
          const customer = await stripe.customers.retrieve(customerId);
          if (!isDeletedCustomer(customer)) {
            email = customer.email ?? null;
            licenseKey = (customer.metadata?.license_key as string | undefined) ?? null;
          }
        } catch {
          // ignore
        }

        await saveLicenseRecord({
          customerId,
          licenseKey: licenseKey ?? null,
          email,
          source: "customer.subscription.deleted",
          extra: {
            subscriptionId: sub.id,
            status: sub.status,
            current_period_end: sub.current_period_end,
          },
          writeLatest: false, // keep latest; log event
          writeHistory: true,
        });

        return ok();
      }

      // Optional: renewals / dunning history if you care
      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        return ok();
      }

      default:
        return ok();
    }
  } catch (err: any) {
    console.error("Webhook handler error:", err?.message || err);
    // Always acknowledge to avoid Stripe retries; logs show the cause
    return ok();
  }
}
