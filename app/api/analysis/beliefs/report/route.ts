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

  // Build extended model + HTML
  const extended = enrichAnalysis(body.analysis_payload);
  const meta = body.report_meta || {};
  const html = renderBeliefBlueprintHTML(extended, meta);

  // Report identifiers & storage base
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

  // 3) Generate a PDF using the NEW independent report PDF route
  const baseUrl = getBaseUrl(req);
  const pdfRes = await fetch(`${baseUrl}/api/analysis/beliefs/report/pdf`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(req.headers.get("X-License-Key")
        ? { "X-License-Key": req.headers.get("X-License-Key")! }
        : {}),
    },
    body: JSON.stringify({
      extended,
      report_meta: meta,
      fileName: `${reportId}.pdf` // hint to the PDF route; it will append if needed
    }),
  });

  if (!pdfRes.ok) {
    const errText = await pdfRes.text().catch(() => "");
    return NextResponse.json(
      {
        message: "PDF generation failed",
        status: pdfRes.status,
        detail: errText.slice(0, 300),
      },
      { status: 502 }
    );
  }

  const pdfJson = await pdfRes.json().catch(() => ({} as any));
  const generatedPdfUrl = pdfJson?.url;
  if (!generatedPdfUrl || typeof generatedPdfUrl !== "string") {
    return NextResponse.json(
      { message: "PDF route did not return a valid URL" },
      { status: 502 }
    );
  }

  // Download the actual generated PDF bytes
  const pdfDownloadRes = await fetch(generatedPdfUrl);
  if (!pdfDownloadRes.ok) {
    const msg = await pdfDownloadRes.text().catch(() => "");
    return NextResponse.json(
      { message: "Failed to download generated PDF", detail: msg.slice(0, 300) },
      { status: 502 }
    );
  }
  const pdfArrayBuffer = await pdfDownloadRes.arrayBuffer();

  // 4) Store the PDF under your report path
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
