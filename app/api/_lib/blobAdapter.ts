// Unified Blob uploader matching your exports/pdf implementation.
// Uses @vercel/blob.put just like the working PDF exporter.

import { put } from "@vercel/blob";
import { randomUUID } from "crypto";

export interface PutResult {
  url: string;
  pathname?: string;
  size?: number;
  uploadedAt?: string;
}

export async function putBlob(
  pathname: string,
  data: string | Buffer | Uint8Array | ArrayBuffer | Blob,
  contentType = "application/octet-stream"
): Promise<PutResult> {
  // 🔹 Normalize everything to a Node Buffer
  let body: Buffer;

  if (typeof data === "string") {
    body = Buffer.from(data, "utf8");
  } else if (Buffer.isBuffer(data)) {
    body = data;
  } else if (data instanceof ArrayBuffer) {
    body = Buffer.from(data);
  } else if (data instanceof Uint8Array) {
    body = Buffer.from(data);
  } else if (data instanceof Blob) {
    const arrBuf = Buffer.from(await data.arrayBuffer());
    body = arrBuf;
  } else {
    throw new Error("Unsupported data type for blob upload");
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

  // 🔹 put() now receives a guaranteed Buffer
  const result = await put(safePath, body, putOpts);

  return {
    url: result.url,
    pathname: safePath,
    size: body.length,
    uploadedAt: new Date().toISOString(),
  };
}
