import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireSuperAdmin } from "./lib";
import { toSafeAmount } from "./configDefaults";
import {
  APP_DEFAULTS,
  DEFAULT_BADGE_REGISTRY as BUILTIN_BADGES,
  DEFAULT_AWARDS,
  DEFAULT_HOUSES,
  DEFAULT_MARKET_RULES,
  DEFAULT_SCORING_RULES,
  clampInt,
  clampNum,
  cleanBadgeId,
  cleanText,
  cleanUrl,
  isHexColor,
  type AwardDef,
  type HouseBrand,
  type ScoringRules,
} from "./defaults";
import { houseValidator, HOUSES } from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// ── Super Admin customization engine ───────────────────────────────────────
//
// Every global option Zein can edit lives in the singleton `systemConfig`
// row. This module is the ONLY place that reads or writes those fields, so
// defaults are defined exactly once and no consumer can drift.
//
// Design rules enforced throughout:
//   • Reads NEVER throw — a missing/partial/malformed row resolves to a fully
//     populated safe default object, so `config.houseNames[house]` is always a
//     string and `config.tournamentEnded` is always a boolean.
//   • Writes are super-admin only, strictly parse their input, and wrap all
//     DB work in try/catch so the client gets a clean toast, never a stack.

export const DEFAULT_HOUSE_NAMES: Record<string, string> = Object.fromEntries(
  HOUSES.map((h) => [h, DEFAULT_HOUSES[h].name]),
);

/** Best-effort audit write — never throws, never blocks the caller's action. */
async function audit(
  ctx: MutationCtx,
  action: string,
  category: string,
  target?: string,
  detail?: string,
): Promise<void> {
  try {
    await ctx.runMutation(internal.audit.logAudit, {
      action,
      category,
      ...(target ? { target } : {}),
      ...(detail ? { detail } : {}),
    });
  } catch {
    // audit failure must never break the admin action
  }
}

export const AWARD_KEYS = [
  "tacticalGenius",
  "unluckyManager",
  "differentialMaster",
  "playerOfTheWeek",
] as const;
export type AwardKey = (typeof AWARD_KEYS)[number];

export const DEFAULT_AWARD_TITLES: Record<AwardKey, { title: string; description: string }> = {
  tacticalGenius: {
    title: "Tactical Genius",
    description: "Highest total points of the tournament.",
  },
  unluckyManager: {
    title: "Unlucky Manager",
    description: "Lowest total points of the tournament.",
  },
  differentialMaster: {
    title: "Differential Master",
    description: "Most points from players owned by under 15% of managers.",
  },
  playerOfTheWeek: {
    title: "Player of the Week",
    description: "Highest-scoring player of the latest gameweek.",
  },
};

export const DEFAULT_BADGE_REGISTRY: Record<
  string,
  { emoji: string; label: string; tone: string }
> = { ...BUILTIN_BADGES };

export const DEFAULT_YEAR12_MESSAGE =
  "That's a wrap on Year 11 — see you all in Year 12!";

// ── Internal helpers ──────────────────────────────────────────────────────

/** The singleton settings row, or null when the DB is fresh. */
export async function getSettingsRow(ctx: QueryCtx | MutationCtx) {
  try {
    const rows = await ctx.db.query("systemConfig").collect();
    return rows[0] ?? null;
  } catch {
    return null; // never throw out of a config read
  }
}

/**
 * Coerce whatever is stored into a fully-populated settings object. Every
 * field is defensively rebuilt — a corrupt row can only ever fall back to
 * the default, never crash a consumer or leak `undefined` into the UI.
 *
 * This is the single implementation of the "safe fallback" contract:
 *   config?.houses?.[Fire]?.name   ?? "Fire"
 *   config?.scoringRules?.goalDef  ?? 6
 *   config?.marketRules?.defaultBudget ?? 70_000_000
 */
