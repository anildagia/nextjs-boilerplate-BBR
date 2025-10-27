// app/api/_lib/questionnaires/generator.ts

export interface QuestionnaireParams {
  context: string;
  objectives?: string[];
  target_responder?: string;
  language?: string;             // e.g., "en", "hi"
  question_count?: number;       // total questions across all sections
  tone?: string;                 // e.g., "neutral", "supportive", "gentle"
  sensitivity_mode?: string;     // e.g., "off", "gentle", "trauma-informed"
  formats?: Array<"open" | "likert" | "scale" | "ranking" | "forced_choice">;
  sections?: {
    count?: number;
    titles?: string[];
  };
  max_words_per_question?: number;
  include_examples?: boolean;
}

export interface QuestionnaireItem {
  id: string;
  prompt: string;
  format: "open" | "likert" | "scale" | "ranking" | "forced_choice";
  options?: string[];
  scale?: { min: number; max: number; labels?: Record<string, string> };
}

export interface Questionnaire {
  questionnaire_id: string;
  title: string;
  description?: string;
  sections: { title: string; items: QuestionnaireItem[] }[];
  response_schema: any; // JSON schema for responses
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function defaultParams(p: QuestionnaireParams): Required<QuestionnaireParams> {
  return {
    context: p.context,
    objectives: p.objectives ?? ["surface implicit beliefs", "capture self-talk"],
    target_responder: p.target_responder ?? "coachee",
    language: p.language ?? "en",
    question_count: Math.max(6, Math.min(40, p.question_count ?? 10)),
    tone: p.tone ?? "supportive",
    sensitivity_mode: p.sensitivity_mode ?? "gentle",
    formats: p.formats ?? ["open", "likert", "scale"],
    sections: {
      count: p.sections?.count ?? 2,
      titles: p.sections?.titles ?? [],
    },
    max_words_per_question: p.max_words_per_question ?? 60,
    include_examples: p.include_examples ?? true,
  };
}

function mixFormats(formats: QuestionnaireParams["formats"], n: number) {
  const out: QuestionnaireItem["format"][] = [];
  for (let i = 0; i < n; i++) {
    out.push(formats![i % formats!.length] as QuestionnaireItem["format"]);
  }
  return out;
}

function buildItems(
  formats: QuestionnaireItem["format"][],
  tone: string,
  maxWords: number
): QuestionnaireItem[] {
  const templatesOpen = [
    "When you think about this situation, what story do you tell yourself?",
    "What worries you most about taking a step forward?",
    "What would it mean about you if things didn’t work out?",
  ];
  const items: QuestionnaireItem[] = [];
  let idx = 1;

  for (const f of formats) {
    if (f === "open") {
      const prompt =
        templatesOpen[(idx - 1) % templatesOpen.length] +
        (tone === "gentle" || tone === "supportive" ? " (answer in your own words)" : "");
      items.push({ id: `q${idx++}`, prompt, format: "open" });
    } else if (f === "likert") {
      items.push({
        id: `q${idx++}`,
        prompt: "I believe my actions today can change my results.",
        format: "likert",
        options: ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"],
        scale: { min: 1, max: 5, labels: { "1": "SD", "5": "SA" } },
      });
    } else if (f === "scale") {
      items.push({
        id: `q${idx++}`,
        prompt: "On a scale of 1–10, how confident are you about progress here?",
        format: "scale",
        scale: { min: 1, max: 10 },
      });
    } else if (f === "ranking") {
      items.push({
        id: `q${idx++}`,
        prompt: "Rank what holds you back the most:",
        format: "ranking",
        options: ["Fear of failure", "Lack of clarity", "Time", "Resources", "Other people"],
      });
    } else if (f === "forced_choice") {
      items.push({
        id: `q${idx++}`,
        prompt: "Which feels more true right now?",
        format: "forced_choice",
        options: ["I can influence this", "This is outside my control"],
      });
    }
  }
  // Trim long prompts if needed
  for (const it of items) {
    if (it.prompt.split(" ").length > maxWords) {
      const words = it.prompt.split(" ").slice(0, maxWords);
      it.prompt = words.join(" ") + " …";
    }
  }
  return items;
}

function toResponseSchema(q: Omit<Questionnaire, "response_schema">): any {
  const props: Record<string, any> = {};
  for (const section of q.sections) {
    for (const item of section.items) {
      if (item.format === "open") {
        props[item.id] = { type: "string" };
      } else if (item.format === "likert") {
        props[item.id] = { type: "integer", minimum: item.scale?.min ?? 1, maximum: item.scale?.max ?? 5 };
      } else if (item.format === "scale") {
        props[item.id] = { type: "integer", minimum: item.scale?.min ?? 1, maximum: item.scale?.max ?? 10 };
      } else if (item.format === "ranking") {
        props[item.id] = { type: "array", items: { type: "string" } };
      } else if (item.format === "forced_choice") {
        props[item.id] = { type: "string", enum: item.options ?? [] };
      }
    }
  }
  return {
    type: "object",
    properties: props,
    additionalProperties: false,
  };
}

export async function generateQuestionnaire(
  raw: QuestionnaireParams
): Promise<Questionnaire> {
  const p = defaultParams(raw);

  const title =
    p.sections.titles?.length
      ? p.sections.titles[0]
      : `Questionnaire for ${p.context}`;
  const slug = slugify(`${title}-${Date.now()}`);

  // Decide section distribution
  const sectionsCount = Math.max(1, p.sections.count || 1);
  const perSection = Math.max(1, Math.round(p.question_count / sectionsCount));
  const formats = mixFormats(p.formats, perSection);

  const sections: Questionnaire["sections"] = [];
  for (let s = 0; s < sectionsCount; s++) {
    const sectionTitle =
      p.sections.titles?.[s] ??
      (s === 0 ? "Foundations" : s === 1 ? "Beliefs & Self-talk" : `Section ${s + 1}`);
    const items = buildItems(formats, p.tone, p.max_words_per_question);
    sections.push({ title: sectionTitle, items });
  }

  const base: Omit<Questionnaire, "response_schema"> = {
    questionnaire_id: slug,
    title,
    description:
      "Designed to elicit narratives, patterns, and appraisals that reveal underlying beliefs related to your context.",
    sections,
  };

  return {
    ...base,
    response_schema: toResponseSchema(base),
  };
}
