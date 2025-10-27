// app/api/reports/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { list } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ---- Minimal per-IP token bucket ----
 * Limits: 30 requests / minute / IP (configurable)
 * In-memory only (good enough for scraping deterrence on serverless)
 */
const MAX_PER_MIN = 30;
const BUCKETS = new Map<
  string,
  { tokens: number; lastRefill: number }
>();

function getClientIp(req: NextRequest): string {
  // X-Forwarded-For may contain a chain; take the first public-ish token
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  // Fallback to user agent hash to avoid single-bucket
  const ua = req.headers.get("user-agent") || "unknown";
  return `ua:${ua.slice(0, 40)}`;
}

function rateLimit(ip: string): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const refillPerMs = MAX_PER_MIN / 60000; // tokens per ms

  let bucket = BUCKETS.get(ip);
  if (!bucket) {
    bucket = { tokens: MAX_PER_MIN, lastRefill: now };
    BUCKETS.set(ip, bucket);
  } else {
    const elapsed = Math.max(0, now - bucket.lastRefill);
    bucket.tokens = Math.min(MAX_PER_MIN, bucket.tokens + elapsed * refillPerMs);
    bucket.lastRefill = now;
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true };
  }

  // How long until next token?
  const deficit = 1 - bucket.tokens;
  const ms = Math.ceil(deficit / refillPerMs);
  return { ok: false, retryAfter: Math.max(1, Math.ceil(ms / 1000)) };
}

/**
 * Pathname pattern:
 *   reports/<owner>/rpt-<13digit_ts>[ -<random> ].<ext>
 * Accepts legacy files without the random suffix, and with html/json/pdf.
 */
const FILE_RE = /^reports\/([^/]+)\/(rpt-(\d{13}))(?:-[A-Za-z0-9]+)?\.(html|json|pdf)$/i;

type Row = {
  owner: string;
  report_id: string;
  ts: number;
  html_url?: string;
  json_url?: string;
  pdf_url?: string;
  viewer_url: string;
};

export async function GET(req: NextRequest) {
  // ---- Rate limit first ----
  const ip = getClientIp(req);
  const rl = rateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "RATE_LIMITED",
        message: `Too many requests. Try again soon.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      }
    );
  }

  const url = new URL(req.url);
  const ownerFilter = (url.searchParams.get("owner") || "").trim().toLowerCase();
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20)));
  const debug = url.searchParams.get("debug") === "1";

  const items: Row[] = [];
  const seen = new Set<string>(); // report key: owner|report_id
  const pageDiagnostics: any[] = [];

  let cursor: string | undefined = url.searchParams.get("cursor") || undefined;
  let page = 0;

  // Keep listing blobs until we have at least `limit` distinct reports or run out of pages
  while (items.length < limit) {
    page += 1;
    const res = await list({
      prefix: "reports/",
      limit: 1000, // page size at storage level
      cursor,
    });

    const sample = res.blobs.slice(0, 10).map((b) => b.pathname);
    if (debug) {
      pageDiagnostics.push({
        page,
        cursorIn: cursor ?? null,
        blobCount: res.blobs.length,
        samplePathnames: sample,
        nextCursor: res.cursor ?? null,
      });
    }

    for (const blob of res.blobs) {
      const m = FILE_RE.exec(blob.pathname);
      if (!m) continue;

      const ownerRaw = m[1];
      if (ownerFilter && ownerRaw.toLowerCase() !== ownerFilter) continue;

      const reportId = m[2]; // e.g., rpt-1761561067344
      const ts = Number(m[3]); // 13-digit timestamp
      const ext = m[4].toLowerCase();

      const key = `${ownerRaw}|${reportId}`;
      let row = (items.find((r) => `${r.owner}|${r.report_id}` === key) as Row | undefined);

      if (!row) {
        // Only add a new row if we still need more
        if (seen.has(key)) {
          // already finalized row in a previous page
        } else {
          row = {
            owner: ownerRaw,
            report_id: reportId,
            ts,
            viewer_url: `${url.origin}/report/view/${reportId}`,
          };
          items.push(row);
          seen.add(key);
        }
      }

      // Attach URLs by extension (SDK returns public URL for public blobs)
      if (row) {
        if (ext === "html") row.html_url = (blob as any).url || undefined;
        else if (ext === "json") row.json_url = (blob as any).url || undefined;
        else if (ext === "pdf") row.pdf_url = (blob as any).url || undefined;
      }

      // Stop early if we already hit desired count
      if (items.length >= limit) break;
    }

    if (!res.cursor || items.length >= limit) {
      cursor = undefined;
      break;
    }
    cursor = res.cursor;
  }

  // Sort newest-first by ts, then trim to `limit` just in case
  items.sort((a, b) => b.ts - a.ts);
  if (items.length > limit) items.length = limit;

  const payload: any = {
    ok: true,
    items,
    cursor: cursor ?? null,
  };

  if (debug) {
    payload._debug = {
      prefixUsed: "reports/",
      ownerFilter,
      limitRequested: limit,
      startCursor: (url.searchParams.get("cursor") || null),
      pagesScanned: page,
      pageDiagnostics,
    };
  }

  return NextResponse.json(payload, { status: 200 });
}
