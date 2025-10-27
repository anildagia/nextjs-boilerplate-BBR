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

async function fetchReports(owner: string | undefined, license: string | undefined): Promise<{ items: Row[] }> {
  // Build absolute base URL from incoming request (Next 15-safe)
  const hdrsList = (await (nextHeaders() as unknown as Promise<Headers>));
  const host = hdrsList.get("host") || "";
  const proto = hdrsList.get("x-forwarded-proto") || "https";
  const base = `${proto}://${host}`;

  const params = new URLSearchParams();
  if (owner) params.set("owner", owner.toLowerCase());

  const res = await fetch(`${base}/api/reports/list?${params.toString()}`, {
    cache: "no-store",
    headers: license ? { "X-License-Key": license } : {},
  }).catch(() => null);

  if (!res || !res.ok) return { items: [] };
  return res.json();
}

export default async function ReportsPage({ searchParams }: { searchParams: { owner?: string; license?: string } }) {
  const owner = (searchParams?.owner || "").trim() || undefined;
  const license = (searchParams?.license || "").trim() || undefined;

  const { items } = await fetchReports(owner, license);

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
            <button className="px-3 py-2 text-sm rounded bg-black text-white">Apply</button>
          </form>
        </header>

        {!license && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
            Enter your Pro license in the form above (or append
            <code className="mx-1">?license=YOUR_KEY</code>) to load reports.
          </div>
        )}

        <div className="bg-white rounded-xl shadow divide-y">
          {items.length === 0 ? (
            <div className="p-6 text-gray-500">
              No reports found{owner ? ` for “${owner}”` : ""}.
            </div>
          ) : (
            <ClientList items={items} />
          )}
        </div>
      </div>
    </main>
  );
}

// client subcomponent for copy buttons
import ClientList from "./ClientList";
