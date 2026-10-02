// ── Pitch / jersey cosmetic themes (canonical source) ─────────────────────
//
// Pure data + pure helpers, no Convex imports — safe on BOTH sides. The React
// helpers live in `src/lib/pitchTheme.ts`, which re-exports these constants so
// the server projection and the client renderer can never disagree about what
// "premium" means.

export const DEFAULT_PITCH_THEME = "default" as const;
export const PREMIUM_PITCH_THEME = "premium" as const;

export type PitchTheme = typeof DEFAULT_PITCH_THEME | typeof PREMIUM_PITCH_THEME;

export const PITCH_THEMES = [DEFAULT_PITCH_THEME, PREMIUM_PITCH_THEME] as const;

/**
 * Coerce anything into a valid theme id. TOTAL — never throws, never returns
 * undefined, so a corrupt/legacy value can never break a pitch render.
 */
export function normalizePitchTheme(value: unknown): PitchTheme {
  if (value === true) return PREMIUM_PITCH_THEME;
  if (typeof value !== "string") return DEFAULT_PITCH_THEME;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return DEFAULT_PITCH_THEME;
  if (trimmed === "premium" || trimmed === "gold" || trimmed === "golden") {
    return PREMIUM_PITCH_THEME;
  }
  return DEFAULT_PITCH_THEME;
}

/** The store item that unlocks a theme, for entitlement → theme mapping. */
export const THEME_ITEM_ID = "golden_theme" as const;