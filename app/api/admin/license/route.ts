// app/api/admin/license/route.ts
import { NextRequest, NextResponse } from "next/server";
import { list } from "@vercel/blob";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// normalize email into a safe key
function emailKey(emailRaw: string) {
  const e = String(emailRaw || "").trim().toLowerCase();
  return e.replace(/[^a-z0-9._-]+/g, "_");
}

// resolve admin token from query (?token=...) first, then header
function getProvidedToken(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("token") || "").trim();
  if (q) return q;
  const h = (req.headers.get("x-admin-token") || "").trim();
  return h;
}

// list exact key and fetch JSON via public URL
async function fetchJsonByExactKey(key: string) {
  const ls = await list({
    prefix: key,
    ...(process.env.BLOB_READ_WRITE_TOKEN ? { token: process.env.BLOB_READ_WRITE_TOKEN } : {}),
  });

  // 1) Try exact key first
  let hit = ls.blobs.find((b) => b.pathname === key);

  // 2) Fallback: accept a suffix (legacy writes with random suffix)
  if (!hit) {
    const candidates = ls.blobs
      .filter((b) => b.pathname === key || b.pathname.startsWith(key + "-"))
      // pick the most recent if multiple; uploadedAt may exist, else sort by pathname
      .sort((a, b) => {
        const at = (a as any).uploadedAt ? new Date((a as any).uploadedAt).getTime() : 0;
        const bt = (b as any).uploadedAt ? new Date((b as any).uploadedAt).getTime() : 0;
        return bt - at || b.pathname.localeCompare(a.pathname);
      });
    hit = candidates[0];
  }

  if (!hit) return null;

  const res = await fetch(hit.url);
  if (!res.ok) return null;
  return (await res.json()) as any;
}

// timing-safe compare
function safeEqual(a: string, b: string) {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export async function GET(req: NextRequest) {
  const debug = req.nextUrl.searchParams.get("debug") === "1";

  try {
    const adminToken = (process.env.ADMIN_TOKEN || "").trim();
    const provided = getProvidedToken(req);

    // If debug, always show diag in the response (no need to check logs)
    const diag = debug
      ? {
          provided_len: provided.length,
          admin_len: adminToken.length,
          provided_hash_prefix: crypto.createHash("sha256").update(provided).digest("hex").slice(0, 12),
          admin_hash_prefix: crypto.createHash("sha256").update(adminToken).digest("hex").slice(0, 12),
          hostname: req.nextUrl.hostname,
          path: req.nextUrl.pathname,
          env_present: Boolean(process.env.ADMIN_TOKEN),
        }
      : undefined;

    if (!adminToken) {
      return NextResponse.json(
        { error: "ADMIN_TOKEN not set", ...(diag ? { debug: diag } : {}) },
        { status: 500 }
      );
    }

    // auth
    if (!provided || !safeEqual(provided, adminToken)) {
      return NextResponse.json(
        { error: "Unauthorized", ...(diag ? { debug: diag } : {}) },
        { status: 401 }
      );
    }

    // inputs
    const customerId = (req.nextUrl.searchParams.get("customerId") || "").trim();
    const email = (req.nextUrl.searchParams.get("email") || "").trim();
    if (!customerId && !email) {
      return NextResponse.json(
        { error: "Provide ?customerId=cus_... or ?email=name@example.com", ...(diag ? { debug: diag } : {}) },
        { status: 400 }
      );
    }

    // lookup by customerId
    if (customerId) {
      const key = `licenses/${customerId}.json`;
      const json = await fetchJsonByExactKey(key);
      if (!json) {
        return NextResponse.json(
          { error: "Not found for customerId", ...(diag ? { debug: diag, key } : {}) },
          { status: 404 }
        );
      }
      return NextResponse.json({ source: "customerId", record: json, ...(diag ? { debug: diag, key } : {}) });
    }

    // lookup by email (requires email index writes in webhook)
    const ek = emailKey(email);
    const emailKeyPath = `licenses_by_email/${ek}.json`;
    const json = await fetchJsonByExactKey(emailKeyPath);
    if (!json) {
      return NextResponse.json(
        { error: "Not found for email", ...(diag ? { debug: diag, key: emailKeyPath } : {}) },
        { status: 404 }
      );
    }
    return NextResponse.json({ source: "email", record: json, ...(diag ? { debug: diag, key: emailKeyPath } : {}) });
  } catch (e: any) {
    return NextResponse.json(
      { error: "LOOKUP_ERROR", message: e?.message || String(e), ...(debug ? { debug: { thrown: true } } : {}) },
      { status: 500 }
    );
  }
}
