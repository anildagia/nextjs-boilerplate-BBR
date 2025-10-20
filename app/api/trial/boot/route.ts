// app/api/trial/boot/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  TRIAL_DAYS,
  readTrialByEmail,
  ensureTrialByEmail,
  computeTrialStatusFromISO, // alias of computeCookieTrial(startIso: string)
  readLicenseByEmail,
  verifyStripeActive,        // alias of hasActiveSub(customerId)
} from "../../_lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Decision order:
 * 1) If no email → return mode: "email_required" (do not start cookie trial).
 * 2) If email present:
 *    a) Lookup license_by_email → if Stripe sub active → mode: "pro".
 *    b) Else check trial file → if active → mode: "trial".
 *    c) Else create trial → mode: "trial".
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const email = (url.searchParams.get("email") || "").trim();

    // 1) Email is required now (no cookie fallback in this flow)
    if (!email) {
      return NextResponse.json(
        {
          mode: "email_required",
          message:
            "Email required to start or look up your trial/license. Please provide your email to continue.",
        },
        { status: 200 }
      );
    }

    // 2a) License lookup by email
    const link = await readLicenseByEmail(email); // { licenseKey, customerId } | null
    if (link && (await verifyStripeActive(link.customerId))) {
      return NextResponse.json(
        {
          mode: "pro",
          message: "Pro license active.",
          customerId: link.customerId,
          licenseKey: link.licenseKey,
        },
        { status: 200 }
      );
    }

    // 2b) Existing trial?
    const existing = await readTrialByEmail(email); // TrialInfo | null
    if (existing?.startedAt) {
      const status = computeTrialStatusFromISO(existing.startedAt); // ONE ARG ONLY
      if (status.active) {
        const dayIndex = Math.min(status.daysTotal, status.daysUsed + 1);
        return NextResponse.json(
          {
            mode: "trial",
            message: `Free trial active — day ${dayIndex} of ${status.daysTotal}.`,
            ...status,
          },
          { status: 200 }
        );
      } else {
        // Trial exists but expired — do not auto-start a new one
        return NextResponse.json(
          {
            mode: "trial_expired",
            message:
              "Your free trial has ended. Please purchase a Pro license to continue.",
            ...status,
          },
          { status: 200 }
        );
      }
    }

    // 2c) No trial yet → create idempotently and return active status
    const started = await ensureTrialByEmail(email);
    if (started.active) {
      const dayIndex = Math.min(started.daysTotal, started.daysUsed + 1);
      return NextResponse.json(
        {
          mode: "trial",
          message: `Free trial started — day ${dayIndex} of ${started.daysTotal}.`,
          ...started,
        },
        { status: 200 }
      );
    }

    // Fallback (shouldn’t happen)
    return NextResponse.json(
      {
        mode: "trial_expired",
        message:
          "Your free trial is not active. Please purchase a Pro license to continue.",
        daysTotal: TRIAL_DAYS,
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("trial/boot error:", e?.message || e);
    return NextResponse.json(
      { error: "TRIAL_BOOT_ERROR", message: "Unable to check access." },
      { status: 500 }
    );
  }
}
