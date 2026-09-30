import { HOUSES, type House, type Position, type Stage } from "@/convex/schema";
import { SCORING_RULES } from "@/convex/points";

export { HOUSES };
export type { House, Position, Stage };

export const HOUSE_DESCRIPTIONS: Record<House, string> = {
  Fire: "Blazing attack, relentless press",
  Earth: "Solid at the back, hard to break down",
  Wind: "Fast transitions, electric wings",
  Water: "Fluid passing, calm under pressure",
};

export const HOUSE_GRADIENTS: Record<House, string> = {
  Fire: "from-red-500/25 to-red-500/5",
  Earth: "from-emerald-500/25 to-emerald-500/5",
  Wind: "from-amber-400/25 to-amber-400/5",
  Water: "from-blue-500/25 to-blue-500/5",
};

export const POSITION_LABELS: Record<Position, string> = {
  GK: "Goalkeeper",
  DEF: "Defender",
  MID: "Midfielder",
  FWD: "Forward",
};

export const STAGE_LABELS: Record<Stage, string> = {
  semifinal1: "Semifinal 1",
  semifinal2: "Semifinal 2",
  third_place: "3rd Place Match",
  final: "Final",
  group_stage: "Group Stage",
};

export const STAGE_ORDER: Stage[] = ["semifinal1", "semifinal2", "third_place", "final"];

export const SCORING_RULE_LINES: { label: string; points: string }[] = [
  { label: "Goal — GK / DEF", points: `+${SCORING_RULES.goalByPosition.GK}` },
  { label: "Goal — MID", points: `+${SCORING_RULES.goalByPosition.MID}` },
  { label: "Goal — FWD", points: `+${SCORING_RULES.goalByPosition.FWD}` },
  { label: "Assist", points: `+${SCORING_RULES.assist}` },
  { label: "Clean sheet — GK / DEF", points: `+${SCORING_RULES.cleanSheetGkDef}` },
  { label: `Every ${SCORING_RULES.savesPerPoint} saves`, points: "+1" },
  { label: "Yellow card", points: String(SCORING_RULES.yellowCard) },
  { label: "Red card", points: String(SCORING_RULES.redCard) },
  { label: "Own goal", points: String(SCORING_RULES.ownGoal) },
  { label: "Player of the Match", points: `+${SCORING_RULES.potmBonus}` },
  {
    label: `Match rating ≥ ${SCORING_RULES.ratingBonusThreshold.toFixed(1)}`,
    points: `+${SCORING_RULES.ratingBonusPoints}`,
  },
  { label: "Captain", points: "×2" },
];

/** Curated avatar presets: house crests, footballer badges, icons, mascots. */
export type AvatarPreset = {
  id: string;
  label: string;
  group: "houses" | "footballers" | "icons" | "mascots";
  /** Emoji glyph for house crests / icons / mascots. */
  emoji?: string;
 /** Player initials rendered as a kit-coloured badge. */
  initials?: string;
  /** Kit number rendered under the initials. */
  number?: string;
  color: string;
  color2?: string;
};

