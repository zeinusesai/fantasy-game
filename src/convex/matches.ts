import { v } from "convex/values";
import { internal } from "./_generated/api";
import { query, mutation, type MutationCtx } from "./_generated/server";
import { requireSuperAdmin } from "./lib";
import {
  houseValidator,
  stageValidator,
  matchStatusValidator,
  STAGES,
} from "./schema";
import type { Position } from "./schema";
import { computePlayerPoints, resolveScoringRules, captainMultiplier } from "./points";
import { getSettingsRow, normalizeSettings } from "./adminConfig";
import type { Id } from "./_generated/dataModel";
import { resolveFormation } from "./formations";
import { checkLineupRules } from "./lineups";

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

/**
 * FotMob-style match detail payload: the match doc plus resolved player docs
 * for every id referenced by lineups, timeline events, ratings and PotM.
 * Public + null-safe: unknown id -> null, storage hiccup -> null. All nested
 * arrays default to [] client-side; never throws for subscribers.
 */
export const getMatchDetails = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    try {
      const match = await ctx.db.get(matchId);
      if (!match) return null;

      // Collect every referenced player id defensively (optional fields may
      // be undefined; timeline assists may be absent).
      const ids = new Set<string>();
      if (match.potmPlayerId) ids.add(match.potmPlayerId);
      for (const id of match.lineups?.homeStarters ?? []) ids.add(id);
      for (const id of match.lineups?.awayStarters ?? []) ids.add(id);
      for (const id of match.expectedLineups?.homeStarters ?? []) ids.add(id);
      for (const id of match.expectedLineups?.awayStarters ?? []) ids.add(id);
      for (const ev of match.timelineEvents ?? []) {
        ids.add(ev.playerId);
        if (ev.assistPlayerId) ids.add(ev.assistPlayerId);
      }
      for (const r of match.playerRatings ?? []) ids.add(r.playerId);

      const players = await Promise.all(
        [...ids].map((id) => ctx.db.get(id as Id<"players">)),
      );
      const playerDocs = players.filter(
        (p): p is NonNullable<typeof p> => p !== null,
      );

      return { match, players: playerDocs };
    } catch {
      return null;
    }
  },
});

// ── Super admin mutations ────────────────────────────────────────────────

/**
 * Set or update the human-readable match date label (e.g. "Fri 14 Nov, 6 PM").
 */
export const setMatchDate = mutation({
  args: { matchId: v.id("matches"), matchDate: v.string() },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Only the Super Admin can edit matches.",
      );
    }
    const matchDate = typeof args.matchDate === "string" ? args.matchDate.trim() : "";
    try {
      const match = await ctx.db.get(args.matchId);
      if (!match) throw new Error("Match not found.");
      await ctx.db.patch(args.matchId, {
        matchDate: matchDate || undefined,
        ...(matchDate ? { kickoffLabel: matchDate } : {}),
      });
      // Date changes don't affect points, but keep the engine in sync.
      await recalculateMatchPoints(ctx, args.matchId);
      return { matchDate };
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith("Uncaught")) throw err;
      throw new Error("Could not set the match date — please try again.");
    }
  },
});

/**
 * Set the starting 7 for both houses (lineup manager / preview builder).
 * Validates every id: player must exist, be active, and belong to the
 * correct house. Same-transaction patch keeps lineups atomic.
 */
/**
 * Super Admin: set the EXPECTED starting 7 for each house before kickoff.
 *
 * This is the pre-match prediction (rendered on the match preview) and is
 * completely separate from `setLineups`, which records who actually started
 * and feeds the scoring engine.
 *
 * Defensive: ids are de-duped, unknown/removed players are rejected with a
 * readable message, a player can never appear for both houses, and each side
 * is capped at 7. Formations are normalised through `resolveFormation`, so an
 * unexpected string can never break the pitch layout. Passing empty arrays
 * clears the expectation.
 */
