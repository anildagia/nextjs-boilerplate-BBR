// app/api/beliefs/scan/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDayStamp, incAndCheck } from "../../_lib/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function inferBelief(input: string) {
  if (/pricing|charge|fee|price/i.test(input)) return "I can’t charge high fees";
  if (/rejection|no\b|ghost/i.test(input)) return "People will reject me";
  if (/time|busy|delay|procrastinat/i.test(input)) return "I never have enough time";
  return "I’m not ready / I’m not enough";
}

function getAnonId(req: NextRequest, bodyAnonId?: string) {
  // Prefer a stable anonId from the request body (the GPT can send one).
  if (bodyAnonId && typeof bodyAnonId === "string") return bodyAnonId.slice(0, 128);

  // Fallback: best-effort from headers (works fine for MVP)
  const ip =
    req.headers.get("x-forwarded-for") ||
    req.headers.get("x-real-ip") ||
    req.headers.get("x-vercel-proxied-for") ||
    "unknown";

  return `ip:${ip}`;
}

export async function POST(req: NextRequest) {
  try {
    const { situation = "", emotion = "", anonId } = await req.json().catch(() => ({}));

    // --- 5 scans per calendar day (UTC) per anonId/ip ---
    const userKey = `${getAnonId(req, anonId)}::${getDayStamp()}`;
    const { allowed, count } = incAndCheck(userKey, 5);
    if (!allowed) {
      return NextResponse.json(
        {
          error: "FREE_LIMIT_REACHED",
          message:
            "Daily free limit reached (5/day). Pro unlocks unlimited scans, NLP reframes, and a 7-day plan.",
          upgradeUrl: "/pricing",
        },
        { status: 429 }
      );
    }

    const belief = inferBelief(`${situation} ${emotion}`.trim());

    return NextResponse.json({
      belief,
      prompts: [
        "List 3 cases where this belief wasn’t true.",
        "If it were 10% easier, what would you attempt this week?",
        "Who can reflect evidence back to you?",
      ],
      severity: 6,
      usage: { todayCount: count, todayLimit: 5 },
      safety:
        "Not therapy; if distressed, use local crisis resources. Say 'gentle mode' for softer pacing.",
    });
  } catch (e: any) {
    console.error("beliefs/scan error:", e?.message || e);
    return NextResponse.json(
      { error: "SCAN_ERROR", message: "Could not process scan." },
      { status: 500 }
    );
  }
}
