// app/report/view/[reportId]/route.ts
// Route Handler that returns the stored HTML file as-is (text/html).
// No React involved; no JSX; no capitalized <HTML> tags rendered by React.

import { NextRequest, NextResponse } from "next/server";
import { list } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE_RE = /^reports\/([^/]+)\/(rpt-(\d{13}))(?:-[A-Za-z0-9]+)?\.html$/i;

export async function GET(
  _req: NextRequest,
  ctx: { params: { reportId: string } }
) {
  const reportId = ctx?.params?.reportId;
  if (!reportId) {
    return new NextResponse("Missing reportId", { status: 400 });
  }

  // Find the first HTML that matches reports/*/<reportId>*.html
  let cursor: string | undefined = undefined;
  let htmlUrl: string | undefined;

  do {
    const page = await list({ prefix: "reports/", limit: 1000, cursor });
    for (const b of page.blobs) {
      const m = FILE_RE.exec(b.pathname);
      if (!m) continue;
      const rid = m[2]; // rpt-<ts>
      if (rid === reportId) {
        htmlUrl = (b as any).url || undefined;
        break;
      }
    }
    if (htmlUrl || !page.cursor) break;
    cursor = page.cursor;
  } while (!htmlUrl);

  if (!htmlUrl) {
    return new NextResponse("Report not found", { status: 404 });
  }

  const upstream = await fetch(htmlUrl);
  if (!upstream.ok) {
    return new NextResponse("Failed to fetch report HTML", { status: 502 });
  }

  const body = await upstream.text();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // optional cache header (tunable)
      "Cache-Control": "public, max-age=60",
    },
  });
}
