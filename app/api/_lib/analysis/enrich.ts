// app/api/_lib/analysis/enrich.ts
// Purpose: take a thin AnalysisPayload and produce a fully shaped "extended" model
// that the HTML renderer can always consume safely.

import type { AnalysisPayload } from "@/app/api/_lib/analysis/beliefs";

// Define the extended types locally (or import your existing ones if you already have them)
export type Pattern = {
  name: string;
  pull: string[];
  push: string[];
  earliest_memory?: string;
  origin?: string;
  effect?: string;
};

export type BeliefMapItem = {
  belief: string;
  impact: string;
  language_tells: string[];
  origin_cues?: string[];
  model_tag?: string;
};

export type SocraticDialogue = {
  belief: string;
  pattern: string;
  prompts: string[];
};

export type Reframe = {
  from: string;
  to: string;
  why_this_matters?: string;
  meaning?: string;
  actions?: string[];
  example?: string;
};

export type ActionPlan = {
  days_1_30: string[];
  days_31_60: string[];
  days_61_90: string[];
};

export type TriggerSwap = { trigger: string; swap: string };

export type CueChallenge = { cue: string; method: string };

export type ExecutiveSnapshot = {
  core_identity_belief: string;
  competing_belief: string;
  family_imprint: string;
  justice_trigger?: string;
  present_contradiction?: string;
};

export type AnalysisPayloadExtended = {
  // High-level narrative bits
  summary: string;

  // Section blocks used by the report
  executive_snapshot: ExecutiveSnapshot;
  patterns: Pattern[];
  belief_map: BeliefMapItem[];
  strengths: string[];
  socratic_dialogues: SocraticDialogue[];
  reframes: Reframe[];
  action_plan: ActionPlan;
  triggers_swaps: TriggerSwap[];
  language_cues_challenges: CueChallenge[];
  measures_of_progress: { label: string; type: string; template?: string }[];
  affirmations: string[];
  salient_themes: string[];

  // Detected beliefs (auto)
  limiting_beliefs: { belief: string; confidence: number }[];
  supporting_beliefs: { belief: string; confidence?: number }[];
};

// --- helpers ---
const arr = <T>(v: any, fallback: T[] = []): T[] => (Array.isArray(v) ? v : fallback);
const str = (v: any, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: any, fallback = 0): number =>
  typeof v === "number" && !Number.isNaN(v) ? v : fallback;
const obj = <T extends object>(v: any, fallback: T): T =>
  v && typeof v === "object" ? (v as T) : fallback;

// You can make this smarter later; for now we just coerce the thin payload into the shape
export function enrichAnalysis(input: AnalysisPayload): AnalysisPayloadExtended {
  // Coerce “detected beliefs” arrays from the thin payload (some fields may not exist)
  const limiting = arr(input?.limiting_beliefs).map((b: any) => ({
    belief: str(b?.belief),
    confidence: num(b?.confidence, 0),
  }));

  const supporting = arr(input?.supporting_beliefs).map((b: any) => ({
    belief: str(b?.belief),
    confidence: num(b?.confidence, 0),
  }));

  // Compose extended object with safe defaults
  const extended: AnalysisPayloadExtended = {
    summary: str(input?.summary),

    executive_snapshot: {
      core_identity_belief: "",
      competing_belief: "",
      family_imprint: "",
      justice_trigger: "",
      present_contradiction: "",
    },

    patterns: [],                    // [] until you decide to infer patterns from input
    belief_map: [],                  // [] until you transform input.limiting/supporting into belief_map
    strengths: [],                   // []
    socratic_dialogues: [],          // []
    reframes: [],                    // []
    action_plan: {
      days_1_30: [],
      days_31_60: [],
      days_61_90: [],
    },
    triggers_swaps: [],              // []
    language_cues_challenges: [],    // []
    measures_of_progress: [],        // []
    affirmations: [],                // []
    salient_themes: arr(input?.salient_themes),

    limiting_beliefs: limiting,
    supporting_beliefs: supporting,
  };

  // OPTIONAL: very light auto-population if source fields exist on input (kept defensive)
  // e.g., if you use input.language_patterns to seed language_cues_challenges, etc.

  return extended;
}
