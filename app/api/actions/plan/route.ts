// app/api/actions/plan/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requirePro } from "../../_lib/paywall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ----- business logic (deterministic) -----
function buildSevenDayPlan(belief: string, goal: string) {
  const safeBelief = belief.trim();
  const safeGoal = goal.trim();

  const cautions = [
    "Keep daily tasks ≤ 20 minutes to avoid overwhelm.",
    "Track effort, not perfection; missing a day is data, not failure.",
    "If distress rises, pause and switch to Gentle Mode (breathing, journaling).",
  ];

  const plan = [
    `Day 1 — Name & Notice: Write the belief "${safeBelief}" and list 3 recent moments it showed up. Then write the goal: "${safeGoal}".`,
    `Day 2 — Evidence scan: List 5 facts that contradict "${safeBelief}". Circle the strongest 2.`,
    `Day 3 — Micro-proof #1: Do a 15–20 min task that moves "${safeGoal}" forward. Log how you felt before/after.`,
    `Day 4 — Reframe draft: Turn "${safeBelief}" into a workable reframe (e.g., “I can take one concrete step today toward ${safeGoal}”). Read it aloud 3×.`,
    `Day 5 — Micro-proof #2: Do the next smallest step for "${safeGoal}". Message one person for accountability.`,
    `Day 6 — Friction audit: List top 3 blockers. For each, write 1 friction-reduction (timer, checklist, calendar block).`,
    `Day 7 — Review & lock-in: Note 3 wins this week. Book 2 calendar blocks for next week’s first two micro-steps.`,
  ];

  return { plan, cautions };
}

// ----- route -----
export async function POST(req: NextRequest) {
  try {
    // 0) Pro gate (reads ?key=... or X-License-Key, verifies active sub)
    const gate = await requirePro(req as unknown as Request);
    if (!gate.ok) {
      return NextResponse.json(gate.body, { status: gate.status });
    }

    // 1) Parse body
    const body = await req.json().catch(() => ({}));
    const belief = String(body.belief || "").trim();
    const goal = String(body.goal || "").trim();

    if (!belief || !goal) {
      return NextResponse.json(
        { error: "MISSING_INPUT", message: "Missing 'belief' or 'goal'." },
        { status: 400 }
      );
    }

    // 2) Generate plan
    const { plan, cautions } = buildSevenDayPlan(belief, goal);

    // 3) Return
    return NextResponse.json(
      { belief, goal, plan, cautions },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("actions/plan error:", err?.message || err);
    return NextResponse.json(
      { error: "PLAN_ERROR", message: "Could not generate action plan." },
      { status: 500 }
    );
  }
}