export const setExpectedLineups = mutation({
  args: {
    matchId: v.id("matches"),
    homeStarters: v.array(v.id("players")),
    awayStarters: v.array(v.id("players")),
    // Bench / substitutes, max 3 per side (enforced by checkLineupRules).
    homeSubs: v.optional(v.array(v.id("players"))),
    awaySubs: v.optional(v.array(v.id("players"))),
    homeFormation: v.optional(v.string()),
    awayFormation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Only the Super Admin can edit expected lineups.",
      );
    }

    try {
      const match = await ctx.db.get(args.matchId);
      if (!match) throw new Error("Match not found — it may have been removed.");

      // Normalize + enforce the shared rules (max 7 starters, max 3 subs, and
      // no starter/bench overlap on the same side). One source of truth —
      // `lineups.savePredictedLineup` uses exactly the same helper.
      const home = checkLineupRules(match.homeHouse, args.homeStarters, args.homeSubs ?? []);
      if (!home.ok) throw new Error(home.error);
      const away = checkLineupRules(match.awayHouse, args.awayStarters, args.awaySubs ?? []);
      if (!away.ok) throw new Error(away.error);

      const homeStarters = home.starters;
      const awayStarters = away.starters;
      const homeSubs = home.subs;
      const awaySubs = away.subs;

      // No player may appear anywhere on BOTH sides (starter or bench).
      const homeUsed = [...homeStarters, ...homeSubs].map(String);
      const awayUsed = [...awayStarters, ...awaySubs].map(String);
      if (new Set([...homeUsed, ...awayUsed]).size !== homeUsed.length + awayUsed.length) {
        throw new Error("A player cannot be expected to play for both houses.");
      }

      const allIds = [...homeStarters, ...homeSubs, ...awayStarters, ...awaySubs];
      for (let i = 0; i < allIds.length; i++) {
        const doc = await ctx.db.get(allIds[i]).catch(() => null);
        if (!doc || !doc.active) {
          throw new Error(
            "One of those players no longer exists or was removed — refresh the roster.",
          );
        }
        const expectedHouse = i < homeUsed.length ? match.homeHouse : match.awayHouse;
        if (doc.house !== expectedHouse) {
          throw new Error(
            `${doc.name} belongs to ${doc.house}, not ${expectedHouse} — check the expected lineup.`,
          );
        }
      }

      const homeFormation = resolveFormation(args.homeFormation);
      const awayFormation = resolveFormation(args.awayFormation);

      // Clearing: empty on both sides removes the field entirely.
      if (homeStarters.length === 0 && awayStarters.length === 0) {
        await ctx.db.patch(args.matchId, { expectedLineups: undefined });
        return { home: 0, away: 0, homeSubs: 0, awaySubs: 0, cleared: true };
      }

      await ctx.db.patch(args.matchId, {
        expectedLineups: {
          homeStarters,
          awayStarters,
          homeSubs,
          awaySubs,
          homeFormation,
          awayFormation,
        },
      });
      return {
        home: homeStarters.length,
        away: awayStarters.length,
        homeSubs: homeSubs.length,
        awaySubs: awaySubs.length,
        homeFormation,
        awayFormation,
        cleared: false,
      };
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith("Uncaught")) throw err;
      throw new Error("Could not save the expected lineups — please try again.");
    }
  },
});

export const setLineups = mutation({
  args: {
    matchId: v.id("matches"),
    homeStarters: v.array(v.id("players")),
    awayStarters: v.array(v.id("players")),
  },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Only the Super Admin can edit lineups.",
      );
    }

    try {
      const match = await ctx.db.get(args.matchId);
      if (!match) throw new Error("Match not found.");
      if (args.homeStarters.length > 7 || args.awayStarters.length > 7) {
        throw new Error("Each house can field at most 7 starters.");
      }

      const all = [...args.homeStarters, ...args.awayStarters];
      if (new Set(all.map(String)).size !== all.length) {
        throw new Error("A player cannot start for both houses.");
      }

      const docs = await Promise.all(all.map((id) => ctx.db.get(id)));
      for (let i = 0; i < all.length; i++) {
        const doc = docs[i];
        if (!doc || !doc.active) {
          throw new Error(`Player on line ${i + 1} no longer exists or was removed.`);
        }
        const isHome = i < args.homeStarters.length;
        const expectedHouse = isHome ? match.homeHouse : match.awayHouse;
        if (doc.house !== expectedHouse) {
          throw new Error(
            `${doc.name} belongs to ${doc.house}, not ${expectedHouse} — check the lineup.`,
          );
        }
      }

      await ctx.db.patch(args.matchId, {
        lineups: {
          homeStarters: args.homeStarters,
          awayStarters: args.awayStarters,
        },
      });
      // Lineups affect clean-sheet eligibility once completed.
      await recalculateMatchPoints(ctx, args.matchId);
      return { home: args.homeStarters.length, away: args.awayStarters.length };
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith("Uncaught")) throw err;
      throw new Error("Could not save the lineups — please try again.");
    }
  },
});

/**
 * Log one timeline event (goal / yellow_card / red_card / sub). Player and
 * assist names are resolved server-side from the player docs — the client
 * never supplies display names. Goals automatically increment the score.
 */
