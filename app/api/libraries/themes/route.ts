// app/api/libraries/themes/route.ts
import { NextResponse } from "next/server";
import { listThemes, THEMES, type ThemeKey } from "../../_lib/libs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const meta = listThemes(); // [{ key, title, count }, ...]
    const themeKeys = Object.keys(THEMES) as ThemeKey[];

    // Identify which themes are Pro-gated vs free.
    const isPro = (key: ThemeKey) =>
      // requiresPro is optional; treat missing as free.
      Boolean((THEMES as Record<string, any>)[key]?.requiresPro);

    const freeKeys = themeKeys.filter((k) => !isPro(k));
    const proKeys = themeKeys.filter((k) => isPro(k));

    // Free preview: cap at 10 total across FREE themes only
    const totalCap = 10;
    const perTheme =
      freeKeys.length > 0
        ? Math.max(1, Math.floor(totalCap / freeKeys.length))
        : 0;

    // Build preview:
    // - Free themes get up to `perTheme` items
    // - Pro themes get an empty array (no leakage)
    const preview = themeKeys.map((key) => {
      const t = THEMES[key];
      const items = isPro(key) ? [] : [...t.items].slice(0, perTheme);
      return { theme: key, items };
    });

    return NextResponse.json({ themes: meta, preview }, { status: 200 });
  } catch (e: any) {
    console.error("libraries/themes error:", e?.message || e);
    return NextResponse.json(
      { error: "THEMES_ERROR", message: "Could not list themes." },
      { status: 500 }
    );
  }
}
