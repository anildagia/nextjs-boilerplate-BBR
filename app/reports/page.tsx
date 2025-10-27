// app/reports/page.tsx
export const dynamic = "force-dynamic";

type Row = {
  owner: string;
  report_id: string;
  html_url?: string;
  json_url?: string;
  viewer_url: string;
};

async function fetchReports(owner: string | undefined, license: string | undefined): Promise<{ items: Row[] }> {
  const params = new URLSearchParams();
  if (owner) params.set("owner", owner.toLowerCase());

  // Use relative path; Next will resolve to this app’s API
  const res = await fetch(`/api/reports/list?${params.toString()}`, {
    cache: "no-store",
    headers: license ? { "X-License-Key": license } : {},
  }).catch(() => null);

  if (!res || !res.ok) return { items: [] };
  return res.json();
}

export default async function ReportsPage({ searchParams }: { searchParams: { owner?: string; license?: string } }) {
  const owner = (searchParams?.owner || "").trim();
  const license = (searchParams?.license || "").trim();

  const { items } = await fetchReports(owner || undefined, license || undefined);

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
              defaultValue={owner}
              className="border rounded px-3 py-2 text-sm"
            />
            <input
              type="password"
              name="license"
              placeholder="License key"
              defaultValue={license}
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
            items.map((r) => (
              <div key={`${r.owner}-${r.report_id}`} className="p-4 flex items-center justify-between">
                <div className="space-y-1">
                  <div className="font-medium">{r.report_id}</div>
                  <div className="text-sm text-gray-500">Owner: {r.owner}</div>
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
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
