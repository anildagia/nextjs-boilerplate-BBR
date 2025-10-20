// app/api/libraries/[theme]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getTheme } from "../../_lib/libs";
import { requirePro } from "../../_lib/paywall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// params is a Promise<{ theme: string }> per your build typing
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ theme: string }> }
) {
  try {
    const { theme } = await context.params;
    const key = (theme || "").trim();

    // Fast 404 if theme unknown
    const data = getTheme(key);
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Only gate if the theme is Pro
    // (requiresPro is optional on Theme; treat missing/false as free)
    const requiresPro = Boolean((data as any)?.requiresPro);
    if (requiresPro) {
      const gate = await requirePro(req as unknown as Request);
      if (!gate.ok) {
        console.warn("Paywall denied:", { theme: key, status: gate.status });        
        return NextResponse.json(gate.body, { status: gate.status });
      }
    }

    // Return full themed library
    return NextResponse.json(
      { key, title: data.title, items: data.items },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("libraries/[theme] error:", e?.message || e);
    return NextResponse.json(
      { error: "THEME_ERROR", message: "Could not fetch theme." },
      { status: 500 }
    );
  }
}
