'use server';
// app/api/_lib/report/beliefBlueprintHtml.ts
import type { AnalysisPayloadExtended } from "@/app/api/_lib/analysis/enrich";

export interface ReportMeta {
  title?: string;
  prepared_for?: string;
  prepared_by?: string;
  brand?: { logoUrl?: string; accentColor?: string };
  footer_note?: string;
}

const esc = (s: string | undefined | null) =>
  String(s ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]!));

const css = (accent = "#1a73e8") => `
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #111; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 32px 24px 64px; }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
  header img { height: 42px; }
  h1 { font-size: 28px; margin: 4px 0 0; }
  .meta { color: #555; font-size: 13px; }
  h2 { font-size: 20px; margin: 28px 0 8px; color: var(--accent); }
  h3 { font-size: 16px; margin: 18px 0 8px; }
  p { line-height: 1.55; margin: 8px 0; }
  ul { margin: 8px 0 16px 18px; }
  .card { border: 1px solid #eee; border-radius: 10px; padding: 14px 16px; margin: 10px 0; background: #fff; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .pill { display:inline-block; background:#f3f5f8; border:1px solid #e8eaef; padding:4px 8px; border-radius:999px; margin:2px 6px 2px 0; font-size:12px; }
  .hr { height: 1px; background: #eee; margin: 18px 0; }
  footer { margin-top: 28px; color: #777; font-size: 12px; text-align: center; }
  @media print {
    body { color: #000; }
    .wrap { padding: 0; }
    .card { break-inside: avoid; }
    header { margin-bottom: 8px; }
  }
`;

