// Fantasy scoring rules — single source of truth, used by the backend on
// match save and by the UI to explain where points come from.
import type { Position } from "./schema";

export const SCORING_RULES = {
  goalByPosition: { GK: 6, DEF: 6, MID: 5, FWD: 4 },
  assist: 3,
  cleanSheetGkDef: 4,
  savesPerPoint: 3, // every 3 saves = 1 pt
  yellowCard: -1,
  redCard: -3,
  ownGoal: -2,
  potmBonus: 3,
  ratingBonusThreshold: 8.0,
  ratingBonusPoints: 2, // rating >= 8.0 earns +2
} as const;

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

/** Compute the fantasy points for one player's stat line in one match. */
export function computePlayerPoints(stats: MatchPlayerStats): number {
  let pts = 0;
  pts += stats.goals * SCORING_RULES.goalByPosition[stats.position];
  pts += stats.assists * SCORING_RULES.assist;
  if (stats.cleanSheet && (stats.position === "GK" || stats.position === "DEF")) {
    pts += SCORING_RULES.cleanSheetGkDef;
  }
  pts += Math.floor(stats.saves / SCORING_RULES.savesPerPoint);
  pts += stats.yellowCards * SCORING_RULES.yellowCard;
  pts += stats.redCards * SCORING_RULES.redCard;
  pts += stats.ownGoals * SCORING_RULES.ownGoal;
  if (stats.potm) pts += SCORING_RULES.potmBonus;
  if (
    stats.rating !== undefined &&
    stats.rating !== null &&
    stats.rating >= SCORING_RULES.ratingBonusThreshold
  ) {
    pts += SCORING_RULES.ratingBonusPoints;
  }
  return pts;
}
