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
import type { Position, Section } from "./schema";
import { normalizeCrest } from "./crests";
import { computePlayerPoints, resolveScoringRules, captainMultiplier } from "./points";
import { getSettingsRow, normalizeSettings } from "./adminConfig";
import type { Id } from "./_generated/dataModel";
import { resolveFormation } from "./formations";
import { checkLineupRules } from "./lineups";
import {
  validatePenaltyShootout,
  derivePenaltyPatch,
  resolveMatchWinner,
  resolveMatchLoser,
} from "./penalties";

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
    // Penalty shootout input. Optional + validated by the shared rules in
    // convex/penalties.ts; `penaltyWinnerId` is derived server-side and is
    // deliberately NOT accepted from the client.
    homePenaltiesScore: v.optional(v.number()),
    awayPenaltiesScore: v.optional(v.number()),
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

    // Penalty shootout rules. Validated BEFORE any write so a bad
    // submission can never leave a half-applied match behind.
    const penaltyError = validatePenaltyShootout({
      stage: args.stage,
      homeGoals: args.homeGoals,
      awayGoals: args.awayGoals,
      homePenaltiesScore: args.homePenaltiesScore,
      awayPenaltiesScore: args.awayPenaltiesScore,
    });
    if (penaltyError) throw new Error(penaltyError);
    const penaltyPatch = derivePenaltyPatch({
      stage: args.stage,
      homeHouse: args.homeHouse,
      awayHouse: args.awayHouse,
      homeGoals: args.homeGoals,
      awayGoals: args.awayGoals,
      homePenaltiesScore: args.homePenaltiesScore,
      awayPenaltiesScore: args.awayPenaltiesScore,
    });

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
        ...penaltyPatch,
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
        ...penaltyPatch,
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

/**
 * Record (or clear) the penalty shootout for a fixture that is already
 * saved, without touching the match report or re-distributing fantasy
 * points. This is the narrow path the Admin "Penalty shootout" toggle
 * uses once regulation goals are already on file.
 *
 * Returns `{ ok: false, error }` for every expected rejection (tied PK
 * scores, penalties on a match that wasn't level, non-knockout stage) so
 * the client can toast the reason inline without a server exception.
 *
 * FANTASY SCORING ISOLATION: this mutation writes ONLY the five shootout
 * fields. It never inserts a `matchPlayers` row and never calls
 * recalculateMatchPoints, so penalty kicks cannot reach player points, the
 * golden boot, or the leaderboard. The regulation `homeGoals`/`awayGoals`
 * that DO feed those systems are left exactly as they are.
 */