export function normalizeSettings(row: {
  isMaintenanceMode?: boolean;
  houseNames?: unknown;
  houses?: unknown;
  awardTitles?: unknown;
  awards?: unknown;
  badgeRegistry?: unknown;
  budgetOverrides?: unknown;
  marketRules?: unknown;
  scoringRules?: unknown;
  uiText?: unknown;
  editableSquads?: boolean;
  maintenanceMessage?: unknown;
  tournamentEnded?: boolean;
  tournamentEndedAt?: number;
  year12Message?: string;
} | null) {
  // ── House names (legacy flat field) ──
  const houseNames: Record<string, string> = { ...DEFAULT_HOUSE_NAMES };
  const rawNames = row?.houseNames;
  if (rawNames && typeof rawNames === "object" && !Array.isArray(rawNames)) {
    for (const house of HOUSES) {
      const value = (rawNames as Record<string, unknown>)[house];
      if (typeof value === "string" && value.trim().length > 0 && value.length <= 24) {
        houseNames[house] = value.trim();
      }
    }
  }

  // ── House branding (name + color + logo + motto) ──
  // The richer `houses` field wins; the legacy `houseNames` field is folded
  // in underneath so an old rename is never silently lost.
  const houses = {} as Record<string, HouseBrand>;
  const rawHouses = row?.houses;
  for (const house of HOUSES) {
    const fallback = DEFAULT_HOUSES[house];
    let entry: Record<string, unknown> | null = null;
    if (rawHouses && typeof rawHouses === "object" && !Array.isArray(rawHouses)) {
      const candidate = (rawHouses as Record<string, unknown>)[house];
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        entry = candidate as Record<string, unknown>;
      }
    }
    const configuredName =
      entry && typeof entry.name === "string" && entry.name.trim().length > 0
        ? entry.name.trim().slice(0, 24)
        : houseNames[house];
    houses[house] = {
      name: configuredName,
      color: entry && isHexColor(entry.color) ? entry.color.trim() : fallback.color,
      logoUrl: entry ? cleanUrl(entry.logoUrl) : "",
      motto: entry
        ? cleanText(entry.motto, 120, fallback.motto)
        : fallback.motto,
    };
    // Keep the flat map in sync so legacy consumers stay correct.
    houseNames[house] = configuredName;
  }

  // ── Award definitions (title + icon + description + threshold) ──
  const awardTitles = {} as Record<AwardKey, { title: string; description: string }>;
  const awardDefs = {} as Record<string, AwardDef>;
  const rawAwards = row?.awardTitles;
  const rawAwardDefs = row?.awards;
  for (const key of AWARD_KEYS) {
    const fallback = DEFAULT_AWARDS[key];
    const readEntry = (src: unknown): Record<string, unknown> | null => {
      if (src && typeof src === "object" && !Array.isArray(src)) {
        const candidate = (src as Record<string, unknown>)[key];
        if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
          return candidate as Record<string, unknown>;
        }
      }
      return null;
    };
    // The rich `awards` entry wins over the legacy `awardTitles` entry.
    const legacy = readEntry(rawAwards);
    const rich = readEntry(rawAwardDefs);
    const entry = { ...(legacy ?? {}), ...(rich ?? {}) };

    const title = cleanText(entry.title, 40, fallback.title);
    const description = cleanText(entry.description, 160, fallback.description);
    const icon = cleanText(entry.icon, 8, fallback.icon);
    const threshold = clampNum(entry.threshold, 0, 100_000, fallback.threshold);

    awardTitles[key] = { title, description };
    awardDefs[key] = { title, icon, description, threshold };
  }
  // Extra custom awards the admin added beyond the built-in keys.
  if (rawAwardDefs && typeof rawAwardDefs === "object" && !Array.isArray(rawAwardDefs)) {
    for (const [key, value] of Object.entries(rawAwardDefs as Record<string, unknown>)) {
      if (key in awardDefs) continue; // already handled above
      if (!cleanBadgeId(key)) continue;
      if (!value || typeof value !== "object") continue;
      const e = value as Record<string, unknown>;
      const fallback = DEFAULT_AWARDS[key];
      awardDefs[key] = {
        title: cleanText(e.title, 40, fallback?.title ?? key),
        icon: cleanText(e.icon, 8, fallback?.icon ?? "🏅"),
        description: cleanText(e.description, 160, fallback?.description ?? ""),
        threshold: clampNum(e.threshold, 0, 100_000, fallback?.threshold ?? 0),
      };
    }
  }

  // Badge registry — built-ins first, then any custom entries.
  const badgeRegistry: Record<string, { emoji: string; label: string; tone: string }> = {
    ...DEFAULT_BADGE_REGISTRY,
  };
  const rawBadges = row?.badgeRegistry;
  if (rawBadges && typeof rawBadges === "object" && !Array.isArray(rawBadges)) {
    for (const [id, value] of Object.entries(rawBadges as Record<string, unknown>)) {
      const key = typeof id === "string" ? id.trim().toLowerCase() : "";
      if (!key || key.length > 24 || !/^[a-z0-9_]+$/.test(key)) continue;
      if (!value || typeof value !== "object") continue;
      const b = value as { emoji?: unknown; label?: unknown; tone?: unknown };
      const emoji = typeof b.emoji === "string" && b.emoji.length <= 8 ? b.emoji : "🏅";
      const label =
        typeof b.label === "string" && b.label.trim().length > 0 && b.label.length <= 24
          ? b.label.trim()
          : key;
      const tone = typeof b.tone === "string" && b.tone.length <= 16 ? b.tone : "amber";
      badgeRegistry[key] = { emoji, label, tone };
    }
  }

  // ── Market & budget rules ──
  const rawMarket = (row?.marketRules ?? null) as Record<string, unknown> | null;
  const marketRules = {
    defaultBudget: clampInt(
      rawMarket?.defaultBudget,
      DEFAULT_MARKET_RULES.minBudget,
      DEFAULT_MARKET_RULES.maxBudget,
      DEFAULT_MARKET_RULES.defaultBudget,
    ),
    maxBudget: clampInt(
      rawMarket?.maxBudget,
      DEFAULT_MARKET_RULES.minBudget,
      DEFAULT_MARKET_RULES.maxBudget,
      DEFAULT_MARKET_RULES.maxBudget,
    ),
    minBudget: clampInt(
      rawMarket?.minBudget,
      1_000_000,
      DEFAULT_MARKET_RULES.maxBudget,
      DEFAULT_MARKET_RULES.minBudget,
    ),
    minPlayerPrice: clampInt(
      rawMarket?.minPlayerPrice,
      0,
      1_000_000_000,
      DEFAULT_MARKET_RULES.minPlayerPrice,
    ),
    maxPlayerPrice: clampInt(
      rawMarket?.maxPlayerPrice,
      1_000_000,
      1_000_000_000,
      DEFAULT_MARKET_RULES.maxPlayerPrice,
    ),
    maxTransfersPerGameweek: clampInt(
      rawMarket?.maxTransfersPerGameweek,
      0,
      50,
      DEFAULT_MARKET_RULES.maxTransfersPerGameweek,
    ),
    panicThresholdMinutes: clampInt(
      rawMarket?.panicThresholdMinutes,
      1,
      1440,
      DEFAULT_MARKET_RULES.panicThresholdMinutes,
    ),
    houseLimit: clampInt(rawMarket?.houseLimit, 1, 7, DEFAULT_MARKET_RULES.houseLimit),
  };
  // Guarantee a coherent window even if the admin entered nonsense:
  // min <= default <= max, and minPrice <= maxPrice.
  marketRules.defaultBudget = clampInt(
    marketRules.defaultBudget,
    marketRules.minBudget,
    marketRules.maxBudget,
    DEFAULT_MARKET_RULES.defaultBudget,
  );
  marketRules.minPlayerPrice = Math.min(
    marketRules.minPlayerPrice,
    marketRules.maxPlayerPrice,
  );

  // ── Scoring rule matrix ──
  const rawScoring = (row?.scoringRules ?? null) as Record<string, unknown> | null;
  const scoringRules: ScoringRules = {
    goalGk: clampInt(rawScoring?.goalGk, 0, 100, DEFAULT_SCORING_RULES.goalGk),
    goalDef: clampInt(rawScoring?.goalDef, 0, 100, DEFAULT_SCORING_RULES.goalDef),
    goalMid: clampInt(rawScoring?.goalMid, 0, 100, DEFAULT_SCORING_RULES.goalMid),
    goalFwd: clampInt(rawScoring?.goalFwd, 0, 100, DEFAULT_SCORING_RULES.goalFwd),
    assist: clampInt(rawScoring?.assist, 0, 100, DEFAULT_SCORING_RULES.assist),
    cleanSheetGkDef: clampInt(
      rawScoring?.cleanSheetGkDef,
      0,
      100,
      DEFAULT_SCORING_RULES.cleanSheetGkDef,
    ),
    savesPerPoint: clampInt(
      rawScoring?.savesPerPoint,
      1,
      50,
      DEFAULT_SCORING_RULES.savesPerPoint,
    ),
    yellowCard: clampInt(rawScoring?.yellowCard, -100, 0, DEFAULT_SCORING_RULES.yellowCard),
    redCard: clampInt(rawScoring?.redCard, -100, 0, DEFAULT_SCORING_RULES.redCard),
    ownGoal: clampInt(rawScoring?.ownGoal, -100, 0, DEFAULT_SCORING_RULES.ownGoal),
    potmBonus: clampInt(rawScoring?.potmBonus, 0, 100, DEFAULT_SCORING_RULES.potmBonus),
    ratingBonus8Threshold: clampNum(
      rawScoring?.ratingBonus8Threshold,
      0,
      10,
      DEFAULT_SCORING_RULES.ratingBonus8Threshold,
    ),
    ratingBonus8Points: clampInt(
      rawScoring?.ratingBonus8Points,
      0,
      100,
      DEFAULT_SCORING_RULES.ratingBonus8Points,
    ),
    ratingBonus9Threshold: clampNum(
      rawScoring?.ratingBonus9Threshold,
      0,
      10,
      DEFAULT_SCORING_RULES.ratingBonus9Threshold,
    ),
    ratingBonus9Points: clampInt(
      rawScoring?.ratingBonus9Points,
      0,
      100,
      DEFAULT_SCORING_RULES.ratingBonus9Points,
    ),
    captainMultiplier: clampNum(
      rawScoring?.captainMultiplier,
      1,
      5,
      DEFAULT_SCORING_RULES.captainMultiplier,
    ),
  };

  // ── UI text & branding ──
  const rawUi = (row?.uiText ?? null) as Record<string, unknown> | null;
  const uiText = {
    appTitle: cleanText(rawUi?.appTitle, 60, APP_DEFAULTS.appTitle),
    appTagline: cleanText(rawUi?.appTagline, 120, APP_DEFAULTS.appTagline),
    maintenanceTitle: cleanText(
      rawUi?.maintenanceTitle,
      60,
      APP_DEFAULTS.maintenanceTitle,
    ),
    maintenanceMessage: cleanText(
      rawUi?.maintenanceMessage ?? row?.maintenanceMessage,
      400,
      APP_DEFAULTS.maintenanceMessage,
    ),
    // The handle is sanitised to a bare handle; the URL is always rebuilt
    // from it so a malicious value can never turn into a different link.
    instagramHandle: cleanText(
      rawUi?.instagramHandle,
      40,
      APP_DEFAULTS.instagramHandle,
    ).replace(/^@/, ""),
    year12Banner: cleanText(rawUi?.year12Banner, 80, APP_DEFAULTS.year12Banner),
    year12Message: cleanText(rawUi?.year12Message ?? row?.year12Message, 240, APP_DEFAULTS.year12Message),
    goldMedalText: cleanText(rawUi?.goldMedalText, 60, APP_DEFAULTS.goldMedalText),
    goldMedalHeadline: cleanText(
      rawUi?.goldMedalHeadline,
      120,
      APP_DEFAULTS.goldMedalHeadline,
    ),
    forfeitText: cleanText(rawUi?.forfeitText, 60, APP_DEFAULTS.forfeitText),
  };

  // Budget overrides — clamped into the admin's configured [min, max] window.
  // Values outside it (negative, NaN, over the ceiling) are dropped rather
  // than propagated.
  const budgetOverrides: Record<string, number> = {};
  const rawOverrides = row?.budgetOverrides;
  if (rawOverrides && typeof rawOverrides === "object" && !Array.isArray(rawOverrides)) {
    for (const [userId, value] of Object.entries(rawOverrides as Record<string, unknown>)) {
      const amount = toSafeAmount(value);
      if (!userId || userId.length > 64) continue;
      if (amount <= 0) continue;
      budgetOverrides[userId] = Math.min(
        Math.round(amount),
        marketRules.maxBudget,
      );
    }
  }

  return {
    isMaintenanceMode: row?.isMaintenanceMode === true,
    houseNames,
    houses,
    awardTitles,
    awards: awardDefs,
    badgeRegistry,
    budgetOverrides,
    marketRules,
    scoringRules,
    uiText,
    instagramUrl: `https://www.instagram.com/${encodeURIComponent(uiText.instagramHandle)}`,
    // Master switch. Absent means "editable" — a fresh database must never
    // lock every manager out of their own squad builder.
    editableSquads: row?.editableSquads !== false,
    tournamentEnded: row?.tournamentEnded === true,
    tournamentEndedAt:
      typeof row?.tournamentEndedAt === "number" && Number.isFinite(row.tournamentEndedAt)
        ? row.tournamentEndedAt
        : null,
    year12Message: uiText.year12Message,
  };
}

