import { NextResponse } from "next/server";
import { requirePro } from "@/app/api/_lib/paywall";
import { analyzeBeliefs, IngestInput } from "@/app/api/_lib/analysis/beliefs";

export async function POST(req: Request) {
  const pro = await requirePro(req);
  if (!pro.ok) {
    return NextResponse.json(
      { message: "Pro required", upgradeUrl: "/pricing" },
      { status: pro.status ?? 402 }
    );
  }

  let body: Partial<IngestInput> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body.questionnaire_id || typeof body.questionnaire_id !== "string") {
    return NextResponse.json(
      { message: "Missing required field: questionnaire_id (string)" },
      { status: 400 }
    );
  }
  if (!body.responses || typeof body.responses !== "object") {
    return NextResponse.json(
      { message: "Missing required field: responses (object)" },
      { status: 400 }
    );
  }

  const payload = analyzeBeliefs({
    questionnaire_id: body.questionnaire_id,
    responses: body.responses,
    metadata: body.metadata,
  });

  return NextResponse.json(
    {
      ok: true,
      endpoint: "analysis/beliefs/ingest-responses",
      analysis: payload
    },
    { status: 200 }
  );
}
