// app/api/trial/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getTrialDays, readTrialCookie, trialRemainingDays } from "../../_lib/trial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { startedAt } = readTrialCookie(req);
  const trialDays = getTrialDays();
  const status = trialRemainingDays(req);

  return NextResponse.json(
    {
      trialDays,
      startedAt: startedAt ?? null,
      isActive: startedAt ? status.isActive : false,
      daysLeft: startedAt ? status.daysLeft : trialDays,
      endsAtISO: startedAt ? status.endsAtISO : null,
    },
    { status: 200 }
  );
}
