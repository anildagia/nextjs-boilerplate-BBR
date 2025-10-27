"use client";

type Row = {
  owner: string;
  report_id: string;
  html_url?: string;
  json_url?: string;
  viewer_url: string;
  pdf_url?: string;
  ts: number;
};

export default function ClientList({ items }: { items: Row[] }) {
  return (
    <>
      {items.map((r) => (
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
    </>
  );
}