export const recordPenaltyShootout = mutation({
  args: {
    matchId: v.id("matches"),
    homePenaltiesScore: v.optional(v.number()),
    awayPenaltiesScore: v.optional(v.number()),
    /** Explicitly clear the shootout (set both PK scores to null/0). */
    clear: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    try {
      const match = await ctx.db.get(args.matchId);
      if (!match) return { ok: false as const, error: "Match not found." };

      // Clearing is always legal — it just removes the shootout fields.
      if (args.clear) {
        await ctx.db.patch(args.matchId, {
          goesToPenalties: false,
          homePenaltiesScore: undefined,
          awayPenaltiesScore: undefined,
          penaltyWinnerId: undefined,
        });
        return { ok: true as const, cleared: true, penaltyWinnerId: null };
      }

      const homePen = args.homePenaltiesScore ?? null;
      const awayPen = args.awayPenaltiesScore ?? null;
      if (homePen === null || awayPen === null) {
        return {
          ok: false as const,
          error: "Enter both penalty scores, or clear the shootout.",
        };
      }

      const error = validatePenaltyShootout({
        stage: match.stage,
        homeGoals: match.homeGoals,
        awayGoals: match.awayGoals,
        homePenaltiesScore: homePen,
        awayPenaltiesScore: awayPen,
      });
      if (error) return { ok: false as const, error };

      const patch = derivePenaltyPatch({
        stage: match.stage,
        homeHouse: match.homeHouse,
        awayHouse: match.awayHouse,
        homeGoals: match.homeGoals,
        awayGoals: match.awayGoals,
        homePenaltiesScore: homePen,
        awayPenaltiesScore: awayPen,
      });
      await ctx.db.patch(args.matchId, patch);

      return {
        ok: true as const,
        cleared: false,
        penaltyWinnerId: patch.penaltyWinnerId ?? null,
        homePenaltiesScore: patch.homePenaltiesScore ?? 0,
        awayPenaltiesScore: patch.awayPenaltiesScore ?? 0,
        goesToPenalties: patch.goesToPenalties,
      };
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith("Uncaught")) throw err;
      throw new Error("Could not save the penalty shootout. Try again.");
    }
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

// ── Y11 PE Hub — weekly dynamic friendly match engine ────────────────────
//
// Teams are NEVER fixed. Each gameweek gets a fresh ad-hoc friendly:
//   • custom dynamic team names per gameweek ("Team Alpha" vs "Team Omega",
//     or a randomized captain draw like "Adam's 7" vs "Zein's 7"),
//   • rosters drawn from the PRESERVED player database for that week only,
//   • a preset vector crest (or an uploaded custom logo) per side.
//
// Legacy house fixtures keep working untouched: `homeHouse` / `awayHouse`
// stay required by the schema, so a friendly stores the neutral
// `group_stage` stage and overrides display through `homeTeamName` /
// `awayTeamName` + `homeCrest` / `awayCrest`. Goals, assists, cards, clean
// sheets and penalty shootouts all continue to work exactly as before —
// no persistent house points are involved.

const MAX_TEAM_NAME = 32;
const FRIENDLY_ROSTER_SIZE = 7;
const MAX_GW = 99; // GW1 … GW30+ with plenty of headroom

/** Preset ad-hoc side names the generator draws from. */
export const FRIENDLY_NAME_POOL = [
  "Team Alpha",
  "Team Omega",
  "Team Phoenix",
  "Team Titan",
  "Team Vortex",
  "Team Nova",
  "Team Blitz",
  "Team Riptide",
] as const;

/** Captain-style draw suffix, e.g. "Zein's 7". */
const CAPTAIN_SUFFIX = "'s 7";

function cleanTeamName(raw: unknown, fallback: string): string {
  const value = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (value === "") return fallback;
  return value.slice(0, MAX_TEAM_NAME);
}

function randomFrom<T>(items: readonly T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

/** Fisher–Yates over a copy — never mutates the source array. */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

/** Active players from the preserved roster. Never deletes / writes. */
async function activeRoster(ctx: MutationCtx): Promise<Id<"players">[]> {
  try {
    const players = await ctx.db.query("players").collect();
    return players.filter((p) => p.active !== false).map((p) => p._id);
  } catch {
    return [];
  }
}

/** Two disjoint random sides of up to 7 drawn from the preserved roster. */
async function drawRandomSquads(
  ctx: MutationCtx,
): Promise<{ home: Id<"players">[]; away: Id<"players">[] }> {
  const ids = shuffled(await activeRoster(ctx));
  const perSide = Math.min(FRIENDLY_ROSTER_SIZE, Math.floor(ids.length / 2));
  if (perSide <= 0) return { home: [], away: [] };
  return {
    home: ids.slice(0, perSide),
    away: ids.slice(perSide, perSide * 2),
  };
}

/** Validate + normalise a client-supplied roster against the roster DB. */
async function normaliseSquad(
  ctx: MutationCtx,
  requested: Id<"players">[] | undefined,
): Promise<{ squad: Id<"players">[]; error: string | null }> {
  if (requested === undefined) return { squad: [], error: null };
  if (!Array.isArray(requested)) return { squad: [], error: "Invalid roster." };
  if (requested.length > FRIENDLY_ROSTER_SIZE) {
    return { squad: [], error: `A friendly side is capped at ${FRIENDLY_ROSTER_SIZE} players.` };
  }
  const seen = new Set<string>();
  const out: Id<"players">[] = [];
  for (const id of requested) {
    if (typeof id !== "string" || id === "") {
      return { squad: [], error: "Invalid player in roster." };
    }
    if (seen.has(id)) continue;
    seen.add(id);
    // Resolving against `players` READS the preserved roster — it never
    // writes — so an unknown/deleted id is rejected instead of stored.
    const player = await ctx.db.get(id as Id<"players">).catch(() => null);
    if (!player) return { squad: [], error: "One of those players no longer exists." };
    out.push(id as Id<"players">);
  }
  return { squad: out, error: null };
}

/**
 * Super Admin: create this week's dynamic friendly.
 *
 * `randomize: true` makes the SERVER draw the team names and both rosters,
 * so the "Randomize Teams" button can never be spoofed by the client.
 * Custom crests are normalised through `normalizeCrest` (preset id or a
 * bounded http(s) / data:image URL — anything else becomes the default).
 */
export const createFriendlyMatch = mutation({
  args: {
    gameweek: v.number(),
    homeTeamName: v.optional(v.string()),
    awayTeamName: v.optional(v.string()),
    homeCrest: v.optional(v.string()),
    awayCrest: v.optional(v.string()),
    homeSquad: v.optional(v.array(v.id("players"))),
    awaySquad: v.optional(v.array(v.id("players"))),
    kickoffLabel: v.optional(v.string()),
    kickoffAt: v.optional(v.number()),
    isKnockout: v.optional(v.boolean()),
    randomize: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);

    if (!Number.isInteger(args.gameweek) || args.gameweek < 1 || args.gameweek > MAX_GW) {
      throw new Error(`Gameweek must be a whole number between 1 and ${MAX_GW}.`);
    }

    const randomize = args.randomize === true;
    const homeName = cleanTeamName(
      args.homeTeamName,
      randomize ? (randomFrom(FRIENDLY_NAME_POOL) ?? "Team Alpha") : "Team Alpha",
    );
    let awayName = cleanTeamName(
      args.awayTeamName,
      randomize ? (randomFrom(FRIENDLY_NAME_POOL) ?? "Team Omega") : "Team Omega",
    );
    if (homeName === awayName) awayName = homeName === "Team Omega" ? "Team Alpha" : "Team Omega";
    if (homeName === awayName) {
      throw new Error("The two teams need different names.");
    }

    let homeSquad: Id<"players">[];
    let awaySquad: Id<"players">[];
    if (randomize) {
      const drawn = await drawRandomSquads(ctx);
      homeSquad = drawn.home;
      awaySquad = drawn.away;
    } else {
      const home = await normaliseSquad(ctx, args.homeSquad);
      if (home.error) throw new Error(home.error);
      const away = await normaliseSquad(ctx, args.awaySquad);
      if (away.error) throw new Error(away.error);
      homeSquad = home.squad;
      awaySquad = away.squad;
      const overlap = homeSquad.filter((id) => awaySquad.includes(id));
      if (overlap.length > 0) {
        throw new Error("A player can only line up for one side of a friendly.");
      }
    }

    const kickoffLabel =
      typeof args.kickoffLabel === "string" && args.kickoffLabel.trim() !== ""
        ? args.kickoffLabel.trim().slice(0, 60)
        : undefined;

    return ctx.db.insert("matches", {
      stage: "group_stage",
      // Neutral legacy slots — the friendly never depends on house points.
      homeHouse: "Fire",
      awayHouse: "Water",
      homeGoals: 0,
      awayGoals: 0,
      status: "scheduled",
      createdAt: Date.now(),
      // ── dynamic friendly metadata ──
      friendly: true,
      gameweek: args.gameweek,
      homeTeamName: homeName,
      awayTeamName: awayName,
      homeCrest: normalizeCrest(args.homeCrest),
      awayCrest: normalizeCrest(args.awayCrest),
      homeSquad,
      awaySquad,
      drawnAt: Date.now(),
      kickoffLabel,
      kickoffAt: Number.isFinite(args.kickoffAt) ? args.kickoffAt : undefined,
      isKnockout: args.isKnockout === true,
    });
  },
});

/**
 * Super Admin: re-draw or hand-edit an existing weekly friendly.
 * Same rules as creation; partial updates are fine (undefined = keep).
 */
export const updateFriendlyMatch = mutation({
  args: {
    matchId: v.id("matches"),
    homeTeamName: v.optional(v.string()),
    awayTeamName: v.optional(v.string()),
    homeCrest: v.optional(v.string()),
    awayCrest: v.optional(v.string()),
    homeSquad: v.optional(v.array(v.id("players"))),
    awaySquad: v.optional(v.array(v.id("players"))),
    gameweek: v.optional(v.number()),
    randomize: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const match = await ctx.db.get(args.matchId);
    if (!match) throw new Error("That fixture no longer exists.");

    const patch: Record<string, unknown> = {};
    if (args.gameweek !== undefined) {
      if (!Number.isInteger(args.gameweek) || args.gameweek < 1 || args.gameweek > MAX_GW) {
        throw new Error(`Gameweek must be a whole number between 1 and ${MAX_GW}.`);
      }
      patch.gameweek = args.gameweek;
    }
    if (args.homeTeamName !== undefined) patch.homeTeamName = cleanTeamName(args.homeTeamName, match.homeTeamName ?? "Team Alpha");
    if (args.awayTeamName !== undefined) patch.awayTeamName = cleanTeamName(args.awayTeamName, match.awayTeamName ?? "Team Omega");
    if ((patch.homeTeamName ?? match.homeTeamName) === (patch.awayTeamName ?? match.awayTeamName)) {
      throw new Error("The two teams need different names.");
    }
    if (args.homeCrest !== undefined) patch.homeCrest = normalizeCrest(args.homeCrest);
    if (args.awayCrest !== undefined) patch.awayCrest = normalizeCrest(args.awayCrest);

    if (args.randomize === true) {
      const drawn = await drawRandomSquads(ctx);
      patch.homeSquad = drawn.home;
      patch.awaySquad = drawn.away;
      if (args.homeTeamName === undefined) {
        patch.homeTeamName = randomFrom(FRIENDLY_NAME_POOL) ?? match.homeTeamName ?? "Team Alpha";
      }
      if (args.awayTeamName === undefined) {
        patch.awayTeamName = randomFrom(FRIENDLY_NAME_POOL) ?? match.awayTeamName ?? "Team Omega";
      }
      if (patch.homeTeamName === patch.awayTeamName) {
        patch.awayTeamName = "Team Omega";
        if (patch.homeTeamName === patch.awayTeamName) patch.awayTeamName = "Team Alpha";
      }
    } else {
      if (args.homeSquad !== undefined) {
        const home = await normaliseSquad(ctx, args.homeSquad);
        if (home.error) throw new Error(home.error);
        patch.homeSquad = home.squad;
      }
      if (args.awaySquad !== undefined) {
        const away = await normaliseSquad(ctx, args.awaySquad);
        if (away.error) throw new Error(away.error);
        patch.awaySquad = away.squad;
      }
      const h = (patch.homeSquad ?? match.homeSquad ?? []) as Id<"players">[];
      const a = (patch.awaySquad ?? match.awaySquad ?? []) as Id<"players">[];
      if (h.some((id) => a.includes(id))) {
        throw new Error("A player can only line up for one side of a friendly.");
      }
    }

    patch.friendly = true;
    patch.drawnAt = Date.now();
    await ctx.db.patch(args.matchId, patch);
    return { ok: true as const };
  },
});

/** Fixtures for one gameweek (with the roster resolved for the generator). */
export const listGameweekMatches = query({
  args: { gameweek: v.number() },
  handler: async (ctx, { gameweek }) => {
    try {
      const matches = await ctx.db
        .query("matches")
        .withIndex("by_gameweek", (q) => q.eq("gameweek", gameweek))
        .collect();
      const ids = new Set<string>();
      for (const m of matches) {
        for (const id of [...(m.homeSquad ?? []), ...(m.awaySquad ?? [])]) ids.add(String(id));
      }
      const players = await Promise.all(
        [...ids].map((id) => ctx.db.get(id as Id<"players">).catch(() => null)),
      );
      const byId = new Map(
        players.filter((p): p is NonNullable<typeof p> => p !== null).map((p) => [String(p._id), p]),
      );
      return matches
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((m) => ({
          ...m,
          homeRoster: (m.homeSquad ?? []).map((id) => byId.get(String(id)) ?? null).filter(Boolean),
          awayRoster: (m.awaySquad ?? []).map((id) => byId.get(String(id)) ?? null).filter(Boolean),
        }));
    } catch {
      return [];
    }
  },
});

/**
 * Server-side "Randomize Teams" preview used by the generator UI before the
 * fixture is saved. Super Admin only; read-only (never touches the roster).
 */
export const previewRandomFriendly = mutation({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);
    const squads = await drawRandomSquads(ctx);
    const names = shuffled(FRIENDLY_NAME_POOL).slice(0, 2);
    return {
      homeTeamName: names[0] ?? "Team Alpha",
      awayTeamName: names[1] ?? "Team Omega",
      homeSquad: squads.home,
      awaySquad: squads.away,
    };
  },
});

