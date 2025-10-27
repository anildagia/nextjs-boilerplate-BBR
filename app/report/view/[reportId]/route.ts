// app/report/view/[reportId]/route.ts
import { list } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Works for Next 14/15 where context.params may be a Promise. */
async function resolveParams<T extends object>(maybeParams: T | Promise<T>): Promise<T> {
  const anyVal: any = maybeParams as any;
  return typeof anyVal?.then === "function" ? await (maybeParams as Promise<T>) : (maybeParams as T);
}

/** Escape a string for safe use inside a RegExp. */
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find the HTML blob whose pathname ends with:
 *   "/{reportId}.html"                   OR
 *   "/{reportId}-{RANDOM}.html"
 * anywhere under the "reports/" prefix (any owner subfolder).
 */
async function findReportHtmlBlob(reportId: string) {
  const idEsc = escapeRe(reportId);
  const re = new RegExp(`/(?:${idEsc})(?:-[A-Za-z0-9_-]+)?\\.html$`); // matches .../rpt-123.html or .../rpt-123-XYZ.html

  let cursor: string | undefined = undefined;
  do {
    const res = await list({
      prefix: "reports/",
      limit: 1000,
      cursor,
      ...(process.env.BLOB_READ_WRITE_TOKEN ? { token: process.env.BLOB_READ_WRITE_TOKEN } : {}),
    });

    for (const b of res.blobs) {
      if (re.test(b.pathname)) {
        return b; // { url, pathname, size, uploadedAt, ... }
      }
    }
    cursor = res.cursor || undefined;
  } while (cursor);

  return null;
}

export async function GET(
  _req: Request,
  context: { params: { reportId: string } } | { params: Promise<{ reportId: string }> }
) {
  const { reportId } = await resolveParams(context.params as any);
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

  // Fetch and return the saved HTML AS-IS (logo/styles already embedded).
  const res = await fetch(blob.url, { cache: "no-store" });
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
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