export const AVATAR_PRESETS: AvatarPreset[] = [
  // ── House emblems ──
  { id: "house-fire", label: "Fire Emblem", group: "houses", emoji: "🔥", color: "#e64530" },
  { id: "house-earth", label: "Earth Emblem", group: "houses", emoji: "🌿", color: "#2f9e44" },
  { id: "house-wind", label: "Wind Emblem", group: "houses", emoji: "🌪️", color: "#f0a821" },
  { id: "house-water", label: "Water Emblem", group: "houses", emoji: "💧", color: "#2f7fe0" },

  // ── Iconic footballer badges (initials + kit colours) ──
  { id: "fb-cr7", label: "Cristiano Ronaldo", group: "footballers", initials: "CR", number: "7", color: "#da291c", color2: "#8f1a12" },
  { id: "fb-messi", label: "Lionel Messi", group: "footballers", initials: "LM", number: "10", color: "#75aadb", color2: "#4a7fb5" },
  { id: "fb-mbappe", label: "Kylian Mbappé", group: "footballers", initials: "KM", number: "10", color: "#1e40af", color2: "#152d78" },
  { id: "fb-haaland", label: "Erling Haaland", group: "footballers", initials: "EH", number: "9", color: "#6cabdd", color2: "#3f7aa8" },
  { id: "fb-bellingham", label: "Jude Bellingham", group: "footballers", initials: "JB", number: "5", color: "#2b3990", color2: "#1c2663" },
  { id: "fb-vinijr", label: "Vinícius Júnior", group: "footballers", initials: "VJ", number: "7", color: "#ffdf00", color2: "#c9a800" },
  { id: "fb-kdb", label: "Kevin De Bruyne", group: "footballers", initials: "KD", number: "17", color: "#9fd3ec", color2: "#6cabdd" },
  { id: "fb-neymar", label: "Neymar Jr.", group: "footballers", initials: "NJ", number: "10", color: "#ffdf00", color2: "#1e9e4a" },
  { id: "fb-saka", label: "Bukayo Saka", group: "footballers", initials: "BS", number: "7", color: "#ef0107", color2: "#9c0005" },
  { id: "fb-yamal", label: "Lamine Yamal", group: "footballers", initials: "LY", number: "19", color: "#a50044", color2: "#6e002d" },

  // ── Minimalist sport / abstract icons ──
  { id: "icon-ball", label: "Match Ball", group: "icons", emoji: "⚽", color: "#f8fafc" },
  { id: "icon-boot", label: "Golden Boot", group: "icons", emoji: "👟", color: "#f0a821" },
  { id: "icon-trophy", label: "Trophy", group: "icons", emoji: "🏆", color: "#f0a821" },
  { id: "icon-crown", label: "Crown", group: "icons", emoji: "👑", color: "#f0a821" },
  { id: "icon-shield", label: "Shield", group: "icons", emoji: "🛡️", color: "#2f7fe0" },
  { id: "icon-bolt", label: "Lightning", group: "icons", emoji: "⚡", color: "#f0a821" },
  { id: "icon-star", label: "Star", group: "icons", emoji: "⭐", color: "#f0a821" },
  { id: "icon-goat", label: "The GOAT", group: "icons", emoji: "🐐", color: "#2f9e44" },

  // ── Mascots (kept from v1 for existing accounts) ──
  { id: "wolf", label: "Wolf", group: "mascots", emoji: "🐺", color: "#e64530" },
  { id: "lion", label: "Lion", group: "mascots", emoji: "🦁", color: "#f0a821" },
  { id: "eagle", label: "Eagle", group: "mascots", emoji: "🦅", color: "#2f7fe0" },
  { id: "bear", label: "Bear", group: "mascots", emoji: "🐻", color: "#2f9e44" },
  { id: "shark", label: "Shark", group: "mascots", emoji: "🦈", color: "#2f7fe0" },
  { id: "tiger", label: "Tiger", group: "mascots", emoji: "🐯", color: "#f0a821" },
  { id: "cobra", label: "Cobra", group: "mascots", emoji: "🐍", color: "#2f9e44" },
  { id: "dragon", label: "Dragon", group: "mascots", emoji: "🐲", color: "#e64530" },
];

/**
 * Resolve a stored avatar id to a displayable URL (SVG data URL).
 * Safe: unknown/empty ids and non-preset values (uploads are http/data URLs)
 * return null so callers can fall back to initials.
 */
export function avatarPresetUrl(id: string | null | undefined): string | null {
  if (!id || id.startsWith("data:") || id.startsWith("http")) return null;
  const preset = AVATAR_PRESETS.find((a) => a.id === id);
  if (!preset) return null;

  const svg =
    preset.initials !== undefined
      ? // Footballer badge: vertical kit gradient + initials + squad number
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
        `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="${preset.color}"/><stop offset="1" stop-color="${preset.color2 ?? preset.color}"/>` +
        `</linearGradient></defs>` +
        `<rect width="64" height="64" rx="32" fill="url(#g)"/>` +
        `<text x="32" y="36" font-family="Arial, sans-serif" font-weight="bold" font-size="22" text-anchor="middle" fill="#ffffff" stroke="rgba(0,0,0,0.25)" stroke-width="0.5">${preset.initials}</text>` +
        `<text x="32" y="54" font-family="Arial, sans-serif" font-weight="bold" font-size="14" text-anchor="middle" fill="rgba(255,255,255,0.85)">${preset.number ?? ""}</text>` +
        `</svg>`
      : // Emoji crest: tinted disc + glyph
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
        `<rect width="64" height="64" rx="32" fill="${preset.color}33"/>` +
        `<circle cx="32" cy="32" r="29" fill="none" stroke="${preset.color}" stroke-width="2"/>` +
        `<text x="32" y="41" font-size="28" text-anchor="middle">${preset.emoji ?? "⚽"}</text>` +
        `</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