export const logTimelineEvent = mutation({
  args: {
    matchId: v.id("matches"),
    type: v.union(
      v.literal("goal"),
      v.literal("yellow_card"),
      v.literal("red_card"),
      v.literal("sub"),
    ),
    minute: v.number(),
    playerId: v.id("players"),
    assistPlayerId: v.optional(v.id("players")),
  },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Only the Super Admin can log events.",
      );
    }

    // Explicit numeric parsing/validation before any DB write.
    const minute = Number(args.minute);
    if (!Number.isFinite(minute) || minute < 0 || minute > 130) {
      throw new Error("Minute must be a number between 0 and 130.");
    }
    if (args.type === "goal" && args.assistPlayerId === args.playerId) {
      throw new Error("The assister must be a different player.");
    }

    try {
      const match = await ctx.db.get(args.matchId);
      if (!match) throw new Error("Match not found.");

      const scorer = await ctx.db.get(args.playerId);
      if (!scorer || !scorer.active) {
        throw new Error("That player no longer exists or was removed.");
      }
      const expectedHouse =
        scorer.house === match.homeHouse ? match.homeHouse : scorer.house;
      if (scorer.house !== match.homeHouse && scorer.house !== match.awayHouse) {
        throw new Error(`${scorer.name} is not in either of tonight's houses.`);
      }

      let assistPlayerName: string | undefined;
      if (args.assistPlayerId) {
        const assister = await ctx.db.get(args.assistPlayerId);
        if (!assister) throw new Error("The selected assister no longer exists.");
        assistPlayerName = assister.name;
      }

      const events = match.timelineEvents ?? [];
      const event = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: args.type,
        minute,
        playerId: args.playerId,
        playerName: scorer.name,
        ...(args.assistPlayerId ? { assistPlayerId: args.assistPlayerId } : {}),
        ...(assistPlayerName ? { assistPlayerName } : {}),
        house: scorer.house as typeof match.homeHouse,
      };

      await ctx.db.patch(args.matchId, {
        timelineEvents: [...events, event],
        ...(args.type === "goal"
          ? scorer.house === match.homeHouse
            ? { homeGoals: match.homeGoals + 1 }
            : { awayGoals: match.awayGoals + 1 }
          : {}),
      });
      // Live points: leaderboards update the moment the event lands.
      await recalculateMatchPoints(ctx, args.matchId);
      return { eventId: event.id };
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith("Uncaught")) throw err;
      throw new Error("Could not log the event — please try again.");
    }
  },
});

/**
 * Remove a timeline event by id. Removing a goal event decrements the score
 * so the scoreboard and the event feed can never drift apart.
 */
export const removeTimelineEvent = mutation({
  args: { matchId: v.id("matches"), eventId: v.string() },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Only the Super Admin can edit events.",
      );
    }

    try {
      const match = await ctx.db.get(args.matchId);
      if (!match) throw new Error("Match not found.");
      const events = match.timelineEvents ?? [];
      const target = events.find((e) => e.id === args.eventId);
      if (!target) throw new Error("Event not found — it may already be removed.");

      const remaining = events.filter((e) => e.id !== args.eventId);
      const patch: Record<string, unknown> = { timelineEvents: remaining };
      if (target.type === "goal") {
        if (target.house === match.homeHouse) {
          patch.homeGoals = Math.max(0, match.homeGoals - 1);
        } else {
          patch.awayGoals = Math.max(0, match.awayGoals - 1);
        }
      }
      await ctx.db.patch(args.matchId, patch);
      await recalculateMatchPoints(ctx, args.matchId);
      return { removed: true };
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith("Uncaught")) throw err;
      throw new Error("Could not remove the event — please try again.");
    }
  },
});

/**
 * Bulk-set FotMob player ratings (1.0-10.0) with per-player stat lines.
 * Every value is re-parsed and range-checked server-side.
 */
