// app/api/_lib/libs.ts

// Define the libraries as a readonly object so TypeScript infers literal keys & values.
// This lets us derive ThemeKey and Theme from the data itself (future-friendly).
export const THEMES = {
  health_discipline: {
    title: "Health & Discipline",
    requiresPro: true,
    items: [
      "I always fall off routines",
      "If I miss one day, the streak is ruined",
      "Healthy food is joyless",
      "I don’t have the discipline others have",
      "My energy is fixed and usually low",
      "If I can’t do a full workout, it’s not worth starting",
      "My body resists change",
      "Rest days mean I’m lazy",
      "I should look perfect before going to the gym",
      "Mood must come before action"
    ] as const
  },

  leadership_imposter: {
    title: "Leadership & Imposter Syndrome (corporate)",
    requiresPro: true,
    items: [
      "I’ll be exposed as not good enough",
      "Others are more qualified than me",
      "If I speak up and I’m wrong, I’m finished",
      "I must have all the answers to lead",
      "Delegation proves I’m not capable",
      "Visibility makes me a target",
      "My wins are luck, not skill",
      "Asking for help shows weakness",
      "If I set boundaries, I’ll be seen as difficult",
      "I have to overwork to deserve my role"
    ] as const
  },

  // --- NEW: Pro libraries behind your existing paywall ---
  money_beliefs: {
    title: "Money Beliefs",
    requiresPro: true,
    items: [
      "Making more money means sacrificing my integrity",
      "I’m not the kind of person who becomes wealthy",
      "If I earn a lot, people will resent me",
      "Money always leaves as fast as it comes",
      "I need money to make money",
      "Charging high fees is greedy",
      "I must work harder, not smarter, to deserve income",
      "Creative work doesn’t pay well",
      "I’m bad with numbers so I’ll fail with money",
      "I can either be spiritual or wealthy, not both"
    ] as const
  },

  relationships_boundaries: {
    title: "Relationships & Boundaries",
    requiresPro: true,
    items: [
      "Saying no will make me unlovable",
      "If I share needs, I’ll be seen as needy",
      "Keeping the peace is more important than my truth",
      "If I set boundaries, I’ll push people away",
      "Love means fixing the other person",
      "I must earn affection by over-giving",
      "Conflict means the relationship is failing",
      "My worth depends on their approval",
      "I should tolerate disrespect to avoid being alone",
      "If I don’t respond immediately, I’m a bad partner/friend"
    ] as const
  },

  entrepreneur_risk_tolerance: {
    title: "Entrepreneur Risk Tolerance",
    requiresPro: true,
    items: [
      "If I can’t guarantee success, I shouldn’t start",
      "Failure would permanently damage my reputation",
      "I must wait until everything is perfect",
      "Taking small risks is pointless",
      "Investing in myself is irresponsible",
      "One bad month means the business is doomed",
      "I must do everything myself to stay safe",
      "Saying no to any client is risky",
      "Experiments waste time I should spend executing",
      "Borrowing credibility is safer than leading with my voice"
    ] as const
  }
} as const;

// Types are derived from THEMES so you only update data, not types.
export type ThemeKey = keyof typeof THEMES;
export type Theme = (typeof THEMES)[ThemeKey];

// Return a stable (alphabetically) list of themes with counts.
// Stable ordering ensures preview allocation doesn’t shuffle when adding themes.
export function listThemes(): Array<{ key: ThemeKey; title: string; count: number }> {
  return (Object.keys(THEMES) as ThemeKey[])
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const t = THEMES[key];
      return { key, title: t.title, count: t.items.length };
    });
}

// Defensive get: returns undefined for unknown keys.
// Callers (routes) can respond with 404 if this returns undefined.
export function getTheme(key: string): Theme | undefined {
  // Use an indexed access with a widened Record type for safety when key is string.
  const rec: Record<string, Theme> = THEMES as unknown as Record<string, Theme>;
  return rec[key];
}

// --- Optional helpers (non-breaking) ---

// Tiny type guard to check for a boolean `requiresPro` on a theme object
function hasRequiresPro(t: unknown): t is { requiresPro: boolean } {
  return (
    typeof t === "object" &&
    t !== null &&
    "requiresPro" in t &&
    typeof (t as any).requiresPro === "boolean"
  );
}

// Quick check for paywall gating in routes/actions.
export function isProTheme(key: string): boolean {
  const theme = getTheme(key);
  return hasRequiresPro(theme) ? theme.requiresPro : false;
}

// List only Pro-gated themes (useful for admin panels or UI badges).
export function listProThemes(): Array<{ key: ThemeKey; title: string; count: number }> {
  return listThemes().filter(({ key }) => isProTheme(key));
}
