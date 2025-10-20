import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

// Accept either: { sessionId, returnUrl } OR { customerId, returnUrl }
type Body =
  | { sessionId: string; returnUrl: string }
  | { customerId: string; returnUrl: string };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;

    const returnUrl = "returnUrl" in body ? body.returnUrl : null;
    if (!returnUrl || !/^https?:\/\//i.test(returnUrl)) {
      return NextResponse.json(
        { error: "Valid returnUrl is required." },
        { status: 400 }
      );
    }

    let customerId: string | undefined;

    if ("customerId" in body && body.customerId) {
      customerId = body.customerId;
    } else if ("sessionId" in body && body.sessionId) {
      const session = await stripe.checkout.sessions.retrieve(body.sessionId, {
        expand: ["customer"],
      });
      if (typeof session.customer === "string") {
        customerId = session.customer;
      } else if (session.customer?.id) {
        customerId = session.customer.id;
      }
    }

    if (!customerId) {
      return NextResponse.json(
        { error: "Could not determine customerId. Pass customerId or a valid sessionId." },
        { status: 400 }
      );
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return NextResponse.json({ url: portal.url });
  } catch (e: any) {
    console.error("create-portal-session error:", e);
    return NextResponse.json(
      { error: e?.raw?.message || e?.message || "Portal session error" },
      { status: 500 }
    );
  }
}
