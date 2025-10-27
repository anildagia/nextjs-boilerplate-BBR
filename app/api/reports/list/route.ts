// app/api/reports/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { requirePro } from "@/app/api/_lib/paywall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Extract rpt id and owner from a blob pathname like:
// reports/<owner>/rpt-1730025600.html
// reports/<owner>/rpt-1730025600-XYZ.json
const RPT_RE = /\/reports\/([^/]+)\/(rpt-\d+)(?:-[^/.]+)?\.(html|json)$/i;

type Row = {
  owner: string;
  report_id: string;
  html_url?: string;
  json_url?: string;
  viewer_url: string;
};

export async function GET(req: NextRequest) {
  // Pro gate
  const gate = await requirePro(req as unknown as Request);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status ?? 402 });

  const url = new URL(req.url);
  const ownerFilter = (url.searchParams.get("owner") || "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit") || 1000)));
  const cursor = url.searchParams.get("cursor") || undefined;

  // Optional optimization: if owner provided, tighten the prefix
  const prefix = ownerFilter ? `reports/${ownerFilter}/` : "reports/";

  const resp = await list({
    prefix,
    limit,
    cursor,
    ...(process.env.BLOB_READ_WRITE_TOKEN ? { token: process.env.BLOB_READ_WRITE_TOKEN } : {}),
  });

  // group by (owner, report_id)
  const map = new Map<string, Row>();

  for (const b of resp.blobs) {
    const m = b.pathname.match(RPT_RE);
    if (!m) continue;
    const [, ownerRaw, reportId, ext] = m;
    const owner = ownerRaw.toLowerCase();

    const key = `${owner}::${reportId}`;
    const row = map.get(key) || {
      owner,
      report_id: reportId,
      viewer_url: `${new URL(req.url).origin}/report/view/${reportId}`,
    };

    if (ext === "html") row.html_url = b.url;
    if (ext === "json") row.json_url = b.url;

    map.set(key, row);
  }

  // Turn into array (most recent first by numeric id)
  const rows = Array.from(map.values()).sort((a, b) => {
    const ta = Number(a.report_id.replace("rpt-", "")) || 0;
    const tb = Number(b.report_id.replace("rpt-", "")) || 0;
    return tb - ta;
  });

  return NextResponse.json({
    ok: true,
    items: rows,
    cursor: resp.cursor ?? null,
  });
}
