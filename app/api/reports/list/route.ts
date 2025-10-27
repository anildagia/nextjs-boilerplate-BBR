// app/api/reports/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { requirePro } from "@/app/api/_lib/paywall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BlobListItem = {
  pathname: string;  // e.g. "reports/5th-element/rpt-1761562672200.html"
  url: string;
  size?: number;
  uploadedAt?: string;
};
type ListResponse = {
  blobs: BlobListItem[];
  cursor?: string | null;
};

type Row = {
  owner: string;        // folder under reports/
  report_id: string;    // "rpt-<timestamp>"
  html_url?: string;
  json_url?: string;
  pdf_url?: string;
  viewer_url: string;   // /report/view/<report_id>
  ts: number;           // numeric timestamp for sorting
};

// Parse "reports/<owner>/<filename>"
function splitPath(pathname: string) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  // expect at least ["reports", "<owner>", "<filename>"]
  if (parts.length < 3 || parts[0] !== "reports") return null;
  const owner = parts[1];
  const filename = parts.slice(2).join("/"); // supports any deeper nesting if ever added
  return { owner, filename };
}

// Parse "rpt-<timestamp>(-random)?.<ext>" → { report_id: "rpt-<ts>", ts: number, ext }
function parseFilename(filename: string) {
  // strict but guarded
  const m = filename.match(/^(rpt-(\d+))(?:-[^.]+)?\.(html|json|pdf)$/i);
  if (!m) return null;
  const report_id = m[1];         // "rpt-<ts>"
  const ts = Number(m[2]) || 0;   // numeric timestamp
  const ext = m[3].toLowerCase(); // html|json|pdf
  return { report_id, ts, ext };
}

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

  // diagnostics
  const diag: Record<string, any> = {
    prefixUsed: prefix,
    ownerFilter,
    limitRequested: limit,
    startCursor: cursorIn || null,
    pagesScanned: 0,
    pageDiagnostics: [] as any[],
  };
  if (debug) console.log("[reports/list] START", { prefix, ownerFilter, limit, cursorIn, debug });

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
    if (debug) console.log("[reports/list] PAGE", pageInfo);
    diag.pageDiagnostics.push(pageInfo);

    for (const b of resp.blobs) {
      const sp = splitPath(b.pathname);
      if (!sp) {
        if (debug) console.log("[reports/list] SKIP splitPath:", b.pathname);
        continue;
      }
      const owner = (sp.owner || "").toLowerCase();
      if (!owner) {
        if (debug) console.log("[reports/list] SKIP ownerEmpty:", b.pathname);
        continue;
      }
      if (ownerFilter && owner !== ownerFilter) {
        if (debug) console.log("[reports/list] SKIP ownerFilter mismatch:", { owner, ownerFilter });
        continue;
      }

      const pf = parseFilename(sp.filename);
      if (!pf) {
        if (debug) console.log("[reports/list] SKIP parseFilename:", sp.filename);
        continue;
      }

      const key = `${owner}::${pf.report_id.toLowerCase()}`;
      let row = map.get(key);
      if (!row) {
        row = {
          owner,
          report_id: pf.report_id.toLowerCase(),
          viewer_url: `${origin}/report/view/${pf.report_id.toLowerCase()}`,
          ts: pf.ts,
        };
        map.set(key, row);
      }

      if (pf.ext === "html") row.html_url = b.url;
      else if (pf.ext === "json") row.json_url = b.url;
      else if (pf.ext === "pdf") row.pdf_url = b.url;
    }

    cursor = (resp.cursor ?? undefined) as string | undefined;
    if (!debug || pages >= maxPages) break;
  } while (cursor);

  const items = Array.from(map.values())
    .filter((r) => r.html_url || r.json_url || r.pdf_url)
    .sort((a, b) => b.ts - a.ts);

  if (debug) console.log("[reports/list] DONE", { items: items.length, pagesScanned: pages });

  const body: any = {
    ok: true,
    items,
    cursor: cursor || null,
  };
  if (debug) body._debug = diag;

  return NextResponse.json(body);
}
