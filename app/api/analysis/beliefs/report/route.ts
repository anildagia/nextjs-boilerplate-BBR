import { NextResponse } from "next/server";
import { requirePro } from "@/app/api/_lib/paywall";
import { renderBeliefBlueprintHTML, type ReportMeta } from "@/app/api/_lib/report/beliefBlueprintHtml";
import { enrichAnalysis } from "@/app/api/_lib/analysis/enrich";
import type { AnalysisPayload } from "@/app/api/_lib/analysis/beliefs";
// Use your existing blob helper if present; otherwise use the new one below:
import { putBlob } from "@/app/api/_lib/blobx";

type ReportRequest = {
  analysis_id?: string;
  analysis_payload?: AnalysisPayload; // allow passing payload directly
  report_meta?: ReportMeta;           // { title, prepared_for, prepared_by, brand:{logoUrl,accentColor}, footer_note }
};

function getBaseUrl(req: Request) {
  // Prefer configured DOMAIN (e.g., https://belief-blueprint.vercel.app)
  const env = process.env.DOMAIN;
  if (env) return env.replace(/\/+$/, "");
  // Fallback from request headers (works on Vercel)
  const host = new URL(req.url).host;
  const proto = (req.headers.get("x-forwarded-proto") || "https");
  return `${proto}://${host}`;
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

  // Accept either analysis_payload directly OR (future) we could fetch by analysis_id.
  if (!body.analysis_payload) {
    return NextResponse.json(
      { message: "Missing required field: analysis_payload" },
      { status: 400 }
    );
  }

  const extended = enrichAnalysis(body.analysis_payload);
  const meta = body.report_meta || {};
  const html = renderBeliefBlueprintHTML(extended, meta);

  // Generate a reportId + blob paths
  const ts = Date.now();
  const reportId = `rpt-${ts}`;
  const emailKey = (pro.emailKey || "anon").toLowerCase(); // if your requirePro exposes an emailKey; otherwise "anon"
  const basePath = `reports/${emailKey}/${reportId}`;

  // 1) Store JSON (extended model)
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

  // 3) Call your existing PDF export endpoint to render the HTML → PDF
  const baseUrl = getBaseUrl(req);
  const pdfRes = await fetch(`${baseUrl}/api/exports/pdf`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Forward license header if your exporter is gated (usually not necessary):
      ...(req.headers.get("X-License-Key") ? { "X-License-Key": req.headers.get("X-License-Key")! } : {}),
    },
    body: JSON.stringify({
      html,               // send raw HTML to your existing exporter
      fileName: `${reportId}.pdf`, // optional; exporter may ignore
    }),
  });

  if (!pdfRes.ok) {
    const txt = await pdfRes.text().catch(() => "");
    return NextResponse.json(
      { message: "PDF export failed", status: pdfRes.status, detail: txt.slice(0, 500) },
      { status: 502 }
    );
  }

  const pdfArrayBuffer = await pdfRes.arrayBuffer();

  // 4) Store PDF
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
