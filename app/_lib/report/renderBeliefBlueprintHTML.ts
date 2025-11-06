// app/_lib/report/renderBeliefBlueprintHTML.ts
// Safe for client-side rendering — no Node, no Blob, no imports.

export interface ReportMeta {
  title?: string;
  prepared_for?: string;
  prepared_by?: string;
  brand?: { logoUrl?: string; accentColor?: string };
  footer_note?: string;
}

export interface AnalysisPayloadExtended {
  executive_snapshot: any;
  patterns: any[];
  belief_map: any[];
  strengths: string[];
  socratic_dialogues: any[];
  reframes: any[];
  action_plan: {
    days_1_30: string[];
    days_31_60: string[];
    days_61_90: string[];
  };
  triggers_swaps: any[];
  language_cues_challenges: any[];
  measures_of_progress: any[];
  affirmations: string[];
  salient_themes: string[];
  limiting_beliefs: any[];
  supporting_beliefs: any[];
  summary?: string;
}

const esc = (s: string | undefined | null) =>
  String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));

export function renderBeliefBlueprintHTML(
  data: AnalysisPayloadExtended,
  meta: ReportMeta = {}
): string {
  const accent = meta.brand?.accentColor || "#0D9488";
  const logoUrl = meta.brand?.logoUrl;
  const title = meta.title || "Belief Blueprint Report";

  return `
<div style="max-width:880px;margin:0 auto;padding:24px;font-family:system-ui,Arial,sans-serif;color:#111;">
  <header style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
    ${logoUrl ? `<img src="${esc(logoUrl)}" alt="logo" style="height:42px;">` : ""}
    <div>
      <h1 style="margin:0;font-size:26px;">${esc(title)}</h1>
      <div style="font-size:13px;color:#555;">
        ${meta.prepared_for ? `Prepared for: ${esc(meta.prepared_for)} · ` : ""}
        ${meta.prepared_by ? `Prepared by: ${esc(meta.prepared_by)} · ` : ""}
        Generated ${new Date().toLocaleDateString()}
      </div>
    </div>
  </header>

  <section>
    <h2 style="color:${accent};font-size:20px;margin:16px 0 6px;">Summary</h2>
    <p>${esc(data.summary ?? "—")}</p>
  </section>

  <section>
    <h2 style="color:${accent};font-size:20px;margin:16px 0 6px;">Strengths & Empowering Beliefs</h2>
    <ul>${(data.strengths || []).map(s => `<li>${esc(s)}</li>`).join("") || "<li>—</li>"}</ul>
  </section>

  <section>
    <h2 style="color:${accent};font-size:20px;margin:16px 0 6px;">Limiting Beliefs</h2>
    <ul>${(data.limiting_beliefs || []).map(b => `<li>${esc(b.belief ?? b)}</li>`).join("") || "<li>—</li>"}</ul>
  </section>

  <section>
    <h2 style="color:${accent};font-size:20px;margin:16px 0 6px;">Reframes</h2>
    ${(data.reframes || [])
      .map(r => `<div style="border:1px solid #eee;border-radius:8px;padding:10px;margin:6px 0;">
          <p><strong>From → To:</strong> ${esc(r.from)} → ${esc(r.to)}</p>
          ${r.meaning ? `<p>${esc(r.meaning)}</p>` : ""}
        </div>`)
      .join("") || "<p>—</p>"}
  </section>

  <footer style="margin-top:24px;font-size:12px;color:#777;text-align:center;">
    ${esc(meta.footer_note || "")}<br>
    <em>Tip: Use your browser’s Print → Save as PDF to keep a copy.</em>
  </footer>
</div>`;
}
