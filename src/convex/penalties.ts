// ── Penalty shootout & tie-breaker rules ────────────────────────────────
//
// Pure module: no Convex imports, no database access, no side effects.
// It is imported by the server (matches.ts, gameweeks.ts, adminControl.ts)
// AND by the client (Admin.tsx, Dashboard.tsx, MatchDetail.tsx,
// Tournament.tsx) so the displayed result can never disagree with the
// stored one. This mirrors the `formations.ts` pattern used elsewhere in
// the project.
//
// ── Design rules that this module enforces ─────────────────────────────
//
// 1. FANTASY SCORING ISOLATION. A shootout is an aggregate match OUTCOME,
//    never a player statistic. Nothing in this module produces player
//    goals/assists, and no shootout figure is ever written to a
//    `matchPlayers` stat line. `computePlayerPoints` is therefore
//    structurally unable to see a penalty kick. Regulation goals (homeGoals
//    / awayGoals) remain the only thing that feeds fantasy points and the
//    golden-boot leaderboard.
//
// 2. ONE WINNER, DERIVED NEVER STORED RAW. `penaltyWinnerId` is *always*
//    derived from the penalty scores by `resolvePenaltyWinner`. The client
//    can send whatever it likes; a mismatched/absent value is ignored.
//
// 3. DRAWS ARE LEGAL IN REGULATION. A completed knockout fixture may end
//    level on goals — that is exactly when a shootout happens. What is
//    illegal is a shootout that is ITSELF tied (there would be no
//    advancing house), or penalties recorded for a match that wasn't
//    level / wasn't a knockout.

import { STAGES, type House, type Stage } from "./schema";

/** Stages that can be decided by a shootout. `group_stage` never is. */
export const KNOCKOUT_STAGES = [
  "semifinal1",
  "semifinal2",
  "third_place",
  "final",
] as const;

export type KnockoutStage = (typeof KNOCKOUT_STAGES)[number];

/** A shootout is 5 kicks each; we accept a little headroom for sudden death. */
export const MAX_PENALTY_KICKS = 20;

/**
 * The subset of a `matches` document this module needs. Structurally typed
 * so a plain object literal works in tests and on the client.
 */
export type PenaltyMatchLike = {
  stage?: Stage | string | null;
  isKnockout?: boolean | null;
  homeHouse?: House | string | null;
  awayHouse?: House | string | null;
  homeGoals?: number | null;
  awayGoals?: number | null;
  homePenaltiesScore?: number | null;
  awayPenaltiesScore?: number | null;
  penaltyWinnerId?: House | string | null;
};

/** Coerce anything to a finite number, else the fallback. Never throws. */
function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Non-negative whole number, else null. */
export function toKickCount(value: unknown): number | null {
  // Guard the coercions that JS would silently succeed at: Number(null) and
  // Number("") are both 0, which would turn "field left blank" into a real
  // 0-kick score.
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value === "boolean") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

/**
 * Is this fixture a knockout tie that can be decided by penalties?
 *
 * Prefers the explicit `isKnockout` flag when the admin has set it, and
 * otherwise falls back to the stage. Falling back matters: every match row
 * that predates this feature has `isKnockout === undefined`, and treating
 * those as non-knockout would silently break the Final.
 */
export function isKnockoutMatch(match: PenaltyMatchLike | null | undefined): boolean {
  if (!match) return false;
  if (typeof match.isKnockout === "boolean") return match.isKnockout;
  const stage = String(match.stage ?? "");
  return (KNOCKOUT_STAGES as readonly string[]).includes(stage);
}

/** Every stage that exists in the bracket, for UI toggles. */
export function isKnockoutStage(stage: Stage | string | null | undefined): boolean {
  return (KNOCKOUT_STAGES as readonly string[]).includes(String(stage ?? ""));
}

/** Regulation score, defensively defaulted. */
export function regulationScore(match: PenaltyMatchLike | null | undefined): {
  home: number;
  away: number;
} {
  return {
    home: Math.max(0, Math.trunc(num(match?.homeGoals, 0))),
    away: Math.max(0, Math.trunc(num(match?.awayGoals, 0))),
  };
}

