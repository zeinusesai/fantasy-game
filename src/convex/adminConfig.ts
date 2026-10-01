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
import { FIXED_MANAGER_BUDGET, toSafeAmount } from "./configDefaults";
import { houseValidator, HOUSES } from "./schema";
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

export const DEFAULT_HOUSE_NAMES: Record<string, string> = {
  Fire: "Fire",
  Earth: "Earth",
  Wind: "Wind",
  Water: "Water",
};

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
> = {
  star: { emoji: "⭐", label: "Star", tone: "amber" },
  gold_checkmark: { emoji: "✅", label: "Gold Checkmark", tone: "amber" },
  fire: { emoji: "🔥", label: "Fire", tone: "orange" },
  crown: { emoji: "👑", label: "Crown", tone: "yellow" },
  shield: { emoji: "🛡️", label: "Shield", tone: "sky" },
  diamond: { emoji: "💎", label: "Diamond", tone: "cyan" },
  contributor: { emoji: "💡", label: "Idea Contributor", tone: "sky" },
};

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
 */
export function normalizeSettings(row: {
  isMaintenanceMode?: boolean;
  houseNames?: unknown;
  awardTitles?: unknown;
  badgeRegistry?: unknown;
  budgetOverrides?: unknown;
  tournamentEnded?: boolean;
  tournamentEndedAt?: number;
  year12Message?: string;
} | null) {
  // House names — only accept a plain object of non-empty strings.
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

  // Award copy — per-key { title, description }, each independently defaulted.
  const awardTitles = {} as Record<AwardKey, { title: string; description: string }>;
  const rawAwards = row?.awardTitles;
  for (const key of AWARD_KEYS) {
    const fallback = DEFAULT_AWARD_TITLES[key];
    const entry =
      rawAwards && typeof rawAwards === "object" && !Array.isArray(rawAwards)
        ? (rawAwards as Record<string, unknown>)[key]
        : undefined;
    if (entry && typeof entry === "object" && entry !== null) {
      const e = entry as { title?: unknown; description?: unknown };
      awardTitles[key] = {
        title:
          typeof e.title === "string" && e.title.trim().length > 0 && e.title.length <= 40
            ? e.title.trim()
            : fallback.title,
        description:
          typeof e.description === "string" &&
          e.description.trim().length > 0 &&
          e.description.length <= 160
            ? e.description.trim()
            : fallback.description,
      };
    } else {
      awardTitles[key] = fallback;
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

  // Budget overrides — only finite, non-negative, capped-at-70m numbers with
  // an id-shaped key survive. Anything else is dropped rather than propagated.
  const budgetOverrides: Record<string, number> = {};
  const rawOverrides = row?.budgetOverrides;
  if (rawOverrides && typeof rawOverrides === "object" && !Array.isArray(rawOverrides)) {
    for (const [userId, value] of Object.entries(rawOverrides as Record<string, unknown>)) {
      const amount = toSafeAmount(value);
      if (!userId || userId.length > 64) continue;
      if (amount <= 0) continue;
      budgetOverrides[userId] = Math.min(Math.round(amount), FIXED_MANAGER_BUDGET);
    }
  }

  return {
    isMaintenanceMode: row?.isMaintenanceMode === true,
    houseNames,
    awardTitles,
    badgeRegistry,
    budgetOverrides,
    tournamentEnded: row?.tournamentEnded === true,
    tournamentEndedAt:
      typeof row?.tournamentEndedAt === "number" && Number.isFinite(row.tournamentEndedAt)
        ? row.tournamentEndedAt
        : null,
    year12Message:
      typeof row?.year12Message === "string" && row.year12Message.trim().length > 0
        ? row.year12Message.trim().slice(0, 240)
        : DEFAULT_YEAR12_MESSAGE,
  };
}

/**
 * Effective budget for one manager: their Super-Admin override if one is
 * set, otherwise the fixed platform budget. Never NaN/Infinity/negative.
 */
export function resolveManagerBudget(
  settings: { budgetOverrides: Record<string, number> },
  userId: string | null | undefined,
): number {
  if (!userId) return FIXED_MANAGER_BUDGET;
  const override = settings.budgetOverrides[userId];
  if (typeof override !== "number" || !Number.isFinite(override) || override <= 0) {
    return FIXED_MANAGER_BUDGET;
  }
  return Math.min(Math.round(override), FIXED_MANAGER_BUDGET);
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
 * Super Admin: set (or clear) one manager's budget override. The value is
 * capped at the fixed $70m platform budget — an override can lower a
 * manager's budget but never raise it above the global cap.
 */
export const setBudgetOverride = mutation({
  args: { userId: v.id("users"), budget: v.optional(v.number()) },
  handler: async (ctx, { userId, budget }) => {
    await requireSuperOrThrow(ctx);
    try {
      const user = await ctx.db.get(userId);
      if (!user) throw new Error("User not found.");
      const overrides = normalizeSettings(await getSettingsRow(ctx)).budgetOverrides;
      if (budget === undefined || budget === null) {
        delete overrides[String(userId)]; // clear → back to the fixed $70m
      } else {
        const amount = toSafeAmount(budget);
        if (amount <= 0) {
          throw new Error("Budget must be greater than zero.");
        }
        overrides[String(userId)] = Math.min(Math.round(amount), FIXED_MANAGER_BUDGET);
      }
      await patchSettings(ctx, { budgetOverrides: overrides });
      return {
        userId,
        budget: resolveManagerBudget({ budgetOverrides: overrides }, String(userId)),
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

/** Convenience export so other modules don't re-derive the cap. */
export { FIXED_MANAGER_BUDGET };
export type { Id };
