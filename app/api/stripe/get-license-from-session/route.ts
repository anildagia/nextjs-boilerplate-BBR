// app/api/stripe/get-license-from-session/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

function issueNewLicense(customerId: string) {
  const short = crypto.randomBytes(4).toString("hex").toUpperCase(); // 8 hex chars
  return `LIC-PRO-${customerId}-${short}`; // LIC-PRO-cus_xxx-XXXXXXXX
}

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get("session_id");
    if (!sessionId) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["customer"],
    });

    const customerId =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id;

    if (!customerId) {
      return NextResponse.json({ error: "No customer on session" }, { status: 400 });
    }

    const customer = await stripe.customers.retrieve(customerId);
    // @ts-ignore metadata typing can be undefined
    const existing: string | undefined = (customer as any).metadata?.license_key;

    if (existing && existing.includes("cus_")) {
      // Return BOTH license and customerId so UI can use either path
      return NextResponse.json({ licenseKey: existing, customerId }, { status: 200 });
    }

    const licenseKey = issueNewLicense(customerId);
    await stripe.customers.update(customerId, {
      metadata: { license_key: licenseKey },
    });

    return NextResponse.json({ licenseKey, customerId }, { status: 200 });
  } catch (e: any) {
    console.error("get-license-from-session error:", e?.message || e);
    return NextResponse.json(
      { error: "LICENSE_FETCH_FAILED" },
      { status: 500 }
    );
  }
}
