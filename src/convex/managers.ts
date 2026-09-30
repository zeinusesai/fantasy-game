import { v } from "convex/values";
import { query, mutation } from "./_generated/server";import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { normalizeUsername } from "./configDefaults";
import {
  requireUser,
  getPlatformConfig,
  getLeaderboardRows,
} from "./lib";

/** App bootstrap: seeds the pre-registered admin accounts (idempotent). */
export const bootstrap = mutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.seedAdmins.ensureSeedAdmins, {});
  },
});

/** Public query so the client can confirm seeding ran (used on app load). */
export const getUsernameExists = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", normalizeUsername(username)))
      .unique();
    return user !== null;
  },
});

export const getUserByUsername = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    return ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
  },
});

// ── Profile ──────────────────────────────────────────────────────────────

export const updateProfile = mutation({
  args: {
    teamName: v.string(),
    avatar: v.optional(v.string()),
  },
  handler: async (ctx, { teamName, avatar }) => {
    const user = await requireUser(ctx);
    const trimmed = teamName.trim();
    if (trimmed.length < 2 || trimmed.length > 40) {
      throw new Error("Team name must be 2-40 characters.");
    }
    await ctx.db.patch(user._id, {
      teamName: trimmed,
      ...(avatar !== undefined ? { image: avatar || undefined } : {}),
    });
  },
});

// ── Global fantasy leaderboard ───────────────────────────────────────────

export const getLeaderboard = query({
  args: {},
  handler: async (ctx) => {
    const rows = await getLeaderboardRows(ctx);
    const users = await ctx.db.query("users").collect();
    const byId = new Map(users.map((u) => [u._id, u]));
    return rows.map((row, i) => {
      const user = byId.get(row.userId);
      return {
        rank: i + 1,
        userId: row.userId,
        username: user?.username ?? "?",
        teamName: user?.teamName ?? "Unnamed team",
        avatar: user?.image ?? null,
        totalPoints: row.total,
        lastMatchPoints: row.lastMatch ?? 0,
      };
    });
  },
});

// ── Tournament leaders (golden boot / playmaker) ─────────────────────────

export const getTournamentLeaders = query({
  args: {},
  handler: async (ctx) => {
    const matchPlayers = await ctx.db.query("matchPlayers").collect();
    const players = await ctx.db.query("players").collect();
    const byId = new Map(players.map((p) => [p._id, p]));

    const goals = new Map<string, { goals: number; assists: number }>();
    for (const mp of matchPlayers) {
      const cur = goals.get(mp.playerId) ?? { goals: 0, assists: 0 };
      cur.goals += mp.goals;
      cur.assists += mp.assists;
      goals.set(mp.playerId, cur);
    }

    const scorers = [...goals.entries()]
      .map(([playerId, agg]) => ({
        player: byId.get(playerId as Id<"players">) ?? null,
        playerId,
        goals: agg.goals,
        assists: agg.assists,
      }))
      .filter((r) => r.player !== null && r.goals > 0)
      .sort((a, b) => b.goals - a.goals)
      .slice(0, 10);

    const assisters = [...goals.entries()]
      .map(([playerId, agg]) => ({
        player: byId.get(playerId as Id<"players">) ?? null,
        playerId,
        goals: agg.goals,
        assists: agg.assists,
      }))
      .filter((r) => r.player !== null && r.assists > 0)
      .sort((a, b) => b.assists - a.assists)
      .slice(0, 10);

    return { topScorers: scorers, topAssisters: assisters };
  },
});

// ── Stats for the user's own dashboard header ────────────────────────────

export const getMyStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const rows = await getLeaderboardRows(ctx);
    const mine = rows.find((r) => r.userId === userId);
    const rank = mine ? rows.findIndex((r) => r.userId === userId) + 1 : null;
    return {
      totalPoints: mine?.total ?? 0,
      lastMatchPoints: mine?.lastMatch ?? 0,
      rank,
      managerCount: rows.length,
    };
  },
});
