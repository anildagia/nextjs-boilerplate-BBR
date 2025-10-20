// app/api/_lib/quota.ts

// Naive in-memory daily quota (resets on cold start/redeploy)
// key format: `${anonOrIp}::${dayStamp}`
const usage = new Map<string, number>();

export function getDayStamp(d = new Date()) {
  // YYYY-MM-DD (UTC) so "day" is consistent regardless of region
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Returns the next UTC midnight ISO string for the given date.
 */
export function nextUtcMidnightISO(d = new Date()): string {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0));
  return dt.toISOString();
}

/**
 * Increment and check the quota for a given key.
 * - limit: if omitted, reads from process.env.FREE_DAILY_LIMIT or defaults to 5
 * - returns { allowed, count, limit, resetAt }
 */
export function incAndCheck(key: string, limit?: number) {
  const dailyLimit = Number(process.env.FREE_DAILY_LIMIT || 5);
  const cap = typeof limit === "number" ? limit : dailyLimit;

  const current = usage.get(key) ?? 0;
  if (current >= cap) {
    return { allowed: false as const, count: current, limit: cap, resetAt: nextUtcMidnightISO() };
  }

  const next = current + 1;
  usage.set(key, next);

  // Lightweight sweep once per call-day to keep the map from growing forever.
  // If your key includes '::YYYY-MM-DD', we can drop old keys cheaply.
  if (Math.random() < 0.02) {
    const today = key.split("::")[1]; // safe because caller builds as `${id}::${day}`
    for (const k of usage.keys()) {
      if (typeof k === "string" && k.includes("::")) {
        const [, day] = k.split("::");
        if (day !== today) usage.delete(k);
      }
    }
  }

  return { allowed: true as const, count: next, limit: cap, resetAt: nextUtcMidnightISO() };
}