/** Penalty score, defensively defaulted to 0 exactly as specified. */
export function penaltyScore(match: PenaltyMatchLike | null | undefined): {
  home: number;
  away: number;
} {
  return {
    home: Math.max(0, Math.trunc(num(match?.homePenaltiesScore, 0))),
    away: Math.max(0, Math.trunc(num(match?.awayPenaltiesScore, 0))),
  };
}

/** Did the sides finish regulation level? */
export function isRegulationDraw(match: PenaltyMatchLike | null | undefined): boolean {
  const { home, away } = regulationScore(match);
  return home === away;
}

/**
 * A shootout is only *in play* when the fixture is a knockout AND the
 * regulation score is level. `goesToPenalties` is what the UI badges on.
 */
export function goesToPenalties(match: PenaltyMatchLike | null | undefined): boolean {
  if (!isKnockoutMatch(match)) return false;
  return isRegulationDraw(match);
}

/** Do we have usable, non-tied penalty numbers on this row? */
export function hasDecidedShootout(match: PenaltyMatchLike | null | undefined): boolean {
  if (!goesToPenalties(match)) return false;
  const { home, away } = penaltyScore(match);
  return home !== away && (home > 0 || away > 0);
}

/**
 * THE tie-breaker. Returns the house that advanced, or `null` when the
 * match is genuinely undecided.
 *
 * Order of authority:
 *   1. A regulation winner (one side simply scored more) — penalties are
 *      irrelevant and MUST NOT override it. This is what stops a shootout
 *      from rewriting a match that was won in normal time.
 *   2. Otherwise, if this is a decided shootout, the higher penalty score.
 *   3. Otherwise null: a level knockout with no (or an invalid tied)
 *      shootout is an undecided fixture, NOT an away win.
 *
 * Every caller that previously used `homeGoals >= awayGoals` is wrong at
 * step 3: that expression silently awards the draw to the home house.
 */
export function resolveMatchWinner(
  match: PenaltyMatchLike | null | undefined,
): House | null {
  if (!match) return null;
  const { home, away } = regulationScore(match);

  if (home > away) return (match.homeHouse as House) ?? null;
  if (away > home) return (match.awayHouse as House) ?? null;

  // Level on goals — the shootout (if any) decides.
  if (goesToPenalties(match)) {
    const pen = penaltyScore(match);
    if (pen.home > pen.away) return (match.homeHouse as House) ?? null;
    if (pen.away > pen.home) return (match.awayHouse as House) ?? null;
  }
  return null;
}

/** The house that went out, or null when the fixture is undecided. */
export function resolveMatchLoser(
  match: PenaltyMatchLike | null | undefined,
): House | null {
  const winner = resolveMatchWinner(match);
  if (!winner || !match) return null;
  if (winner === match.homeHouse) return (match.awayHouse as House) ?? null;
  if (winner === match.awayHouse) return (match.homeHouse as House) ?? null;
  return null;
}

/** Did the house win? Null-safe: an undecided match is simply "no". */
export function didHouseWin(
  match: PenaltyMatchLike | null | undefined,
  house: House | null | undefined,
): boolean {
  if (!match || !house) return false;
  return resolveMatchWinner(match) === house;
}

/**
 * Validate a shootout submission. Returns `null` when valid, otherwise a
 * human-readable reason. Total function — never throws, always a string
 * or null, so it can be called straight from a form validator.
 */
export function validatePenaltyShootout(input: {
  stage: Stage | string;
  homeGoals: number;
  awayGoals: number;
  homePenaltiesScore?: number | null;
  awayPenaltiesScore?: number | null;
} | null | undefined): string | null {
  // Total function: a junk/absent payload is treated as "no shootout
  // submitted" rather than throwing, so this is safe to call straight from
  // a form validator.
  if (!input || typeof input !== "object") return null;
  const home = Math.trunc(num(input.homeGoals, 0));
  const away = Math.trunc(num(input.awayGoals, 0));
  const homePen = input.homePenaltiesScore;
  const awayPen = input.awayPenaltiesScore;
  const hasPen = homePen !== null && homePen !== undefined && awayPen !== null && awayPen !== undefined;

  if (!isKnockoutStage(input.stage)) {
    if (hasPen) {
      return "Penalty kicks only apply to a knockout fixture (semi-final, third place or final).";
    }
    return null;
  }

  if (!hasPen) return null; // no shootout submitted — legal on its own

  if (home !== away) {
    return "This match was not level on goals, so no penalty shootout is needed — clear the PK scores.";
  }

  const h = toKickCount(homePen);
  const a = toKickCount(awayPen);
  if (h === null || a === null) {
    return "Penalty scores must be whole numbers of kicks (no decimals, no negatives).";
  }
  if (h > MAX_PENALTY_KICKS || a > MAX_PENALTY_KICKS) {
    return `Penalty scores cannot exceed ${MAX_PENALTY_KICKS} kicks each.`;
  }
  if (h === a) {
    return "Penalty kicks finished level — a shootout must produce a winner. Re-enter the PK scores.";
  }
  return null;
}

