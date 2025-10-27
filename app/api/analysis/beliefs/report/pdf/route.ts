// app/api/analysis/beliefs/report/pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { randomUUID } from "crypto";
import { put } from "@vercel/blob";
import { requirePro } from "@/app/api/_lib/paywall";
import type { AnalysisPayload } from "@/app/api/_lib/analysis/beliefs";
import { enrichAnalysis, type AnalysisPayloadExtended } from "@/app/api/_lib/analysis/enrich";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ------------------------------ utils ------------------------------ */

function norm(s: string): string {
  return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
}
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
/** Slug to safe filename basis (no extension). */
function slugBase(s: string) {
  return s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}

/* ------------------------------ types ------------------------------ */

type ReportMeta = {
  title?: string;               // default "Belief Blueprint — Report"
  prepared_for?: string;
  prepared_by?: string;
  brand?: { logoUrl?: string; accentColor?: string }; // (unused in PDF text mode)
  footer_note?: string;
};

type PdfRequest = {
  // Either send full base analysis and we'll enrich, or send extended directly:
  analysis_payload?: AnalysisPayload;
  extended?: AnalysisPayloadExtended;
  report_meta?: ReportMeta;
  fileName?: string; // optional override, ".pdf" appended automatically
};

/* ------------------------------ handler ------------------------------ */

