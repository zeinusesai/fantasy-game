// ── Fantasy scoring engine (Super-Admin configurable) ────────────────────
//
// The rules below are only the DEFAULTS. At runtime the Super Admin can
// retune every number from the Customization tab, and that configured matrix
// is what actually scores a match.
//
// The contract:
//   • `DEFAULT_SCORING_RULES` is the fallback for every field.
//   • `resolveScoringRules(partial)` takes ANY input — including null, a
//     string, or a matrix full of NaN — and returns a complete, in-range,
//     finite rules object. It is total: it cannot throw.
//   • `computePlayerPoints(stats, rules?)` defaults to the built-ins, so every
//     existing call site keeps working unchanged.

import type { Position } from "./schema";
import {
  DEFAULT_SCORING_RULES,
  clampInt,
  clampNum,
  goalPointsFor,
  type ScoringRules,
} from "./defaults";

export type { ScoringRules };

/** The immutable built-in matrix (used when nothing is configured). */
export const SCORING_RULES: ScoringRules = { ...DEFAULT_SCORING_RULES };

/**
 * Coerce any partial/untrusted rules object into a complete ScoringRules.
 * Total function — never throws, always finite, always in range.
 */
export function resolveScoringRules(partial: unknown): ScoringRules {
  const raw =
    partial && typeof partial === "object" && !Array.isArray(partial)
      ? (partial as Record<string, unknown>)
      : {};
  return {
    goalGk: clampInt(raw.goalGk, 0, 100, DEFAULT_SCORING_RULES.goalGk),
    goalDef: clampInt(raw.goalDef, 0, 100, DEFAULT_SCORING_RULES.goalDef),
    goalMid: clampInt(raw.goalMid, 0, 100, DEFAULT_SCORING_RULES.goalMid),
    goalFwd: clampInt(raw.goalFwd, 0, 100, DEFAULT_SCORING_RULES.goalFwd),
    assist: clampInt(raw.assist, 0, 100, DEFAULT_SCORING_RULES.assist),
    cleanSheetGkDef: clampInt(raw.cleanSheetGkDef, 0, 100, DEFAULT_SCORING_RULES.cleanSheetGkDef),
    // A savesPerPoint of 0 would be a divide-by-zero at scoring time.
    savesPerPoint: clampInt(raw.savesPerPoint, 1, 50, DEFAULT_SCORING_RULES.savesPerPoint),
    yellowCard: clampInt(raw.yellowCard, -100, 0, DEFAULT_SCORING_RULES.yellowCard),
    redCard: clampInt(raw.redCard, -100, 0, DEFAULT_SCORING_RULES.redCard),
    ownGoal: clampInt(raw.ownGoal, -100, 0, DEFAULT_SCORING_RULES.ownGoal),
    potmBonus: clampInt(raw.potmBonus, 0, 100, DEFAULT_SCORING_RULES.potmBonus),
    ratingBonus8Threshold: clampNum(raw.ratingBonus8Threshold, 0, 10, DEFAULT_SCORING_RULES.ratingBonus8Threshold),
    ratingBonus8Points: clampInt(raw.ratingBonus8Points, 0, 100, DEFAULT_SCORING_RULES.ratingBonus8Points),
    ratingBonus9Threshold: clampNum(raw.ratingBonus9Threshold, 0, 10, DEFAULT_SCORING_RULES.ratingBonus9Threshold),
    ratingBonus9Points: clampInt(raw.ratingBonus9Points, 0, 100, DEFAULT_SCORING_RULES.ratingBonus9Points),
    captainMultiplier: clampNum(raw.captainMultiplier, 1, 5, DEFAULT_SCORING_RULES.captainMultiplier),
  };
}

export type MatchPlayerStats = {
  position: Position;
  rating?: number | null;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  ownGoals: number;
  saves: number;
  cleanSheet: boolean;
  potm: boolean;
};

/** Coerce a stat count to a finite integer — never NaN-poisons a total. */
function stat(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n === 0) return 0;
  return n;
}

/**
 * Compute one player's fantasy points under the supplied rules.
 * `rules` is optional — omitting it uses the built-in defaults, so every
 * existing call site continues to compile and behave identically.
 */
export function computePlayerPoints(
  stats: MatchPlayerStats,
  rules: ScoringRules = SCORING_RULES,
): number {
  // The rules object may itself be untrusted when passed straight from a
  // config row, so normalise before any arithmetic.
  const R = resolveScoringRules(rules);
  const position: Position = (() => {
    const p = stats?.position;
    return p === "GK" || p === "DEF" || p === "MID" || p === "FWD" ? p : "MID";
  })();

  let pts = 0;
  pts += stat(stats?.goals) * goalPointsFor(R, position);
  pts += stat(stats?.assists) * R.assist;
  if (stats?.cleanSheet === true && (position === "GK" || position === "DEF")) {
    pts += R.cleanSheetGkDef;
  }
  pts += Math.floor(Math.max(stat(stats?.saves), 0) / R.savesPerPoint);
  pts += stat(stats?.yellowCards) * R.yellowCard;
  pts += stat(stats?.redCards) * R.redCard;
  pts += stat(stats?.ownGoals) * R.ownGoal;
  if (stats?.potm === true) pts += R.potmBonus;

  const rating = stat(stats?.rating);
  if (rating > 0) {
    // 9-tier is checked first so an admin setting both tiers still gets the
    // higher bonus — matching the historical behaviour.
    if (rating >= R.ratingBonus9Threshold) {
      pts += R.ratingBonus9Points;
    } else if (rating >= R.ratingBonus8Threshold) {
      pts += R.ratingBonus8Points;
    }
  }
  return pts;
}

/** Captain multiplier for the given rules (2× by default, admin-tunable). */
export function captainMultiplier(rules: ScoringRules = SCORING_RULES): number {
  return resolveScoringRules(rules).captainMultiplier;
}
