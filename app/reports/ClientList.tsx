"use client";

import { useCallback, useState } from "react";

type Row = {
  owner: string;
  report_id: string;
  html_url?: string;
  json_url?: string;
  viewer_url: string;
  pdf_url?: string;
  ts: number;
};

type Props = {
  initialItems: Row[];
  initialCursor: string | null;
  owner?: string;
  license?: string;
  limit?: number;
};

export default function ClientList({
  initialItems,
  initialCursor,
  owner,
  license,
  limit = 20,
}: Props) {
  const [items, setItems] = useState<Row[]>(initialItems || []);
  const [cursor, setCursor] = useState<string | null>(initialCursor || null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (owner) params.set("owner", owner.toLowerCase());
      if (cursor) params.set("cursor", cursor);
      params.set("limit", String(limit));

      const res = await fetch(`/api/reports/list?${params.toString()}`, {
        headers: license ? { "X-License-Key": license } : {},
        cache: "no-store",
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const newItems: Row[] = Array.isArray(data?.items) ? data.items : [];
      setItems(prev => [...prev, ...newItems]);
      setCursor(data?.cursor ?? null);
    } catch (e: any) {
      setErr(e?.message || "Failed to load more");
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, owner, license, limit]);

  const refresh = useCallback(async () => {
    // Reload first page via navigation (preserves search params)
    window.location.reload();
  }, []);

  return (
    <>
      {items.length === 0 && (
        <div className="p-6 text-gray-500">No reports found{owner ? ` for “${owner}”` : ""}.</div>
      )}

      {items.map((r) => (
        <div key={`${r.owner}-${r.report_id}`} className="p-4 flex items-center justify-between">
          <div className="space-y-1">
            <div className="font-medium">{r.report_id}</div>
            <div className="text-sm text-gray-500">
              Owner: {r.owner} · {new Date(r.ts).toLocaleString()}
            </div>
          </div>
          <div className="flex gap-3">
            <a
              className="text-blue-600 hover:underline text-sm"
              href={r.viewer_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open
            </a>
            {r.html_url && (
              <button
                className="text-sm underline"
                onClick={async () => {
                  await navigator.clipboard.writeText(r.html_url!);
                  alert("HTML URL copied");
                }}
              >
                Copy HTML
              </button>
            )}
            {r.json_url && (
              <button
                className="text-sm underline"
                onClick={async () => {
                  await navigator.clipboard.writeText(r.json_url!);
                  alert("JSON URL copied");
                }}
              >
                Copy JSON
              </button>
            )}
            {r.pdf_url && (
              <a
                className="text-sm text-blue-600 hover:underline"
                href={r.pdf_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                PDF
              </a>
            )}
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between p-4">
        <div className="text-sm text-gray-500">
          {cursor ? "More results available" : items.length > 0 ? "End of results" : ""}
          {err ? ` · ${err}` : ""}
        </div>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            className="px-3 py-2 text-sm rounded border bg-white hover:bg-gray-50"
            disabled={loading}
          >
            Refresh
          </button>
          <button
            onClick={loadMore}
            className="px-3 py-2 text-sm rounded bg-black text-white disabled:opacity-50"
            disabled={!cursor || loading}
          >
            {loading ? "Loading…" : cursor ? "Load more" : "No more"}
          </button>
        </div>
      </div>
    </>
  );
}
