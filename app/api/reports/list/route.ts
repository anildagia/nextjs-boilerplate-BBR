// app/api/reports/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { requirePro } from "@/app/api/_lib/paywall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BlobListItem = {
  pathname: string;  // e.g. reports/<owner>/rpt-1761562672200.html
  url: string;
  size?: number;
  uploadedAt?: string;
};
type ListResponse = {
  blobs: BlobListItem[];
  cursor?: string | null;
};

/**
 * Accept BOTH:
 *   reports/<owner>/rpt-<timestamp>.(html|json|pdf)
 *   reports/<owner>/rpt-<timestamp>-<random>.(html|json|pdf)  // future-proof
 *
 * Groups by {owner, rpt-<timestamp>}.
 *
 * Regex groups:
 *  1: owner
 *  2: report_id base (rpt-<timestamp>)
 *  3: timestamp (digits)
 *  4: optional random suffix (if present)
 *  5: extension (html|json|pdf)
 */
const FILE_RE =
  /^reports\/([^/]+)\/(rpt-(\d+))(?:-[A-Za-z0-9_-]+)?\.(html|json|pdf)$/i;

type Row = {
  owner: string;
  report_id: string;      // rpt-<timestamp>
  html_url?: string;
  json_url?: string;
  pdf_url?: string;       // present if you kept older pdfs
  viewer_url: string;     // /report/view/<report_id>
  ts: number;             // numeric timestamp for sorting
};

export async function GET(req: NextRequest) {
  // Pro gate
  const gate = await requirePro(req as unknown as Request);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status ?? 402 });

  const url = new URL(req.url);
  const ownerFilter = (url.searchParams.get("owner") || "").trim().toLowerCase();
  const limitParam = Number(url.searchParams.get("limit") || 1000);
  const limit = Math.max(1, Math.min(1000, isNaN(limitParam) ? 1000 : limitParam));
  const cursorIn = url.searchParams.get("cursor") || undefined;
  const debug = url.searchParams.get("debug") === "1";

  const origin = new URL(req.url).origin;
  const prefix = ownerFilter ? `reports/${ownerFilter}/` : "reports/";

  const diag: Record<string, any> = {
    prefixUsed: prefix,
    ownerFilter,
    limitRequested: limit,
    startCursor: cursorIn || null,
    pagesScanned: 0,
    pageDiagnostics: [] as any[],
  };
  console.log("[reports/list] START", { prefix, ownerFilter, limit, cursorIn, debug });

  const map = new Map<string, Row>(); // key: owner::report_id
  let cursor: string | undefined = cursorIn;
  let pages = 0;
  const maxPages = debug ? 5 : 1; // in debug, scan up to 5 pages

  do {
    pages += 1;
    diag.pagesScanned = pages;

    const resp = (await list({
      prefix,
      limit,
      cursor,
      ...(process.env.BLOB_READ_WRITE_TOKEN ? { token: process.env.BLOB_READ_WRITE_TOKEN } : {}),
    })) as unknown as ListResponse;

    const pageInfo = {
      page: pages,
      cursorIn: cursor || null,
      blobCount: resp.blobs?.length || 0,
      samplePathnames: resp.blobs?.slice(0, 10).map((b) => b.pathname) || [],
      nextCursor: resp.cursor ?? null,
    };
    diag.pageDiagnostics.push(pageInfo);
    console.log("[reports/list] PAGE", pageInfo);

    for (const b of resp.blobs) {
      const m = b.pathname.match(FILE_RE);
      if (!m) {
        if (debug) console.log("[reports/list] SKIP (no match to FILE_RE):", b.pathname);
        continue;
      }

      const owner = m[1].toLowerCase();
      const report_id = m[2].toLowerCase(); // rpt-<timestamp>
      const tsNum = Number(m[3]) || 0;
      const ext = m[5].toLowerCase();

      if (ownerFilter && owner !== ownerFilter) {
        if (debug) console.log("[reports/list] SKIP (ownerFilter mismatch):", { owner, ownerFilter });
        continue;
      }

      const key = `${owner}::${report_id}`;
      let row = map.get(key);
      if (!row) {
        row = {
          owner,
          report_id,
          viewer_url: `${origin}/report/view/${report_id}`,
          ts: tsNum,
        };
        map.set(key, row);
      }

      if (ext === "html") row.html_url = b.url;
      else if (ext === "json") row.json_url = b.url;
      else if (ext === "pdf") row.pdf_url = b.url;
    }

    cursor = (resp.cursor ?? undefined) as string | undefined;
    if (!debug || pages >= maxPages) break;
  } while (cursor);

  const items = Array.from(map.values())
    .filter((r) => r.html_url || r.json_url || r.pdf_url)
    .sort((a, b) => b.ts - a.ts);

  console.log("[reports/list] DONE", { items: items.length, pagesScanned: pages });

  const body: any = {
    ok: true,
    items,
    cursor: cursor || null,
  };
  if (debug) body._debug = diag;

  return NextResponse.json(body);
}
