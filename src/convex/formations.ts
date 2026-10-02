import type { Position } from "./schema";

/**
 * Shared 7-a-side formation definitions.
 *
 * Imported by BOTH the Convex server (saveSquad / forceSaveSquad /
 * setExpectedLineups validation) and the React client (pitch layout, formation
 * pickers), so the shape a manager picks is exactly the shape the server
 * enforces. Pure data + pure functions only — no convex runtime imports.
 *
 * A formation string is "DEF-MID-FWD" with exactly one goalkeeper implied
 * (the platform rule: every 7-a-side team fields 1 GK). The legacy tournament
 * shape "1-2-2-2" (GK-DEF-MID-FWD) is kept as an alias for "2-2-2" so squads
 * saved before formations existed keep validating.
 */

export type FormationShape = { GK: number; DEF: number; MID: number; FWD: number };

export const DEFAULT_FORMATION = "2-3-1";

export type FormationPreset = {
  id: string;
  label: string;
  blurb: string;
  shape: FormationShape;
};

export const FORMATION_PRESETS: readonly FormationPreset[] = [
  {
    id: "2-3-1",
    label: "2-3-1",
    blurb: "Balanced",
    shape: { GK: 1, DEF: 2, MID: 3, FWD: 1 },
  },
  {
    id: "3-2-1",
    label: "3-2-1",
    blurb: "Defensive",
    shape: { GK: 1, DEF: 3, MID: 2, FWD: 1 },
  },
  {
    id: "2-2-2",
    label: "2-2-2",
    blurb: "Midfield control",
    shape: { GK: 1, DEF: 2, MID: 2, FWD: 2 },
  },
  {
    id: "1-3-2",
    label: "1-3-2",
    blurb: "Attacking",
    shape: { GK: 1, DEF: 1, MID: 3, FWD: 2 },
  },
  {
    id: "3-1-2",
    label: "3-1-2",
    blurb: "Counter-attack",
    shape: { GK: 1, DEF: 3, MID: 1, FWD: 2 },
  },
];

/** Legacy fixed tournament shape → its modern equivalent. */
export const LEGACY_FORMATION = "1-2-2-2";
const ALIASES: Record<string, string> = { [LEGACY_FORMATION]: "2-2-2" };

const PRESET_BY_ID = new Map<string, FormationShape>(
  FORMATION_PRESETS.map((p) => [p.id, p.shape] as const),
);

/** The original hard-coded 1 GK / 2 DEF / 2 MID / 2 FWD rule. */
export const LEGACY_SHAPE: FormationShape = { GK: 1, DEF: 2, MID: 2, FWD: 2 };

/** True only for a known preset id (aliases excluded). */
export function isFormationId(value: unknown): boolean {
  return typeof value === "string" && PRESET_BY_ID.has(value);
}

/**
 * Normalise any stored/legacy/unknown formation string to a safe preset id.
 * Never throws and never returns undefined — unexpected values fall back to
 * the 2-3-1 default, so a bad string can never break a pitch layout.
 */
export function resolveFormation(value?: string | null): string {
  if (typeof value !== "string") return DEFAULT_FORMATION;
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_FORMATION;
  if (PRESET_BY_ID.has(trimmed)) return trimmed;
  const alias = ALIASES[trimmed];
  return alias ?? DEFAULT_FORMATION;
}

/** Shape for a formation id — always a complete object, never undefined. */
export function formationShape(value?: string | null): FormationShape {
  return PRESET_BY_ID.get(resolveFormation(value)) ?? LEGACY_SHAPE;
}

/** Display label, e.g. "2-3-1". */
export function formationLabel(value?: string | null): string {
  return resolveFormation(value);
}

/** Human blurb ("Balanced", "Defensive"…) for the picker chips. */
export function formationBlurb(value?: string | null): string {
  const id = resolveFormation(value);
  return FORMATION_PRESETS.find((p) => p.id === id)?.blurb ?? "Balanced";
}

/** "2-3-1 · Balanced" — one-line summary for headers. */
export function formationSummary(value?: string | null): string {
  const id = resolveFormation(value);
  return `${id} · ${formationBlurb(id)}`;
}

