// app/api/analysis/beliefs/report/pdf-html/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requirePro } from "@/app/api/_lib/paywall";
import { putBlob } from "@/app/api/_lib/blobAdapter";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// (optional, if your plan allows) export const maxDuration = 60;

type PrintRequest = {
  html?: string;        // raw HTML to render
  html_url?: string;    // OR a fully-qualified URL to render
  fileName?: string;    // optional: "MyReport.pdf"
  owner?: string;       // optional path segment for blob e.g. brand/user
};

function safeSlug(s: string) {
  return (s || "anon").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export async function POST(req: NextRequest) {
  // 0) Paywall
  const gate = await requirePro(req as unknown as Request);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status ?? 402 });

  // 1) Inputs
  const body = (await req.json().catch(() => ({}))) as PrintRequest;
  const now = Date.now();
  const ownerKey = safeSlug(body.owner || "anon");
  const baseName = (body.fileName?.replace(/\.pdf$/i, "") || `belief-blueprint-${now}`);
  const blobPath = `reports/${ownerKey}/${baseName}.pdf`;

  if (!body.html && !body.html_url) {
    return NextResponse.json({ message: "Provide either 'html' or 'html_url'." }, { status: 400 });
  }

  // 2) Launch headless Chrome (serverless-friendly)
  // Tips:
  //  - Inline CSS and images are safest. If using external resources, ensure HTTPS public URLs.
  //  - Set printBackground:true so colors and backgrounds are printed.
  const exePath = await chromium.executablePath;
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: exePath,
    headless: chromium.headless, // true on server
  });

  try {
    const page = await browser.newPage();

    if (body.html) {
      // Render from raw HTML
      await page.setContent(body.html, { waitUntil: "networkidle0" });
    } else if (body.html_url) {
      // Render a URL (must be absolute: https://...)
      const url = body.html_url;
      if (!/^https?:\/\//i.test(url)) {
        return NextResponse.json({ message: "html_url must be absolute (https://...)" }, { status: 400 });
      }
      await page.goto(url, { waitUntil: "networkidle0" });
    }

    // Optional: ensure print CSS applies (if you use @media print rules)
    // await page.emulateMediaType("print");

    const pdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "12mm", bottom: "14mm", left: "12mm" },
      // preferCSSPageSize: true, // enable if you set @page size in CSS
    });

    // 3) Upload to Blob
    const pdfBlob = await putBlob(blobPath, Buffer.from(pdfBytes), "application/pdf");

    return NextResponse.json(
      { ok: true, url: pdfBlob.url, pathname: pdfBlob.pathname ?? blobPath },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("pdf-html error:", e?.message || e);
    return NextResponse.json({ error: "PDF_RENDER_ERROR", message: "Could not render HTML to PDF." }, { status: 500 });
  } finally {
    await browser.close().catch(() => {});
  }
}
