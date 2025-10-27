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
  let body: Blob;

  if (typeof data === "string") {
    body = new Blob([data], { type: contentType });
  } else if (data instanceof Blob) {
    body = data;
  } else if (data instanceof ArrayBuffer) {
    body = new Blob([data], { type: contentType });
  } else if (data instanceof Uint8Array) {
    // ✅ convert Uint8Array to ArrayBuffer for TS compatibility
    body = new Blob([data.buffer], { type: contentType });
  } else {
    throw new Error("Unsupported data type for blob upload");
  }

  const res = await fetch(
    `https://api.vercel.com/v2/blob?pathname=${encodeURIComponent(pathname)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "x-vercel-bearer-token": process.env.BLOB_READ_WRITE_TOKEN || "",
      },
      body,
    }
  );

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Blob upload failed: ${res.status} ${msg}`);
  }

  return (await res.json()) as PutResult;
}