/**
 * Effective budget for one manager: their Super-Admin override if one is
 * set, otherwise the configured global default. Always finite, positive and
 * clamped to the admin's configured [min, max] window.
 */
export function resolveManagerBudget(
  settings: {
    budgetOverrides: Record<string, number>;
    marketRules?: { defaultBudget: number; minBudget: number; maxBudget: number };
  },
  userId: string | null | undefined,
): number {
  const fallback = settings.marketRules?.defaultBudget ?? DEFAULT_MARKET_RULES.defaultBudget;
  const min = settings.marketRules?.minBudget ?? DEFAULT_MARKET_RULES.minBudget;
  const max = settings.marketRules?.maxBudget ?? DEFAULT_MARKET_RULES.maxBudget;
  if (!userId) return fallback;
  const override = settings.budgetOverrides[userId];
  if (typeof override !== "number" || !Number.isFinite(override) || override <= 0) {
    return fallback;
  }
  return clampInt(override, min, max, fallback);
}

/** Upsert the singleton settings row with a partial patch. */
async function patchSettings(
  ctx: MutationCtx,
  patch: Record<string, unknown>,
): Promise<void> {
  const row = await getSettingsRow(ctx);
  if (row) {
    await ctx.db.patch(row._id, patch);
  } else {
    await ctx.db.insert("systemConfig", {
      isMaintenanceMode: false,
      ...patch,
    });
  }
}

