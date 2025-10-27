import { NextRequest, NextResponse } from "next/server";
import { requirePro } from "@/app/api/_lib/paywall";
import type { AnalysisPayload } from "@/app/api/_lib/analysis/beliefs";
import { enrichAnalysis } from "@/app/api/_lib/analysis/enrich";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Expected request shape
type AnalyzeRequest = {
  questionnaire_id?: string;
  responses?: Array<{ q: string; a: string }>;
  options?: { depth?: "standard" | "deep"; gentle_mode?: boolean };
};

export async function POST(req: NextRequest) {
  // Pro-gate
  const pro = await requirePro(req as unknown as Request);
  if (!pro.ok) {
    return NextResponse.json(
      { message: "Pro required", upgradeUrl: "/pricing" },
      { status: pro.status ?? 402 }
    );
  }

  // Parse body
  let body: AnalyzeRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  // Minimal validation
  if (!Array.isArray(body.responses) || body.responses.length === 0) {
    return NextResponse.json(
      { message: "Missing required field: responses (array of {q,a})" },
      { status: 400 }
    );
  }

  // --- Minimal heuristic analysis → produce AnalysisPayload ---
  // NOTE: This is intentionally simple. Replace with your LLM-based analysis when ready.
  const sampleSummary = `Detected ${body.responses.length} responses${
    body.options?.depth === "deep" ? " (deep mode)" : ""
  }. Common themes: self-judgment, uncertainty.`;

  const analysis: AnalysisPayload = {
    analysis_id: `an-${Date.now()}`,
    questionnaire_id: body.questionnaire_id ?? `qid-unknown`,
    salient_themes: ["self-judgment", "uncertainty"],
    limiting_beliefs: [
      {
        belief: "I might not be good enough",
        evidence_from_responses: body.responses.slice(0, 2).map(r => ({ snippet: r.a })),
        confidence: 0.6
      }
    ],
    supporting_beliefs: [],
    contradictions: [],
    emotional_markers: [],
    language_patterns: ["absolutist_language"],
    recommendations: ["Try one safe-share per meeting"],
    summary: sampleSummary
  };

  // Optional: compute extended form now (so clients get more structure immediately)
  const extended = enrichAnalysis(analysis);

  return NextResponse.json(
    {
      ok: true,
      analysis_id: analysis.analysis_id,
      analysis_payload: analysis,
      extended // clients can pass this straight to the report endpoint if they want
    },
    { status: 200 }
  );
}

export async function GET() {
  // Make the route explicit: no listing; avoids 405/404 confusion in tests
  return NextResponse.json({ message: "POST only. Send {responses:[{q,a}], ...}." }, { status: 405 });
}
