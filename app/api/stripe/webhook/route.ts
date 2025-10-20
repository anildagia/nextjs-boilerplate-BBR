// app/api/stripe/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import crypto from "crypto";
import { put } from "@vercel/blob";

export const runtime = "nodejs"; // Stripe SDK needs Node

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
// One stable "latest" per customer (and by-email), plus append-only history.
async function saveLicenseRecord(params: {
  customerId: string;
  licenseKey: string | null;
  email?: string | null;
  source: string; // e.g., "checkout.session.completed" | "subscription.created" | "subscription.updated" | "subscription.deleted"
  extra?: Record<string, any>;
  writeLatest?: boolean;   // overwrite stable key(s)
  writeHistory?: boolean;  // append immutable record
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

  const putOpts: Parameters<typeof put>[2] = {
    access: "public",                 // server SDK currently typed for "public"
    contentType: "application/json",
    addRandomSuffix: false,           // <<< force stable filenames
    ...(process.env.BLOB_READ_WRITE_TOKEN
      ? { token: process.env.BLOB_READ_WRITE_TOKEN }
      : {}),
  };

  if (writeLatest) {
    // Stable “latest” for quick lookup by customerId
    const latest = await put(
      `licenses/${customerId}.json`,
      Buffer.from(JSON.stringify(record, null, 2)),
      putOpts
    );
    console.log("[BLOB] wrote latest:", latest.url);

    // Stable by-email index (only if email available)
    if (email) {
      const ek = emailKey(email);
      const byEmail = await put(
        `licenses_by_email/${ek}.json`,
        Buffer.from(JSON.stringify(record, null, 2)),
        putOpts
      );
      console.log("[BLOB] wrote email index:", byEmail.url);
    }
  }

  if (writeHistory) {
    // Append immutable history entry (timestamp makes it unique)
    const hist = await put(
      `licenses_history/${customerId}-${Date.now()}.json`,
      Buffer.from(JSON.stringify(record, null, 2)),
      putOpts
    );
    console.log("[BLOB] wrote history:", hist.url);
  }
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();

  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return bad("STRIPE_WEBHOOK_SECRET not set", 500);
  if (!sig) return bad("Missing Stripe signature header");

  // Stripe requires the raw body for signature verification
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err?.message || err);
    return bad("Invalid signature", 400);
  }

  try {
    switch (event.type) {
      // ----------------------------------------------------------
      // 1) Checkout completes: create license, write latest + history
      // ----------------------------------------------------------
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // Customer id from session
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id;

        if (!customerId) {
          console.error("checkout.session.completed: missing customer id");
          return ok();
        }

        // Generate license and store on Customer metadata
        const licenseKey = issueLicenseForCustomerId(customerId);
        await stripe.customers.update(customerId, {
          metadata: { license_key: licenseKey },
        });

        // Capture email: prefer session details; else fetch customer safely
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
      // 2) Subscription created: backfill license if missing,
      //    write latest + history
      // ----------------------------------------------------------
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
          writeLatest: true,   // reflect current state
          writeHistory: true,
        });

        return ok();
      }

      // ----------------------------------------------------------
      // 3) Subscription updated: license typically unchanged,
      //    write history-only (optional: set writeLatest: true if you
      //    want the latest snapshot to mirror status immediately)
      // ----------------------------------------------------------
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
          writeLatest: false,  // history only (toggle to true if desired)
          writeHistory: true,
        });

        return ok();
      }

      // ----------------------------------------------------------
      // 4) Subscription canceled/deleted: history-only
      // ----------------------------------------------------------
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
          writeLatest: false,  // keep last known “latest”; just log history
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
        // Ignore other events (but still 200 to prevent retries)
        return ok();
    }
  } catch (err: any) {
    console.error("Webhook handler error:", event.type, err?.message || err);
    // Acknowledge to avoid retry storms; logs are enough to debug
    return ok();
  }
}
