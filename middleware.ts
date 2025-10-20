// /middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  readTrialCookie,
  startTrialCookie,
  trialRemainingDays,
} from "./app/api/_lib/trial";

// Paths that must always be reachable (no trial/license gating),
// e.g. webhooks, license checks, checkout, privacy, etc.
const ALLOWLIST_PREFIXES = [
  "/api/trial/boot",
  "/api/trial/status",
  "/api/license/status",
  "/api/stripe/webhook",
  "/api/stripe/create-checkout-session",
  "/api/stripe/create-portal-session",
  "/api/stripe/get-license-from-session",
  "/api/pricing",
  "/api/privacy",
  "/api/admin/license", 
  "/api/admin/gifts/issue-stripe",  
  "/api/admin/gifts/revoke-stripe",    
];

// If the path starts with any of these, middleware won’t block.
function isAllowlisted(pathname: string) {
  return ALLOWLIST_PREFIXES.some((p) => pathname.startsWith(p));
}

export function middleware(req: NextRequest) {
  const url = new URL(req.url);
  const { pathname, searchParams } = url;

  // Only gate API routes; skip everything else (pages, static, images)
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Let allowlisted endpoints pass (webhook, status, checkout helpers, etc.)
  if (isAllowlisted(pathname)) {
    return NextResponse.next();
  }

  // Ensure the trial is started on the first API call of any kind.
  const cookies = readTrialCookie(req);
  const res = NextResponse.next();
  if (!cookies.startedAt) {
    startTrialCookie(res, new Date());
    // We still allow this first request through.
    return res;
  }

  // Enforce: after trial expires, user must supply a license key
  // Presence-only check here (real validation happens in the route).
  const { isActive } = trialRemainingDays(req);
  const hasLicenseMarker =
    (searchParams.get("key")?.trim() || "") ||
    (req.headers.get("x-license-key")?.trim() || "");

  if (!isActive && !hasLicenseMarker) {
    return NextResponse.json(
      {
        error: "TRIAL_EXPIRED",
        message:
          "Your free trial has ended. Please purchase a Pro license at /pricing and paste your license key.",
        upgradeUrl: "/pricing",
      },
      { status: 402 }
    );
  }

  // Trial active OR a license key is present → let the route handle it.
  return res;
}

// Apply only to API routes; exclude static assets implicitly
export const config = {
  matcher: ["/api/:path*"],
};