export const setPlayerRatings = mutation({
  args: {
    matchId: v.id("matches"),
    ratings: v.array(
      v.object({
        playerId: v.id("players"),
        rating: v.number(),
        goals: v.number(),
        assists: v.number(),
        saves: v.number(),
        yellowCards: v.number(),
        redCards: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Only the Super Admin can set ratings.",
      );
    }

    try {
      const match = await ctx.db.get(args.matchId);
      if (!match) throw new Error("Match not found.");
      if (args.ratings.length > 14) {
        throw new Error("At most 14 player lines (7 per house) are allowed.");
      }

      const seen = new Set<string>();
      const rows = [];
      for (const r of args.ratings) {
        if (seen.has(String(r.playerId))) {
          throw new Error("Duplicate player in the ratings list.");
        }
        seen.add(String(r.playerId));

        const rating = Number(r.rating);
        if (!Number.isFinite(rating) || rating < 1 || rating > 10) {
          throw new Error(`Rating for one of the players must be between 1.0 and 10.0.`);
        }
        for (const n of [r.goals, r.assists, r.saves, r.yellowCards, r.redCards]) {
          if (!Number.isInteger(Number(n)) || Number(n) < 0) {
            throw new Error("Stats must be non-negative whole numbers.");
          }
        }

        const player = await ctx.db.get(r.playerId);
        if (!player) throw new Error("A rated player no longer exists.");
        rows.push({
          playerId: r.playerId,
          playerName: player.name,
          house: player.house as typeof match.homeHouse,
          rating: Math.round(rating * 10) / 10,
          goals: Number(r.goals),
          assists: Number(r.assists),
          saves: Number(r.saves),
          yellowCards: Number(r.yellowCards),
          redCards: Number(r.redCards),
        });
      }

      await ctx.db.patch(args.matchId, { playerRatings: rows });
      await recalculateMatchPoints(ctx, args.matchId);
      return { count: rows.length };
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith("Uncaught")) throw err;
      throw new Error("Could not save the ratings — please try again.");
    }
  },
});

