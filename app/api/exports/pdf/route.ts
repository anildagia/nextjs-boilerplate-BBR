// app/api/exports/pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { requirePro } from "../../_lib/paywall";
import { put } from "@vercel/blob";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Normalize for equality checks (trim, collapse spaces, lower-case). */
function norm(s: string): string {
  return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
}
function uniquePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const k = norm(it);
    if (!k) continue;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(it.trim());
    }
  }
  return out;
}
function listsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (norm(a[i]) !== norm(b[i])) return false;
  return true;
}
function looksLike7DayPlan(items: string[]): boolean {
  const dayish = items.some((s) => /(^|\s)day\s*\d+/i.test(s));
  return dayish || items.length === 7;
}

// Wrap long lines (character-based)
function wrapText(text: string, maxChars = 90) {
  const lines: string[] = [];
  for (const rawLine of String(text || "").split("\n")) {
    let line = rawLine.trim();
    while (line.length > maxChars) {
      let cut = maxChars;
      const space = line.lastIndexOf(" ", maxChars);
      if (space > 0) cut = space;
      lines.push(line.slice(0, cut));
      line = line.slice(cut).trimStart();
    }
    if (line.length) lines.push(line);
    if (!rawLine.trim().length) lines.push(""); // preserve blank lines
  }
  return lines;
}

/** Replace symbols WinAnsi can't encode (Helvetica encoding). */
function sanitizeForWinAnsi(s: string): string {
  const map: Record<string, string> = {
    "≤": "<=",
    "≥": ">=",
    "≠": "!=",
    "±": "+/-",
    "→": "->",
    "←": "<-",
    "×": "x",
    "–": "-",
    "—": "-",
    "“": '"',
    "”": '"',
    "‘": "'",
    "’": "'",
    "…": "...",
  };
  return s
    .replace(
      /[\u2013\u2014\u201C\u201D\u2018\u2019\u2026\u2264\u2265\u2260\u00B1\u2192\u2190\u00D7]/g,
      (m) => map[m] ?? m
    )
    .replace(/[^\x00-\x7F]/g, "?");
}

export async function POST(req: NextRequest) {
  try {
    // 0) Pro gate
    const gate = await requirePro(req as unknown as Request);
    if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

    // 1) Inputs
    const body = await req.json().catch(() => ({}));
    const belief: string = String(body.belief ?? "I’m not enough");

    const rawSteps: string[] = Array.isArray(body.steps) ? body.steps : [];
    const rawPlan: string[] = Array.isArray(body.plan) ? body.plan : [];
    const steps = uniquePreserveOrder(rawSteps);
    const plan = uniquePreserveOrder(rawPlan);

    // Build non-duplicating sections
    type Section = { title: string; items: string[] };
    const sections: Section[] = [];
    const both = steps.length > 0 && plan.length > 0;

    if (!both) {
      if (steps.length) {
        sections.push({
          title: looksLike7DayPlan(steps) ? "7-Day Micro-Action Plan" : "Reframe Steps",
          items: steps,
        });
      } else if (plan.length) {
        sections.push({ title: "7-Day Micro-Action Plan", items: plan });
      }
    } else {
      if (listsEqual(steps, plan)) {
        sections.push({
          title: looksLike7DayPlan(steps) ? "7-Day Micro-Action Plan" : "Reframe Steps",
          items: steps,
        });
      } else {
        sections.push({ title: "Reframe Steps", items: steps });
        const stepSet = new Set(steps.map(norm));
        const planOnly = plan.filter((p) => !stepSet.has(norm(p)));
        if (planOnly.length) sections.push({ title: "7-Day Micro-Action Plan", items: planOnly });
      }
    }

    const generatedAt = new Date().toLocaleString("en-IN", { hour12: false });

    // 2) Build PDF (Helvetica + sanitize)
    const pdfDoc = await PDFDocument.create();
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let page = pdfDoc.addPage([595.28, 841.89]); // A4
    let { height } = page.getSize();
    const margin = 50;
    let y = height - margin;

    function addPage() {
      page = pdfDoc.addPage([595.28, 841.89]);
      ({ height } = page.getSize());
      y = height - margin;
    }

    const clean = (s: string) => sanitizeForWinAnsi(s);

    function drawHeader(text: string) {
      if (y < margin + 40) addPage();
      page.drawText(clean(text), {
        x: margin,
        y: (y -= 24),
        size: 20,
        font: fontBold,
        color: rgb(0, 0, 0),
      });
      y -= 6;
    }

    function drawSmall(text: string) {
      if (y < margin + 20) addPage();
      page.drawText(clean(text), {
        x: margin,
        y: (y -= 14),
        size: 10,
        font: fontRegular,
        color: rgb(0.4, 0.4, 0.4),
      });
      y -= 6;
    }

    function drawParagraph(text: string, size = 12) {
      const lines = wrapText(clean(text), 90);
      for (const line of lines) {
        if (y < margin + 20) addPage();
        page.drawText(line, {
          x: margin,
          y: (y -= size + 2),
          size,
          font: fontRegular,
          color: rgb(0, 0, 0),
        });
      }
      y -= 6;
    }

    function drawList(items: string[], numbered = true) {
      for (let i = 0; i < items.length; i++) {
        if (y < margin + 20) addPage();
        const prefix = numbered ? `${i + 1}. ` : "• ";
        const lines = wrapText(clean(items[i]), 86);
        page.drawText(prefix + (lines[0] || ""), {
          x: margin,
          y: (y -= 14),
          size: 12,
          font: fontRegular,
          color: rgb(0, 0, 0),
        });
        for (let j = 1; j < lines.length; j++) {
          if (y < margin + 20) addPage();
          page.drawText("   " + lines[j], {
            x: margin,
            y: (y -= 14),
            size: 12,
            font: fontRegular,
            color: rgb(0, 0, 0),
          });
        }
      }
      y -= 6;
    }

    // Contents
    drawHeader("Discovering Beliefs — Summary");
    drawSmall(`Generated: ${generatedAt}`);
    y -= 8;

    page.drawText(clean("Core Belief"), {
      x: margin,
      y: (y -= 18),
      size: 16,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
    y -= 6;
    drawParagraph(belief);

    for (const section of sections) {
      if (!section.items.length) continue;
      page.drawText(clean(section.title), {
        x: margin,
        y: (y -= 18),
        size: 16,
        font: fontBold,
        color: rgb(0, 0, 0),
      });
      y -= 6;
      drawList(section.items, true);
    }

    y -= 6;
    drawSmall(
      "Safety: Coaching guidance, not therapy. If distressed, use local crisis resources."
    );

    const pdfBytes = await pdfDoc.save(); // Uint8Array

    // 3) Upload to Vercel Blob (public)
    const fileName = `Discovering_Beliefs_Summary_${randomUUID()}.pdf`;
    const putOpts: Parameters<typeof put>[2] = {
      access: "public",
      contentType: "application/pdf",
      ...(process.env.BLOB_READ_WRITE_TOKEN
        ? { token: process.env.BLOB_READ_WRITE_TOKEN }
        : {}),
    };

    const { url } = await put(
      `exports/${fileName}`,
      Buffer.from(pdfBytes),
      putOpts
    );

    return NextResponse.json(
      { fileName, url, bytes: pdfBytes.length, unicodeFontsLoaded: false },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("exports/pdf error:", e?.message || e);
    return NextResponse.json(
      { error: "EXPORT_ERROR", message: "Could not generate PDF." },
      { status: 500 }
    );
  }
}