/** Shared super-admin guard with a consistent, non-leaking message. */
async function requireSuperOrThrow(ctx: MutationCtx): Promise<void> {
  try {
    await requireSuperAdmin(ctx);
  } catch {
    throw new Error("Only the Super Admin can change tournament settings.");
  }
}

// ── Public reads ─────────────────────────────────────────────────────────

/**
 * The one query every page uses for global customization. ALWAYS returns a
 * fully-populated object — the client can write
 * `config?.houseNames?.[house] ?? house` without any further guarding.
 */
export const getAdminConfig = query({
  args: {},
  handler: async (ctx) => {
    try {
      return normalizeSettings(await getSettingsRow(ctx));
    } catch {
      // Last-resort literal defaults — identical to normalizeSettings(null).
      return normalizeSettings(null);
    }
  },
});

/** Convenience read: display name for a house (never undefined). */
export const getHouseName = query({
  args: { house: houseValidator },
  handler: async (ctx, { house }) => {
    try {
      const settings = normalizeSettings(await getSettingsRow(ctx));
      return settings.houseNames[house] ?? DEFAULT_HOUSE_NAMES[house] ?? house;
    } catch {
      return DEFAULT_HOUSE_NAMES[house] ?? house;
    }
  },
});

/** All house display names at once (used by badges, crests, standings). */
export const getHouseNames = query({
  args: {},
  handler: async (ctx) => {
    try {
      return normalizeSettings(await getSettingsRow(ctx)).houseNames;
    } catch {
      return { ...DEFAULT_HOUSE_NAMES };
    }
  },
});

// ── House names ──────────────────────────────────────────────────────────

/**
 * Super Admin: rename one or more houses. Keys must be real house ids and
 * values must be non-empty strings ≤24 chars. A partial patch merges with the
 * existing names — omitted houses keep their current value.
 */
export const setHouseNames = mutation({
  args: {
    houseNames: v.array(v.object({ house: houseValidator, name: v.string() })),
  },
  handler: async (ctx, { houseNames }) => {
    await requireSuperOrThrow(ctx);
    try {
      const entries = Array.isArray(houseNames) ? houseNames : [];
      if (entries.length === 0) throw new Error("Provide at least one house name.");
      const current = normalizeSettings(await getSettingsRow(ctx)).houseNames;
      for (const entry of entries) {
        const house = entry?.house;
        if (!house || !HOUSES.includes(house)) {
          throw new Error(`Unknown house "${String(house)}".`);
        }
        const name = typeof entry.name === "string" ? entry.name.trim() : "";
        if (name.length < 1 || name.length > 24) {
          throw new Error("House names must be 1-24 characters.");
        }
        current[house] = name;
      }
      await patchSettings(ctx, { houseNames: current });
      return { houseNames: current };
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Provide")) throw err;
      if (
        err instanceof Error &&
        (err.message.includes("House names") || err.message.includes("Unknown house"))
      ) {
        throw err;
      }
      throw new Error("Could not save the house names — please try again.");
    }
  },
});

// ── Award titles & descriptions ───────────────────────────────────────────

/**
 * Super Admin: customise award copy. Only the four known award keys are
 * accepted; unknown keys and over-long values are rejected with a clean error.
 */
