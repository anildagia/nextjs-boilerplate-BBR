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

export async function POST(req: Request) {
  // 0) Paywall
  const pro = await requirePro(req);
  if (!pro.ok) {
    return NextResponse.json(
      { message: "Pro required", upgradeUrl: "/pricing" },
      { status: pro.status ?? 402 }
    );
  }

  // 1) Body
  let body: ReportRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.analysis_payload) {
    return NextResponse.json(
      { message: "Missing required field: analysis_payload" },
      { status: 400 }
    );
  }

  // 2) Build extended model + HTML
  const extended = enrichAnalysis(body.analysis_payload);
  const meta = body.report_meta || {};
  const htmlContent = renderBeliefBlueprintHTML(extended, meta);

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

  // 7) Respond with URLs (users can open HTML and “Print to PDF” in browser)
  return NextResponse.json(
    {
      ok: true,
      endpoint: "analysis/beliefs/report",
      report_id: reportId,
      report_json_url: jsonBlob.url,
      report_html_url: htmlBlob.url,
      viewer_url
    },
    { status: 200 }
  );
}
