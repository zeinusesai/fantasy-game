// ── Hardcoded defaults for every configurable value ──────────────────────
//
// This module is the fallback layer for the entire configuration engine.
// Every value here is used in three places:
//   1. the normalizer that rebuilds `systemConfig` into a complete object,
//   2. the client hook that layers defaults under the server response,
//   3. the scoring engine when no override is configured.
//
// Because both server and client import these constants, a missing or corrupt
// config row can never produce a different value in the UI than in the
// backend — there is exactly one definition of "default".

import type { House, Position } from "./schema";
import { HOUSES, POSITIONS } from "./schema";

export const APP_DEFAULTS = {
  appTitle: "Year 11 Interhouse",
  appTagline: "Interhouse Tournament & Fantasy League",
  maintenanceTitle: "Under maintenance",
  maintenanceMessage:
    "The website is currently in maintenance, need anything? Contact Zein. It will probably be up in a few minutes!",
  instagramHandle: "zein.e9",
  instagramUrl: "https://www.instagram.com/zein.e9",
  year12Banner: "See you in Year 12!",
  year12Message: "That's a wrap on Year 11 — see you all in Year 12!",
  goldMedalText: "Plastic Golden Medal",
  goldMedalHeadline: "1st Place Winner — Receives a Plastic Golden Medal!",
  forfeitText: "Forfeit Assigned",
} as const;

export interface HouseBrand {
  name: string;
  color: string;
  logoUrl: string;
  motto: string;
}

/** Hex colors are validated before use; anything else falls back here. */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

export const DEFAULT_HOUSES: Record<string, HouseBrand> = {
  Fire: { name: "Fire", color: "#e64530", logoUrl: "", motto: "Passion and fire in every challenge." },
  Earth: { name: "Earth", color: "#2f9e44", logoUrl: "", motto: "Steady, strong and unshakeable." },
  Wind: { name: "Wind", color: "#f0a821", logoUrl: "", motto: "Swift minds, quicker feet." },
  Water: { name: "Water", color: "#2f7fe0", logoUrl: "", motto: "Calm on the surface, deep beneath." },
};

export interface AwardDef {
  title: string;
  icon: string;
  description: string;
  /** Minimum points needed for the award to be handed out (0 = always). */
  threshold: number;
}

export const DEFAULT_AWARDS: Record<string, AwardDef> = {
  tacticalGenius: {
    title: "Tactical Genius",
    icon: "🧠",
    description: "Highest total points of the tournament.",
    threshold: 0,
  },
  unluckyManager: {
    title: "Unlucky Manager",
    icon: "💔",
    description: "Lowest total points of the tournament.",
    threshold: 0,
  },
  differentialMaster: {
    title: "Differential Master",
    icon: "🎯",
    description: "Most points from players owned by under 15% of managers.",
    threshold: 0,
  },
  playerOfTheWeek: {
    title: "Player of the Week",
    icon: "👑",
    description: "Highest-scoring player of the latest gameweek.",
    threshold: 0,
  },
  goldenBoot: {
    title: "Golden Boot",
    icon: "🥾",
    description: "Top goalscorer of the tournament.",
    threshold: 0,
  },
  goldenGlove: {
    title: "Golden Glove",
    icon: "🧤",
    description: "Most clean sheets by a goalkeeper or defender.",
    threshold: 0,
  },
};

export const DEFAULT_MARKET_RULES = {
  /** Global default starting budget. */
  defaultBudget: 70_000_000,
  /** Per-manager overrides are clamped to this ceiling. */
  maxBudget: 80_000_000,
  minBudget: 5_000_000,
  minPlayerPrice: 4_000_000,
  maxPlayerPrice: 22_000_000,
  /** Max transfers a manager may make per gameweek (0 = unlimited). */
  maxTransfersPerGameweek: 0,
  /** Minutes before a deadline at which the crimson panic banner shows. */
  panicThresholdMinutes: 60,
  /** Squads per house in a starting seven (unchanged in practice). */
  houseLimit: 3,
} as const;

