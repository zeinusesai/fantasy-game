import type { QueryCtx, MutationCtx } from "./_generated/server";
import { internalQuery, internalMutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { DEFAULT_CONFIG, CONFIG_KEYS, FIXED_MANAGER_BUDGET } from "./configDefaults";
import {
  DEFAULT_PITCH_THEME,
  PREMIUM_PITCH_THEME,
  THEME_ITEM_ID,
} from "./pitchThemes";
import type { Doc, Id } from "./_generated/dataModel";

export const getUserIdByUsername = internalQuery({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
    return user?._id ?? null;
  },
});

export type PlatformUser = Doc<"users">;

/**
 * Store cosmetics a manager currently has switched ON, for rendering their
 * pitch / jersey anywhere it is inspected (own profile, Dashboard, Leaderboard
 * rival inspector, ProfileModal).
 *
 * Derived from `storeEntitlements`, which is the single source of truth for
 * store perks, so a grant or a toggle updates every client reactively. The
 * Super Admin auto-owns every cosmetic.
 *
 * TOTAL: any failure — missing table, corrupt row, db hiccup — degrades to
 * "no cosmetics" instead of throwing, so a cosmetic lookup can never crash a
 * page or a query subscription.
 */
export async function readUserCosmetics(ctx: QueryCtx, user: Doc<"users">) {
  const none = {
    activePitchTheme: DEFAULT_PITCH_THEME,
    hasGoldenJersey: false,
    hasProfileBorder: false,
    hasCustomTitle: false,
  } as const;
  if (user.role === "super_admin") {
    return {
      activePitchTheme: PREMIUM_PITCH_THEME,
      hasGoldenJersey: true,
      hasProfileBorder: true,
      hasCustomTitle: true,
    } as const;
  }
  try {
    const rows = await ctx.db
      .query("storeEntitlements")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const enabled = (itemId: string) =>
      rows.some((r) => r.itemId === itemId && r.enabled === true);
    const premium = enabled(THEME_ITEM_ID);
    return {
      activePitchTheme: premium ? PREMIUM_PITCH_THEME : DEFAULT_PITCH_THEME,
      hasGoldenJersey: premium,
      hasProfileBorder: enabled("profile_border"),
      hasCustomTitle: enabled("custom_title"),
    };
  } catch {
    return none;
  }
}

/**
 * Platform-wide settings. The budget is FIXED at $70m for every manager, so
 * it is returned from the constant rather than from any stored config row —
 * a stale or tampered `config` row can never raise or lower the cap.
 */
export async function getPlatformConfig(ctx: QueryCtx | MutationCtx) {
  const rows = await ctx.db.query("config").collect();
  const houseRow = rows.find((r) => r.key === CONFIG_KEYS.HOUSE_LIMIT);
  return {
    budget: FIXED_MANAGER_BUDGET,
    houseLimit:
      typeof houseRow?.value === "number" ? houseRow.value : DEFAULT_CONFIG.houseLimit,
  };
}

export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Must be signed in.");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Account no longer exists.");
  return user;
}

export async function requireSuperAdmin(ctx: QueryCtx | MutationCtx) {
  const user = await requireUser(ctx);
  if (user.role !== "super_admin") {
    throw new Error("Only the Super Admin can perform this action.");
  }
  return user;
}

export async function requireAdmin(ctx: QueryCtx | MutationCtx) {
  const user = await requireUser(ctx);
  if (user.role !== "super_admin" && user.role !== "moderator") {
    throw new Error("Only admins can perform this action.");
  }
  return user;
}

/**
 * Internal: deletes a user and everything tied to them — password auth
 * accounts, their fantasy squad, per-match score rows and price requests —
 * so no orphaned records are left behind (admin tooling).
 */
export const deleteUserAndAccount = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", userId).eq("provider", "password"),
      )
      .collect();
    for (const a of accounts) await ctx.db.delete(a._id);

    // Cascade: the user's squad (if any) — prevents orphaned squads.
    const squad = await getSquadForUser(ctx, userId);
    if (squad) await ctx.db.delete(squad._id);

    // Cascade: per-match fantasy score rows belonging to the user.
    const scores = await ctx.db
      .query("matchScores")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const s of scores) await ctx.db.delete(s._id);

    // Cascade: price requests submitted by the user.
    const requests = await ctx.db
      .query("priceRequests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const r of requests) await ctx.db.delete(r._id);

    await ctx.db.delete(userId);
    return {
      accounts: accounts.length,
      squadDeleted: squad !== null,
      scoresDeleted: scores.length,
      requestsDeleted: requests.length,
    };
  },
});

export async function getSquadForUser(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  return ctx.db
    .query("squads")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

export type SquadPointsRow = { squadId: Id<"squads">; userId: Id<"users">; total: number; lastMatch: number | null };

/** Aggregated fantasy points across every completed match. */
export async function getLeaderboardRows(ctx: QueryCtx | MutationCtx) {
  const squads = await ctx.db.query("squads").collect();
  const scores = await ctx.db.query("matchScores").collect();
  let lastMatchId: Id<"matches"> | null = null;
  for (const s of scores) {
    if (lastMatchId === null || s.matchId > lastMatchId) lastMatchId = s.matchId;
  }

  const bySquad = new Map<string, { total: number; lastMatch: number | null }>();
  for (const s of scores) {
    const cur = bySquad.get(s.squadId) ?? { total: 0, lastMatch: null as number | null };
    cur.total += s.points;
    if (lastMatchId !== null && s.matchId === lastMatchId) {
      cur.lastMatch = (cur.lastMatch ?? 0) + s.points;
    }
    bySquad.set(s.squadId, cur);
  }

  const rows: SquadPointsRow[] = squads.map((squad) => {
    const agg = bySquad.get(squad._id) ?? { total: 0, lastMatch: null };
    return {
      squadId: squad._id,
      userId: squad.userId,
      total: agg.total,
      lastMatch: agg.lastMatch,
    };
  });
  rows.sort((a, b) => b.total - a.total);
  return rows;
}
