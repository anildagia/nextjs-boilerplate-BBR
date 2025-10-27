// app/api/_lib/analysis/enrich.ts
// Extends the base AnalysisPayload (from beliefs.ts) into a full Sample-Report-ready model.

import type { AnalysisPayload } from "@/app/api/_lib/analysis/beliefs";

/** ----- Extended Structures required by the sample report ----- */

export interface ExecutiveSnapshot {
  core_identity_belief: string;
  competing_belief: string;
  family_imprint: string;
  justice_trigger?: string;
  present_contradiction?: string;
}

export interface ThemePattern {
  name: string;
  pull: string[];  // attractions
  push: string[];  // aversions
  earliest_memory?: string;
  origin?: string;
  effect?: string;
}

export interface BeliefMapItem {
  belief: string;
  impact: string;
  language_tells: string[];
  origin_cues?: string[];
  model_tag?: string; // e.g., "capability_belief", "overgeneralization"
}

export interface SocraticDialogue {
  belief: string;
  pattern: string;
  prompts: string[];
}

export interface ReframeBlock {
  from: string;
  to: string;
  why_this_matters?: string;
  meaning?: string;
  actions?: string[];
  example?: string;
}

export interface ActionPlan {
  days_1_30: string[];
  days_31_60: string[];
  days_61_90: string[];
}

export interface TriggerSwap {
  trigger: string;
  swap: string;
}

export interface LanguageCueChallenge {
  cue: string;      // e.g., "always/never", "should/must", "out of my control"
  method: string;   // e.g., "scope challenge", "definition split"
}

export interface ScorecardMeasure {
  label: string;
  type: "daily" | "weekly" | "monthly";
  template?: string;
}

export interface AnalysisPayloadExtended extends AnalysisPayload {
  executive_snapshot: ExecutiveSnapshot;
  patterns: ThemePattern[];
  belief_map: BeliefMapItem[];
  strengths: string[];
  socratic_dialogues: SocraticDialogue[];
  reframes: ReframeBlock[];
  action_plan: ActionPlan;
  triggers_swaps: TriggerSwap[];
  language_cues_challenges: LanguageCueChallenge[];
  measures_of_progress: ScorecardMeasure[];
  affirmations: string[];
}

/** ----- Minimal heuristics to lift base -> extended (placeholder, deterministic) ----- */

const hasPattern = (arr: string[], s: string) => arr.some(x => x.toLowerCase().includes(s));

export function enrichAnalysis(base: AnalysisPayload): AnalysisPayloadExtended {
  // Executive snapshot (derive crude defaults from base)
  const core_identity_belief =
    base.limiting_beliefs.find(b => /fail|enough|worth/i.test(b.belief))?.belief
    ?? "I’m not good enough";
  const competing_belief =
    base.supporting_beliefs[0]?.belief
    ?? "My actions can improve results";
  const family_imprint =
    hasPattern(base.language_patterns, "deontic") ? "Rules/shoulds from early caretakers" : "Achievement = worth";
  const justice_trigger =
    hasPattern(base.salient_themes, "approval") ? "Perceived unfair judgment/approval withholding" : undefined;
  const present_contradiction =
    base.contradictions[0] ?? undefined;

  // Patterns from themes (pull/push simple defaults)
  const patterns: ThemePattern[] = base.salient_themes.map(name => ({
    name,
    pull: name.includes("self_efficacy") ? ["Autonomy", "Progress"] : ["Safety", "Certainty"],
    push: name.includes("fear_of_failure") ? ["Public evaluation", "High stakes"] : ["Ambiguity"],
    earliest_memory: undefined,
    origin: name.includes("control") ? "Modeled external locus of control" : "Generalized past outcomes",
    effect: name.includes("resources_time") ? "Defers action due to perceived constraints" : "Avoidance or over-planning",
  }));

  // Belief map from limiting/supporting beliefs
  const belief_map: BeliefMapItem[] = [
    ...base.limiting_beliefs.map(b => ({
      belief: b.belief,
      impact: "Avoids or delays action; narrows options; drains motivation",
      language_tells: ["always/never", "can’t", "not good enough"],
      origin_cues: ["Past failures recalled vividly"],
      model_tag: "overgeneralization",
    })),
    ...base.supporting_beliefs.map(b => ({
      belief: b.belief,
      impact: "Increases initiative; sustains effort",
      language_tells: ["I can", "I will", "I’m learning"],
      origin_cues: ["Recent wins, mentor models"],
      model_tag: "capability_belief",
    })),
  ];

  // Strengths inferred
  const strengths: string[] = base.supporting_beliefs.length
    ? ["Growth orientation", "Willingness to self-rate", "Action bias when confident"]
    : ["Self-awareness emerging"];

  // Socratic dialogues (one per limiting belief)
  const socratic_dialogues: SocraticDialogue[] = base.limiting_beliefs.map(b => ({
    belief: b.belief,
    pattern: "Overgeneralization / Low-control assumption",
    prompts: [
      "What evidence contradicts this when you zoom into the last 30 days?",
      "If a close friend said this, how would you challenge it compassionately?",
      "What would change if this belief were 20% less true?",
    ],
  }));

  // Reframes From -> To (+ Clarifications-compatible fields)
  const reframes: ReframeBlock[] = base.limiting_beliefs.map(b => ({
    from: b.belief,
    to: "I’m learning targeted skills and my actions influence outcomes.",
    why_this_matters: "It restores agency and unlocks experimentation.",
    meaning: "Progress is proof; results follow repetitions.",
    actions: ["List 3 controllable levers", "1 tiny test this week", "Log evidence of influence"],
    example: "Ran 1 outreach test → got 2 replies → iterated message.",
  }));

  // 30–60–90
  const action_plan: ActionPlan = {
    days_1_30: ["Daily 10-minute belief check-in", "One tiny experiment per week", "Evidence log"],
    days_31_60: ["Scale successful micro-tests", "One public share per week", "Ask for feedback"],
    days_61_90: ["Document new playbook", "Automate recurring steps", "Set next 90-day target"],
  };

  // Trigger→Swap pairs
  const triggers_swaps: TriggerSwap[] = [
    { trigger: "Interview rejection email", swap: "Extract 1 learning + schedule next outreach in 10 minutes" },
    { trigger: "Rumination words: always/never", swap: "Replace with specific scope + recent data point" },
  ];

  // Language cues → challenge methods
  const language_cues_challenges: LanguageCueChallenge[] = [
    { cue: "always/never", method: "Scope challenge: define timeframe & context" },
    { cue: "should/must", method: "Definition split: replace with want/choose + reason" },
    { cue: "out of my control", method: "Circle of control: list 3 direct levers" },
  ];

  // Measures / scorecard
  const measures_of_progress: ScorecardMeasure[] = [
    { label: "Weekly experiments shipped", type: "weekly", template: "Count >= 1" },
    { label: "Evidence entries logged", type: "weekly", template: "Count >= 3" },
    { label: "Self-talk reframe uses", type: "daily", template: "≥ 1 deliberate swap/day" },
  ];

  // Affirmations
  const affirmations: string[] = [
    "Small experiments compound.",
    "I influence outcomes through deliberate practice.",
    "Discomfort is a sign of growth, not danger.",
  ];

  return {
    ...base,
    executive_snapshot: {
      core_identity_belief,
      competing_belief,
      family_imprint,
      justice_trigger,
      present_contradiction,
    },
    patterns,
    belief_map,
    strengths,
    socratic_dialogues,
    reframes,
    action_plan,
    triggers_swaps,
    language_cues_challenges,
    measures_of_progress,
    affirmations,
  };
}
