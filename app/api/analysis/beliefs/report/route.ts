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
  const pro = await requirePro(req);
  if (!pro.ok) {
    return NextResponse.json(
      { message: "Pro required", upgradeUrl: "/pricing" },
      { status: pro.status ?? 402 }
    );
  }

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

  const extended = enrichAnalysis(body.analysis_payload);
  const meta = body.report_meta || {};
  const html = renderBeliefBlueprintHTML(extended, meta);

  const ts = Date.now();
  const reportId = `rpt-${ts}`;

  const ownerRaw =
    (body.report_meta?.prepared_by?.trim() ||
      body.report_meta?.prepared_for?.trim() ||
      "anon");
  const ownerKey = ownerRaw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const basePath = `reports/${ownerKey}/${reportId}`;

  // 1) Store JSON (extended analysis)
  const jsonBlob = await putBlob(
    `${basePath}.json`,
    JSON.stringify({ report_id: reportId, meta, extended }, null, 2),
    "application/json"
  );

  // 2) Store HTML
  const htmlBlob = await putBlob(
    `${basePath}.html`,
    html,
    "text/html; charset=utf-8"
  );

  // 3) Generate base PDF via existing exporter, then fetch actual bytes
  const baseUrl = getBaseUrl(req);
  const pdfExportRes = await fetch(`${baseUrl}/api/exports/pdf`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(req.headers.get("X-License-Key")
        ? { "X-License-Key": req.headers.get("X-License-Key")! }
        : {}),
    },
    // Send minimal placeholder content for exporter
    body: JSON.stringify({
      belief: "Belief Blueprint Summary",
      steps: ["Generated automatically by Belief Blueprint system."],
      plan: [],
    }),
  });

  if (!pdfExportRes.ok) {
    const errText = await pdfExportRes.text().catch(() => "");
    return NextResponse.json(
      {
        message: "PDF export failed",
        status: pdfExportRes.status,
        detail: errText.slice(0, 300),
      },
      { status: 502 }
    );
  }

  // Parse exporter response (JSON with .url)
  const exportJson = await pdfExportRes.json().catch(() => ({}));
  const exportUrl = exportJson?.url;
  if (!exportUrl || typeof exportUrl !== "string") {
    return NextResponse.json(
      { message: "Exporter did not return a valid URL" },
      { status: 502 }
    );
  }

  // Download the actual PDF bytes from exporter Blob URL
  const pdfDownloadRes = await fetch(exportUrl);
  if (!pdfDownloadRes.ok) {
    const msg = await pdfDownloadRes.text().catch(() => "");
    return NextResponse.json(
      { message: "Failed to download generated PDF", detail: msg.slice(0, 300) },
      { status: 502 }
    );
  }
  const pdfArrayBuffer = await pdfDownloadRes.arrayBuffer();

  // 4) Store the real PDF bytes under your report path
  const pdfBlob = await putBlob(
    `${basePath}.pdf`,
    Buffer.from(pdfArrayBuffer),
    "application/pdf"
  );

  return NextResponse.json(
    {
      ok: true,
      endpoint: "analysis/beliefs/report",
      report_id: reportId,
      report_json_url: jsonBlob.url,
      report_html_url: htmlBlob.url,
      report_pdf_url: pdfBlob.url,
    },
    { status: 200 }
  );
}
