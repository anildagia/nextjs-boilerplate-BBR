// app/api/_lib/trial.ts
import type { NextRequest, NextResponse } from "next/server";

const TRIAL_COOKIE = "db_trial_started_at";

/** Read trial length (days) from env; default to 7 if missing/invalid */
export function getTrialDays(): number {
  const raw = process.env.TRIAL_DAYS?.trim();
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 7;
  return Math.floor(n);
}

/** Parse the Cookie header and return a simple key/value map */
function parseCookieHeader(cookieHeader: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.split("=");
    const key = k?.trim();
    if (!key) continue;
    const val = rest.join("=").trim();
    out[key] = decodeURIComponent(val || "");
  }
  return out;
}

/** Extract { startedAt } (ISO string) if our trial cookie exists */
export function readTrialCookie(req: Request | NextRequest): { startedAt?: string } {
  const raw = (req.headers as any)?.get?.("cookie") ?? null;
  const cookies = parseCookieHeader(raw);
  const startedAt = cookies[TRIAL_COOKIE];
  return startedAt ? { startedAt } : {};
}

/** Compute remaining days and end date from the cookie */
export function trialRemainingDays(
  req: Request | NextRequest,
  now = new Date()
): { isActive: boolean; daysLeft: number; endsAtISO: string } {
  const { startedAt } = readTrialCookie(req);
  const trialDays = getTrialDays();

  if (!startedAt) {
    return { isActive: false, daysLeft: 0, endsAtISO: new Date(0).toISOString() };
  }

  const start = new Date(startedAt);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + trialDays);

  const msDay = 24 * 60 * 60 * 1000;
  const delta = end.getTime() - now.getTime();
  const daysLeft = Math.max(0, Math.ceil(delta / msDay));
  const isActive = now < end;

  return { isActive, daysLeft, endsAtISO: end.toISOString() };
}

/**
 * Set the trial cookie on a NextResponse.
 * - HttpOnly to avoid JS access
 * - Secure (true in prod)
 * - SameSite=Lax
 * - Max-Age = TRIAL_DAYS in seconds
 */
export function startTrialCookie(res: NextResponse, now = new Date()) {
  const trialDays = getTrialDays();
  const maxAge = trialDays * 24 * 60 * 60; // seconds

  // @ts-ignore: NextResponse has .cookies.set in App Router
  res.cookies.set(TRIAL_COOKIE, now.toISOString(), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge,
  });
}

/**
 * Allow request if:
 * - licenseActive is true, OR
 * - trial cookie exists and is not expired
 *
 * Returns { ok: true } when allowed, otherwise { ok: false, reason: "NO_TRIAL" | "EXPIRED" }.
 */
export function allowTrialOrRequirePro(
  req: Request | NextRequest,
  licenseActive: boolean
): { ok: true } | { ok: false; reason: "NO_TRIAL" | "EXPIRED" } {
  if (licenseActive) return { ok: true };
  const { startedAt } = readTrialCookie(req);
  if (!startedAt) return { ok: false, reason: "NO_TRIAL" };
  const { isActive } = trialRemainingDays(req);
  if (isActive) return { ok: true };
  return { ok: false, reason: "EXPIRED" };
}
