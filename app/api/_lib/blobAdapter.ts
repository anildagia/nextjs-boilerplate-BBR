// Minimal fallback that uses Vercel Blob REST API directly.
// Works even if @vercel/blob package isn't installed.

export interface PutResult {
  url: string;
  pathname?: string;
  size?: number;
  uploadedAt?: string;
}

/**
 * Uploads data to the connected Vercel Blob store.
 * Automatically uses the system auth context inside Vercel.
 */
export async function putBlob(
  pathname: string,
  data: Blob | ArrayBuffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<PutResult> {
  // ensure we have a base64 string or ArrayBuffer
  const body =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : data instanceof Blob
      ? data
      : new Blob([data], { type: contentType });

  const res = await fetch(`https://api.vercel.com/v2/blob?pathname=${encodeURIComponent(pathname)}`, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-vercel-bearer-token": process.env.BLOB_READ_WRITE_TOKEN || "",
    },
    body,
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Blob upload failed: ${res.status} ${msg}`);
  }

  return (await res.json()) as PutResult;
}
