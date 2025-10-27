// app/api/_lib/report/beliefBlueprintHtml.ts
// IMPORTANT: This module returns a STRING of complete HTML.
// It does NOT export any React component and does NOT use JSX.

export type ReportMeta = {
  title?: string;
  prepared_for?: string;
  prepared_by?: string;
  brand?: {
    logoUrl?: string;
    accentColor?: string; // e.g. "#0D9488"
  };
  footer_note?: string;
};

type Evidence = { snippet: string };
type LimitingBelief = {
  belief: string;
  evidence_from_responses?: Evidence[];
  confidence?: number;
};

type AnalysisExtended = {
  analysis_id?: string;
  questionnaire_id?: string;
  salient_themes?: string[];
  limiting_beliefs?: LimitingBelief[];
  supporting_beliefs?: any[];
  contradictions?: any[];
  emotional_markers?: any[];
  language_patterns?: string[];
  recommendations?: string[];
  summary?: string;
};

function esc(s?: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderBeliefBlueprintHTML(
  extended: AnalysisExtended,
  meta: ReportMeta = {}
): string {
  const title = meta.title || "Belief Blueprint Report";
  const accent = meta.brand?.accentColor || "#0D9488";
  const logo = meta.brand?.logoUrl || "";
  const preparedFor = meta.prepared_for || "";
  const preparedBy = meta.prepared_by || "";
  const footer = meta.footer_note || "";

  const headerLogo = logo
    ? `<img src="${esc(logo)}" alt="Brand Logo" style="height:48px;object-fit:contain;" />`
    : "";

  const themes =
    extended.salient_themes?.length
      ? extended.salient_themes.map(t => `<span class="chip">${esc(t)}</span>`).join(" ")
      : "<em>No salient themes provided.</em>";

  const limBeliefs =
    extended.limiting_beliefs?.length
      ? extended.limiting_beliefs
          .map((b, i) => {
            const ev = (b.evidence_from_responses || [])
              .map(e => `<li>${esc(e.snippet)}</li>`)
              .join("");
            const conf = typeof b.confidence === "number" ? ` (confidence ${(b.confidence * 100).toFixed(0)}%)` : "";
            return `
              <section class="card">
                <h3>${i + 1}. ${esc(b.belief)}${conf}</h3>
                ${ev ? `<div class="subt">Evidence</div><ul>${ev}</ul>` : ""}
              </section>
            `;
          })
          .join("")
      : `<div class="muted">No limiting beliefs detected.</div>`;

  const langPat =
    extended.language_patterns?.length
      ? `<ul>${extended.language_patterns.map(p => `<li>${esc(p)}</li>`).join("")}</ul>`
      : "<div class=\"muted\">None listed.</div>";

  const recs =
    extended.recommendations?.length
      ? `<ol>${extended.recommendations.map(p => `<li>${esc(p)}</li>`).join("")}</ol>`
      : "<div class=\"muted\">None provided.</div>";

  const summary = esc(extended.summary || "");

  // COMPLETE, LOWERCASE HTML DOCUMENT (string)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(title)}</title>
  <style>
    :root { --accent: ${accent}; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"; color: #0f172a; background:#f8fafc; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 32px 20px 60px; }
    header { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom: 16px; }
    h1 { font-size: 26px; margin: 0; }
    .meta { color:#475569; font-size: 13px; }
    .chip { display:inline-block; background: #e6fffb; color:#064e3b; border:1px solid var(--accent); border-radius: 999px; padding: 2px 10px; margin: 2px 6px 2px 0; font-size:12px; }
    .section { margin-top: 18px; padding: 16px; background: white; border-radius: 12px; border:1px solid #e2e8f0; }
    .section > h2 { margin: 0 0 8px; font-size: 16px; color:#0f172a; }
    .muted { color:#64748b; font-style: italic; }
    .card { border:1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin: 10px 0; background:#fcfdff; }
    .card h3 { margin: 0 0 6px; font-size: 15px; }
    .subt { font-weight: 600; font-size: 12px; color:#334155; margin-top:8px; }
    footer { margin-top: 28px; color:#64748b; font-size: 12px; text-align:center; }
    a { color: var(--accent); text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <h1>${esc(title)}</h1>
        <div class="meta">
          ${preparedFor ? `Prepared for: <strong>${esc(preparedFor)}</strong>` : ""}
          ${preparedBy ? `${preparedFor ? " · " : ""}Prepared by: <strong>${esc(preparedBy)}</strong>` : ""}
        </div>
      </div>
      ${headerLogo}
    </header>

    <section class="section">
      <h2>Summary</h2>
      <div>${summary || "<span class='muted'>No summary provided.</span>"}</div>
    </section>

    <section class="section">
      <h2>Salient themes</h2>
      <div>${themes}</div>
    </section>

    <section class="section">
      <h2>Limiting beliefs</h2>
      ${limBeliefs}
    </section>

    <section class="section">
      <h2>Language patterns</h2>
      ${langPat}
    </section>

    <section class="section">
      <h2>Recommendations</h2>
      ${recs}
    </section>

    <footer>
      ${esc(footer)}
    </footer>
  </div>
</body>
</html>`;
}