/**
 * The canonical persistable shape derived from an admin submission.
 * `penaltyWinnerId` is computed here, never taken from the client, and
 * `undefined` (not null) clears an optional field on `db.patch`.
 */
export function derivePenaltyPatch(input: {
  stage: Stage | string;
  homeHouse: House | string;
  awayHouse: House | string;
  homeGoals: number;
  awayGoals: number;
  homePenaltiesScore?: number | null;
  awayPenaltiesScore?: number | null;
}): {
  isKnockout: boolean;
  goesToPenalties: boolean;
  homePenaltiesScore?: number;
  awayPenaltiesScore?: number;
  penaltyWinnerId?: House;
} {
  const knockout = isKnockoutStage(input.stage);
  const home = Math.trunc(num(input.homeGoals, 0));
  const away = Math.trunc(num(input.awayGoals, 0));
  // The house names MUST be part of the draft: resolveMatchWinner picks the
  // side by identity, so without them penaltyWinnerId would be undefined.
  const draft: PenaltyMatchLike = {
    stage: input.stage,
    isKnockout: knockout,
    homeHouse: input.homeHouse as House,
    awayHouse: input.awayHouse as House,
    homeGoals: home,
    awayGoals: away,
    homePenaltiesScore: toKickCount(input.homePenaltiesScore) ?? 0,
    awayPenaltiesScore: toKickCount(input.awayPenaltiesScore) ?? 0,
  };
  const decided = goesToPenalties(draft) && hasDecidedShootout(draft);

  if (!decided) {
    // Clear everything — a stale PK score would otherwise keep showing
    // "(4–3 PEN)" on a match that was won in normal time.
    return {
      isKnockout: knockout,
      goesToPenalties: false,
      homePenaltiesScore: undefined,
      awayPenaltiesScore: undefined,
      penaltyWinnerId: undefined,
    };
  }
  const winner = resolveMatchWinner(draft);
  return {
    isKnockout: knockout,
    goesToPenalties: true,
    homePenaltiesScore: toKickCount(draft.homePenaltiesScore) ?? 0,
    awayPenaltiesScore: toKickCount(draft.awayPenaltiesScore) ?? 0,
    penaltyWinnerId: winner ?? undefined,
  };
}

/**
 * Display line for a scoreboard.
 *   decided shootout -> "2 – 2 (4 – 3 PEN)"
 *   undecided level  -> "2 – 2 (Shootout pending)"
 *   normal result    -> "2 – 1"
 */
export function formatScoreLine(
  match: PenaltyMatchLike | null | undefined,
  opts: { sep?: string } = {},
): string {
  const sep = opts.sep ?? "–";
  if (!match) return `0${sep}0`;
  const { home, away } = regulationScore(match);
  const base = `${home}${sep}${away}`;
  if (hasDecidedShootout(match)) {
    const pen = penaltyScore(match);
    return `${base} (${pen.home}${sep}${pen.away} PEN)`;
  }
  if (goesToPenalties(match) && match?.isKnockout !== false) {
    return `${base} (Shootout pending)`;
  }
  return base;
}

/** Sentence shown under a decided shootout. */
export function formatShootoutSummary(
  match: PenaltyMatchLike | null | undefined,
): string | null {
  if (!hasDecidedShootout(match)) return null;
  const winner = resolveMatchWinner(match);
  if (!winner) return null;
  const pen = penaltyScore(match);
  const { home, away } = regulationScore(match);
  return `${winner} wins ${Math.max(pen.home, pen.away)}–${Math.min(pen.home, pen.away)} on penalties after a ${home}–${away} draw.`;
}

/** Re-exported for convenience so callers need one import for the bracket. */
export { STAGES };
