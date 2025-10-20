// app/api/admin/gifts/revoke-stripe/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
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

/* ---------- blob writer (stable) ---------- */
function emailKey(emailRaw: string) {
  const e = String(emailRaw || "").trim().toLowerCase();
  return e.replace(/[^a-z0-9._-]+/g, "_");
}
async function saveLicenseRecord(params: {
  customerId: string;
  licenseKey: string | null;
  email?: string | null;
  source: string; // "admin.revoke"
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

  await put(
    `licenses/${customerId}.json`,
    Buffer.from(JSON.stringify(record, null, 2)),
    putOpts
  );
  await put(
    `licenses_history/${customerId}-${Date.now()}.json`,
    Buffer.from(JSON.stringify(record, null, 2)),
    putOpts
  );
  if (email) {
    const ek = emailKey(email);
    await put(
      `licenses_by_email/${ek}.json`,
      Buffer.from(JSON.stringify(record, null, 2)),
      putOpts
    );
  }
}

/* ---------- utilities ---------- */
function customerIdFromLicense(licenseKey?: string | null) {
  if (!licenseKey) return null;
  const parts = licenseKey.trim().split("-");
  return parts.find((p) => p.startsWith("cus_")) || null;
}

async function resolveCustomerId(
  stripe: Stripe,
  opts: { customerId?: string | null; license?: string | null; email?: string | null }
) {
  if (opts.customerId) return opts.customerId;
  if (opts.license) {
    const fromKey = customerIdFromLicense(opts.license);
    if (fromKey) return fromKey;
  }
  if (opts.email) {
    const list = await stripe.customers.list({ email: opts.email, limit: 1 });
    if (list.data[0]) return list.data[0].id;
  }
  return null;
}

/* ---------- core handler ---------- */
async function handle(req: NextRequest) {
  // auth
  const adminToken = process.env.ADMIN_TOKEN;
  const token = req.nextUrl.searchParams.get("token") || req.headers.get("x-admin-token") || "";
  if (!adminToken || token !== adminToken) return unauthorized();

  const stripe = getStripe();

  // inputs
  let customerId = req.nextUrl.searchParams.get("customerId") || "";
  let license = req.nextUrl.searchParams.get("license") || "";
  let email = req.nextUrl.searchParams.get("email") || "";

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (body?.customerId) customerId = String(body.customerId);
    if (body?.license) license = String(body.license);
    if (body?.email) email = String(body.email);
  }

  const cusId = await resolveCustomerId(stripe, {
    customerId: customerId || null,
    license: license || null,
    email: email || null,
  });
  if (!cusId) return bad("Could not resolve customer");

  // cancel all active/trialing subscriptions
  const subs = await stripe.subscriptions.list({ customer: cusId, status: "all", expand: ["data.items"] });
  const targets = subs.data.filter((s) => ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(s.status));

  for (const s of targets) {
    await stripe.subscriptions.cancel(s.id);
  }

  // read email + license_key to store in blob
  let custEmail: string | null = null;
  let licenseKey: string | null = null;
  try {
    const cust = await stripe.customers.retrieve(cusId);
    // @ts-ignore
    custEmail = "deleted" in cust && cust.deleted ? null : (cust.email ?? null);
    // @ts-ignore
    licenseKey = "deleted" in cust && cust.deleted ? null : ((cust.metadata?.license_key as string | undefined) ?? null);
  } catch {
    // ignore; still proceed
  }

  await saveLicenseRecord({
    customerId: cusId,
    licenseKey,
    email: custEmail,
    source: "admin.revoke",
    extra: {
      revokedAt: new Date().toISOString(),
      revokedSubs: targets.map((t) => ({ id: t.id, status: t.status })),
    },
  });

  return NextResponse.json({
    ok: true,
    message: `Revoked ${targets.length} subscription(s) for ${cusId}`,
    customerId: cusId,
    revokedSubscriptions: targets.map((t) => t.id),
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
