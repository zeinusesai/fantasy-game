// ── Fixed 2-gameweek tournament structure ────────────────────────────────
//
// The tournament is always exactly two gameweeks. This module is the single
// source of truth for that structure so the deadline engine, the chips, the
// bracket and the admin UI can never disagree about which stage belongs to
// which gameweek.
//
//   GW1 = Semi-Final 1 + Semi-Final 2
//   GW2 = 3rd Place Playoff + Final
//
// Nothing here reads the database — it is pure, total and importable from
// both mutations and queries (and from the client for labels).

export const GAMEWEEKS = [
  {
    number: 1,
    label: "Gameweek 1",
    shortLabel: "GW1",
    stages: ["semifinal1", "semifinal2"],
    summary: "Semi-Final 1 and Semi-Final 2",
  },
  {
    number: 2,
    label: "Gameweek 2",
    shortLabel: "GW2",
    stages: ["third_place", "final"],
    summary: "3rd Place Playoff and the Final",
  },
] as const;

export type StageKey = (typeof GAMEWEEKS)[number]["stages"][number];
export type GameweekNumber = 1 | 2;

const STAGE_TO_GW: Record<string, GameweekNumber> = {
  semifinal1: 1,
  semifinal2: 1,
  third_place: 2,
  final: 2,
};

/**
 * Which gameweek a stage belongs to. Returns `null` for anything not in the
 * tournament structure (e.g. the legacy "group_stage") rather than throwing,
 * so a stray stage can never break a caller.
 */
export function gameweekForStage(stage: string | null | undefined): GameweekNumber | null {
  if (typeof stage !== "string") return null;
  return STAGE_TO_GW[stage] ?? null;
}

/** The stage list for a gameweek (empty array for an invalid number). */
export function stagesForGameweek(n: number | null | undefined): readonly string[] {
  if (n !== 1 && n !== 2) return [];
  return GAMEWEEKS[n - 1].stages;
}

/** Human label for a gameweek number, safe for any input. */
export function gameweekLabel(n: number | null | undefined): string {
  if (n === 1) return "Gameweek 1";
  if (n === 2) return "Gameweek 2";
  return "Tournament";
}

/**
 * Which gameweek is currently "live" for transfers — the earliest one that
 * has not been fully locked, settled or past its deadline. Returns `null`
 * when every gameweek is closed (or nothing is configured yet).
 */
export function activeGameweek(
  byStage: Record<string, { deadlineAt: number | null; locked: boolean; settled: boolean }>,
  now: number = Date.now(),
): GameweekNumber | null {
  for (const gw of GAMEWEEKS) {
    const stages = gw.stages.map(
      (s) => byStage[s] ?? { deadlineAt: null, locked: false, settled: false },
    );
    // A gameweek is open while ANY of its stages is still editable — that
    // keeps transfers alive between the two semifinals.
    const anyOpen = stages.some(
      (s) =>
        s.settled !== true &&
        s.locked !== true &&
        !(typeof s.deadlineAt === "number" && now > s.deadlineAt),
    );
    if (anyOpen) return gw.number;
  }
  return null;
}

/**
 * Why transfers are currently locked, or `null` when edits are allowed.
 *
 * IMPORTANT: this deliberately checks per gameweek rather than per stage. An
 * earlier implementation rejected a transfer if ANY stage was closed, which
 * meant a manager could never make a change after their first semifinal was
 * recorded — even with a whole gameweek still ahead of them.
 */
export function transferLockReason(
  byStage: Record<string, { deadlineAt: number | null; locked: boolean; settled: boolean }>,
  now: number = Date.now(),
): string | null {
  const live = activeGameweek(byStage, now);
  if (live !== null) return null;

  // Nothing open — report the most useful reason for the UI.
  let sawDeadline = false;
  let sawLock = false;
  let sawSettled = false;
  for (const gw of GAMEWEEKS) {
    for (const stage of gw.stages) {
      const s = byStage[stage];
      if (!s) continue;
      if (s.settled === true) sawSettled = true;
      else if (s.locked === true) sawLock = true;
      else if (typeof s.deadlineAt === "number" && now > s.deadlineAt) sawDeadline = true;
    }
  }
  if (sawSettled) return "Every gameweek has been settled — transfers are closed.";
  if (sawLock) return "Transfers are locked for every remaining gameweek.";
  if (sawDeadline) return "The transfer deadline has passed for every gameweek.";
  return null;
}
