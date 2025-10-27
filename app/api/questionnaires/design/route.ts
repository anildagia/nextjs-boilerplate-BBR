import { NextResponse } from "next/server";
import { requirePro } from "@/app/api/_lib/paywall";
import { generateQuestionnaire, QuestionnaireParams } from "@/app/api/_lib/questionnaires/generator";

export async function POST(req: Request) {
  const pro = await requirePro(req);
  if (!pro.ok) {
    return NextResponse.json(
      { message: "Pro required", upgradeUrl: "/pricing" },
      { status: pro.status ?? 402 }
    );
  }

  let body: Partial<QuestionnaireParams> = {};
  try {
    body = await req.json();
  } catch {
    // allow empty body; we'll fill sensible defaults in generator
  }

  if (!body?.context || typeof body.context !== "string") {
    return NextResponse.json(
      { message: "Missing required field: context (string)" },
      { status: 400 }
    );
  }

  const questionnaire = await generateQuestionnaire({
    context: body.context,
    objectives: body.objectives,
    target_responder: body.target_responder,
    language: body.language,
    question_count: body.question_count,
    tone: body.tone,
    sensitivity_mode: body.sensitivity_mode,
    formats: body.formats,
    sections: body.sections,
    max_words_per_question: body.max_words_per_question,
    include_examples: body.include_examples,
  });

  return NextResponse.json(
    {
      ok: true,
      endpoint: "questionnaires/design",
      questionnaire,
    },
    { status: 200 }
  );
}