/** Captain-draw naming helper: "Zein's 7" from a manager's username. */
export const captainTeamName = (username: string | null | undefined): string => {
  const clean = typeof username === "string" ? username.trim().slice(0, 20) : "";
  return `${clean === "" ? "Team" : clean}${CAPTAIN_SUFFIX}`;
};

// ── Y11 PE Hub — sequential season gameweeks (GW1 … GW30+) ────────────────

const GAMEWEEK_STATUSES = ["open", "locked", "calculating", "closed"] as const;
type GameweekStatus = (typeof GAMEWEEK_STATUSES)[number];

function isGameweekStatus(value: unknown): value is GameweekStatus {
  return typeof value === "string" && (GAMEWEEK_STATUSES as readonly string[]).includes(value);
}

function cleanGwNumber(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > MAX_GW) {
    throw new Error(`Gameweek must be a whole number between 1 and ${MAX_GW}.`);
  }
  return n;
}

/** Open-ended by design: any whole number of matches per gameweek. */
function cleanMatchCount(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    throw new Error("Matches per gameweek must be a whole number between 1 and 12.");
  }
  return n;
}

/**
 * Super Admin: set how many dynamic friendlies this gameweek should have
 * (typically 2–4, more when required). Open-ended — the season is not capped
 * at a fixed fixture list.
 */
