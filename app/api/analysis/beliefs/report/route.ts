// app/api/analysis/beliefs/report/route.ts
import { NextResponse } from "next/server";
import { requirePro } from "@/app/api/_lib/paywall";
import { renderBeliefBlueprintHTML, type ReportMeta } from "@/app/api/_lib/report/beliefBlueprintHtml";
import { enrichAnalysis } from "@/app/api/_lib/analysis/enrich";
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

// --- debug helpers (no behavior change) ---
function mkTraceId() {
  // simple, stable-enough traceId for log correlation
  return `rpt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function safeLen(v: unknown) {
  try {
    if (!v) return 0;
    if (typeof v === "string") return v.length;
    if (Array.isArray(v)) return v.length;
    if (typeof v === "object") return Object.keys(v as any).length;
    return 0;
  } catch { return 0; }
}

export async function POST(req: Request) {
  const traceId = mkTraceId();
  const url = new URL(req.url);
  const sawHeaderKey = !!req.headers.get("x-license-key");
  const sawQueryKey = url.searchParams.has("key");
//  const wantEchoDebug = url.searchParams.get("debug") === "1";
  const wantEchoDebug = "1";
  
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

  // 2) Build extended model + HTML
  const extended = enrichAnalysis(body.analysis_payload);
  const meta = body.report_meta || {};
  const htmlContent = renderBeliefBlueprintHTML(extended, meta);

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

  // 6) Build viewer URL (pretty route that streams the exact saved HTML by reportId)
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

  // 7) Respond with URLs (users can open HTML and “Print to PDF” in browser)
  const payload: any = {
    ok: true,
    endpoint: "analysis/beliefs/report",
    report_id: reportId,
    report_json_url: jsonBlob.url,
    report_html_url: htmlBlob.url,
    viewer_url,
  };

  if (wantEchoDebug) {
    payload.debug = {
      traceId,
      sawHeaderKey,
      sawQueryKey,
      analysis_payload_len: safeLen(body.analysis_payload),
      report_meta_len: safeLen(meta),
    };
  }

  const resp = NextResponse.json(payload, { status: 200 });
  resp.headers.set("X-Debug-Trace", traceId);
  console.log("[report] END ok", { traceId, status: 200 });
  return resp;
}