export interface ScoringRules {
  goalGk: number;
  goalDef: number;
  goalMid: number;
  goalFwd: number;
  assist: number;
  cleanSheetGkDef: number;
  /** Clean-sheet bonus for midfielders (GK/DEF use `cleanSheetGkDef`). */
  cleanSheetMid: number;
  savesPerPoint: number;
  yellowCard: number;
  redCard: number;
  ownGoal: number;
  potmBonus: number;
  ratingBonus8Threshold: number;
  ratingBonus8Points: number;
  ratingBonus9Threshold: number;
  ratingBonus9Points: number;
  captainMultiplier: number;
}

export const DEFAULT_SCORING_RULES: ScoringRules = {
  goalGk: 10,
  goalDef: 8,
  goalMid: 6,
  goalFwd: 5,
  assist: 3,
  cleanSheetGkDef: 4,
  cleanSheetMid: 1,
  // 1 save point per 3 saves made.
  savesPerPoint: 3,
  yellowCard: -1,
  redCard: -3,
  ownGoal: -2,
  potmBonus: 3,
  ratingBonus8Threshold: 8,
  ratingBonus8Points: 2,
  ratingBonus9Threshold: 9,
  ratingBonus9Points: 3,
  captainMultiplier: 2,
};

/** The immutable built-in badge registry (Super Admin can add more). */
export const DEFAULT_BADGE_REGISTRY: Record<
  string,
  { emoji: string; label: string; tone: string }
> = {
  star: { emoji: "⭐", label: "Star", tone: "amber" },
  gold_checkmark: { emoji: "✅", label: "Gold Checkmark", tone: "amber" },
  fire: { emoji: "🔥", label: "Fire", tone: "orange" },
  crown: { emoji: "👑", label: "Crown", tone: "yellow" },
  shield: { emoji: "🛡️", label: "Shield", tone: "sky" },
  diamond: { emoji: "💎", label: "Diamond", tone: "cyan" },
  contributor: { emoji: "💡", label: "Idea Contributor", tone: "sky" },
};

// ── Coercion helpers ─────────────────────────────────────────────────────
// All of these are total functions: any input (including null, undefined,
// objects and NaN) produces a safe, in-range number.

/** Clamp to a finite integer inside [min, max], else return the fallback. */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

/** Clamp to a finite number (may be fractional, e.g. a 1.5× multiplier). */
export function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** Trim + length-cap a string, returning the fallback when empty. */
export function cleanText(value: unknown, maxLength: number, fallback: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (s.length === 0) return fallback;
  return s.slice(0, maxLength);
}

/**
 * Only http(s) and data: URLs are accepted for logo/photo fields — this
 * blocks `javascript:` and other script-bearing schemes from ever reaching
 * an <img src> or a background style.
 */
export function cleanUrl(value: unknown, fallback = ""): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (s.length === 0) return fallback;
  const lower = s.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) return s.slice(0, 2000);
  if (lower.startsWith("data:image/")) return s.slice(0, 2_000_000);
  return fallback;
}

/** Keep a badge id that is a safe slug. */
export function cleanBadgeId(value: unknown): string {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9_]{2,24}$/.test(s) ? s : "";
}

/** Position-keyed lookup helper for the scoring matrix. */
export function goalPointsFor(
  rules: ScoringRules,
  position: Position | string | null | undefined,
): number {
  switch (position) {
    case "GK":
      return rules.goalGk;
    case "DEF":
      return rules.goalDef;
    case "MID":
      return rules.goalMid;
    case "FWD":
      return rules.goalFwd;
    default:
      return rules.goalFwd;
  }
}

export const ALL_HOUSES = HOUSES as readonly House[];
export const ALL_POSITIONS = POSITIONS as readonly Position[];