export const setSeasonGameweekMatchCount = mutation({
  args: { gameweek: v.number(), matchesPlanned: v.number() },
  handler: async (ctx, { gameweek, matchesPlanned }) => {
    await requireSuperAdmin(ctx);
    const number = cleanGwNumber(gameweek);
    const count = cleanMatchCount(matchesPlanned);
    const row = await ctx.db
      .query("seasonGameweeks")
      .withIndex("by_number", (q) => q.eq("number", number))
      .unique();
    if (!row) throw new Error(`Gameweek ${number} does not exist.`);
    await ctx.db.patch(row._id, { matchesPlanned: count });
    return { gameweek: number, matchesPlanned: count };
  },
});

/**
 * Super Admin: generate a whole round of dynamic friendlies for a gameweek.
 *
 * Every match is fully custom and independent — a fresh pair of team names,
 * crests and randomly drawn 7-a-side squads per fixture — so nothing is fixed
 * week to week. The count defaults to the gameweek's `matchesPlanned` (or 3),
 * and the plan is stamped onto the gameweek so the calendar shows it.
 */
export const createFriendlyRound = mutation({
  args: {
    gameweek: v.number(),
    count: v.optional(v.number()),
    homeTeamName: v.optional(v.string()),
    awayTeamName: v.optional(v.string()),
    homeCrest: v.optional(v.string()),
    awayCrest: v.optional(v.string()),
    kickoffLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const number = cleanGwNumber(args.gameweek);

    const row = await ctx.db
      .query("seasonGameweeks")
      .withIndex("by_number", (q) => q.eq("number", number))
      .unique();
    if (!row) throw new Error(`Gameweek ${number} does not exist.`);

    const count = cleanMatchCount(args.count ?? row.matchesPlanned ?? 3);

    const firstHome = args.homeTeamName?.trim();
    const firstAway = args.awayTeamName?.trim();
    const pool = shuffled(FRIENDLY_NAME_POOL);
    const kickoffLabel = args.kickoffLabel?.trim();

    const created: Id<"matches">[] = [];
    for (let i = 0; i < count; i++) {
      const squads = await drawRandomSquads(ctx);
      if (squads.home.length === 0 || squads.away.length === 0) {
        throw new Error(
          "Not enough active players to draw two sides — import the roster first.",
        );
      }
      const homeTeamName =
        i === 0 && firstHome ? firstHome : (pool[(i * 2) % pool.length] ?? "Team Alpha");
      const awayTeamName =
        i === 0 && firstAway ? firstAway : (pool[(i * 2 + 1) % pool.length] ?? "Team Omega");

      created.push(
        await ctx.db.insert("matches", {
          // Neutral legacy slots — a friendly never depends on house points.
          stage: "group_stage",
          homeHouse: "Fire",
          awayHouse: "Water",
          homeGoals: 0,
          awayGoals: 0,
          status: "scheduled",
          createdAt: Date.now(),
          friendly: true,
          gameweek: number,
          homeTeamName,
          awayTeamName,
          homeCrest: normalizeCrest(args.homeCrest),
          awayCrest: normalizeCrest(args.awayCrest),
          homeSquad: squads.home,
          awaySquad: squads.away,
          drawnAt: Date.now(),
          kickoffLabel,
        }),
      );
    }

    if (row.matchesPlanned !== count) {
      await ctx.db.patch(row._id, { matchesPlanned: count });
    }
    return { createdCount: created.length, matchesPlanned: count, matchIds: created };
  },
});

