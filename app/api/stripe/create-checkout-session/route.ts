import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

type Interval = "month" | "year";
type Currency = "INR" | "USD";

function getPriceId(interval: Interval, currency: Currency): string {
  const map = {
    INR: {
      month: process.env.PRICE_PRO_MONTHLY_INR,
      year: process.env.PRICE_PRO_ANNUAL_INR,
    },
    USD: {
      month: process.env.PRICE_PRO_MONTHLY_USD,
      year: process.env.PRICE_PRO_ANNUAL_USD,
    },
  } as const;

  const id = interval === "year" ? map[currency].year : map[currency].month;
  if (!id) {
    throw new Error(
      `Missing Price ID for ${currency} ${interval}. Check env vars: PRICE_PRO_${interval === "year" ? "ANNUAL" : "MONTHLY"}_${currency}`
    );
  }
  return id!;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const intervalRaw = String(body.interval || "month").toLowerCase();
    const interval: Interval = intervalRaw === "year" ? "year" : "month";
    const email: string | undefined = body.email?.toString();
    const currency: Currency = String(body.currency || "INR").toUpperCase() as Currency;

    if (currency !== "INR" && currency !== "USD") {
      return NextResponse.json({ error: "Invalid currency" }, { status: 400 });
    }
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }

    const priceId = getPriceId(interval, currency);
    const domain = process.env.DOMAIN;
    if (!domain) {
      return NextResponse.json({ error: "DOMAIN env var not set" }, { status: 500 });
    }

    // Default to SUBSCRIPTION mode for your plans; allow override if you need one-time payments
    const mode: "subscription" | "payment" =
      body.mode === "payment" ? "payment" : "subscription";

    // Base params shared by both modes
    const params: Stripe.Checkout.SessionCreateParams = {
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,

      // 🇮🇳 India export compliance: collect billing address in both modes
      billing_address_collection: "required",
      phone_number_collection: { enabled: true },

      allow_promotion_codes: true,
      success_url: `${domain}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${domain}/cancelled`,
      metadata: {
        app: "belief-blueprint",
        plan_interval: interval,
        plan_currency: currency,
      },
    };

    // Only in PAYMENT mode: explicitly tell Checkout to create/update the Customer
    if (mode === "payment") {
      (params as any).customer_creation = "always";
      (params as any).customer_update = { name: "auto", address: "auto" };
    }
    // In SUBSCRIPTION mode, Checkout will create/attach a Customer automatically
    // and persist collected billing details; no need for customer_creation.

    const session = await stripe.checkout.sessions.create(params);
    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (err: any) {
    console.error("create-checkout-session error:", err);
    return NextResponse.json(
      { error: err?.raw?.message || err?.message || "Checkout session error" },
      { status: 500 }
    );
  }
}
