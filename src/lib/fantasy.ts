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

/** Preset avatars shown at signup — no file upload needed for v1. */
export const AVATAR_PRESETS: { id: string; label: string; emoji: string; color: string }[] = [
  { id: "wolf", label: "Wolf", emoji: "🐺", color: "#e64530" },
  { id: "lion", label: "Lion", emoji: "🦁", color: "#f0a821" },
  { id: "eagle", label: "Eagle", emoji: "🦅", color: "#2f7fe0" },
  { id: "bear", label: "Bear", emoji: "🐻", color: "#2f9e44" },
  { id: "shark", label: "Shark", emoji: "🦈", color: "#2f7fe0" },
  { id: "tiger", label: "Tiger", emoji: "🐯", color: "#f0a821" },
  { id: "cobra", label: "Cobra", emoji: "🐍", color: "#2f9e44" },
  { id: "dragon", label: "Dragon", emoji: "🐲", color: "#e64530" },
];

export function avatarPresetUrl(id: string | null | undefined): string | null {
  if (!id) return null;
  const preset = AVATAR_PRESETS.find((a) => a.id === id);
  return preset
    ? `data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="${preset.color}22"/><text x="32" y="40" font-size="32" text-anchor="middle">${preset.emoji}</text></svg>`,
      )}`
    : null;
}
