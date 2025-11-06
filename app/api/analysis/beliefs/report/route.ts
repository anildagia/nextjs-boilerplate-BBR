// app/api/analysis/beliefs/report/route.ts
import { NextResponse } from "next/server";
import { requirePro } from "@/app/api/_lib/paywall";
import { renderBeliefBlueprintHTML, type ReportMeta } from "@/app/api/_lib/report/beliefBlueprintHtml";
import { enrichAnalysis, type AnalysisPayloadExtended } from "@/app/api/_lib/analysis/enrich";
import type { AnalysisPayload } from "@/app/api/_lib/analysis/beliefs";
import { putBlob } from "@/app/api/_lib/blobAdapter";

export const runtime = "nodejs";

type ReportRequest = {
  analysis_id?: string;
  analysis_payload?: AnalysisPayload;
  report_meta?: ReportMeta;
};

function getBaseUrl(req: Request) {
  let base = process.env.DOMAIN || "";
  if (!base) {
    const host = new URL(req.url).host;
    const proto = req.headers.get("x-forwarded-proto") || "https";
    base = `${proto}://${host}`;
  }
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  return base.replace(/\/+$/, "");
}

// --- small helpers for last-mile normalization and debug ---
function mkTraceId() {
  return `rpt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
const isArr = (v: any): v is any[] => Array.isArray(v);
const arr = <T>(v: any, fb: T[] = []): T[] => (Array.isArray(v) ? v : fb);
const obj = <T extends object>(v: any, fb: T): T => (v && typeof v === "object" ? (v as T) : fb);
const str = (v: any, fb = ""): string => (typeof v === "string" ? v : fb);

// Ensure the extended shape is fully safe for the HTML renderer
function normalizeExtended(raw: AnalysisPayloadExtended): AnalysisPayloadExtended {
  const missing: string[] = [];

  function needArr(name: string, v: any) {
    if (!Array.isArray(v)) missing.push(name);
    return arr(v);
  }
  function needObj<T extends object>(name: string, v: any, fb: T): T {
    if (!(v && typeof v === "object")) missing.push(name);
    return obj<T>(v, fb);
  }

  const normalized: AnalysisPayloadExtended = {
    summary: str(raw?.summary, ""),

    executive_snapshot: needObj("executive_snapshot", raw?.executive_snapshot, {
      core_identity_belief: "",
      competing_belief: "",
      family_imprint: "",
      justice_trigger: "",
      present_contradiction: "",
    }),

    patterns: needArr("patterns", raw?.patterns),
    belief_map: needArr("belief_map", raw?.belief_map),
    strengths: needArr("strengths", raw?.strengths),
    socratic_dialogues: needArr("socratic_dialogues", raw?.socratic_dialogues),
    reframes: needArr("reframes", raw?.reframes),

    action_plan: needObj("action_plan", raw?.action_plan, {
      days_1_30: [],
      days_31_60: [],
      days_61_90: [],
    }),
    triggers_swaps: needArr("triggers_swaps", raw?.triggers_swaps),
    language_cues_challenges: needArr("language_cues_challenges", raw?.language_cues_challenges),
    measures_of_progress: needArr("measures_of_progress", raw?.measures_of_progress),
    affirmations: needArr("affirmations", raw?.affirmations),
    salient_themes: needArr("salient_themes", raw?.salient_themes),

    limiting_beliefs: needArr("limiting_beliefs", raw?.limiting_beliefs),
    supporting_beliefs: needArr("supporting_beliefs", raw?.supporting_beliefs),
  };

  // Attach a hidden property for diagnostics (not persisted)
  (normalized as any).__missing = missing;
  return normalized;
}

export async function POST(req: Request) {
  const traceId = mkTraceId();
  const url = new URL(req.url);
  const sawHeaderKey = !!req.headers.get("x-license-key");
  const sawQueryKey = url.searchParams.has("key");

  console.log("[report] START", {
    traceId,
    path: url.pathname,
    query: url.search,
    sawHeaderKey,
    sawQueryKey,
  });

  // 0) Paywall
  const pro = await requirePro(req);
  console.log("[report] requirePro", { traceId, ok: pro.ok, status: (pro as any)?.status });
  if (!pro.ok) {
    const resp = NextResponse.json(
      { message: "Pro required", upgradeUrl: "/pricing" },
      { status: (pro as any)?.status ?? 402 }
    );
    resp.headers.set("X-Debug-Trace", traceId);
    console.log("[report] END paywall-denied", { traceId });
    return resp;
  }

  // 1) Body
  let body: ReportRequest;
  try {
    body = await req.json();
  } catch {
    const resp = NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
    resp.headers.set("X-Debug-Trace", traceId);
    console.log("[report] END invalid-json", { traceId });
    return resp;
  }

  if (!body.analysis_payload) {
    const resp = NextResponse.json(
      { message: "Missing required field: analysis_payload" },
      { status: 400 }
    );
    resp.headers.set("X-Debug-Trace", traceId);
    console.log("[report] END missing-analysis-payload", { traceId });
    return resp;
  }

  // 2) Build extended model (first-pass defaults in enrich)
  const extendedRaw = enrichAnalysis(body.analysis_payload);

  // 2a) Last-mile normalization (guarantees renderer safety even with ultra-thin payloads)
  const extended = normalizeExtended(extendedRaw);
  const missing = (extended as any).__missing as string[] | undefined;

  console.log("[report] NORMALIZE", {
    traceId,
    missing: missing || [],
    extended_keys: Object.keys(extendedRaw || {}),
    meta_keys: Object.keys(body.report_meta || {}),
  });

  // 2b) Render HTML
  let htmlContent = "";
  const meta = body.report_meta || {};
  try {
    htmlContent = renderBeliefBlueprintHTML(extended, meta);
  } catch (e: any) {
    console.error("[report] RENDER_ERROR", {
      traceId,
      message: e?.message || String(e),
      shapes: {
        patterns: Array.isArray(extended.patterns),
        belief_map: Array.isArray(extended.belief_map),
        action_plan: {
          d1: Array.isArray(extended.action_plan?.days_1_30),
          d2: Array.isArray(extended.action_plan?.days_31_60),
          d3: Array.isArray(extended.action_plan?.days_61_90),
        },
      },
    });
    const resp = NextResponse.json(
      { error: "RENDER_ERROR", message: "Could not render HTML." },
      { status: 400 }
    );
    resp.headers.set("X-Debug-Trace", traceId);
    return resp;
  }

  console.log("[report] INPUTS", {
    traceId,
    analysis_payload_keys: Object.keys(body.analysis_payload || {}),
    report_meta_keys: Object.keys(meta || {}),
    html_len: htmlContent.length,
  });

  // 3) Names & storage paths
  const ts = Date.now();
  const reportId = `rpt-${ts}`;

  const ownerRaw =
    (body.report_meta?.prepared_by?.trim() ||
      body.report_meta?.prepared_for?.trim() ||
      "anon");
  const ownerKey = ownerRaw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const basePath = `reports/${ownerKey}/${reportId}`;

  // 4) Store JSON (extended analysis)
  const jsonBlob = await putBlob(
    `${basePath}.json`,
    JSON.stringify({ report_id: reportId, meta, extended }, null, 2),
    "application/json"
  );

  // 5) Store HTML
  const htmlBlob = await putBlob(
    `${basePath}.html`,
    htmlContent,
    "text/html; charset=utf-8"
  );

  // 6) Build viewer URL
  const baseUrl = getBaseUrl(req);
  const viewer_url = `${baseUrl}/report/view/${reportId}`;

  console.log("[report] STORED", {
    traceId,
    reportId,
    ownerKey,
    json_url_host: (() => { try { return new URL(jsonBlob.url).host; } catch { return "?"; } })(),
    json_url_path: (() => { try { return new URL(jsonBlob.url).pathname; } catch { return "?"; } })(),
    html_url_host: (() => { try { return new URL(htmlBlob.url).host; } catch { return "?" ; } })(),
    html_url_path: (() => { try { return new URL(htmlBlob.url).pathname; } catch { return "?"; } })(),
    viewer_url_path: (() => { try { return new URL(viewer_url).pathname; } catch { return "?"; } })(),
  });

  const resp = NextResponse.json(
    {
      ok: true,
      endpoint: "analysis/beliefs/report",
      report_id: reportId,
      report_json_url: jsonBlob.url,
      report_html_url: htmlBlob.url,
      viewer_url,
    },
    { status: 200 }
  );
  resp.headers.set("X-Debug-Trace", traceId);
  console.log("[report] END ok", { traceId, status: 200 });
  return resp;
}
