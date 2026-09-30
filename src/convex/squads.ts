import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireUser, getPlatformConfig, getSquadForUser } from "./lib";
import { formatMoney } from "./configDefaults";
import type { Doc, Id } from "./_generated/dataModel";

const REQUIRED_FORMATION: Record<string, number> = {
  GK: 1,
  DEF: 2,
  MID: 2,
  FWD: 2,
};

export type SquadPlayer = Doc<"players">;

/**
 * Returns the signed-in user's squad, or `null` when there isn't one.
 * Never throws: not-signed-in (including the brief auth-attachment race on
 * mount) and missing accounts both yield `null` so the client can render an
 * empty state instead of crashing on a rejected query.
 */
export const getMySquad = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null; // not signed in (yet)
    const user = await ctx.db.get(userId);
    if (!user) return null; // account no longer exists
    const squad = await getSquadForUser(ctx, userId);
    if (!squad) return null; // no squad built yet (e.g. admins)
    const players = await Promise.all(squad.playerIds.map((id) => ctx.db.get(id)));
    const captain = squad.captainId ? await ctx.db.get(squad.captainId) : null;
    return {
      squadId: squad._id,
      totalSpent: squad.totalSpent,
      players: players.filter(Boolean) as SquadPlayer[],
      captainId: captain ? squad.captainId : null,
    };
  },
});

/**
 * Most-picked player across all fantasy squads (popularity aggregation).
 * Null-safe: returns null when there are no squads, no picks or the top
 * player was deleted — the UI renders no badge instead of crashing.
 */
export const getMostPickedPlayer = query({
  args: {},
  handler: async (ctx) => {
    try {
      const squads = await ctx.db.query("squads").collect();
      if (squads.length === 0) return null;

      const counts = new Map<string, number>();
      for (const squad of squads) {
        for (const pid of squad.playerIds ?? []) {
          counts.set(String(pid), (counts.get(String(pid)) ?? 0) + 1);
        }
      }
      if (counts.size === 0) return null;

      let topId: string | null = null;
      let topCount = 0;
      for (const [pid, count] of counts) {
        if (count > topCount) {
          topId = pid;
          topCount = count;
        }
      }
      if (!topId) return null;

      const player = await ctx.db.get(topId as Id<"players">);
      if (!player) return null; // deleted player — no badge

      // Guarded percentage: squads.length >= 1 here, so no division by zero.
      const percentage = Math.round((topCount / squads.length) * 100);
      return {
        playerId: player._id,
        playerName: player.name,
        house: player.house,
        pickCount: topCount,
        percentage,
      };
    } catch {
      return null;
    }
  },
});

/** Points the signed-in user's squad earned from one match (null-safe). */
export const getSquadPointsByMatch = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { squadId: null, points: 0 };
    const squad = await getSquadForUser(ctx, userId);
    if (!squad) return { squadId: null, points: 0 };
    const all = await ctx.db
      .query("matchScores")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .collect();
    const score = all.find((s) => s.squadId === squad._id);
    return { squadId: squad._id, points: score?.points ?? 0 };
  },
});

export const saveSquad = mutation({
  args: {
    playerIds: v.array(v.id("players")),
    captainId: v.id("players"),
  },
  handler: async (ctx, { playerIds, captainId }) => {
    const user = await requireUser(ctx);
    const { budget, houseLimit } = await getPlatformConfig(ctx);

    if (playerIds.length !== 7) {
      throw new Error(`Pick exactly 7 players (currently ${playerIds.length}).`);
    }
    if (new Set(playerIds).size !== playerIds.length) {
      throw new Error("You cannot pick the same player twice.");
    }
    const captainInSquad = playerIds.includes(captainId);
    if (!captainInSquad) {
      throw new Error("Your captain must be one of your 7 starters.");
    }

    const players = await Promise.all(playerIds.map((id) => ctx.db.get(id)));
    if (players.some((p) => !p || !p.active)) {
      throw new Error("One of your selected players no longer exists.");
    }

    // Formation: 1 GK / 2 DEF / 2 MID / 2 FWD
    const counts: Record<string, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const p of players) if (p) counts[p.position] += 1;
    for (const [pos, need] of Object.entries(REQUIRED_FORMATION)) {
      if (counts[pos] !== need) {
        throw new Error(
          `Illegal formation: you need exactly ${need} × ${pos} (you picked ${counts[pos]}).`,
        );
      }
    }

    // House limit
    const houseCounts = new Map<string, number>();
    for (const p of players) {
      if (!p) continue;
      houseCounts.set(p.house, (houseCounts.get(p.house) ?? 0) + 1);
    }
    for (const [house, count] of houseCounts) {
      if (count > houseLimit) {
        throw new Error(
          `House limit exceeded: max ${houseLimit} players from ${house} (you picked ${count}).`,
        );
      }
    }

    // Budget
    const totalSpent = players.reduce((sum, p) => sum + (p?.price ?? 0), 0);
    if (totalSpent > budget) {
      throw new Error(
        `Squad exceeds your budget: ${formatMoney(totalSpent)} spent of ${formatMoney(budget)}.`,
      );
    }
    const myBudget = user.budget ?? budget;
    if (totalSpent > myBudget) {
      throw new Error(
        `Squad exceeds your available budget: ${formatMoney(myBudget)}.`,
      );
    }

    const existing = await getSquadForUser(ctx, user._id);
    if (existing) {
      await ctx.db.patch(existing._id, { playerIds, captainId, totalSpent });
      return existing._id;
    }
    return ctx.db.insert("squads", { userId: user._id, playerIds, captainId, totalSpent });
  },
});
