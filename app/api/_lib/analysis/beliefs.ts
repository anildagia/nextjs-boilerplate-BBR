// app/api/_lib/analysis/beliefs.ts

export interface IngestInput {
  questionnaire_id: string;
  responses: Record<string, any>;
  metadata?: {
    respondent_role?: string;
    scenario?: string;
    language?: string;
    submitted_at?: string;
  };
}

export interface BeliefEvidence {
  snippet: string;       // short text or value that supports the belief
  ref?: string;          // optional reference to question id
}

export interface BeliefItem {
  belief: string;                 // textual belief hypothesis
  evidence_from_responses: BeliefEvidence[]; // evidence links
  confidence: number;             // 0..1
}

export interface AnalysisPayload {
  analysis_id: string;
  questionnaire_id: string;
  salient_themes: string[];
  limiting_beliefs: BeliefItem[];
  supporting_beliefs: BeliefItem[];
  contradictions: string[];
  emotional_markers: string[];
  language_patterns: string[];
  recommendations: string[];
  summary: string;
  metadata?: IngestInput["metadata"];
}

/** very small utility */
const nowId = () => `an-${Date.now()}`;

/** crude tokenization & simple pattern extraction */
function extractLanguageMarkers(texts: string[]): {
  markers: string[];
  negativeSelfTalkHits: BeliefEvidence[];
  controlBeliefsHits: BeliefEvidence[];
} {
  const markers = new Set<string>();
  const negPhrases = [
    "i can't", "i cannot", "i’m not", "im not", "i am not",
    "i always fail", "never works", "not good enough", "i should have"
  ];
  const controlPhrases = [
    "out of my control", "nothing i can do", "depends on others", "can't change"
  ];

  const negHits: BeliefEvidence[] = [];
  const ctrlHits: BeliefEvidence[] = [];

  texts.forEach((t, i) => {
    const s = (t || "").toString().toLowerCase();
    if (!s.trim()) return;
    if (/[?!]$/.test(s)) markers.add("questioning_tone");
    if (/\balways\b|\bnever\b/.test(s)) markers.add("absolutist_language");
    if (/\bshould\b|\bmust\b/.test(s)) markers.add("deontic_modal");

    negPhrases.forEach(p => { if (s.includes(p)) { negHits.push({ snippet: p }); } });
    controlPhrases.forEach(p => { if (s.includes(p)) { ctrlHits.push({ snippet: p }); } });
  });

  return {
    markers: Array.from(markers),
    negativeSelfTalkHits: negHits,
    controlBeliefsHits: ctrlHits,
  };
}

/** naive theme detection via keyword buckets */
function inferThemes(texts: string[]): string[] {
  const themes = new Set<string>();
  const buckets: Record<string, RegExp> = {
    "fear_of_failure": /\bfail|failure|mistake|risk\b/i,
    "self_efficacy": /\bconfiden|capable|can\b/i,
    "control_vs_external": /\bcontrol|depends|others\b/i,
    "clarity_and_direction": /\bclarity|direction|goal|plan\b/i,
    "resources_time": /\btime|resource|money|budget\b/i,
    "approval_and_judgment": /\bjudge|approval|validation|others think\b/i,
  };
  texts.forEach(t => {
    for (const [name, rx] of Object.entries(buckets)) {
      if (rx.test(String(t || ""))) themes.add(name);
    }
  });
  return Array.from(themes);
}

/** produce belief hypotheses with crude confidence scoring */
function deriveBeliefs(
  texts: string[],
  negHits: BeliefEvidence[],
  ctrlHits: BeliefEvidence[]
): { limiting: BeliefItem[]; supporting: BeliefItem[] } {
  const limiting: BeliefItem[] = [];
  const supporting: BeliefItem[] = [];

  if (negHits.length) {
    limiting.push({
      belief: "I’m not good enough / I will fail",
      evidence_from_responses: negHits,
      confidence: Math.min(1, 0.4 + negHits.length * 0.1),
    });
  }
  if (ctrlHits.length) {
    limiting.push({
      belief: "Outcomes are outside my control",
      evidence_from_responses: ctrlHits,
      confidence: Math.min(1, 0.4 + ctrlHits.length * 0.1),
    });
  }

  // crude positive signal from numeric scales (confidence > 6/10 or agree on self-efficacy)
  const numericVals = texts
    .map(t => Number(t))
    .filter(v => !Number.isNaN(v) && Number.isFinite(v)) as number[];

  const highConfidence = numericVals.filter(v => v >= 7).length;
  if (highConfidence > 0) {
    supporting.push({
      belief: "My actions can improve results",
      evidence_from_responses: [{ snippet: "High self-reported confidence (≥7/10)" }],
      confidence: Math.min(1, 0.5 + highConfidence * 0.1),
    });
  }

  return { limiting, supporting };
}

/** main entry point */
export function analyzeBeliefs(input: IngestInput): AnalysisPayload {
  const analysis_id = nowId();

  // flatten all response values as strings for pattern checks
  const textLike: string[] = Object.values(input.responses).map(v => {
    if (Array.isArray(v)) return v.join(", ");
    return typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
  });

  const { markers, negativeSelfTalkHits, controlBeliefsHits } = extractLanguageMarkers(textLike);
  const themes = inferThemes(textLike);
  const { limiting, supporting } = deriveBeliefs(textLike, negativeSelfTalkHits, controlBeliefsHits);

  const contradictions: string[] = [];
  if (limiting.length && supporting.length) {
    contradictions.push("Co-existence of low-control statements with high self-efficacy indicators.");
  }

  const recommendations: string[] = [];
  if (limiting.find(b => b.belief.includes("not good enough"))) {
    recommendations.push("Reframe: Identify one piece of evidence you handled a similar challenge well.");
  }
  if (limiting.find(b => b.belief.includes("outside my control"))) {
    recommendations.push("Circle of control: List 3 levers you can directly influence this week.");
  }

  const summary = [
    themes.length ? `Detected themes: ${themes.join(", ")}.` : "No strong thematic clusters detected.",
    limiting.length ? `Limiting beliefs hypothesized: ${limiting.length}.` : "No strong limiting beliefs detected.",
    supporting.length ? `Supporting beliefs present.` : "",
  ].join(" ");

  return {
    analysis_id,
    questionnaire_id: input.questionnaire_id,
    salient_themes: themes,
    limiting_beliefs: limiting,
    supporting_beliefs: supporting,
    contradictions,
    emotional_markers: [],      // you can extend later (e.g., affect lexicons)
    language_patterns: markers,
    recommendations,
    summary,
    metadata: input.metadata,
  };
}
