/**
 * Y11 PE Hub — preset match crests shared by the Super-Admin friendly-match
 * generator and the match centre.
 *
 * Pure data + pure helpers only: safe to import from Convex functions AND
 * from React components (no server imports, no browser APIs).
 */

export type CrestPreset = {
  /** Stable id stored on `matches.homeCrest` / `matches.awayCrest`. */
  id: string;
  /** Emoji glyph rendered inside the crest disc. */
  glyph: string;
  label: string;
  /** Tailwind classes for the disc (used by the picker + the match header). */
  tone: string;
};

/** The stylistic vector-sport crests a Super Admin can assign per matchup. */
export const CREST_PRESETS: readonly CrestPreset[] = [
  { id: "struck", glyph: "⚡", label: "Struck", tone: "border-teal-400/40 bg-teal-400/10 text-teal-300" },
  { id: "crown", glyph: "👑", label: "Crown", tone: "border-amber-400/40 bg-amber-400/10 text-amber-300" },
  { id: "shield", glyph: "🛡️", label: "Shield", tone: "border-sky-400/40 bg-sky-400/10 text-sky-300" },
  { id: "flame", glyph: "🔥", label: "Flame", tone: "border-orange-400/40 bg-orange-400/10 text-orange-300" },
  { id: "wing", glyph: "🪽", label: "Wing", tone: "border-slate-300/40 bg-slate-300/10 text-slate-200" },
  { id: "star", glyph: "⭐", label: "Star", tone: "border-yellow-300/40 bg-yellow-300/10 text-yellow-200" },
  { id: "bull", glyph: "🐂", label: "Bull", tone: "border-red-400/40 bg-red-400/10 text-red-300" },
  { id: "anchor", glyph: "⚓", label: "Anchor", tone: "border-indigo-400/40 bg-indigo-400/10 text-indigo-300" },
  { id: "hex", glyph: "🔷", label: "Hex", tone: "border-blue-400/40 bg-blue-400/10 text-blue-300" },
  { id: "pulse", glyph: "💠", label: "Pulse", tone: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" },
  { id: "orbit", glyph: "🪐", label: "Orbit", tone: "border-violet-400/40 bg-violet-400/10 text-violet-300" },
  { id: "bolt", glyph: "🔶", label: "Facet", tone: "border-gold/40 bg-gold/10 text-gold" },
] as const;

const PRESET_IDS = new Set(CREST_PRESETS.map((c) => c.id));

export const MAX_CREST_URL_CHARS = 2000;

/**
 * Total normaliser for a crest value coming from the Super Admin.
 *
 * Accepts a known preset id or a bounded http(s) / data:image URL (the custom
 * logo upload path). Anything else — a script tag, an arbitrary scheme, a
 * 4 MB data URL — degrades to `""`, which the UI renders as the default crest.
 * Never throws.
 */
export function normalizeCrest(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  if (value === "") return "";
  if (PRESET_IDS.has(value)) return value;
  if (value.length > MAX_CREST_URL_CHARS) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/i.test(value)) return value;
  return "";
}

/** Look up a preset, falling back to `null` for a custom/unknown crest. */
export function crestPreset(id: unknown): CrestPreset | null {
  if (typeof id !== "string") return null;
  return CREST_PRESETS.find((c) => c.id === id) ?? null;
}

/** True when the stored value is a custom (uploaded) logo rather than a preset. */
export function isCustomCrest(value: unknown): boolean {
  return typeof value === "string" && value !== "" && crestPreset(value) === null;
}
