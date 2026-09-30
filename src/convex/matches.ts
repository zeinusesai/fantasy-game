import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireSuperAdmin } from "./lib";
import {
  houseValidator,
  stageValidator,
  matchStatusValidator,
  STAGES,
} from "./schema";
import { computePlayerPoints } from "./points";
import type { Id } from "./_generated/dataModel";

// ── Public queries ───────────────────────────────────────────────────────

export const listMatches = query({
  args: {},
  handler: async (ctx) => {
    const matches = await ctx.db.query("matches").collect();
    return matches.sort((a, b) => {
      const ai = STAGES.indexOf(a.stage);
      const bi = STAGES.indexOf(b.stage);
      if (ai !== bi) return ai - bi;
      return a.createdAt - b.createdAt;
    });
  },
});

/** FotMob-style match detail: match + per-player stat lines with player docs. */
export const getMatch = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const match = await ctx.db.get(matchId);
    if (!match) return null;
    const matchPlayers = await ctx.db
      .query("matchPlayers")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .collect();
    const playerIds = [...new Set(matchPlayers.map((mp) => mp.playerId))];
    const players = await Promise.all(playerIds.map((id) => ctx.db.get(id)));
    const byId = new Map(players.filter(Boolean).map((p) => [p!._id, p!]));
    return {
      match,
      lines: matchPlayers
        .map((mp) => ({ ...mp, player: byId.get(mp.playerId) ?? null }))
        .sort((a, b) => {
          if (!a.player || !b.player) return 0;
          if (a.player.house !== b.player.house) {
            return a.player.house === match.homeHouse ? -1 : 1;
          }
          return a.player.name.localeCompare(b.player.name);
        }),
    };
  },
});

// ── Super admin mutations ────────────────────────────────────────────────

export const scheduleMatch = mutation({
  args: {
    stage: stageValidator,
    homeHouse: houseValidator,
    awayHouse: houseValidator,
    kickoffLabel: v.optional(v.string()),
  },
  handler: async (ctx, { stage, homeHouse, awayHouse, kickoffLabel }) => {
    await requireSuperAdmin(ctx);
    if (homeHouse === awayHouse) {
      throw new Error("A house cannot play against itself.");
    }
    return ctx.db.insert("matches", {
      stage,
      homeHouse,
      awayHouse,
      homeGoals: 0,
      awayGoals: 0,
      status: "scheduled",
      kickoffLabel: kickoffLabel?.trim() || undefined,
      createdAt: Date.now(),
    });
  },
});

export const setMatchStatus = mutation({
  args: { matchId: v.id("matches"), status: matchStatusValidator },
  handler: async (ctx, { matchId, status }) => {
    await requireSuperAdmin(ctx);
    await ctx.db.patch(matchId, { status });
  },
});

export const deleteMatch = mutation({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    await requireSuperAdmin(ctx);
    const scores = await ctx.db
      .query("matchScores")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .collect();
    for (const s of scores) await ctx.db.delete(s._id);
    const lines = await ctx.db
      .query("matchPlayers")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .collect();
    for (const l of lines) await ctx.db.delete(l._id);
    await ctx.db.delete(matchId);
  },
});

const matchLineValidator = v.object({
  playerId: v.id("players"),
  rating: v.optional(v.number()),
  goals: v.number(),
  goalMinutes: v.optional(v.array(v.number())),
  assists: v.number(),
  yellowCards: v.number(),
  redCards: v.number(),
  ownGoals: v.number(),
  ownGoalMinutes: v.optional(v.array(v.number())),
  saves: v.number(),
  cleanSheet: v.boolean(),
});

/**
 * Create or update a completed match report. Recomputes every player's
 * fantasy points via the scoring engine and redistributes points to all
 * squads containing those players (captain counts double). Deleting old
 * derived rows first keeps edits idempotent.
 */
