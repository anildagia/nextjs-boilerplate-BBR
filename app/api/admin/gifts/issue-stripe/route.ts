// app/api/admin/gifts/issue-stripe/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import crypto from "crypto";
import { put } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- env / sdk ---------- */
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key, { apiVersion: "2024-06-20" });
}
function unauthorized(msg = "Unauthorized") {
  return NextResponse.json({ error: "UNAUTHORIZED", message: msg }, { status: 401 });
}
function bad(msg: string, code = 400) {
  return NextResponse.json({ error: "BAD_REQUEST", message: msg }, { status: code });
}

/* ---------- license helpers ---------- */
function issueLicenseForCustomerId(customerId: string) {
  const short = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `LIC-PRO-${customerId}-${short}`;
}
function emailKey(emailRaw: string) {
  const e = String(emailRaw || "").trim().toLowerCase();
  return e.replace(/[^a-z0-9._-]+/g, "_");
}

/* ---------- blob writer (stable) ---------- */
async function saveLicenseRecord(params: {
  customerId: string;
  licenseKey: string;
  email?: string | null;
  source: string; // "admin.issue"
  extra?: Record<string, any>;
}) {
  const { customerId, licenseKey, email = null, source, extra = {} } = params;
  const record = {
    customerId,
    licenseKey,
    email,
    source,
    savedAt: new Date().toISOString(),
    ...extra,
  };

  const putOpts: Parameters<typeof put>[2] = {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    ...(process.env.BLOB_READ_WRITE_TOKEN ? { token: process.env.BLOB_READ_WRITE_TOKEN } : {}),
  };

  // latest by customer
  await put(
    `licenses/${customerId}.json`,
    Buffer.from(JSON.stringify(record, null, 2)),
    putOpts
  );

  // immutable history
  await put(
    `licenses_history/${customerId}-${Date.now()}.json`,
    Buffer.from(JSON.stringify(record, null, 2)),
    putOpts
  );

  // optional index by email
  if (email) {
    const ek = emailKey(email);
    await put(
      `licenses_by_email/${ek}.json`,
      Buffer.from(JSON.stringify(record, null, 2)),
      putOpts
    );
  }
}

/* ---------- core handler ---------- */
async function handle(req: NextRequest) {
  // auth
  const adminToken = process.env.ADMIN_TOKEN;
  const token = req.nextUrl.searchParams.get("token") || req.headers.get("x-admin-token") || "";
  if (!adminToken || token !== adminToken) return unauthorized();

  const stripe = getStripe();

  // inputs (GET query or POST json)
  let email = req.nextUrl.searchParams.get("email") || "";
  let daysStr = req.nextUrl.searchParams.get("days") || "";
  let price = req.nextUrl.searchParams.get("price") || ""; // optional if GIFT_PRICE_ID set

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (body?.email) email = String(body.email);
    if (body?.days) daysStr = String(body.days);
    if (body?.price) price = String(body.price);
  }

  email = email.trim();
  const days = Math.max(1, parseInt(daysStr || "30", 10));
  const priceId = price || process.env.GIFT_PRICE_ID;

  if (!email) return bad("Missing email");
  if (!priceId) return bad("Missing price (provide ?price= or set GIFT_PRICE_ID in env)");

  // find or create customer (avoid Search API)
  let customerId: string | null = null;
  {
    const existing = await stripe.customers.list({ email, limit: 1 });
    if (existing.data[0]) {
      customerId = existing.data[0].id;
    } else {
      const created = await stripe.customers.create({ email });
      customerId = created.id;
    }
  }

  // create license & persist on customer
  const licenseKey = issueLicenseForCustomerId(customerId);
  await stripe.customers.update(customerId, {
    metadata: { license_key: licenseKey, gift_issued_by: "admin" },
  });

  // create a $0 trial subscription (no payment method) that auto-cancels after N days
  // strategy: use a normal price but set trial_end to now + days; also set cancel_at (or schedule revoke from admin later)
  const nowSec = Math.floor(Date.now() / 1000);
  const trialEnd = nowSec + days * 24 * 60 * 60;

  const sub = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    trial_end: trialEnd,
    payment_behavior: "default_incomplete",
    // Ensure it doesn’t try to invoice during trial
    collection_method: "charge_automatically",
    metadata: { gift: "true" },
  });

  // Write Blob records
  await saveLicenseRecord({
    customerId,
    licenseKey,
    email,
    source: "admin.issue",
    extra: {
      subscriptionId: sub.id,
      trialEndsAt: new Date(trialEnd * 1000).toISOString(),
      days,
    },
  });

  return NextResponse.json({
    ok: true,
    message: `Gift issued for ${email}`,
    customerId,
    licenseKey,
    subscriptionId: sub.id,
    trialEndsAt: new Date(trialEnd * 1000).toISOString(),
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
