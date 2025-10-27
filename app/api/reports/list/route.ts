// app/api/reports/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { requirePro } from "@/app/api/_lib/paywall"; // ⬅️ paywall gate

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Minimal per-IP token bucket: 30 req/min */
const MAX_PER_MIN = 30;
const BUCKETS = new Map<string, { tokens: number; lastRefill: number }>();
const FILE_RE = /^reports\/([^/]+)\/(rpt-(\d{13}))(?:-[A-Za-z0-9]+)?\.(html|json|pdf)$/i;

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) { const first = xff.split(",")[0]?.trim(); if (first) return first; }
  const real = req.headers.get("x-real-ip"); if (real) return real;
  const ua = req.headers.get("user-agent") || "unknown";
  return `ua:${ua.slice(0, 40)}`;
}
function rateLimit(ip: string): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now(), refillPerMs = MAX_PER_MIN / 60000;
  let b = BUCKETS.get(ip);
  if (!b) { b = { tokens: MAX_PER_MIN, lastRefill: now }; BUCKETS.set(ip, b); }
  else {
    const elapsed = Math.max(0, now - b.lastRefill);
    b.tokens = Math.min(MAX_PER_MIN, b.tokens + elapsed * refillPerMs);
    b.lastRefill = now;
  }
  if (b.tokens >= 1) { b.tokens -= 1; return { ok: true }; }
  const deficit = 1 - b.tokens, ms = Math.ceil(deficit / refillPerMs);
  return { ok: false, retryAfter: Math.max(1, Math.ceil(ms / 1000)) };
}

type Row = {
  owner: string; report_id: string; ts: number;
  html_url?: string; json_url?: string; pdf_url?: string; viewer_url: string;
};

export async function GET(req: NextRequest) {
  // ---- Pro paywall (blocks anonymous access) ----
  const gate = await requirePro(req as unknown as Request);
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: "PRO_REQUIRED", message: "License required to list reports." },
      { status: gate.status ?? 402 }
    );
  }

  // ---- Rate limit ----
  const ip = getClientIp(req);
  const rl = rateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "RATE_LIMITED", message: "Too many requests. Try again soon." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  const url = new URL(req.url);
  const ownerFilter = (url.searchParams.get("owner") || "").trim().toLowerCase();
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20)));
  const debug = url.searchParams.get("debug") === "1";

  const items: Row[] = [];
  const seen = new Set<string>();
  const pageDiagnostics: any[] = [];
  let cursor: string | undefined = url.searchParams.get("cursor") || undefined;
  let page = 0;

  while (items.length < limit) {
    page += 1;
    const res = await list({ prefix: "reports/", limit: 1000, cursor });
    if (debug) {
      pageDiagnostics.push({
        page, cursorIn: cursor ?? null, blobCount: res.blobs.length,
        samplePathnames: res.blobs.slice(0, 10).map(b => b.pathname),
        nextCursor: res.cursor ?? null,
      });
    }

    for (const blob of res.blobs) {
      const m = FILE_RE.exec(blob.pathname);
      if (!m) continue;
      const ownerRaw = m[1];
      if (ownerFilter && ownerRaw.toLowerCase() !== ownerFilter) continue;

      const reportId = m[2], ts = Number(m[3]), ext = m[4].toLowerCase();
      const key = `${ownerRaw}|${reportId}`;
      let row = items.find(r => `${r.owner}|${r.report_id}` === key);
      if (!row) {
        if (seen.has(key)) { /* already finalized */ }
        else {
          row = { owner: ownerRaw, report_id: reportId, ts, viewer_url: `${url.origin}/report/view/${reportId}` };
          items.push(row); seen.add(key);
        }
      }
      if (row) {
        if (ext === "html") row.html_url = (blob as any).url || undefined;
        else if (ext === "json") row.json_url = (blob as any).url || undefined;
        else if (ext === "pdf") row.pdf_url = (blob as any).url || undefined;
      }
      if (items.length >= limit) break;
    }

    if (!res.cursor || items.length >= limit) { cursor = undefined; break; }
    cursor = res.cursor;
  }

  items.sort((a, b) => b.ts - a.ts);
  if (items.length > limit) items.length = limit;

  const payload: any = { ok: true, items, cursor: cursor ?? null };
  if (debug) payload._debug = { ownerFilter, limitRequested: limit, pagesScanned: page, pageDiagnostics };
  return NextResponse.json(payload, { status: 200 });
}
