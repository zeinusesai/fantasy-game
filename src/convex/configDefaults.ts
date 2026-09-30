// Keys for the singleton config table.
export const CONFIG_KEYS = {
  BUDGET: "budget",
  HOUSE_LIMIT: "houseLimit",
} as const;

export const DEFAULT_CONFIG = {
  budget: 100_000_000,
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

// House color tokens used across UI + seed logo SVGs.
export const HOUSE_META = {
  Fire: { color: "#e64530" },
  Earth: { color: "#2f9e44" },
  Wind: { color: "#f0a821" },
  Water: { color: "#2f7fe0" },
} as const;
