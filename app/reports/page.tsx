// app/reports/page.tsx
import { headers as nextHeaders } from "next/headers";
export const dynamic = "force-dynamic";

type Row = {
  owner: string;
  report_id: string;
  html_url?: string;
  json_url?: string;
  viewer_url: string;
  pdf_url?: string;
  ts: number;
};

type ListResponse = {
  ok: boolean;
  items: Row[];
  cursor?: string | null;
};

async function fetchReports(
  owner: string | undefined,
  license: string | undefined,
  limit = 20
): Promise<ListResponse> {
  // Next 15: headers() can be async
  const hdrsList = (await (nextHeaders() as unknown as Promise<Headers>));
  const host = hdrsList.get("host") || "";
  const proto = hdrsList.get("x-forwarded-proto") || "https";
  const base = `${proto}://${host}`;

  const params = new URLSearchParams();
  if (owner) params.set("owner", owner.toLowerCase());
  params.set("limit", String(limit));

  const res = await fetch(`${base}/api/reports/list?${params.toString()}`, {
    cache: "no-store",
    headers: license ? { "X-License-Key": license } : {},
  }).catch(() => null);

  if (!res || !res.ok) return { ok: false, items: [], cursor: null };
  return res.json();
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { owner?: string; license?: string; limit?: string };
}) {
  const owner = (searchParams?.owner || "").trim() || undefined;
  const license = (searchParams?.license || "").trim() || undefined;
  const limit = Number(searchParams?.limit || 20) || 20;

  let items: Row[] = [];
  let cursor: string | null = null;

  if (license) {
    const resp = await fetchReports(owner, license, limit);
    items = resp.items || [];
    cursor = resp.cursor ?? null;
  }
  
  // const { items, cursor } = await fetchReports(owner, license, limit);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">My Reports</h1>
          <form className="flex gap-2 items-center" action="/reports" method="get">
            <input
              type="text"
              name="owner"
              placeholder="Filter by owner (prepared_by/for)"
              defaultValue={owner || ""}
              className="border rounded px-3 py-2 text-sm"
            />
            <input
              type="password"
              name="license"
              placeholder="License key"
              defaultValue={license || ""}
              className="border rounded px-3 py-2 text-sm"
            />
            <input
              type="number"
              name="limit"
              min={5}
              max={100}
              defaultValue={limit}
              className="border rounded px-2 py-2 text-sm w-24"
              title="Page size"
            />
            <button className="px-3 py-2 text-sm rounded bg-black text-white">Apply</button>
          </form>
        </header>

        {!license && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
            Enter your Pro license above (or append <code className="mx-1">?license=YOUR_KEY</code>) to load reports.
          </div>
        )}

        <div className="bg-white rounded-xl shadow divide-y">
          <ClientList
            initialItems={items || []}
            initialCursor={cursor ?? null}
            owner={owner}
            license={license}
            limit={limit}
          />
        </div>
      </div>
    </main>
  );
}

// client list with pagination lives in a separate client module
import ClientList from "./ClientList";
