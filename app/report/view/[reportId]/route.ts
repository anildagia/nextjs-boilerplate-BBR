// app/report/view/[reportId]/route.ts
import { list } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Minimal types for @vercel/blob list() results */
type BlobListItem = {
  pathname: string;
  url: string;
  size?: number;
  uploadedAt?: string;
};
type ListResponse = {
  blobs: BlobListItem[];
  cursor?: string | null;
};

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
  const re = new RegExp(`/(?:${idEsc})(?:-[A-Za-z0-9_-]+)?\\.html$`); // .../rpt-123.html or .../rpt-123-XYZ.html

  let cursor: string | undefined = undefined;

  do {
    const resp = (await list({
      prefix: "reports/",
      limit: 1000,
      cursor,
      ...(process.env.BLOB_READ_WRITE_TOKEN ? { token: process.env.BLOB_READ_WRITE_TOKEN } : {}),
    })) as unknown as ListResponse;

    for (const b of resp.blobs) {
      if (re.test(b.pathname)) {
        return b; // { url, pathname, ... }
      }
    }
    cursor = (resp.cursor ?? undefined) as string | undefined;
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

  // Fetch the saved HTML AS-IS (logo/styles already embedded in the file itself)
  const fetchRes = await fetch(blob.url, { cache: "no-store" });
  if (!fetchRes.ok) {
    const msg = await fetchRes.text().catch(() => fetchRes.statusText);
    return new Response(
      JSON.stringify({ message: "Failed to fetch HTML", detail: msg.slice(0, 300) }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const htmlContent = await fetchRes.text();
  return new Response(htmlContent, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