/** Every season gameweek, GW1 first. Public: managers need to see status. */
export const listSeasonGameweeks = query({
  args: {},
  handler: async (ctx) => {
    try {
      const rows = await ctx.db.query("seasonGameweeks").collect();
      return rows.sort((a, b) => a.number - b.number);
    } catch {
      return [];
    }
  },
});

/** Create (or relabel) one gameweek in the PE calendar. Super Admin only. */
export const createSeasonGameweek = mutation({
  args: {
    number: v.number(),
    title: v.optional(v.string()),
    deadlineAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const number = cleanGwNumber(args.number);
    const title =
      typeof args.title === "string" && args.title.trim() !== ""
        ? args.title.trim().slice(0, 60)
        : undefined;
    const existing = await ctx.db
      .query("seasonGameweeks")
      .withIndex("by_number", (q) => q.eq("number", number))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...(title !== undefined ? { title } : {}),
        ...(args.deadlineAt !== undefined ? { deadlineAt: args.deadlineAt } : {}),
      });
      return existing._id;
    }
    const next = (await ctx.db
      .query("seasonGameweeks")
      .collect())
      .reduce((max, r) => Math.max(max, r.number), 0);
    if (number > next + 1) {
      throw new Error(`Create GW${next + 1} first — gameweeks are sequential.`);
    }
    return ctx.db.insert("seasonGameweeks", {
      number,
      label: `GW${number}`,
      title,
      status: "open",
      openedAt: Date.now(),
      ...(args.deadlineAt !== undefined ? { deadlineAt: args.deadlineAt } : {}),
    });
  },
});

