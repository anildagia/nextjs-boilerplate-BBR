// app/api/beliefs/reframe/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requirePro } from "../../_lib/paywall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------- Reframe logic (deterministic, concise) ----------
function buildReframeSteps(belief: string, context: string) {
  const b = (belief || "").trim() || "I’m not enough";
  const c = (context || "").trim();

  const steps = [
    `Name it precisely: “${b}”. Write 1–2 sentences that capture how it shows up${c ? ` in: ${c}` : ""}.`,
    "Counter-evidence: list 5 concrete facts from the past month that weaken this belief.",
    `Workable reframe: “I don’t need certainty to act; I can take one useful step today toward what matters.”`,
    "Submodalities shift: shrink/dim the ‘threat’ image; brighten/bring closer the ‘capable’ scene.",
    "As-if experiment: act for 10 minutes as if the belief were 30% quieter; then note what changed.",
    "Anchor: 4/6 breath for 2 minutes; say your reframe aloud; take the next 60-second action.",
  ];

  return steps;
}

// ---------- Route ----------
export async function POST(req: NextRequest) {
  try {
    // 0) Pro gate (reads ?key=... or X-License-Key, verifies active sub)
    const gate = await requirePro(req as unknown as Request);
    if (!gate.ok) {
      return NextResponse.json(gate.body, { status: gate.status });
    }

    // 1) Parse request
    const body = await req.json().catch(() => ({}));
    const belief = String(body.belief || "").trim();
    const context = String(body.context || "").trim();

    if (!belief) {
      // Belief is required for Pro reframe
      return NextResponse.json(
        { error: "MISSING_INPUT", message: "Missing 'belief'." },
        { status: 400 }
      );
    }

    // 2) Build reframe steps
    const steps = buildReframeSteps(belief, context);

    // 3) Respond
    return NextResponse.json({
      belief: belief || "I’m not enough",
      context,
      steps,
      note:
        "Pro access verified via license. Use these steps to guide a focused 10–15 minute intervention.",
    });
  } catch (e: any) {
    console.error("reframe error:", e?.message || e);
    return NextResponse.json(
      { error: "REFRAME_ERROR", message: "Could not generate reframe." },
      { status: 500 }
    );
  }
}
