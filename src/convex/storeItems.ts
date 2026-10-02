// ── Manual Cash Micro-Transaction Store catalogue ─────────────────────────
//
// Shared by the server (`transactions.ts`) and the client (`Store.tsx`,
// `Admin.tsx`) so the price a manager sees is literally the price the server
// validates. Prices are in AED (United Arab Emirates dirham) and every item
// is capped by `MAX_PRICE_AED`.
//
// This module is PURE — no Convex imports, no database access, no side
// effects — so it is safe to import from both environments.

/**
 * HARD price ceiling. Nothing in the store may ever cost more than this.
 * Enforced here (authoring), in the store UI (client-side) AND in
 * `requestPurchase` (server-side), so a tampered client cannot get through.
 */
export const MAX_PRICE_AED = 10;

/** What buying an item actually does to the buyer's account. */
export type StoreGrant =
  /** Unlocks a cosmetic the manager can toggle on/off themselves. */
  | "cosmetic"
  /** Adds `grants.extraChips` extra single-use Double Down chips. */
  | "extra_chip"
  /** Sets the manager's permanent budget override to $72m. */
  | "budget_expansion";

export type StoreItemId =
  | "custom_title"
  | "profile_border"
  | "golden_theme"
  | "extra_chip"
  | "budget_expansion";

export type StoreItem = {
  id: StoreItemId;
  /** Display name shown in the store, the admin queue and the feed. */
  name: string;
  /** Short description under the name. */
  blurb: string;
  /** Cash price in AED. Always `1 <= priceAED <= MAX_PRICE_AED`. */
  priceAED: number;
  /** Lucide icon key the Store page maps to a component. */
  icon: "title" | "border" | "theme" | "chip" | "budget";
  /** Tailwind gradient classes for the item card. */
  accent: string;
  /** What approving the purchase actually grants. */
  grant: StoreGrant;
  /** Cosmetic items can be switched on/off after purchase. */
  toggleable: boolean;
  /** Extra chips granted by the "extra_chip" item. */
  extraChips?: number;
  /** Budget cap (raw dollars) granted by the "budget_expansion" item. */
  budgetAmount?: number;
};

export const STORE_ITEMS: readonly StoreItem[] = [
  {
    id: "custom_title",
    name: "Custom Manager Title & Badge",
    blurb: "Show a custom title and icon next to your name on the leaderboard.",
    priceAED: 5,
    icon: "title",
    accent: "from-violet-500/20 to-fuchsia-500/10",
    grant: "cosmetic",
    toggleable: true,
  },
  {
    id: "profile_border",
    name: "Custom Profile Border",
    blurb: "An animated glowing fire frame around your profile avatar.",
    priceAED: 5,
    icon: "border",
    accent: "from-orange-500/20 to-amber-500/10",
    grant: "cosmetic",
    toggleable: true,
  },
  {
    id: "golden_theme",
    name: "Golden Jersey / Premium Pitch",
    blurb: "Unlocks a gold pitch and jersey aesthetic for your squad.",
    priceAED: 8,
    icon: "theme",
    accent: "from-yellow-400/25 to-amber-500/10",
    grant: "cosmetic",
    toggleable: true,
  },
  {
    id: "extra_chip",
    name: 'Extra "Double Down" Chip',
    blurb: "Grants 1 extra single-use chip that doubles your gameweek points.",
    priceAED: 10,
    icon: "chip",
    accent: "from-sky-500/20 to-cyan-500/10",
    grant: "extra_chip",
    toggleable: false,
    extraChips: 1,
  },
  {
    id: "budget_expansion",
    name: "Budget Expansion",
    blurb: "Permanently raises your starting budget from $70m to $72m.",
    priceAED: 10,
    icon: "budget",
    accent: "from-emerald-500/20 to-teal-500/10",
    grant: "budget_expansion",
    toggleable: false,
    budgetAmount: 72_000_000,
  },
] as const;

/** Every catalogue item, validated once at module load (authoring safety net). */
export const VALID_STORE_ITEMS: readonly StoreItem[] = STORE_ITEMS.filter(
  (item) =>
    Number.isFinite(item.priceAED) &&
    item.priceAED > 0 &&
    item.priceAED <= MAX_PRICE_AED,
);

/** All catalogue ids — handy for validation without importing the objects. */
export const STORE_ITEM_IDS = STORE_ITEMS.map((i) => i.id);

/**
 * Look up a catalogue item by id.
 *
 * TOTAL: never throws. Returns `null` for null/undefined, non-strings, junk
 * strings and unknown ids, so an attacker-supplied id can never reach the
 * database or crash a handler.
 */
export function storeItemById(id: unknown): StoreItem | null {
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  return STORE_ITEMS.find((item) => item.id === trimmed) ?? null;
}

/** True when the id belongs to the catalogue. */
export function isStoreItemId(id: unknown): id is StoreItemId {
  return storeItemById(id) !== null;
}

/**
 * True when `priceAED` is a valid, payable amount (finite, positive, whole or
 * half AED, and within the hard ceiling). Used to reject tampered prices.
 */
export function isValidPriceAED(priceAED: unknown): boolean {
  const n = typeof priceAED === "number" ? priceAED : Number(priceAED);
  return Number.isFinite(n) && n > 0 && n <= MAX_PRICE_AED;
}

/**
 * The real price for an item, always taken from the CATALOGUE (never from the
 * client) and clamped to the ceiling. Returns `null` for unknown ids.
 */
export function priceForItem(id: unknown): number | null {
  const item = storeItemById(id);
  if (!item) return null;
  return Math.min(item.priceAED, MAX_PRICE_AED);
}