/** Seed GW1 … `upTo` in one call (used by the Season tab setup button). */
export const ensureSeasonGameweeks = mutation({
  args: { upTo: v.number() },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const upTo = cleanGwNumber(args.upTo);
    const rows = await ctx.db.query("seasonGameweeks").collect();
    const have = new Set(rows.map((r) => r.number));
    let created = 0;
    for (let n = 1; n <= upTo; n++) {
      if (have.has(n)) continue;
      await ctx.db.insert("seasonGameweeks", {
        number: n,
        label: `GW${n}`,
        status: n === 1 ? "open" : "locked",
        ...(n === 1 ? { openedAt: Date.now() } : {}),
      });
      created += 1;
    }
    return { created };
  },
});

/**
 * Drive one gameweek's lifecycle: open → locked → calculating → closed.
 * Super Admin only. Validates the status so a typo can never be stored.
 */
export const setSeasonGameweekStatus = mutation({
  args: { number: v.number(), status: v.string() },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const number = cleanGwNumber(args.number);
    const status = String(args.status ?? "").trim().toLowerCase();
    if (!isGameweekStatus(status)) {
      throw new Error(`Status must be one of: ${GAMEWEEK_STATUSES.join(", ")}.`);
    }
    const row = await ctx.db
      .query("seasonGameweeks")
      .withIndex("by_number", (q) => q.eq("number", number))
      .unique();
    if (!row) throw new Error(`Gameweek ${number} does not exist yet.`);
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status,
      ...(status === "open" ? { openedAt: now } : {}),
      ...(status === "closed" ? { closedAt: now } : {}),
    });

    // Closing a gameweek is the trigger for the weekly "Section Champions"
    // cosmetic: the top-scoring PE section for THIS week is recorded, which
    // automatically retires the previous week's winner (the read path always
    // uses the newest row). Non-fatal — a cosmetic failure never blocks the
    // closure itself.
    let champion: { awarded: boolean; section?: Section; totalPoints?: number } = {
      awarded: false,
    };
    if (status === "closed") {
      try {
        const result = await ctx.runMutation(internal.leaderboard.awardSectionChampions, {
          gameweek: number,
        });
        champion = {
          awarded: result.awarded,
          ...(result.awarded ? { section: result.section, totalPoints: result.totalPoints } : {}),
        };
      } catch {
        champion = { awarded: false };
      }
    }

    return { number, status, sectionChampion: champion };
  },
});

/** Set / clear a gameweek's transfer deadline. Super Admin only. */
export const setSeasonGameweekDeadline = mutation({
  args: { number: v.number(), deadlineAt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const number = cleanGwNumber(args.number);
    const row = await ctx.db
      .query("seasonGameweeks")
      .withIndex("by_number", (q) => q.eq("number", number))
      .unique();
    if (!row) throw new Error(`Gameweek ${number} does not exist yet.`);
    const valid =
      args.deadlineAt !== undefined && Number.isFinite(args.deadlineAt) && args.deadlineAt > 0
        ? args.deadlineAt
        : undefined;
    await ctx.db.patch(row._id, { deadlineAt: valid });
    return { number, deadlineAt: valid ?? null };
  },
});

/** Remove a gameweek that was created by mistake. Super Admin only. */
export const deleteSeasonGameweek = mutation({
  args: { number: v.number() },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    const number = cleanGwNumber(args.number);
    const row = await ctx.db
      .query("seasonGameweeks")
      .withIndex("by_number", (q) => q.eq("number", number))
      .unique();
    if (!row) return { deleted: false as const };
    await ctx.db.delete(row._id);
    return { deleted: true as const };
  },
});

