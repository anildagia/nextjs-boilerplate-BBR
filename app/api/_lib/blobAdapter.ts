// Simple wrapper around the same Blob upload logic used in app/api/exports/pdf/route.ts.
// This guarantees identical behavior for new features (HTML, JSON, PDF uploads).

import { put } from "@vercel/blob";
import { randomUUID } from "crypto";

export interface PutResult {
  url: string;
  pathname?: string;
  size?: number;
  uploadedAt?: string;
}

/**
 * Uploads a file to the connected Vercel Blob store using the same
 * pattern as exports/pdf/route.ts. Public by default.
 */
export async function putBlob(
  pathname: string,
  data: string | Buffer | Uint8Array | ArrayBuffer | Blob,
  contentType = "application/octet-stream"
): Promise<PutResult> {
  // Normalize data type
  let body: Buffer | Uint8Array;
  if (typeof data === "string") {
    body = Buffer.from(data, "utf8");
  } else if (data instanceof ArrayBuffer) {
    body = Buffer.from(data);
  } else if (data instanceof Uint8Array) {
    body = data;
  } else if (data instanceof Blob) {
    const arrBuf = Buffer.from(await data.arrayBuffer());
    body = arrBuf;
  } else {
    body = data as any;
  }

  const putOpts: Parameters<typeof put>[2] = {
    access: "public",
    contentType,
    ...(process.env.BLOB_READ_WRITE_TOKEN
      ? { token: process.env.BLOB_READ_WRITE_TOKEN }
      : {}),
  };

  const safePath = pathname.startsWith("reports/")
    ? pathname
    : `reports/${randomUUID()}-${pathname}`;

  const result = await put(safePath, body, putOpts);
  return {
    url: result.url,
    pathname: safePath,
    size: (body as any).length || undefined,
    uploadedAt: new Date().toISOString(),
  };
}
