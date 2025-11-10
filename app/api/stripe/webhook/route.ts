// app/api/stripe/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import crypto from "crypto";
import { put } from "@vercel/blob";

export const runtime = "nodejs"; // Stripe SDK needs Node

// ---- Optional: hard routing guards (set per-project) ----
// Example: Only accept events containing these price IDs
const ALLOWED_PRICE_IDS = (process.env.ALLOWED_PRICE_IDS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Example: ensure writes go to the expected blob subdomain (safety net)
const EXPECTED_BLOB_SUBDOMAIN = process.env.EXPECTED_BLOB_SUBDOMAIN || ""; // e.g. "yortzkpqfilo9jvz"

// --- Stripe init ---
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

// Create a new-format license: LIC-PRO-<cus_XXXX>-<8HEX>
function issueLicenseForCustomerId(customerId: string) {
  const short = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `LIC-PRO-${customerId}-${short}`;
}

// ---- Stripe helpers / type guards ----
function isDeletedCustomer(
  c: Stripe.Customer | Stripe.DeletedCustomer
): c is Stripe.DeletedCustomer {
  return (c as any).deleted === true;
}

// normalize email to a blob-safe key: lowercased + only [a-z0-9._-]
function emailKey(emailRaw: string) {
  const e = String(emailRaw || "").trim().toLowerCase();
  return e.replace(/[^a-z0-9._-]+/g, "_");
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

  const record = {
    customerId,
    licenseKey,
    email,
    source,
    savedAt: new Date().toISOString(),
    ...extra,
  };

  const token = process.env.BLOB_READ_WRITE_TOKEN || "";
  const tokenPreview = token ? `${token.slice(0, 12)}…${token.slice(-6)}` : null;

  const putOpts: Parameters<typeof put>[2] = {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,           // stable file names
    ...(token ? { token } : {}),
  };

  // Helper to log destination store subdomain
  const logWrite = (label: string, url: string) => {
    try {
      const u = new URL(url);
      const host = u.host; // e.g. yortzkpqfilo9jvz.public.blob.vercel-storage.com
      const sub = host.split(".")[0];
      console.log(`[BLOB] ${label}`, { url, storeSubdomain: sub, tokenPreview });
      if (EXPECTED_BLOB_SUBDOMAIN && sub !== EXPECTED_BLOB_SUBDOMAIN) {
        console.warn(`[BLOB][WARN] Expected subdomain "${EXPECTED_BLOB_SUBDOMAIN}" but wrote to "${sub}". Check env token!`);
      }
    } catch {
      console.log(`[BLOB] ${label}`, { url, tokenPreview });
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

export async function POST(req: NextRequest) {
  const stripe = getStripe();

  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) return bad("STRIPE_WEBHOOK_SECRET not set", 500);
  if (!sig) return bad("Missing Stripe signature header");

  // For quick env provenance while debugging
  console.log("[stripe:webhook] env", {
    projectUrl: process.env.VERCEL_URL || null,
    tokenPreview: process.env.BLOB_READ_WRITE_TOKEN
      ? `${process.env.BLOB_READ_WRITE_TOKEN.slice(0, 12)}…${process.env.BLOB_READ_WRITE_TOKEN.slice(-6)}`
      : null,
    secretPreview: `${secret.slice(0, 8)}…${secret.slice(-4)}`,
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
    // Optional per-project routing based on known price IDs
    if (ALLOWED_PRICE_IDS.length > 0) {
      const obj: any = event.data.object;
      const lineItems = obj?.lines?.data || obj?.display_items || [];
      const priceIds = new Set<string>();

      // Try to collect price ids from common event shapes
      if (Array.isArray(lineItems)) {
        for (const li of lineItems) {
          const priceId =
            li?.price?.id ||
            li?.plan?.id ||
            li?.price ||
            li?.plan ||
            null;
          if (typeof priceId === "string") priceIds.add(priceId);
        }
      }
      if (obj?.subscription_items?.data) {
        for (const it of obj.subscription_items.data) {
          const pid = it?.price?.id || it?.plan?.id;
          if (typeof pid === "string") priceIds.add(pid);
        }
      }

      const hasAllowed = [...priceIds].some(id => ALLOWED_PRICE_IDS.includes(id));
      if (!hasAllowed) {
        console.log("[stripe:webhook] skipped (no allowed price ids)", {
          eventType: event.type,
          priceIds: [...priceIds],
        });
        return ok();
      }
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

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

      case "customer.subscription.created": {
        const sub = event.data.object as Stripe.Subscription;
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

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
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
          writeLatest: false,
          writeHistory: true,
        });

        return ok();
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
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
          writeLatest: false,
          writeHistory: true,
        });

        return ok();
      }

      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        return ok();
      }

      default:
        return ok();
    }
  } catch (err: any) {
    console.error("Webhook handler error:", err?.message || err);
    return ok();
  }
}