/**
 * Y11 PE Hub — numeric skill tiers, per-gameweek averages and 3-week form.
 *
 * Replaces star ratings with a numeric Tier 1–5 badge plus the raw numbers a
 * manager actually cares about: average points per gameweek, goals, assists,
 * clean sheets and a 🔥 Hot / ❄️ Cold trend over the last three fixtures.
 *
 * READ-ONLY over the preserved `players` / `matchPlayers` tables — nothing is
 * written, so the roster database is untouched. Total: a storage hiccup
 * degrades to an empty map instead of rejecting the query.
 */
export const getPlayerSkillStats = query({
  args: {},
  handler: async (ctx) => {
    try {
      const players = await ctx.db.query("players").collect();
      const lines = await ctx.db.query("matchPlayers").collect();

      const byPlayer = new Map<
        string,
        { points: number[]; goals: number; assists: number; cs: number; apps: number }
      >();
      for (const line of lines) {
        const key = String(line.playerId);
        const cur = byPlayer.get(key) ?? { points: [], goals: 0, assists: 0, cs: 0, apps: 0 };
        cur.goals += Number(line.goals) || 0;
        cur.assists += Number(line.assists) || 0;
        cur.cs += line.cleanSheet === true ? 1 : 0;
        cur.apps += 1;
        cur.points.push(Number(line.fantasyPoints) || 0);
        byPlayer.set(key, cur);
      }

      // Price ladder used only when a player has no appearances yet, so a
      // brand-new roster still gets a sensible spread of tiers.
      const prices = players.map((p) => Number(p.price) || 0);
      const sortedPrices = [...prices].sort((a, b) => a - b);
      const priceRank = (price: number) => {
        if (sortedPrices.length <= 1) return 0.5;
        let below = 0;
        for (const v of sortedPrices) if (v <= price) below += 1;
        return below / sortedPrices.length;
      };

      const tierFromAvg = (avg: number) => {
        if (avg >= 20) return 5;
        if (avg >= 14) return 4;
        if (avg >= 9) return 3;
        if (avg >= 4) return 2;
        return 1;
      };
      const tierFromPrice = (rank: number) => {
        if (rank >= 0.9) return 5;
        if (rank >= 0.7) return 4;
        if (rank >= 0.45) return 3;
        if (rank >= 0.2) return 2;
        return 1;
      };

      return players.map((p) => {
        const stat = byPlayer.get(String(p._id)) ?? {
          points: [],
          goals: 0,
          assists: 0,
          cs: 0,
          apps: 0,
        };
        const total = stat.points.reduce((sum, n) => sum + n, 0);
        const avg = stat.apps > 0 ? total / stat.apps : 0;
        const recent = stat.points.slice(-3);
        const last = recent[recent.length - 1] ?? null;
        const prev = recent[recent.length - 2] ?? null;

        let form: "hot" | "cold" | "steady" = "steady";
        if (recent.length > 0 && last !== null) {
          if (last >= 10 && (prev === null || last >= prev)) form = "hot";
          else if (last <= 3 && recent.length > 1) form = "cold";
        }

        const tier =
          stat.apps > 0 ? tierFromAvg(avg) : tierFromPrice(priceRank(Number(p.price) || 0));

        return {
          playerId: p._id,
          tier,
          avg: Math.round(avg * 10) / 10,
          total: Math.round(total),
          apps: stat.apps,
          goals: stat.goals,
          assists: stat.assists,
          cleanSheets: stat.cs,
          form,
          recent: recent.map((n) => Math.round(n)),
        };
      });
    } catch {
      return [];
    }
  },
});

/**
 * Y11 PE Hub — Gameweek recap engine.
 *
 * Produces a dramatic three-paragraph news write-up for the most recent
 * settled gameweek: the top manager, the biggest faller, and the captain
 * failures — plus the weekly Banter & Blunder badges that get displayed on
 * the dashboard feed.
 *
 * Purely derived from stored results (no external service), so it can never
 * fail a page load: every branch degrades to `null` and the card hides itself.
 */