function li(items: string[] | undefined) {
  if (!items || !items.length) return "<p>—</p>";
  return `<ul>${items.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;
}

export function renderBeliefBlueprintHTML(
  data: AnalysisPayloadExtended,
  meta: ReportMeta = {}
): string {
  const {
    executive_snapshot,
    patterns,
    belief_map,
    strengths,
    socratic_dialogues,
    reframes,
    action_plan,
    triggers_swaps,
    language_cues_challenges,
    measures_of_progress,
    affirmations,
    salient_themes,
    limiting_beliefs,
    supporting_beliefs,
    summary,
  } = data;

  const title = meta.title || "Belief Blueprint Report";
  const accent = meta.brand?.accentColor || "#1a73e8";
  const logoUrl = meta.brand?.logoUrl;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(title)}</title>
<style>${css(accent)}</style>
</head>
<body>
  <div class="wrap">
    <header>
      ${logoUrl ? `<img src="${esc(logoUrl)}" alt="logo" />` : ""}
      <div>
        <h1>${esc(title)}</h1>
        <div class="meta">
          ${meta.prepared_for ? `Prepared for: ${esc(meta.prepared_for)} · ` : ""}
          ${meta.prepared_by ? `Prepared by: ${esc(meta.prepared_by)} · ` : ""}
          Generated: ${new Date().toLocaleDateString()}
        </div>
      </div>
    </header>

    <div class="card">
      <h2>Executive Snapshot</h2>
      <div class="grid">
        <div>
          <h3>Core Identity Belief</h3>
          <p>${esc(executive_snapshot.core_identity_belief)}</p>
          <h3>Competing Belief</h3>
          <p>${esc(executive_snapshot.competing_belief)}</p>
          <h3>Family Imprint</h3>
          <p>${esc(executive_snapshot.family_imprint)}</p>
        </div>
        <div>
          <h3>Justice Trigger</h3>
          <p>${esc(executive_snapshot.justice_trigger || "—")}</p>
          <h3>Present Contradiction</h3>
          <p>${esc(executive_snapshot.present_contradiction || "—")}</p>
          <h3>Summary</h3>
          <p>${esc(summary)}</p>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Recurring Patterns & Themes</h2>
      ${patterns.map(p => `
        <div class="card">
          <h3>${esc(p.name)}</h3>
          <div><strong>Pull:</strong> ${p.pull.map(x=>`<span class="pill">${esc(x)}</span>`).join("") || "—"}</div>
          <div><strong>Push:</strong> ${p.push.map(x=>`<span class="pill">${esc(x)}</span>`).join("") || "—"}</div>
          <p><strong>Earliest memory:</strong> ${esc(p.earliest_memory || "—")}</p>
          <p><strong>Source / origin:</strong> ${esc(p.origin || "—")}</p>
          <p><strong>Effect:</strong> ${esc(p.effect || "—")}</p>
        </div>
      `).join("")}
    </div>

    <div class="card">
      <h2>Belief Map</h2>
      ${belief_map.map(bm => `
        <div class="card">
          <h3>${esc(bm.belief)}</h3>
          <p><strong>Impact:</strong> ${esc(bm.impact)}</p>
          <p><strong>Language tells:</strong> ${bm.language_tells.map(x=>`<span class="pill">${esc(x)}</span>`).join("") || "—"}</p>
          <p><strong>Origin cues:</strong> ${bm.origin_cues?.map(x=>`<span class="pill">${esc(x)}</span>`).join("") || "—"}</p>
          <p><strong>Model tag:</strong> ${esc(bm.model_tag || "—")}</p>
        </div>
      `).join("")}
    </div>

    <div class="card">
      <h2>Strengths & Empowering Beliefs</h2>
      ${li(strengths)}
      ${supporting_beliefs?.length ? `
        <h3>Supporting Beliefs Detected</h3>
        <ul>${supporting_beliefs.map(b => `<li>${esc(b.belief)} (confidence ${(b.confidence*100|0)}%)</li>`).join("")}</ul>
      ` : ""}
    </div>

    <div class="card">
      <h2>Socratic Mini-Dialogues</h2>
      ${socratic_dialogues.map(s => `
        <div class="card">
          <h3>Belief: ${esc(s.belief)}</h3>
          <p><em>Pattern:</em> ${esc(s.pattern)}</p>
          ${li(s.prompts)}
        </div>
      `).join("")}
    </div>

    <div class="card">
      <h2>Suggested Reframes</h2>
      ${reframes.map(r => `
        <div class="card">
          <p><strong>From → To:</strong> ${esc(r.from)} → <span class="pill">${esc(r.to)}</span></p>
          ${r.why_this_matters ? `<p><strong>Why this matters:</strong> ${esc(r.why_this_matters)}</p>` : ""}
          ${r.meaning ? `<p><strong>Meaning:</strong> ${esc(r.meaning)}</p>` : ""}
          ${r.actions?.length ? `<h3>Put into action</h3>${li(r.actions)}` : ""}
          ${r.example ? `<p><strong>Example:</strong> ${esc(r.example)}</p>` : ""}
        </div>
      `).join("")}
    </div>

    <div class="card">
      <h2>30–60–90 Day Action Plan</h2>
      <div class="grid">
        <div>
          <h3>Days 1–30</h3>${li(action_plan.days_1_30)}
          <h3>Days 31–60</h3>${li(action_plan.days_31_60)}
          <h3>Days 61–90</h3>${li(action_plan.days_61_90)}
        </div>
        <div>
          <h3>Triggers → Swaps</h3>
          ${triggers_swaps?.length ? `
            <ul>${triggers_swaps.map(t => `<li><strong>${esc(t.trigger)}</strong> → ${esc(t.swap)}</li>`).join("")}</ul>
          ` : "<p>—</p>"}
          <h3>Language Cues → Challenges</h3>
          ${language_cues_challenges?.length ? `
            <ul>${language_cues_challenges.map(c => `<li><strong>${esc(c.cue)}</strong> → ${esc(c.method)}</li>`).join("")}</ul>
          ` : "<p>—</p>"}
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Measures of Progress</h2>
      ${measures_of_progress?.length ? `
        <ul>${measures_of_progress.map(m => `<li>${esc(m.label)} — ${esc(m.type)}${m.template ? ` · ${esc(m.template)}`:""}</li>`).join("")}</ul>
      ` : "<p>—</p>"}
    </div>

    <div class="card">
      <h2>Affirmations</h2>
      ${li(affirmations)}
    </div>

    <div class="card">
      <h2>Detected Themes & Beliefs (Auto)</h2>
      ${salient_themes?.length ? `<p><strong>Themes:</strong> ${salient_themes.map(x=>`<span class="pill">${esc(x)}</span>`).join("")}</p>` : ""}
      ${limiting_beliefs?.length ? `
        <h3>Limiting Beliefs</h3>
        <ul>${limiting_beliefs.map(b => `<li>${esc(b.belief)} (confidence ${(b.confidence*100|0)}%)</li>`).join("")}</ul>
      ` : ""}
    </div>

    <footer>${esc(meta.footer_note || "")}</footer>
  </div>
</body>
</html>`;
}