export const setAwardTitles = mutation({
  args: {
    titles: v.array(
      v.object({
        key: v.string(),
        title: v.optional(v.string()),
        description: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { titles }) => {
    await requireSuperOrThrow(ctx);
    try {
      const list = Array.isArray(titles) ? titles : [];
      if (list.length === 0) throw new Error("Nothing to update.");
      const current = normalizeSettings(await getSettingsRow(ctx)).awardTitles;
      for (const entry of list) {
        const key = typeof entry.key === "string" ? entry.key.trim() : "";
        if (!(AWARD_KEYS as readonly string[]).includes(key)) {
          throw new Error(`Unknown award "${key}".`);
        }
        const typed = key as AwardKey;
        if (entry.title !== undefined) {
          const title = entry.title.trim();
          if (title.length < 1 || title.length > 40) {
            throw new Error("Award titles must be 1-40 characters.");
          }
          current[typed].title = title;
        }
        if (entry.description !== undefined) {
          const description = entry.description.trim();
          if (description.length < 1 || description.length > 160) {
            throw new Error("Award descriptions must be 1-160 characters.");
          }
          current[typed].description = description;
        }
      }
      await patchSettings(ctx, { awardTitles: current });
      return { awardTitles: current };
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("characters") || err.message.includes("Unknown award"))
      ) {
        throw err;
      }
      throw new Error("Could not save the award titles — please try again.");
    }
  },
});

// ── Custom badge registry ────────────────────────────────────────────────

/**
 * Super Admin: create or update a custom badge variant. `badgeId` is a
 * lowercase slug; it is what gets assigned to a user via
 * `usersAdmin.assignUserBadge`. Empty string deletes the custom entry.
 */
export const upsertCustomBadge = mutation({
  args: {
    badgeId: v.string(),
    emoji: v.optional(v.string()),
    label: v.optional(v.string()),
    tone: v.optional(v.string()),
  },
  handler: async (ctx, { badgeId, emoji, label, tone }) => {
    await requireSuperOrThrow(ctx);
    try {
      const id = typeof badgeId === "string" ? badgeId.trim().toLowerCase() : "";
      if (!/^[a-z0-9_]{2,24}$/.test(id)) {
        throw new Error("Badge ID must be 2-24 characters: a-z, 0-9 or _");
      }
      if (id in DEFAULT_BADGE_REGISTRY) {
        throw new Error("That's a built-in badge — edit the copy instead.");
      }
      const registry = normalizeSettings(await getSettingsRow(ctx)).badgeRegistry;
      const existing = registry[id];

      if (emoji === undefined && label === undefined && tone === undefined) {
        // No fields supplied → delete.
        delete registry[id];
        await patchSettings(ctx, { badgeRegistry: registry });
        return { badgeId: id, deleted: true };
      }

      const nextEmoji =
        typeof emoji === "string" && emoji.trim().length > 0 && emoji.length <= 8
          ? emoji.trim()
          : (existing?.emoji ?? "🏅");
      const nextLabel =
        typeof label === "string" && label.trim().length > 0 && label.length <= 24
          ? label.trim()
          : (existing?.label ?? id);
      const nextTone =
        typeof tone === "string" && tone.trim().length > 0 && tone.length <= 16
          ? tone.trim()
          : (existing?.tone ?? "amber");

      registry[id] = { emoji: nextEmoji, label: nextLabel, tone: nextTone };
      await patchSettings(ctx, { badgeRegistry: registry });
      return { badgeId: id, deleted: false, badge: registry[id] };
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("Badge ID") || err.message.includes("built-in"))
      ) {
        throw err;
      }
      throw new Error("Could not save the badge — please try again.");
    }
  },
});

/** Super Admin: list every badge that can be assigned (built-in + custom). */
export const listAssignableBadges = query({
  args: {},
  handler: async (ctx) => {
    try {
      const registry = normalizeSettings(await getSettingsRow(ctx)).badgeRegistry;
      return Object.entries(registry)
        .map(([id, meta]) => ({ id, ...meta }))
        .sort((a, b) => a.label.localeCompare(b.label));
    } catch {
      return Object.entries(DEFAULT_BADGE_REGISTRY).map(([id, meta]) => ({ id, ...meta }));
    }
  },
});

// ── Per-manager budget overrides ─────────────────────────────────────────

/**
 * Super Admin: set (or clear) one manager's budget override, clamped into the
 * configured [minBudget, maxBudget] window (defaults $5m–$80m).
 */
export const setBudgetOverride = mutation({
  args: { userId: v.id("users"), budget: v.optional(v.number()) },
  handler: async (ctx, { userId, budget }) => {
    await requireSuperOrThrow(ctx);
    try {
      const user = await ctx.db.get(userId);
      if (!user) throw new Error("User not found.");
      const settings = normalizeSettings(await getSettingsRow(ctx));
      const overrides = settings.budgetOverrides;
      if (budget === undefined || budget === null) {
        delete overrides[String(userId)]; // clear → back to the global default
      } else {
        const amount = toSafeAmount(budget);
        if (amount <= 0) {
          throw new Error("Budget must be greater than zero.");
        }
        overrides[String(userId)] = Math.min(
          Math.round(amount),
          settings.marketRules.maxBudget,
        );
      }
      await patchSettings(ctx, { budgetOverrides: overrides });
      await audit(
        ctx,
        "set_budget_override",
        "user",
        user.username ?? String(userId),
        budget == null
          ? "Cleared override → global default"
          : `Budget override set to ${overrides[String(userId)]}`,
      );
      return {
        userId,
        budget: resolveManagerBudget(settings, String(userId)),
        hasOverride: overrides[String(userId)] !== undefined,
      };
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("User not found") || err.message.includes("greater than zero"))
      ) {
        throw err;
      }
      throw new Error("Could not set the budget override — please try again.");
    }
  },
});

// ── House branding (name + color + logo + motto) ─────────────────────────