/** Assign the Player of the Match. Must be a rated or lined-up player. */
export const setPotmPlayer = mutation({
  args: { matchId: v.id("matches"), playerId: v.optional(v.id("players")) },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Only the Super Admin can assign PotM.",
      );
    }

    try {
      const match = await ctx.db.get(args.matchId);
      if (!match) throw new Error("Match not found.");
      if (args.playerId) {
        const player = await ctx.db.get(args.playerId);
        if (!player) throw new Error("That player no longer exists.");
        const inRatings = (match.playerRatings ?? []).some(
          (r) => r.playerId === args.playerId,
        );
        const inLineups =
          (match.lineups?.homeStarters ?? []).includes(args.playerId) ||
          (match.lineups?.awayStarters ?? []).includes(args.playerId);
        if (!inRatings && !inLineups) {
          throw new Error(
            "PotM must be one of the players rated or lined up for this match.",
          );
        }
      }
      await ctx.db.patch(args.matchId, { potmPlayerId: args.playerId });
      await recalculateMatchPoints(ctx, args.matchId);
      return { ok: true };
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith("Uncaught")) throw err;
      throw new Error("Could not assign PotM — please try again.");
    }
  },
});

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

    // Per-player stat lines with computed fantasy points. Scored against the
    // Super-Admin's configured matrix (falls back to built-in defaults).
    const settings = normalizeSettings(await getSettingsRow(ctx));
    const rules = resolveScoringRules(settings.scoringRules);
    for (const line of args.lines) {
      const player = playerDocs.find((p) => p && p._id === line.playerId);
      if (!player) continue;
      const potm = args.potmPlayerId === line.playerId;
      const fantasyPoints = computePlayerPoints(
        {
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
        },
        rules,
      );
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

// ── Live FPL points engine ───────────────────────────────────────────────

/**
 * Recompute the fantasy-points distribution for one match from its
 * Match Center data (ratings rows carry the per-player stat lines) and
 * rewrite the matchScores table. Called automatically whenever an admin
 * edits events, ratings, PotM or status — so leaderboards update live.
 *
 * Defensive by construction: empty ratings/squads are valid no-op states,
 * and player docs deleted mid-tournament are skipped, never crashed on.
 */
async function recalculateMatchPoints(
  ctx: MutationCtx,
  matchId: Id<"matches">,
): Promise<number> {
  const match = await ctx.db.get(matchId);
  if (!match) return 0;

  // Per-player aggregate stat lines, assembled defensively. Ratings rows are
  // the primary source; timeline events contribute counts for players who
  // have no rating row yet (early live state).
  const agg = new Map<
    string,
    {
      position: Position;
      rating: number | null;
      goals: number;
      assists: number;
      yellowCards: number;
      redCards: number;
      saves: number;
      ownGoals: number;
      cleanSheet: boolean;
      potm: boolean;
    }
  >();
  const blank = () => ({
    position: "MID" as Position,
    rating: null as number | null,
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    ownGoals: 0,
    cleanSheet: false,
    potm: false,
  });

  for (const r of match.playerRatings ?? []) {
    const row = agg.get(String(r.playerId)) ?? blank();
    const player = await ctx.db.get(r.playerId);
    if (player) row.position = player.position;
    const rating = Number(r.rating);
    row.rating = Number.isFinite(rating) ? rating : null;
    row.goals += Number(r.goals) || 0;
    row.assists += Number(r.assists) || 0;
    row.saves += Number(r.saves) || 0;
    row.yellowCards += Number(r.yellowCards) || 0;
    row.redCards += Number(r.redCards) || 0;
    agg.set(String(r.playerId), row);
  }

  for (const ev of match.timelineEvents ?? []) {
    const row = agg.get(String(ev.playerId)) ?? blank();
    const player = await ctx.db.get(ev.playerId);
    if (player) row.position = player.position;
    if (ev.type === "goal") row.goals += 1;
    else if (ev.type === "yellow_card") row.yellowCards += 1;
    else if (ev.type === "red_card") row.redCards += 1;
    if (ev.assistPlayerId) {
      const aRow = agg.get(String(ev.assistPlayerId)) ?? blank();
      const aPlayer = await ctx.db.get(ev.assistPlayerId);
      if (aPlayer) aRow.position = aPlayer.position;
      aRow.assists += 1;
      agg.set(String(ev.assistPlayerId), aRow);
    }
    agg.set(String(ev.playerId), row);
  }

  // Clean sheets: only when the match is completed and the player's house
  // conceded zero goals (7-a-side: no goals conceded → CS for GK/DEF).
  if (match.status === "completed") {
    const homeClean = match.awayGoals === 0;
    const awayClean = match.homeGoals === 0;
    const starters = [
      ...(match.lineups?.homeStarters ?? []).map(String),
      ...(match.lineups?.awayStarters ?? []).map(String),
    ];
    for (const pid of new Set(starters)) {
      const row = agg.get(pid) ?? blank();
      const player = await ctx.db.get(pid as Id<"players">);
      if (player) {
        row.position = player.position;
        row.cleanSheet =
          player.house === match.homeHouse ? homeClean : awayClean;
      }
      agg.set(pid, row);
    }
  }

  // PotM bonus.
  if (match.potmPlayerId) {
    const row = agg.get(String(match.potmPlayerId)) ?? blank();
    row.potm = true;
    agg.set(String(match.potmPlayerId), row);
  }

  if (agg.size === 0) return 0; // nothing to distribute yet

  // Compute per-player points via the shared scoring rules.
  const pointsByPlayer = new Map<string, number>();
  // Resolve the Super-Admin scoring matrix ONCE for this recalculation so
  // every player in the match is scored against identical rules, and a
  // missing/corrupt config row falls back to the built-in defaults.
  const settings = normalizeSettings(await getSettingsRow(ctx));
  const rules = resolveScoringRules(settings.scoringRules);
  const captainMult = captainMultiplier(rules);
  for (const [pid, stats] of agg) {
    pointsByPlayer.set(pid, computePlayerPoints(stats, rules));
  }

  // Rewrite the matchScores table (idempotent full refresh).
  const old = await ctx.db
    .query("matchScores")
    .withIndex("by_match", (q) => q.eq("matchId", matchId))
    .collect();
  for (const s of old) await ctx.db.delete(s._id);

  const squads = await ctx.db.query("squads").collect();
  for (const squad of squads) {
    let pts = 0;
    for (const pid of squad.playerIds) {
      const p = pointsByPlayer.get(String(pid));
      if (p === undefined) continue;
      pts += p;
      if (squad.captainId === pid) pts += p * (captainMult - 1); // captain bonus
    }
    await ctx.db.insert("matchScores", {
      matchId,
      squadId: squad._id,
      userId: squad.userId,
      points: pts,
    });
  }

  // Live awards engine: every match mutation funnels through here, so
  // refreshing the tournament awards right now guarantees Tactical Genius /
  // Unlucky Manager / Differential Master / Player of the Week are always in
  // sync with the latest score — no manual reset, no admin action.
  // Best-effort: a failed refresh must never roll back the match itself.
  try {
    await ctx.runMutation(internal.awards.recalculateAwards, {});
  } catch {
    // awards refresh is non-fatal
  }

  return squads.length;
}

/** Public query so the UI can reflect the live points total for a match. */
export const getMatchPointsTotal = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    try {
      const rows = await ctx.db
        .query("matchScores")
        .withIndex("by_match", (q) => q.eq("matchId", matchId))
        .collect();
      const total = rows.reduce((sum, r) => sum + (Number(r.points) || 0), 0);
      return { total, managers: rows.length };
      } catch {
      return { total: 0, managers: 0 };
    }
  },
});