export const saveMatch = mutation({
  args: {
    matchId: v.optional(v.id("matches")),
    stage: stageValidator,
    homeHouse: houseValidator,
    awayHouse: houseValidator,
    homeGoals: v.number(),
    awayGoals: v.number(),
    status: matchStatusValidator,
    kickoffLabel: v.optional(v.string()),
    potmPlayerId: v.optional(v.id("players")),
    lines: v.array(matchLineValidator),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);

    if (args.homeHouse === args.awayHouse) {
      throw new Error("A house cannot play against itself.");
    }
    for (const n of [args.homeGoals, args.awayGoals]) {
      if (!Number.isInteger(n) || n < 0) {
        throw new Error("Scores must be non-negative whole numbers.");
      }
    }
    for (const line of args.lines) {
      for (const n of [
        line.goals,
        line.assists,
        line.yellowCards,
        line.redCards,
        line.ownGoals,
        line.saves,
      ]) {
        if (!Number.isInteger(n) || n < 0) {
          throw new Error("Match statistics must be non-negative whole numbers.");
        }
      }
      if (line.rating !== undefined && (line.rating < 1 || line.rating > 10)) {
        throw new Error("Player ratings must be between 1.0 and 10.0.");
      }
      for (const m of [...(line.goalMinutes ?? []), ...(line.ownGoalMinutes ?? [])]) {
        if (!Number.isFinite(m) || m < 0 || m > 130) {
          throw new Error("Goal minutes must be between 0 and 130.");
        }
      }
    }
    if (args.potmPlayerId && !args.lines.some((l) => l.playerId === args.potmPlayerId)) {
      throw new Error("Player of the Match must be one of the players in the report.");
    }

    const playerDocs = await Promise.all(args.lines.map((l) => ctx.db.get(l.playerId)));
    playerDocs.forEach((p, i) => {
      if (!p || !p.active) {
        throw new Error(`Unknown player on line ${i + 1} of the match report.`);
      }
    });

    let matchId: Id<"matches">;
    if (args.matchId) {
      const existing = await ctx.db.get(args.matchId);
      if (!existing) throw new Error("Match not found.");
      matchId = args.matchId;
      // Wipe previously derived rows so re-saving stays consistent.
      const oldScores = await ctx.db
        .query("matchScores")
        .withIndex("by_match", (q) => q.eq("matchId", matchId))
        .collect();
      for (const s of oldScores) await ctx.db.delete(s._id);
      const oldLines = await ctx.db
        .query("matchPlayers")
        .withIndex("by_match", (q) => q.eq("matchId", matchId))
        .collect();
      for (const l of oldLines) await ctx.db.delete(l._id);
      await ctx.db.patch(matchId, {
        stage: args.stage,
        homeHouse: args.homeHouse,
        awayHouse: args.awayHouse,
        homeGoals: args.homeGoals,
        awayGoals: args.awayGoals,
        status: args.status,
        kickoffLabel: args.kickoffLabel?.trim() || undefined,
        potmPlayerId: args.potmPlayerId,
      });
    } else {
      matchId = await ctx.db.insert("matches", {
        stage: args.stage,
        homeHouse: args.homeHouse,
        awayHouse: args.awayHouse,
        homeGoals: args.homeGoals,
        awayGoals: args.awayGoals,
        status: args.status,
        kickoffLabel: args.kickoffLabel?.trim() || undefined,
        potmPlayerId: args.potmPlayerId,
        createdAt: Date.now(),
      });
    }

    // Per-player stat lines with computed fantasy points.
    for (const line of args.lines) {
      const player = playerDocs.find((p) => p && p._id === line.playerId);
      if (!player) continue;
      const potm = args.potmPlayerId === line.playerId;
      const fantasyPoints = computePlayerPoints({
        position: player.position,
        rating: line.rating,
        goals: line.goals,
        assists: line.assists,
        yellowCards: line.yellowCards,
        redCards: line.redCards,
        ownGoals: line.ownGoals,
        saves: line.saves,
        cleanSheet: line.cleanSheet,
        potm,
      });
      await ctx.db.insert("matchPlayers", {
        matchId,
        playerId: line.playerId,
        house: player.house,
        rating: line.rating,
        goals: line.goals,
        goalMinutes: line.goalMinutes,
        assists: line.assists,
        yellowCards: line.yellowCards,
        redCards: line.redCards,
        ownGoals: line.ownGoals,
        ownGoalMinutes: line.ownGoalMinutes,
        saves: line.saves,
        cleanSheet: line.cleanSheet,
        potm,
        fantasyPoints,
      });
    }

    // Distribute points to every squad containing these players.
    const inserted = await ctx.db
      .query("matchPlayers")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .collect();
    const squads = await ctx.db.query("squads").collect();
    for (const squad of squads) {
      const inSquad = new Set(squad.playerIds.map(String));
      let pts = 0;
      for (const row of inserted) {
        if (!inSquad.has(String(row.playerId))) continue;
        pts += row.fantasyPoints;
        if (squad.captainId === row.playerId) pts += row.fantasyPoints; // captain 2x
      }
      await ctx.db.insert("matchScores", {
        matchId,
        squadId: squad._id,
        userId: squad.userId,
        points: pts,
      });
    }

    return matchId;
  },
});
