import { NextResponse } from "next/server";
import { requirePro } from "@/app/api/_lib/paywall";

export async function POST(req: Request) {
  const pro = await requirePro(req);
  if (!pro.ok) {
    return NextResponse.json(
      { message: "Pro required", upgradeUrl: "/pricing" },
      { status: pro.status ?? 402 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      endpoint: "questionnaires/design",
      note: "Stub ready. Business logic to be added in next steps."
    },
    { status: 200 }
  );
}
