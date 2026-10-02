// ── Pitch & jersey cosmetic themes (client renderer) ──────────────────────
//
// Managers can unlock cosmetics in the store (Golden Jersey / Premium Pitch).
// This module is the SINGLE place that decides what a pitch LOOKS like, and it
// is shared by every renderer (Dashboard, Profile, Squad Builder, the
// Leaderboard rival inspector and the ProfileModal) so a manager's chosen
// theme is always interpreted identically no matter where their squad is
// inspected.
//
// Everything here is a TOTAL, side-effect-free function: any input — null,
// undefined, a number, a string from three years ago — resolves to the plain
// green default. A bad theme value can never throw or render an unstyled
// pitch, and the client never crashes on an incomplete user row.

import {
  DEFAULT_PITCH_THEME,
  PITCH_THEMES,
  PREMIUM_PITCH_THEME,
  normalizePitchTheme,
  type PitchTheme,
} from "@/convex/pitchThemes";

export {
  DEFAULT_PITCH_THEME,
  PITCH_THEMES,
  PREMIUM_PITCH_THEME,
  normalizePitchTheme,
};
export type { PitchTheme };

/**
 * Resolve the theme a manager should actually SEE, from whichever cosmetic
 * signals the caller has. An enabled premium entitlement wins; otherwise the
 * stored `activePitchTheme` field is used; otherwise the default green pitch.
 *
 * `owned` is optional — a caller that only knows "has this manager unlocked
 * the premium pitch?" can pass that straight through.
 */
export function resolvePitchTheme(
  activePitchTheme: unknown,
  owned?: unknown,
): PitchTheme {
  if (owned === true) return PREMIUM_PITCH_THEME;
  return normalizePitchTheme(activePitchTheme);
}

/** True when the premium/gold aesthetic should render. */
export function isPremiumPitch(theme: unknown): boolean {
  return normalizePitchTheme(theme) === PREMIUM_PITCH_THEME;
}

/**
 * Tailwind classes for the pitch container.
 *
 * Base rounding/border always come from the caller; the theme only swaps the
 * surface. The premium gradient lives in CSS (`.pitch-bg-premium`) so the gold
 * mow-stripes render identically on every pitch in the app.
 */
export function pitchThemeClass(theme: unknown): string {
  if (!isPremiumPitch(theme)) {
    // Standard green pitch.
    return "pitch-bg border-emerald-900/50";
  }
  // High-contrast dark/gold pitch.
  return "pitch-bg-premium border-amber-300/45";
}

/** Classes for the pitch LINEWORK (touchlines, halfway line, centre circle). */
export function pitchMarkingsClass(theme: unknown): string {
  return isPremiumPitch(theme) ? "pitch-marks-premium" : "";
}

/** Badge classes for a golden jersey — metallic gold disc + warm glow. */
export function jerseyClass(golden: unknown): string {
  return golden === true
    ? "jersey-gold ring-2 ring-amber-200/90 shadow-[0_0_20px_rgba(251,191,36,0.55)]"
    : "";
}

/** Accent colour for text overlays on a golden-jersey player card. */
export function jerseyAccentClass(golden: unknown): string {
  return golden === true ? "text-amber-100" : "";
}