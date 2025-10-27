import { NextRequest, NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { requirePro } from "@/app/api/_lib/paywall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BlobListItem = {
  pathname: string;  // e.g. "reports/5th-element/rpt-1761561067344-ABCD.html"
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
  pdf_url?: string;     // legacy files, if any
  viewer_url: string;   // /report/view/<report_id>
  ts: number;           // numeric timestamp for sorting
};

// Safely find "reports/<owner>/<filename>" anywhere in the path.
function splitPath(pathname: string) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  const ix = parts.indexOf("reports");
  if (ix < 0 || ix + 2 >= parts.length) return null;
  const owner = parts[ix + 1];
  const filename = parts.slice(ix + 2).join("/"); // support deeper nesting if it ever appears
  return { owner, filename };
}

// Parse "rpt-<timestamp>(-random)?.<ext>" → { report_id: "rpt-<ts>", ts: number, ext }
function parseFilename(filename: string) {
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

  const diag: Record<string, any> = {
    prefixUsed: prefix,
    ownerFilter,
    limitRequested: limit,
    startCursor: cursorIn || null,
    pagesScanned: 0,
    pageDiagnostics: [] as any[],
    scanned: [] as any[], // per-blob logs in debug
  };
  if (debug) console.log("[reports/list] START", { prefix, ownerFilter, limit, cursorIn, debug });

  const map = new Map<string, Row>(); // key: owner::report_id
  let cursor: string | undefined = cursorIn;
  let pages = 0;
  const maxPages = debug ? 5 : 1; // scan more pages in debug mode

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
      const entry: any = { pathname: b.pathname };

      const sp = splitPath(b.pathname);
      if (!sp) {
        entry.skip = "splitPath-failed";
        if (debug) console.log("[reports/list] SKIP splitPath:", b.pathname);
        diag.scanned.push(entry);
        continue;
      }
      entry.ownerRaw = sp.owner;
      entry.filename = sp.filename;

      const owner = (sp.owner || "").toLowerCase();
      if (!owner) {
        entry.skip = "owner-empty";
        if (debug) console.log("[reports/list] SKIP ownerEmpty:", b.pathname);
        diag.scanned.push(entry);
        continue;
      }
      if (ownerFilter && owner !== ownerFilter) {
        entry.skip = "owner-filter-mismatch";
        entry.owner = owner;
        if (debug) console.log("[reports/list] SKIP ownerFilter mismatch:", { owner, ownerFilter });
        diag.scanned.push(entry);
        continue;
      }

      const pf = parseFilename(sp.filename);
      if (!pf) {
        entry.skip = "parseFilename-failed";
        if (debug) console.log("[reports/list] SKIP parseFilename:", sp.filename);
        diag.scanned.push(entry);
        continue;
      }

      entry.parsed = pf;
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

      entry.included = true;
      diag.scanned.push(entry);
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