export const getGameweekRecap = query({
  args: {},
  handler: async (ctx) => {
    try {
      const squads = await ctx.db.query("squads").collect();
      const users = await ctx.db.query("users").collect();
      const scores = await ctx.db.query("matchScores").collect();
      const lines = await ctx.db.query("matchPlayers").collect();
      if (squads.length === 0 || scores.length === 0) return null;

      const nameOf = (userId: unknown): string => {
        const u = users.find((row) => String(row._id) === String(userId));
        return u?.teamName?.trim() || u?.username?.trim() || "A manager";
      };

      const totals = new Map<string, number>();
      for (const s of scores) {
        const key = String(s.userId);
        totals.set(key, (totals.get(key) ?? 0) + (Number(s.points) || 0));
      }
      const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
      if (ranked.length === 0) return null;

      const top = ranked[0]!;
      const bottom = ranked[ranked.length - 1]!;
      const average = ranked.reduce((sum, r) => sum + r[1], 0) / ranked.length;

      const captainPoints = (captainId: unknown): number => {
        if (captainId === null || captainId === undefined) return 0;
        return lines
          .filter((l) => String(l.playerId) === String(captainId))
          .reduce((sum, l) => sum + (Number(l.fantasyPoints) || 0), 0);
      };

      const ghostCaptains = squads
        .filter((s) => totals.has(String(s.userId)) && captainPoints(s.captainId) <= 0)
        .map((s) => ({ userId: s.userId, team: nameOf(s.userId) }));

      const bestCaptain = squads
        .map((s) => ({ team: nameOf(s.userId), pts: captainPoints(s.captainId) }))
        .filter((r) => r.pts > 0)
        .sort((a, b) => b.pts - a.pts)[0] ?? null;

      const swing = Math.round((top[1] - bottom[1]) * 10) / 10;
      const topName = nameOf(top[0]);
      const bottomName = nameOf(bottom[0]);
      const ghostNames = ghostCaptains.slice(0, 3).map((g) => g.team);

      const paragraphs = [
        `Gameweek review — ${topName} top the pile. A ruthless ${top[1].toFixed(1)}-point haul puts them ${Math.max(
          0,
          Math.round((top[1] - average) * 10) / 10,
        ).toFixed(1)} clear of the pack average of ${average.toFixed(1)}, and the chasing managers have no answer. Every pick landed, the armband paid dividends, and the table has a new benchmark to chase next week.`,
        `The biggest fall of the week belongs to ${bottomName}, who banked just ${bottom[1].toFixed(1)} points — a ${swing.toFixed(
          1,
        )}-point swing off the pace at the top. Formations looked blunt, the budget was spread thin, and a single blank week has turned a promising start into damage limitation.`,
        ghostNames.length > 0
          ? `Then came the captaincy chaos. ${ghostNames.join(
              ", ",
            )} all handed the armband to a player who returned a grand total of nothing — the Ghost Captain curse is alive and well. ${
              bestCaptain
                ? `At the other end, ${bestCaptain.team}'s skipper delivered ${bestCaptain.pts.toFixed(1)} points and made the difference.`
                : "Nobody's captain managed to fire this week."
            }`
          : `Captaincy was kind this week — ${
              bestCaptain
                ? `${bestCaptain.team}'s skipper led the way with ${bestCaptain.pts.toFixed(1)} points.`
                : "every armband returned a return."
            } Fresh squads, fresh gameweek, and the table is still wide open.`,
      ];

      type RecapBadge = {
        emoji: string;
        label: string;
        note: string;
        userId: string | null;
        team: string;
      };
      const badges: RecapBadge[] = [];

      if (ghostCaptains.length > 0) {
        badges.push({
          emoji: "👻",
          label: "Ghost Captain",
          note: `${ghostCaptains.length} manager${ghostCaptains.length === 1 ? "" : "s"} handed the armband to a player who scored 0.`,
          userId: String(ghostCaptains[0]!.userId),
          team: ghostCaptains[0]!.team,
        });
      }
      if (bottom[1] < average) {
        badges.push({
          emoji: "🪑",
          label: "Bench Disaster",
          note: `${bottomName} finished ${swing.toFixed(1)} points off the top on ${bottom[1].toFixed(1)}.`,
          userId: String(bottom[0]),
          team: bottomName,
        });
      }
      if (bestCaptain && bestCaptain.pts >= 15) {
        badges.push({
          emoji: "🔥",
          label: "Armband Genius",
          note: `${bestCaptain.team}'s captain returned ${bestCaptain.pts.toFixed(1)} points.`,
          userId: null,
          team: bestCaptain.team,
        });
      }

      return {
        headline: `${topName} seize the gameweek`,
        topTeam: topName,
        topPoints: Math.round(top[1] * 10) / 10,
        managerCount: ranked.length,
        paragraphs,
        badges,
        generatedAt: Date.now(),
      };
    } catch {
      return null;
    }
  },
});

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