/** Super Admin: update the full brand block for one or more houses. */
export const setHouseBranding = mutation({
  args: {
    entries: v.array(
      v.object({
        house: houseValidator,
        name: v.optional(v.string()),
        color: v.optional(v.string()),
        logoUrl: v.optional(v.string()),
        motto: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { entries }) => {
    await requireSuperOrThrow(ctx);
    try {
      const list = Array.isArray(entries) ? entries : [];
      if (list.length === 0) throw new Error("Nothing to update.");
      const settings = normalizeSettings(await getSettingsRow(ctx));
      const changed: string[] = [];
      for (const entry of list) {
        const house = entry?.house;
        if (!house || !HOUSES.includes(house)) {
          throw new Error(`Unknown house "${String(house)}".`);
        }
        const current = settings.houses[house];
        const next: HouseBrand = { ...current };
        if (entry.name !== undefined) {
          const name = cleanText(entry.name, 24, "");
          if (name.length === 0) throw new Error("House names must be 1-24 characters.");
          next.name = name;
        }
        if (entry.color !== undefined) {
          if (!isHexColor(entry.color)) {
            throw new Error('Colors must be a hex code like "#e64530".');
          }
          next.color = entry.color.trim();
        }
        if (entry.logoUrl !== undefined) {
          // cleanUrl drops anything that isn't http(s)/data:image — this is
          // what stops `javascript:` from reaching an <img src>.
          next.logoUrl = cleanUrl(entry.logoUrl);
        }
        if (entry.motto !== undefined) {
          next.motto = cleanText(entry.motto, 120, DEFAULT_HOUSES[house].motto);
        }
        settings.houses[house] = next;
        changed.push(house);
      }
      await patchSettings(ctx, {
        houses: settings.houses,
        houseNames: Object.fromEntries(
          HOUSES.map((h) => [h, settings.houses[h].name]),
        ),
      });
      await audit(ctx, "set_house_branding", "config", changed.join(", "));
      return { houses: settings.houses };
    } catch (err) {
      if (err instanceof Error && /Unknown house|must be|Colors must/.test(err.message)) {
        throw err;
      }
      throw new Error("Could not save the house branding — please try again.");
    }
  },
});

// ── Award definitions (title + icon + description + threshold) ──────────

/** Super Admin: update award definitions, including icons and thresholds. */
export const setAwardDefs = mutation({
  args: {
    entries: v.array(
      v.object({
        key: v.string(),
        title: v.optional(v.string()),
        icon: v.optional(v.string()),
        description: v.optional(v.string()),
        threshold: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { entries }) => {
    await requireSuperOrThrow(ctx);
    try {
      const list = Array.isArray(entries) ? entries : [];
      if (list.length === 0) throw new Error("Nothing to update.");
      const settings = normalizeSettings(await getSettingsRow(ctx));
      for (const entry of list) {
        const key = cleanBadgeId(entry?.key);
        if (!key) throw new Error("Unknown award key.");
        if (entry.title !== undefined) {
          const t = cleanText(entry.title, 40, "");
          if (t.length === 0) throw new Error("Award titles must be 1-40 characters.");
          settings.awards[key].title = t;
        }
        if (entry.icon !== undefined) {
          settings.awards[key].icon = cleanText(entry.icon, 8, settings.awards[key].icon);
        }
        if (entry.description !== undefined) {
          settings.awards[key].description = cleanText(
            entry.description,
            160,
            settings.awards[key].description,
          );
        }
        if (entry.threshold !== undefined) {
          settings.awards[key].threshold = clampNum(entry.threshold, 0, 100_000, 0);
        }
        // Keep the legacy flat copy in sync for older consumers.
        if (key in settings.awardTitles) {
          settings.awardTitles[key as AwardKey] = {
            title: settings.awards[key].title,
            description: settings.awards[key].description,
          };
        }
      }
      await patchSettings(ctx, {
        awards: settings.awards,
        awardTitles: settings.awardTitles,
      });
      await audit(ctx, "set_award_defs", "config", list.map((e) => e.key).join(", "));
      return { awards: settings.awards };
    } catch (err) {
      if (err instanceof Error && /Unknown award|must be/.test(err.message)) throw err;
      throw new Error("Could not save the award definitions — please try again.");
    }
  },
});

// ── Market & budget rules ────────────────────────────────────────────────

/** Super Admin: edit the global default budget, price caps and GW timers. */
export const setMarketRules = mutation({
  args: {
    defaultBudget: v.optional(v.number()),
    maxBudget: v.optional(v.number()),
    minBudget: v.optional(v.number()),
    minPlayerPrice: v.optional(v.number()),
    maxPlayerPrice: v.optional(v.number()),
    maxTransfersPerGameweek: v.optional(v.number()),
    panicThresholdMinutes: v.optional(v.number()),
    houseLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSuperOrThrow(ctx);
    try {
      const current = normalizeSettings(await getSettingsRow(ctx)).marketRules;
      const next = { ...current };
      if (args.minBudget !== undefined) {
        next.minBudget = clampInt(args.minBudget, 1_000_000, DEFAULT_MARKET_RULES.maxBudget, current.minBudget);
      }
      if (args.maxBudget !== undefined) {
        next.maxBudget = clampInt(args.maxBudget, DEFAULT_MARKET_RULES.minBudget, 500_000_000, current.maxBudget);
      }
      if (args.defaultBudget !== undefined) {
        next.defaultBudget = clampInt(args.defaultBudget, next.minBudget, next.maxBudget, current.defaultBudget);
      }
      if (args.minPlayerPrice !== undefined) {
        next.minPlayerPrice = clampInt(args.minPlayerPrice, 0, 1_000_000_000, current.minPlayerPrice);
      }
      if (args.maxPlayerPrice !== undefined) {
        next.maxPlayerPrice = clampInt(args.maxPlayerPrice, 1_000_000, 1_000_000_000, current.maxPlayerPrice);
      }
      next.minPlayerPrice = Math.min(next.minPlayerPrice, next.maxPlayerPrice);
      if (args.maxTransfersPerGameweek !== undefined) {
        next.maxTransfersPerGameweek = clampInt(args.maxTransfersPerGameweek, 0, 50, current.maxTransfersPerGameweek);
      }
      if (args.panicThresholdMinutes !== undefined) {
        next.panicThresholdMinutes = clampInt(args.panicThresholdMinutes, 1, 1440, current.panicThresholdMinutes);
      }
      if (args.houseLimit !== undefined) {
        next.houseLimit = clampInt(args.houseLimit, 1, 7, current.houseLimit);
      }
      await patchSettings(ctx, {
        marketRules: next,
        // Keep the legacy singleton config row in sync so any older reader
        // (which still reads CONFIG_KEYS.BUDGET) sees the same number.
        ...(next.defaultBudget !== current.defaultBudget ? { budgetRow: next.defaultBudget } : {}),
      });
      await patchConfigBudget(ctx, next.defaultBudget);
      await audit(
        ctx,
        "set_market_rules",
        "config",
        undefined,
        `default ${next.defaultBudget}, price ${next.minPlayerPrice}–${next.maxPlayerPrice}, panic ${next.panicThresholdMinutes}m`,
      );
      return { marketRules: next };
    } catch {
      throw new Error("Could not save the market rules — please try again.");
    }
  },
});

/** Mirror the configured default budget into the legacy `config` table. */
async function patchConfigBudget(ctx: MutationCtx, budget: number): Promise<void> {
  try {
    const existing = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", "budget"))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { value: budget });
    } else {
      await ctx.db.insert("config", { key: "budget", value: budget });
    }
  } catch {
    // legacy mirror is best-effort — the systemConfig value is authoritative
  }
}

// ── Scoring rule matrix ─────────────────────────────────────────────────

/** Super Admin: retune the entire scoring matrix. */
export const setScoringRules = mutation({
  args: { rules: v.record(v.string(), v.number()) },
  handler: async (ctx, { rules }) => {
    await requireSuperOrThrow(ctx);
    try {
      if (!rules || typeof rules !== "object") {
        throw new Error("No scoring rules supplied.");
      }
      const raw = rules as Record<string, unknown>;
      const current = normalizeSettings(await getSettingsRow(ctx)).scoringRules;
      const next: ScoringRules = {
        goalGk: clampInt(raw.goalGk, 0, 100, current.goalGk),
        goalDef: clampInt(raw.goalDef, 0, 100, current.goalDef),
        goalMid: clampInt(raw.goalMid, 0, 100, current.goalMid),
        goalFwd: clampInt(raw.goalFwd, 0, 100, current.goalFwd),
        assist: clampInt(raw.assist, 0, 100, current.assist),
        cleanSheetGkDef: clampInt(raw.cleanSheetGkDef, 0, 100, current.cleanSheetGkDef),
        // Division guard: a 0 here would be a divide-by-zero crash in scoring.
        savesPerPoint: clampInt(raw.savesPerPoint, 1, 50, current.savesPerPoint),
        yellowCard: clampInt(raw.yellowCard, -100, 0, current.yellowCard),
        redCard: clampInt(raw.redCard, -100, 0, current.redCard),
        ownGoal: clampInt(raw.ownGoal, -100, 0, current.ownGoal),
        potmBonus: clampInt(raw.potmBonus, 0, 100, current.potmBonus),
        ratingBonus8Threshold: clampNum(raw.ratingBonus8Threshold, 0, 10, current.ratingBonus8Threshold),
        ratingBonus8Points: clampInt(raw.ratingBonus8Points, 0, 100, current.ratingBonus8Points),
        ratingBonus9Threshold: clampNum(raw.ratingBonus9Threshold, 0, 10, current.ratingBonus9Threshold),
        ratingBonus9Points: clampInt(raw.ratingBonus9Points, 0, 100, current.ratingBonus9Points),
        captainMultiplier: clampNum(raw.captainMultiplier, 1, 5, current.captainMultiplier),
      };
      await patchSettings(ctx, { scoringRules: next });
      await audit(
        ctx,
        "set_scoring_rules",
        "config",
        undefined,
        `GK/DEF ${next.goalGk}, MID ${next.goalMid}, FWD ${next.goalFwd}, captain ×${next.captainMultiplier}`,
      );
      return { scoringRules: next };
    } catch (err) {
      if (err instanceof Error && err.message.includes("No scoring rules")) throw err;
      throw new Error("Could not save the scoring rules — please try again.");
    }
  },
});

// ── UI text & branding ──────────────────────────────────────────────────

/** Super Admin: edit every piece of user-facing copy. */
export const setUiText = mutation({
  args: {
    appTitle: v.optional(v.string()),
    appTagline: v.optional(v.string()),
    maintenanceTitle: v.optional(v.string()),
    maintenanceMessage: v.optional(v.string()),
    instagramHandle: v.optional(v.string()),
    year12Banner: v.optional(v.string()),
    year12Message: v.optional(v.string()),
    goldMedalText: v.optional(v.string()),
    goldMedalHeadline: v.optional(v.string()),
    forfeitText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSuperOrThrow(ctx);
    try {
      const current = normalizeSettings(await getSettingsRow(ctx)).uiText;
      const next = {
        appTitle: args.appTitle !== undefined ? cleanText(args.appTitle, 60, current.appTitle) : current.appTitle,
        appTagline: args.appTagline !== undefined ? cleanText(args.appTagline, 120, current.appTagline) : current.appTagline,
        maintenanceTitle: args.maintenanceTitle !== undefined ? cleanText(args.maintenanceTitle, 60, current.maintenanceTitle) : current.maintenanceTitle,
        maintenanceMessage: args.maintenanceMessage !== undefined ? cleanText(args.maintenanceMessage, 400, current.maintenanceMessage) : current.maintenanceMessage,
        instagramHandle: args.instagramHandle !== undefined ? cleanText(args.instagramHandle, 40, current.instagramHandle).replace(/^@/, "") : current.instagramHandle,
        year12Banner: args.year12Banner !== undefined ? cleanText(args.year12Banner, 80, current.year12Banner) : current.year12Banner,
        year12Message: args.year12Message !== undefined ? cleanText(args.year12Message, 240, current.year12Message) : current.year12Message,
        goldMedalText: args.goldMedalText !== undefined ? cleanText(args.goldMedalText, 60, current.goldMedalText) : current.goldMedalText,
        goldMedalHeadline: args.goldMedalHeadline !== undefined ? cleanText(args.goldMedalHeadline, 120, current.goldMedalHeadline) : current.goldMedalHeadline,
        forfeitText: args.forfeitText !== undefined ? cleanText(args.forfeitText, 60, current.forfeitText) : current.forfeitText,
      };
      await patchSettings(ctx, { uiText: next, year12Message: next.year12Message });
      await audit(ctx, "set_ui_text", "config", undefined, `Title: "${next.appTitle}"`);
      return { uiText: next };
    } catch {
      throw new Error("Could not save the UI text — please try again.");
    }
  },
});

/**
 * Super Admin master switch: force the Squad Builder into read-only mode
 * for every manager (or allow it back).
 */
export const setMasterReadOnly = mutation({
  args: { editable: v.boolean() },
  handler: async (ctx, { editable }) => {
    await requireSuperOrThrow(ctx);
    try {
      const isEditable = editable === true;
      await patchSettings(ctx, { editableSquads: isEditable });
      await audit(
        ctx,
        "set_master_read_only",
        "config",
        undefined,
        isEditable ? "Squad builder opened" : "Squad builder locked platform-wide",
      );
      return { editableSquads: isEditable };
    } catch {
      throw new Error("Could not change the squad builder mode — please try again.");
    }
  },
});

// ── Tournament lifecycle + Year 12 copy ──────────────────────────────────

/**
 * Super Admin: end (or reopen) the entire tournament. Ending locks every
 * gameweek so no further transfers or edits are possible, and flips the
 * dashboard into the "See you in Year 12!" celebration state.
 */
export const setTournamentEnded = mutation({
  args: { ended: v.boolean() },
  handler: async (ctx, { ended }) => {
    await requireSuperOrThrow(ctx);
    try {
      const isEnded = ended === true;
      await patchSettings(ctx, {
        tournamentEnded: isEnded,
        tournamentEndedAt: isEnded ? Date.now() : undefined,
      });
      // Ending the tournament locks every stage so nothing can change after
      // the podium is published.
      const gwRows = await ctx.db.query("gameweeks").collect();
      for (const stage of ["semifinal1", "semifinal2", "third_place", "final"] as const) {
        const row = gwRows.find((r) => r.stage === stage);
        if (row) {
          await ctx.db.patch(row._id, { locked: true });
        } else {
          await ctx.db.insert("gameweeks", { stage, locked: true });
        }
      }
      return { tournamentEnded: isEnded };
    } catch {
      throw new Error(
        ended === true
          ? "Could not end the tournament — please try again."
          : "Could not reopen the tournament — please try again.",
      );
    }
  },
});

/** Super Admin: customise the Year 12 celebration headline. */
export const setYear12Message = mutation({
  args: { message: v.string() },
  handler: async (ctx, { message }) => {
    await requireSuperOrThrow(ctx);
    try {
      const trimmed = typeof message === "string" ? message.trim() : "";
      if (trimmed.length > 240) {
        throw new Error("Message must be 240 characters or fewer.");
      }
      await patchSettings(ctx, {
        year12Message: trimmed === "" ? undefined : trimmed,
      });
      return { year12Message: trimmed === "" ? DEFAULT_YEAR12_MESSAGE : trimmed };
    } catch (err) {
      if (err instanceof Error && err.message.includes("240 characters")) throw err;
      throw new Error("Could not save the message — please try again.");
    }
  },
});

// ── Internal helpers for the maintenance gate + awards engine ───────────

/** Internal: the singleton row's id, or null. Used by the maintenance gate. */
export const getSettingsRowId = internalQuery({
  args: {},
  handler: async (ctx) => {
    try {
      return (await getSettingsRow(ctx))?._id ?? null;
    } catch {
      return null;
    }
  },
});

/**
 * Internal: rewrite the award snapshot. Called by `recalculateAwards` after
 * every match update — never throws, because a failed award refresh must not
 * roll back the match itself.
 */
export const writeAwardSnapshot = internalMutation({
  args: { patch: v.any() },
  handler: async (ctx, { patch }) => {
    try {
      if (!patch || typeof patch !== "object") return { written: false };
      const rows = await ctx.db.query("awards").collect();
      const existing = rows[0];
      const doc = { ...(patch as Record<string, unknown>), updatedAt: Date.now() };
      if (existing) {
        await ctx.db.patch(existing._id, doc as never);
        // Explicitly unset any winner the new computation did not produce.
        const winnerKeys = [
          "tacticalGeniusUserId",
          "tacticalGeniusName",
          "tacticalGeniusTeam",
          "tacticalGeniusPoints",
          "unluckyUserId",
          "unluckyName",
          "unluckyTeam",
          "unluckyPoints",
          "differentialUserId",
          "differentialName",
          "differentialTeam",
          "differentialPoints",
          "playerOfWeekId",
          "playerOfWeekName",
          "playerOfWeekHouse",
          "playerOfWeekPoints",
        ];
        const unset: Record<string, undefined> = {};
        for (const key of winnerKeys) {
          if ((doc as Record<string, unknown>)[key] === undefined) unset[key] = undefined;
        }
        if (Object.keys(unset).length > 0) {
          await ctx.db.patch(existing._id, unset as never);
        }
      } else {
        await ctx.db.insert("awards", doc as never);
      }
      return { written: true };
    } catch {
      return { written: false };
    }
  },
});

/** Internal: read the stored award snapshot (null when never computed). */
export const readAwardSnapshot = internalQuery({
  args: {},
  handler: async (ctx) => {
    try {
      const rows = await ctx.db.query("awards").collect();
      return rows[0] ?? null;
    } catch {
      return null;
    }
  },
});

/** Internal: the settings row typed for other modules' budget resolution. */
export const getSettingsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    try {
      return normalizeSettings(await getSettingsRow(ctx));
    } catch {
      return normalizeSettings(null);
    }
  },
});

/** Convenience re-exports so other modules don't re-derive the defaults. */
export { DEFAULT_MARKET_RULES, DEFAULT_SCORING_RULES, DEFAULT_HOUSES, DEFAULT_AWARDS };
export type { Id };
