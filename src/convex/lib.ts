import type { QueryCtx, MutationCtx } from "./_generated/server";
import { internalQuery, internalMutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { DEFAULT_CONFIG, CONFIG_KEYS } from "./configDefaults";
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

export async function getPlatformConfig(ctx: QueryCtx | MutationCtx) {
  const rows = await ctx.db.query("config").collect();
  const budgetRow = rows.find((r) => r.key === CONFIG_KEYS.BUDGET);
  const houseRow = rows.find((r) => r.key === CONFIG_KEYS.HOUSE_LIMIT);
  return {
    budget:
      typeof budgetRow?.value === "number" ? budgetRow.value : DEFAULT_CONFIG.budget,
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

/** Internal: deletes a user and their password auth account (admin tooling). */
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
    await ctx.db.delete(userId);
    return { accounts: accounts.length };
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
