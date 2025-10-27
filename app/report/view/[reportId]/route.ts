// app/report/view/[reportId]/route.ts
import { NextRequest } from "next/server";
import { list } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Find the HTML blob whose pathname ends with "/{reportId}.html"
 * anywhere under the "reports/" prefix.
 */
async function findReportHtmlBlob(reportId: string) {
  let cursor: string | undefined = undefined;

  // We page through the listing until we find a match.
  // If your store gets huge, you can optimize by accepting an optional ?owner=
  // and using prefix: `reports/${owner}/` — but per your requirement we search all owners.
  do {
    const res = await list({
      prefix: "reports/",
      limit: 1000,
      cursor,
      ...(process.env.BLOB_READ_WRITE_TOKEN
        ? { token: process.env.BLOB_READ_WRITE_TOKEN }
        : {}),
    });

    for (const b of res.blobs) {
      if (b.pathname.endsWith(`/${reportId}.html`)) {
        return b; // { url, pathname, size, ... }
      }
    }
    cursor = res.cursor || undefined;
  } while (cursor);

  return null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: { reportId: string } }
) {
  const reportId = ctx.params.reportId;
  if (!reportId) {
    return new Response(JSON.stringify({ message: "Missing reportId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const blob = await findReportHtmlBlob(reportId);
  if (!blob) {
    return new Response("Report HTML not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Fetch the saved HTML and return it AS-IS.
  const res = await fetch(blob.url);
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    return new Response(
      JSON.stringify({ message: "Failed to fetch HTML", detail: msg.slice(0, 300) }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const html = await res.text();
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Let browser features like Print → Save as PDF work as the user sees it
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