export async function POST(req: NextRequest) {
  try {
    // 0) Pro gate (reuse your existing helper)
    const gate = await requirePro(req as unknown as Request);
    if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

    // 1) Inputs
    const body = (await req.json().catch(() => ({}))) as PdfRequest;
    if (!body.analysis_payload && !body.extended) {
      return NextResponse.json(
        { message: "Send either analysis_payload or extended." },
        { status: 400 }
      );
    }

    const meta = body.report_meta || {};
    const title = meta.title?.trim() || "Belief Blueprint — Report";

    // Build the extended model if only base payload was provided
    const extended: AnalysisPayloadExtended =
      body.extended ?? enrichAnalysis(body.analysis_payload as AnalysisPayload);

    // 2) Create PDF (Helvetica; text layout similar to your existing exporter)
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
    function drawSubheader(text: string) {
      if (y < margin + 24) addPage();
      page.drawText(clean(text), {
        x: margin,
        y: (y -= 18),
        size: 16,
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
    function drawList(items: string[], numbered = false) {
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

    // Header
    drawHeader(title);
    const generatedAt = new Date().toLocaleString("en-IN", { hour12: false });
    const preparedFor = meta.prepared_for ? ` · For: ${meta.prepared_for}` : "";
    const preparedBy = meta.prepared_by ? ` · By: ${meta.prepared_by}` : "";
    drawSmall(`Generated: ${generatedAt}${preparedFor}${preparedBy}`);

    // ---- Executive Snapshot ----
    drawSubheader("Executive Snapshot");
    drawParagraph(`Core Identity Belief: ${extended.executive_snapshot.core_identity_belief}`);
    drawParagraph(`Competing Belief: ${extended.executive_snapshot.competing_belief}`);
    drawParagraph(`Family Imprint: ${extended.executive_snapshot.family_imprint}`);
    drawParagraph(`Justice Trigger: ${extended.executive_snapshot.justice_trigger || "—"}`);
    drawParagraph(`Present Contradiction: ${extended.executive_snapshot.present_contradiction || "—"}`);
    drawParagraph(`Summary: ${extended.summary}`);

    // ---- Recurring Patterns & Themes ----
    if (extended.patterns?.length) {
      drawSubheader("Recurring Patterns & Themes");
      for (const p of extended.patterns) {
        drawParagraph(`Theme: ${p.name}`);
        drawParagraph(`Pull: ${(p.pull || []).join(", ") || "—"}`);
        drawParagraph(`Push: ${(p.push || []).join(", ") || "—"}`);
        drawParagraph(`Earliest memory: ${p.earliest_memory || "—"}`);
        drawParagraph(`Source / origin: ${p.origin || "—"}`);
        drawParagraph(`Effect: ${p.effect || "—"}`);
      }
    }

    // ---- Belief Map ----
    if (extended.belief_map?.length) {
      drawSubheader("Belief Map");
      for (const b of extended.belief_map) {
        drawParagraph(`Belief: ${b.belief}`);
        drawParagraph(`Impact: ${b.impact}`);
        drawParagraph(`Language tells: ${(b.language_tells || []).join(", ") || "—"}`);
        drawParagraph(`Origin cues: ${(b.origin_cues || []).join(", ") || "—"}`);
        drawParagraph(`Model tag: ${b.model_tag || "—"}`);
      }
    }

    // ---- Strengths & Empowering Beliefs ----
    if (extended.strengths?.length || extended.supporting_beliefs?.length) {
      drawSubheader("Strengths & Empowering Beliefs");
      if (extended.strengths?.length) drawList(extended.strengths);
      if (extended.supporting_beliefs?.length) {
        drawParagraph("Supporting Beliefs Detected:");
        drawList(
          extended.supporting_beliefs.map(
            (s) => `${s.belief} (confidence ${(s.confidence * 100) | 0}%)`
          )
        );
      }
    }

    // ---- Socratic Mini-Dialogues ----
    if (extended.socratic_dialogues?.length) {
      drawSubheader("Socratic Mini-Dialogues");
      for (const s of extended.socratic_dialogues) {
        drawParagraph(`Belief: ${s.belief}`);
        drawParagraph(`Pattern: ${s.pattern}`);
        if (s.prompts?.length) drawList(s.prompts);
      }
    }

    // ---- Suggested Reframes ----
    if (extended.reframes?.length) {
      drawSubheader("Suggested Reframes");
      for (const r of extended.reframes) {
        drawParagraph(`From → To: ${r.from} → ${r.to}`);
        if (r.why_this_matters) drawParagraph(`Why this matters: ${r.why_this_matters}`);
        if (r.meaning) drawParagraph(`Meaning: ${r.meaning}`);
        if (r.actions?.length) {
          drawParagraph("Put into action:");
          drawList(r.actions);
        }
        if (r.example) drawParagraph(`Example: ${r.example}`);
      }
    }

    // ---- 30–60–90 Day Action Plan ----
    if (extended.action_plan) {
      drawSubheader("30–60–90 Day Action Plan");
      drawParagraph("Days 1–30:"); if (extended.action_plan.days_1_30?.length) drawList(extended.action_plan.days_1_30, true);
      drawParagraph("Days 31–60:"); if (extended.action_plan.days_31_60?.length) drawList(extended.action_plan.days_31_60, true);
      drawParagraph("Days 61–90:"); if (extended.action_plan.days_61_90?.length) drawList(extended.action_plan.days_61_90, true);
    }

    // ---- Triggers → Swaps ----
    if (extended.triggers_swaps?.length) {
      drawSubheader("Triggers → Swaps");
      drawList(extended.triggers_swaps.map(t => `${t.trigger} → ${t.swap}`));
    }

    // ---- Language Cues → Challenges ----
    if (extended.language_cues_challenges?.length) {
      drawSubheader("Language Cues → Challenges");
      drawList(extended.language_cues_challenges.map(c => `${c.cue} → ${c.method}`));
    }

    // ---- Measures of Progress ----
    if (extended.measures_of_progress?.length) {
      drawSubheader("Measures of Progress");
      drawList(
        extended.measures_of_progress.map(m =>
          `${m.label} — ${m.type}${m.template ? ` · ${m.template}` : ""}`
        )
      );
    }

    // ---- Affirmations ----
    if (extended.affirmations?.length) {
      drawSubheader("Affirmations");
      drawList(extended.affirmations);
    }

    if (meta.footer_note) {
      drawSmall(meta.footer_note);
    } else {
      drawSmall("Safety: Coaching guidance, not therapy. If distressed, use local crisis resources.");
    }

    const pdfBytes = await pdfDoc.save(); // Uint8Array

    // 3) Upload to Vercel Blob (public)
    const baseName =
      (body.fileName?.replace(/\.pdf$/i, "") ||
        `${slugBase(title || "Belief_Blueprint_Report")}_${randomUUID()}`);

    const fileName = `${baseName}.pdf`;
    const putOpts: Parameters<typeof put>[2] = {
      access: "public",
      contentType: "application/pdf",
      ...(process.env.BLOB_READ_WRITE_TOKEN ? { token: process.env.BLOB_READ_WRITE_TOKEN } : {}),
    };

    const { url } = await put(
      `reports/${fileName}`,           // keep under /reports/ namespace
      Buffer.from(pdfBytes),
      putOpts
    );

    return NextResponse.json(
      { ok: true, url, fileName, bytes: pdfBytes.length },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("report/pdf error:", e?.message || e);
    return NextResponse.json(
      { error: "EXPORT_ERROR", message: "Could not generate PDF." },
      { status: 500 }
    );
  }
}
