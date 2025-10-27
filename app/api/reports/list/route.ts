// app/api/reports/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { requirePro } from "@/app/api/_lib/paywall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BlobListItem = {
  pathname: string;  // e.g. reports/<owner>/rpt-1761562672200-ABC.html
  url: string;
  size?: number;
  uploadedAt?: string;
};
type ListResponse = {
  blobs: BlobListItem[];
  cursor?: string | null;
};

const FILE_RE = /^reports\/([^/]+)\/(rpt-(\d+))-([A-Za-z0-9_-]+)\.(html|json)$/i;
// groups:
// 1: owner
// 2: report_id base (rpt-<timestamp>)
// 3: timestamp (digits)
// 4: random suffix
// 5: ext (html|json)

type Row = {
  owner: string;
  report_id: string;      // rpt-<timestamp>
  html_url?: string;
  json_url?: string;
  viewer_url: string;     // /report/view/<report_id>
  ts: number;             // sort helper
};

export async function GET(req: NextRequest) {
  // Pro gate
  const gate = await requirePro(req as unknown as Request);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status ?? 402 });

  const url = new URL(req.url);
  const ownerFilter = (url.searchParams.get("owner") || "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit") || 1000)));
  const cursorIn = url.searchParams.get("cursor") || undefined;

  // If owner provided, scope to that prefix; else scan all reports/*
  const prefix = ownerFilter ? `reports/${ownerFilter}/` : "reports/";

  const resp = (await list({
    prefix,
    limit,
    cursor: cursorIn,
    ...(process.env.BLOB_READ_WRITE_TOKEN ? { token: process.env.BLOB_READ_WRITE_TOKEN } : {}),
  })) as unknown as ListResponse;

  const origin = new URL(req.url).origin;
  const map = new Map<string, Row>(); // key: owner::report_id

  for (const b of resp.blobs) {
    const m = b.pathname.match(FILE_RE);
    if (!m) continue;

    const owner = m[1].toLowerCase();
    const report_id = m[2].toLowerCase(); // rpt-<timestamp>
    const tsNum = Number(m[3]) || 0;
    const ext = m[5].toLowerCase();

    if (ownerFilter && owner !== ownerFilter) continue;

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
    if (ext === "json") row.json_url = b.url;
  }

  // Keep only rows that have at least html OR json; sort by timestamp desc
  const items = Array.from(map.values())
    .filter(r => r.html_url || r.json_url)
    .sort((a, b) => b.ts - a.ts);

  return NextResponse.json({
    ok: true,
    items,
    cursor: resp.cursor ?? null,
  });
}
