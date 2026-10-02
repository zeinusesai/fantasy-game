// Keys for the singleton config table.
export const CONFIG_KEYS = {
  BUDGET: "budget",
  HOUSE_LIMIT: "houseLimit",
  ADMIN_MESSAGE: "adminMessage",
  TOURNAMENT_FINALIZED: "tournamentFinalized",
} as const;

/**
 * Gameweek structure: the 4-match tournament maps onto 2 gameweeks.
 * GW1 = both semifinals, GW2 = 3rd-place match + final.
 */
export const GW_STAGES = ["semifinal1", "semifinal2", "third_place", "final"] as const;
export type GwStage = (typeof GW_STAGES)[number];

/** The one-time "Double Down" chip id for each gameweek. */
export const CHIP_GW1 = "double_down_gw1";
export const CHIP_GW2 = "double_down_gw2";
export const VALID_CHIPS = [CHIP_GW1, CHIP_GW2] as const;

/** Which chip doubles which stage's points. */
export function chipForStage(stage: string): string | null {
  if (stage === "semifinal1" || stage === "semifinal2") return CHIP_GW1;
  if (stage === "third_place" || stage === "final") return CHIP_GW2;
  return null;
}

/**
 * Every manager on the platform shares ONE fixed starting budget: $70m.
 * This constant is the single source of truth — per-user values (the legacy
 * `users.budget` field and the old Super-Admin `users.customBudget` override)
 * are deliberately ignored everywhere so the cap can never drift.
 */
export const FIXED_MANAGER_BUDGET = 70_000_000;

/**
 * Hard cap on one direct-message body. Lives here (a PURE module, safe to
 * import from both the Convex server and the React client) so the composer can
 * show a live counter against the exact same limit the server enforces.
 */
export const MAX_MESSAGE_LENGTH = 1000;

/**
 * Hard ceiling on BENCH / substitute players per side of a predicted lineup.
 * Lives in this PURE module so the client (match editor) and the server
 * (`convex/lineups.ts`) enforce the identical number from one constant.
 */
export const MAX_SUBSTITUTES = 3;

export const DEFAULT_CONFIG = {
  budget: FIXED_MANAGER_BUDGET, // $70m — fixed for all managers
  houseLimit: 3,
};

export const DEFAULT_BUDGET_CONFIG_KEY = CONFIG_KEYS.BUDGET;

// Budgets are plain dollar amounts stored as numbers.
export function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "$0";
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    const str = m % 1 === 0 ? String(m) : m.toFixed(1);
    return `$${str}m`;
  }
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}k`;
  return `$${value}`;
}

export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "").toLowerCase();
  if (!cleaned) return null;
  const match = cleaned.match(/^(\d+(?:\.\d+)?)(m|k)?$/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  if (Number.isNaN(num)) return null;
  if (match[2] === "m") return Math.round(num * 1_000_000);
  if (match[2] === "k") return Math.round(num * 1000);
  return Math.round(num);
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * The one and only budget resolver.
 *
 * Every manager's budget is the fixed $70m platform default. A Super-Admin
 * per-manager override may LOWER it, but can never raise it above the cap —
 * so `safeBudget` always returns `min(override, $70m)`.
 *
 * Any value that is missing, `NaN`, `Infinity`, zero or negative falls back
 * to the full platform budget. This matters: `NaN > x` is always false, so a
 * corrupt value would otherwise silently PASS every squad budget check.
 * The result is always finite and non-negative.
 */
export function safeBudget(
  value?: number | null,
  fallback: number = FIXED_MANAGER_BUDGET,
): number {
  const fb =
    typeof fallback === "number" && Number.isFinite(fallback) && fallback > 0
      ? Math.round(fallback)
      : FIXED_MANAGER_BUDGET;
  if (typeof value !== "number") return fb;
  if (!Number.isFinite(value) || value <= 0) return fb;
  // NOTE: no upper clamp here — clamping to the Super-Admin's configured
  // window is `resolveManagerBudget`'s job (it knows the live max). This
  // function only guarantees the value is finite, positive and integral.
  return Math.round(value);
}

/**
 * Strictly parses any price/budget-shaped value into a finite, non-negative
 * number. Used for client-side budget math so a string price can never cause
 * string concatenation, and so `NaN` never leaks into a sum.
 */
export function toSafeAmount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

// House color tokens used across UI + seed logo SVGs.
export const HOUSE_META = {
  Fire: { color: "#e64530" },
  Earth: { color: "#2f9e44" },
  Wind: { color: "#f0a821" },
  Water: { color: "#2f7fe0" },
} as const;