/**
 * Resolve the formation a set of selected players represents:
 * an explicit valid id wins, otherwise the shape is inferred from the
 * position counts (legacy squads). Returns null when the counts match no
 * preset so the caller can fall back to the platform default.
 */
export function resolveFormationForPlayers(
  counts: Partial<Record<Position, number>>,
  requested?: string | null,
): string | null {
  if (typeof requested === "string" && isFormationId(requested.trim())) {
    return resolveFormation(requested);
  }
  return inferFormation(counts);
}

/** Reverse lookup: which preset does this position count match? */
export function inferFormation(
  counts: Partial<Record<Position, number>>,
): string | null {
  const gk = Number(counts.GK ?? 0);
  const def = Number(counts.DEF ?? 0);
  const mid = Number(counts.MID ?? 0);
  const fwd = Number(counts.FWD ?? 0);
  if (![gk, def, mid, fwd].every((n) => Number.isFinite(n))) return null;
  for (const preset of FORMATION_PRESETS) {
    const s = preset.shape;
    if (s.GK === gk && s.DEF === def && s.MID === mid && s.FWD === fwd) {
      return preset.id;
    }
  }
  return null;
}

/** Does this selection of players satisfy the formation? */
export function formationMatches(
  counts: Partial<Record<Position, number>>,
  formation?: string | null,
): boolean {
  const shape = formationShape(formation);
  return (
    Number(counts.GK ?? 0) === shape.GK &&
    Number(counts.DEF ?? 0) === shape.DEF &&
    Number(counts.MID ?? 0) === shape.MID &&
    Number(counts.FWD ?? 0) === shape.FWD
  );
}

/** One slot on the visual pitch: percentage coordinates + the position it covers. */
export type FormationSlot = { position: Position; x: number; y: number };

// Row baselines (percent of pitch height). GK sits at the bottom, forwards at
// the top, so the visual reads like a real team sheet.
const ROW_Y: Record<Position, number> = { GK: 88, DEF: 70, MID: 43, FWD: 17 };

/** Even horizontal spread for `n` players in a row (n is clamped to 1–3). */
function spreadX(n: number): number[] {
  const count = Math.max(1, Math.min(3, Math.floor(n) || 1));
  if (count === 1) return [50];
  if (count === 2) return [30, 70];
  return [18, 50, 82];
}

/**
 * The 7 pitch slots for a formation, ordered GK → DEF → MID → FWD (the same
 * order the squad list is built in). Unknown ids resolve to the 2-3-1 layout.
 */
export function formationSlots(formation?: string | null): FormationSlot[] {
  const shape = formationShape(formation);
  const slots: FormationSlot[] = [];
  for (const position of ["GK", "DEF", "MID", "FWD"] as Position[]) {
    const rowCount = Math.max(0, Math.min(3, Math.round(shape[position])));
    for (const x of spreadX(rowCount)) {
      slots.push({ position, x, y: ROW_Y[position] });
    }
  }
  return slots;
}

/**
 * Grid coordinates for `count` slots. Formation slots are used for the first
 * seven; any overflow (a squad saved under a different shape) is parked on a
 * safe extra row so a player can never disappear off the pitch.
 */
export function formationCoords(
  formation: string | null | undefined,
  count: number,
): { x: number; y: number }[] {
  const base = formationSlots(formation);
  const coords = base.map(({ x, y }) => ({ x, y }));
  const total = Math.max(0, Math.floor(Number(count) || 0));
  for (let i = coords.length; i < total; i++) {
    coords.push({ x: 50, y: 96 });
  }
  return coords;
}

/** Slot descriptors padded out to `count` (extra slots keep their own position). */
export function formationSlotsFor(
  formation: string | null | undefined,
  count: number,
): FormationSlot[] {
  const base = formationSlots(formation);
  const total = Math.max(0, Math.floor(Number(count) || 0));
  const slots: FormationSlot[] = base.map((s) => ({ ...s }));
  while (slots.length < total) {
    slots.push({ position: "MID", x: 50, y: 96 });
  }
  return slots;
}