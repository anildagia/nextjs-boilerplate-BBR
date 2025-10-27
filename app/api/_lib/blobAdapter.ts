// Tries to reuse an existing blob helper in your repo.
// Falls back to @vercel/blob.put if nothing is found.
// Additive-only; does not modify existing files.

type PutResult = { url: string; pathname?: string; size?: number; uploadedAt?: string };

type PutLike =
  | ((pathname: string, data: any, contentType?: string) => Promise<PutResult>)                                // putBlob(path, data, ct)
  | ((pathname: string, data: any, opts?: { contentType?: string; access?: "public" | "private" }) => Promise<PutResult>); // put(path, data, opts)

let cached: (pathname: string, data: any, contentType?: string) => Promise<PutResult> | null = null;

async function tryImport<T = any>(path: string): Promise<T | null> {
  try { return (await import(path)) as T; } catch { return null; }
}

async function resolveImpl(): Promise<(pathname: string, data: any, contentType?: string) => Promise<PutResult>> {
  // Common places teams keep a blob helper:
  const candidates = [
    "@/app/api/_lib/blob",           // e.g., export { putBlob } or export { put }
    "@/app/api/_lib/storage/blob",
    "@/app/_lib/blob",
    "@/lib/blob",
  ];

  for (const p of candidates) {
    const mod = await tryImport<any>(p);
    if (!mod) continue;

    if (typeof mod.putBlob === "function") {
      return (pathname, data, contentType) => mod.putBlob(pathname, data, contentType);
    }
    if (typeof mod.put === "function") {
      return (pathname, data, contentType) => mod.put(pathname, data, { contentType, access: "public" });
    }
  }

  // Fallback to @vercel/blob
  const vb = await tryImport<any>("@vercel/blob");
  if (vb?.put) {
    return (pathname, data, contentType) => vb.put(pathname, data, { contentType, access: "public" });
  }

  throw new Error("No blob helper found and @vercel/blob not available");
}

export async function putBlob(pathname: string, data: any, contentType?: string): Promise<PutResult> {
  if (!cached) cached = await resolveImpl();
  return cached(pathname, data, contentType);
}
