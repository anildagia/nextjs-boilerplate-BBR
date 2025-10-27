import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

async function getReportHTML(reportId: string) {
  const owner = "anon"; // optional: parse owner from query or session later
  const url = `https://belief-blueprint.vercel-storage.com/reports/${owner}/${reportId}.html`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.text();
}

export default async function ReportViewerPage({ params }: { params: { reportId: string } }) {
  const html = await getReportHTML(params.reportId);
  if (!html) notFound();

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-5xl mx-auto bg-white shadow-lg rounded-2xl overflow-hidden">
        <div className="flex justify-between items-center px-6 py-4 border-b">
          <img
            src="https://www.anildagia.com/templates/rt_orion/custom/images/5thelement.jpg"
            alt="Brand Logo"
            className="h-10"
          />
          <button onClick={() => window.print()} className="text-sm text-blue-600 hover:underline">
            Print / Save as PDF
          </button>
        </div>
        <div
          className="prose prose-lg max-w-none p-6"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <footer className="text-center text-sm text-gray-500 py-4 border-t">
          © 2025 5th Element · Coaching guidance, not therapy.
        </footer>
      </div>
    </main>
  );
}
