import { v } from "convex/values";
import { query, mutation, internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireSuperAdmin } from "./lib";
import { GW_STAGES, CHIP_GW1, CHIP_GW2, chipForStage } from "./configDefaults";
import {
  GAMEWEEKS,
  activeGameweek,
  gameweekForStage,
  stagesForGameweek,
  transferLockReason,
} from "./gameweekStructure";
import { stageValidator } from "./schema";
import { resolveMatchWinner } from "./penalties";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// ── Gameweek management (deadlines, locks, settle) ────────────────────────

/**
 * Public gameweek state for the UI: deadline countdowns, manual locks and
 * settle flags per stage, plus the derived "which gameweek is live" answer.
 * Never throws; returns safe defaults for a fresh database (no rows →
 * everything unlocked and open).
 */
export const getGameweekStatus = query({
  args: {},
  handler: async (ctx) => {
    const emptyByStage: Record<
      string,
      { deadlineAt: number | null; locked: boolean; settled: boolean }
    > = {};
    try {
      const rows = await ctx.db.query("gameweeks").collect();
      const byStage: Record<
        string,
        { deadlineAt: number | null; locked: boolean; settled: boolean }
      > = {};
      for (const stage of GW_STAGES) {
        byStage[stage] = { deadlineAt: null, locked: false, settled: false };
      }
      for (const row of rows) {
        byStage[row.stage] = {
          deadlineAt: typeof row.deadlineAt === "number" ? row.deadlineAt : null,
          locked: row.locked === true,
          settled: row.settled === true,
        };
      }
      const now = Date.now();
      // Per-gameweek view: the earliest upcoming deadline drives the panic
      // banner, and `closed` is what the squad builder's read-only mode uses.
      const byGameweek = GAMEWEEKS.map((gw) => {
        const stages = gw.stages.map(
          (s) => byStage[s] ?? { deadlineAt: null, locked: false, settled: false },
        );
        const deadlines = stages
          .map((s) => s.deadlineAt)
          .filter((d): d is number => typeof d === "number" && d > now);
        const nextDeadlineAt = deadlines.length > 0 ? Math.min(...deadlines) : null;
        const settled = stages.every((s) => s.settled === true);
        const locked = stages.some((s) => s.locked === true);
        const expired = stages.some(
          (s) => typeof s.deadlineAt === "number" && now > s.deadlineAt,
        );
        const isClosed = settled || (locked && expired) || expired;
        return {
          number: gw.number,
          label: gw.label,
          shortLabel: gw.shortLabel,
          summary: gw.summary,
          stages: gw.stages,
          settled,
          locked,
          closed: isClosed,
          nextDeadlineAt,
        };
      });

      return {
        byStage,
        byGameweek,
        activeGameweek: activeGameweek(byStage, now),
        lockReason: transferLockReason(byStage, now),
      };
    } catch {
      return {
        byStage: emptyByStage,
        byGameweek: GAMEWEEKS.map((gw) => ({
          number: gw.number,
          label: gw.label,
          shortLabel: gw.shortLabel,
          summary: gw.summary,
          stages: gw.stages,
          settled: false,
          locked: false,
          closed: false,
          nextDeadlineAt: null,
        })),
        activeGameweek: activeGameweek(emptyByStage),
        lockReason: null,
      };
    }
  },
});

/**
 * Deadline gate for mutations: returns the lock reason for a stage, or null
 * when edits are allowed. A stage is closed when it is manually locked, its
 * deadline has passed, or it is already settled.
 */
async function getStageLockReason(
  ctx: QueryCtxLike,
  stage: string,
): Promise<string | null> {
  try {
    const rows = await ctx.db
      .query("gameweeks")
      .withIndex("by_stage", (q) => q.eq("stage", stage as never))
      .collect();
    const row = rows[0];
    if (!row) return null; // unconfigured → open
    const gw = gameweekForStage(stage);
    const gwLabel = gw === 1 ? "Gameweek 1" : gw === 2 ? "Gameweek 2" : "this gameweek";
    if (row.settled === true) return `${gwLabel} has been settled and can no longer be edited.`;
    if (row.locked === true) return `Transfers are locked for ${gwLabel}.`;
    if (typeof row.deadlineAt === "number" && Date.now() > row.deadlineAt) {
      return `The transfer deadline for ${gwLabel} has passed.`;
    }
    return null;
  } catch {
    // Fail-safe: on any error, don't hard-block users.
    return null;
  }
}

type QueryCtxLike = QueryCtx;

/** Public helper for the UI: is the given stage still open for transfers? */
export const isStageOpen = query({
  args: { stage: stageValidator },
  handler: async (ctx, { stage }) => {
    const reason = await getStageLockReason(ctx, stage);
    return { open: reason === null, reason };
  },
});

/** Super Admin: set or clear the transfer deadline for one stage. */
export const setDeadline = mutation({
  args: { stage: stageValidator, deadlineAt: v.optional(v.number()) },
  handler: async (ctx, { stage, deadlineAt }) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Only the Super Admin can set deadlines.",
      );
    }
    try {
      if (!GW_STAGES.includes(stage as (typeof GW_STAGES)[number])) {
        throw new Error("Unknown stage.");
      }
      const ts =
        deadlineAt === undefined || deadlineAt === null ? undefined : Number(deadlineAt);
      if (ts !== undefined && (!Number.isFinite(ts) || ts < 0)) {
        throw new Error("Deadline must be a valid future timestamp.");
      }
      const existing = await ctx.db
        .query("gameweeks")
        .withIndex("by_stage", (q) => q.eq("stage", stage))
        .collect();
      const row = existing[0];
      if (row) {
        await ctx.db.patch(row._id, { deadlineAt: ts });
      } else {
        await ctx.db.insert("gameweeks", { stage, deadlineAt: ts });
      }
      return { stage, deadlineAt: ts ?? null };
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith("Uncaught")) throw err;
      throw new Error("Could not set the deadline — please try again.");
    }
  },
});

/** Super Admin: manually lock/unlock one stage. */
export const setStageLock = mutation({
  args: { stage: stageValidator, locked: v.boolean() },
  handler: async (ctx, { stage, locked }) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Only the Super Admin can lock gameweeks.",
      );
    }
    try {
      const existing = await ctx.db
        .query("gameweeks")
        .withIndex("by_stage", (q) => q.eq("stage", stage))
        .collect();
      const row = existing[0];
      if (row) {
        await ctx.db.patch(row._id, { locked: locked === true });
      } else {
        await ctx.db.insert("gameweeks", { stage, locked: locked === true });
      }
      return { stage, locked: locked === true };
    } catch {
      throw new Error("Could not update the lock — please try again.");
    }
  },
});

// ── "Double Down" chip (one per gameweek, once per tournament) ───────────

/**
 * Arm the one-time Double Down chip for a gameweek. Exactly one chip may be
 * armed across the whole tournament; arming is blocked once that gameweek's
 * deadline has passed, it is locked, or it is settled.
 */
export const activateChip = mutation({
  args: { chip: v.union(v.literal(CHIP_GW1), v.literal(CHIP_GW2)) },
  handler: async (ctx, { chip }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Must be signed in.");
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("Account no longer exists.");

    try {
      const squad = await ctx.db
        .query("squads")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      if (!squad) throw new Error("Save a squad first to use a chip.");

      const stage = chip === CHIP_GW1 ? "semifinal1" : "final";
      const reason = await getStageLockReason(ctx, stage);
      if (reason) throw new Error(reason);

      // EVERY MANAGER GETS EXACTLY ONE chip for the whole tournament.
      //
      // The extra-chip store item has been deleted, so there is no purchased
      // allowance to read: `squad.chipUsed` is the single source of truth and
      // the allocation is therefore strictly equal for all managers.
      const freeRemaining = squad.chipUsed === true ? 0 : 1;

      // An armed chip blocks arming again (one multiplier at a time).
      if (squad.activeChip) {
        throw new Error(
          "You already have a Double Down chip armed for a gameweek.",
        );
      }
      if (freeRemaining === 0) {
        throw new Error(
          "You have already used your one Double Down chip this tournament.",
        );
      }

      await ctx.db.patch(squad._id, {
        activeChip: chip,
        chipUsed: true,
      });

      // Activity feed entry (defensive: never blocks the activation).
      try {
        await ctx.runMutation(internal.activity.logActivity, {
          type: "chip",
          text: `🎯 @${user.username ?? "a manager"} activated the Double Down chip for Gameweek ${chip === CHIP_GW1 ? "1" : "2"} — all points this gameweek count double!`,
          actorUserId: userId,
        });
      } catch {
        // feed failure is non-fatal
      }
      return { chip };
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith("Uncaught")) throw err;
      throw new Error("Could not activate the chip — please try again.");
    }
  },
});

/** Remove an armed (not yet consumed) chip — the manager changed their mind. */
export const deactivateChip = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Must be signed in.");
    try {
      const squad = await ctx.db
        .query("squads")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      if (!squad) return { removed: false };
      if (squad.chipUsed === true) {
        throw new Error("This chip has already been consumed and cannot be removed.");
      }
      await ctx.db.patch(squad._id, { activeChip: undefined });
      return { removed: true };
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith("Uncaught")) throw err;
      throw new Error("Could not remove the chip — please try again.");
    }
  },
});

// ── Settle: chips, wagers, predictions, differential + awards ────────────

/**
 * Super Admin: settle a gameweek (idempotent). Applies the armed Double
 * Down chips to every match score of the gameweek, resolves 1v1 wagers for
 * the gameweek, scores the match-result predictions (+2 per correct pick,
 * granted as a bonus matchScores row), logs rank-shift activity and marks
 * the gameweek settled.
 */
export const settleGameweek = mutation({
  args: { stages: v.array(stageValidator) },
  handler: async (ctx, { stages }) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Only the Super Admin can settle gameweeks.",
      );
    }
    if (!Array.isArray(stages) || stages.length === 0) {
      throw new Error("Pick at least one stage to settle.");
    }
    for (const s of stages) {
      if (!GW_STAGES.includes(s as (typeof GW_STAGES)[number])) {
        throw new Error(`Unknown stage: ${s}`);
      }
    }

    // Idempotency guard: a stage can only be settled once.
    const existingRows = await ctx.db.query("gameweeks").collect();
    for (const s of stages) {
      const row = existingRows.find((r) => r.stage === s);
      if (row?.settled === true) {
        throw new Error(`Gameweek for ${s} has already been settled.`);
      }
    }

    try {
      const stageSet = new Set(stages.map(String));

      // 1) Double Down chips — double every gameweek score for armed squads.
      const squads = await ctx.db.query("squads").collect();
      for (const squad of squads) {
        if (!squad.activeChip) continue;
        const chipStage = squad.activeChip === CHIP_GW1 ? "semifinal1" : "final";
        if (!stageSet.has(chipStage)) continue;
        const scores = await ctx.db
          .query("matchScores")
          .withIndex("by_squad", (q) => q.eq("squadId", squad._id))
          .collect();
        const chipMatches = await ctx.db.query("matches").collect();
        const matchStage = new Map(
          chipMatches.map((m) => [String(m._id), m.stage as string]),
        );
        for (const score of scores) {
          const stage = matchStage.get(String(score.matchId));
          if (!stage || !stageSet.has(stage)) continue;
          await ctx.db.patch(score._id, { points: (Number(score.points) || 0) * 2 });
        }
        await ctx.db.patch(squad._id, { chipUsed: true, activeChip: undefined });
        // A settlement is the natural moment to re-check the reward engine:
        // the gameweek has just been scored, so any feat that just became true
        // is awarded now. Best-effort and fire-and-forget — a reward hiccup
        // must never roll back the score that triggered it. The Super Admin
        // can also run it manually from the audit panel.
        try {
          await ctx.runMutation(internal.rewardsEngine.evaluateRewardsInternal, {});
        } catch {
          // Non-fatal.
        }
        try {
          const owner = await ctx.db.get(squad.userId);
          await ctx.runMutation(internal.activity.logActivity, {
            type: "settled",
            text: `⚡ Double Down resolved for @${owner?.username ?? "a manager"} — Gameweek points doubled!`,
            actorUserId: squad.userId,
          });
        } catch {
          // feed failure is non-fatal
        }
      }

      // 2) 1v1 wagers — compare gameweek totals between the two managers.
      const wagers = await ctx.db
        .query("wagers")
        .withIndex("by_status", (q) => q.eq("status", "accepted"))
        .collect();
      for (const wager of wagers) {
        if (!stageSet.has(wager.stage)) continue;
        const allScores = await ctx.db.query("matchScores").collect();
        const matchStage = new Map(
          (await ctx.db.query("matches").collect()).map((m) => [String(m._id), m.stage as string]),
        );
        const gwTotal = (uid: Id<"users">) =>
          allScores
            .filter(
              (s) =>
                s.userId === uid &&
                stageSet.has(matchStage.get(String(s.matchId)) ?? ""),
            )
            .reduce((sum, s) => sum + (Number(s.points) || 0), 0);

        const challengerTotal = gwTotal(wager.challengerId);
        const opponentTotal = gwTotal(wager.opponentId);
        let winnerId: Id<"users"> | undefined;
        if (challengerTotal > opponentTotal) winnerId = wager.challengerId;
        else if (opponentTotal > challengerTotal) winnerId = wager.opponentId;

        if (winnerId) {
          // Loser pays the stake: append a negative bonus row for the loser
          // and a positive one for the winner.
          const loserId =
            winnerId === wager.challengerId ? wager.opponentId : wager.challengerId;
          const stake = Math.max(0, Math.round(Number(wager.stake) || 0));
          const loserSquad = await ctx.db
            .query("squads")
            .withIndex("by_user", (q) => q.eq("userId", loserId))
            .unique();
          const winnerSquad = await ctx.db
            .query("squads")
            .withIndex("by_user", (q) => q.eq("userId", winnerId))
            .unique();
          if (loserSquad && winnerSquad) {
            const firstMatch = (await ctx.db.query("matches").collect())
              .filter((m) => stageSet.has(m.stage as string))
              .sort((a, b) => a.createdAt - b.createdAt)[0];
            if (firstMatch) {
              await ctx.db.insert("matchScores", {
                matchId: firstMatch._id,
                squadId: loserSquad._id,
                userId: loserId,
                points: -stake,
              });
              await ctx.db.insert("matchScores", {
                matchId: firstMatch._id,
                squadId: winnerSquad._id,
                userId: winnerId,
                points: stake,
              });
            }
          }
        }
        await ctx.db.patch(wager._id, {
          status: "settled" as const,
          winnerId,
          settledAt: Date.now(),
        });
      }

      // 3) Predictions — resolve +2 bonus per correct pick.
      const matches = (await ctx.db.query("matches").collect()).filter((m) =>
        stageSet.has(m.stage as string),
      );
      const preds = await ctx.db.query("predictions").collect();
      for (const pred of preds) {
        if (!stageSet.has(pred.stage)) continue;
        if (pred.correct !== undefined) continue; // already resolved (idempotent)
        const match = matches.find((m) => m.stage === pred.stage);
        if (!match || match.status !== "completed") continue;
        const actualWinner = resolveMatchWinner(match);
        const correct = actualWinner !== null && actualWinner === pred.pick;
        await ctx.db.patch(pred._id, { correct, awarded: correct ? 2 : 0 });
        if (correct) {
          const squad = await ctx.db
            .query("squads")
            .withIndex("by_user", (q) => q.eq("userId", pred.userId))
            .unique();
          if (squad) {
            const anchor = matches.sort((a, b) => a.createdAt - b.createdAt)[0];
            if (anchor) {
              await ctx.db.insert("matchScores", {
                matchId: anchor._id,
                squadId: squad._id,
                userId: pred.userId,
                points: 2,
              });
            }
          }
        }
      }

      // 4) Rank-shift activity + mark rows settled.
      const rows = await ctx.db.query("gameweeks").collect();
      for (const stage of stages) {
        const row = rows.find((r) => r.stage === stage);
        if (row) {
          await ctx.db.patch(row._id, { settled: true, locked: true });
        } else {
          await ctx.db.insert("gameweeks", { stage, settled: true, locked: true });
        }
      }
      try {
        await ctx.runMutation(internal.activity.logRankShifts, {});
      } catch {
        // feed failure is non-fatal
      }
      return { settled: stages.length };
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith("Uncaught")) throw err;
      throw new Error("Could not settle the gameweek — please try again.");
    }
  },
});

// ── Awards, differential metric, hall of fame ────────────────────────────

/**
 * Tournament awards: Tactical Genius (top total), Unlucky Manager (lowest
 * total), Differential Master (most points from players owned by <15% of
 * managers) and Player of the Week (top fantasy scorer among the latest
 * completed matches). Every section degrades to null independently.
 */
export const getTournamentAwards = query({
  args: {},
  handler: async (ctx) => {
    const empty = {
      tacticalGenius: null as { userId: Id<"users">; username: string; teamName: string; totalPoints: number } | null,
      unluckyManager: null as { userId: Id<"users">; username: string; teamName: string; totalPoints: number } | null,
      differentialMaster: null as { userId: Id<"users">; username: string; teamName: string; diffPoints: number } | null,
      playerOfTheWeek: null as { playerId: Id<"players">; playerName: string; house: string; points: number } | null,
    };
    try {
      const squads = await ctx.db.query("squads").collect();
      if (squads.length === 0) return empty;

      const scores = await ctx.db.query("matchScores").collect();
      const totals = new Map<string, number>();
      for (const s of scores) {
        totals.set(s.userId, (totals.get(s.userId) ?? 0) + (Number(s.points) || 0));
      }
      const users = await ctx.db.query("users").collect();
      const byId = new Map(users.map((u) => [u._id, u]));

      // Tactical Genius + Unlucky Manager.
      let topId: string | null = null;
      let lowId: string | null = null;
      let topPts = -Infinity;
      let lowPts = Infinity;
      for (const [uid, pts] of totals) {
        if (pts > topPts) { topPts = pts; topId = uid; }
        if (pts < lowPts) { lowPts = pts; lowId = uid; }
      }
      if (topId) {
        const u = byId.get(topId as Id<"users">);
        if (u) {
          empty.tacticalGenius = {
            userId: u._id,
            username: u.username ?? "unknown",
            teamName: u.teamName ?? "Unnamed team",
            totalPoints: topPts,
          };
        }
      }
      if (lowId && lowId !== topId) {
        const u = byId.get(lowId as Id<"users">);
        if (u) {
          empty.unluckyManager = {
            userId: u._id,
            username: u.username ?? "unknown",
            teamName: u.teamName ?? "Unnamed team",
            totalPoints: lowPts,
          };
        }
      }

      // Differential Master: points earned from players picked by <15% of
      // all squads. Score rows are stored per squad, so differential points
      // are attributed as each squad's per-player average × its low-owned
      // player count — a stable approximation that works for every squad.
      const ownership = new Map<string, number>();
      for (const squad of squads) {
        for (const pid of squad.playerIds ?? []) {
          ownership.set(String(pid), (ownership.get(String(pid)) ?? 0) + 1);
        }
      }
      const totalSquads = Math.max(squads.length, 1);
      const diffByUser = new Map<string, number>();
      for (const squad of squads) {
        const lowOwned = (squad.playerIds ?? []).filter((pid) => {
          const pickedBy = ownership.get(String(pid)) ?? 0;
          return totalSquads > 0 && pickedBy / totalSquads < 0.15;
        });
        if (lowOwned.length === 0) continue;
        const squadTotal = scores
          .filter((s) => s.squadId === squad._id)
          .reduce((sum, s) => sum + (Number(s.points) || 0), 0);
        const perPlayer = squadTotal / Math.max(squad.playerIds.length, 1);
        const diffPts = Math.round(perPlayer * lowOwned.length);
        diffByUser.set(squad.userId, (diffByUser.get(squad.userId) ?? 0) + diffPts);
      }
      let diffTop: string | null = null;
      let diffTopPts = 0;
      for (const [uid, pts] of diffByUser) {
        if (pts > diffTopPts) { diffTopPts = pts; diffTop = uid; }
      }
      if (diffTop && diffTopPts > 0) {
        const u = byId.get(diffTop as Id<"users">);
        if (u) {
          empty.differentialMaster = {
            userId: u._id,
            username: u.username ?? "unknown",
            teamName: u.teamName ?? "Unnamed team",
            diffPoints: diffTopPts,
          };
        }
      }

      // Player of the Week: top fantasy scorer among the latest completed
      // gameweek's matches (matches created closest to the newest one).
      const allMatches = (await ctx.db.query("matches").collect())
        .filter((m) => m.status === "completed")
        .sort((a, b) => b.createdAt - a.createdAt);
      const mpRows = await ctx.db.query("matchPlayers").collect();
      if (allMatches.length > 0) {
        const newest = allMatches[0].createdAt;
        const latestSet = new Set(
          allMatches
            .filter((m) => Math.abs(newest - m.createdAt) < 1000 * 60 * 60 * 48)
            .map((m) => String(m._id)),
        );
        const pool = latestSet.size > 0
          ? mpRows.filter((mp) => latestSet.has(String(mp.matchId)))
          : mpRows;
        const top = pool
          .slice()
          .sort((a, b) => (Number(b.fantasyPoints) || 0) - (Number(a.fantasyPoints) || 0))[0];
        if (top) {
          const player = await ctx.db.get(top.playerId);
          if (player) {
            empty.playerOfTheWeek = {
              playerId: player._id,
              playerName: player.name,
              house: player.house,
              points: Number(top.fantasyPoints) || 0,
            };
          }
        }
      }

      return empty;
    } catch {
      return empty;
    }
  },
});

/**
 * House standings: total points and average points per manager for each of
 * the four houses. A manager counts toward the house most represented in
 * their squad (ties → first found). Safe at 0 squads — averages use
 * Math.max(count, 1) so no division by zero can occur.
 */
export const getHouseStandings = query({
  args: {},
  handler: async (ctx) => {
    const safe = () =>
      ("Fire|Earth|Wind|Water".split("|")).map((house) => ({
        house,
        totalPoints: 0,
        managerCount: 0,
        avgPoints: 0,
      }));
    try {
      const squads = await ctx.db.query("squads").collect();
      if (squads.length === 0) return safe();

      const players = await ctx.db.query("players").collect();
      const houseByPlayer = new Map(players.map((p) => [String(p._id), p.house]));
      const scores = await ctx.db.query("matchScores").collect();
      const totals = new Map<string, number>();
      for (const s of scores) {
        totals.set(s.userId, (totals.get(s.userId) ?? 0) + (Number(s.points) || 0));
      }

      const buckets = new Map<
        string,
        { totalPoints: number; managerCount: number }
      >();
      for (const squad of squads) {
        const counts = new Map<string, number>();
        for (const pid of squad.playerIds ?? []) {
          const house = houseByPlayer.get(String(pid));
          if (!house) continue;
          counts.set(house, (counts.get(house) ?? 0) + 1);
        }
        let best = "";
        let bestN = 0;
        for (const [house, n] of counts) {
          if (n > bestN) { best = house; bestN = n; }
        }
        if (!best) continue;
        const cur = buckets.get(best) ?? { totalPoints: 0, managerCount: 0 };
        cur.totalPoints += totals.get(squad.userId) ?? 0;
        cur.managerCount += 1;
        buckets.set(best, cur);
      }

      return ("Fire|Earth|Wind|Water".split("|")).map((house) => {
        const b = buckets.get(house) ?? { totalPoints: 0, managerCount: 0 };
        return {
          house,
          totalPoints: b.totalPoints,
          managerCount: b.managerCount,
          avgPoints: Math.round((b.totalPoints / Math.max(b.managerCount, 1)) * 10) / 10,
        };
      });
    } catch {
      return safe();
    }
  },
});

/**
 * Tournament stat races: Golden Boot (top goalscorer) and Golden Glove
 * (top clean-sheet GK/DEF). Null-safe at 0 matches.
 */
export const getTournamentStats = query({
  args: {},
  handler: async (ctx) => {
    const empty = {
      goldenBoot: null as { playerId: Id<"players">; playerName: string; house: string; goals: number } | null,
      goldenGlove: null as { playerId: Id<"players">; playerName: string; house: string; cleanSheets: number } | null,
      matchesPlayed: 0,
    };
    try {
      const mpRows = await ctx.db.query("matchPlayers").collect();
      const matches = await ctx.db.query("matches").collect();
      empty.matchesPlayed = matches.filter((m) => m.status === "completed").length;
      if (mpRows.length === 0) return empty;

      const players = await ctx.db.query("players").collect();
      const byId = new Map(players.map((p) => [String(p._id), p]));

      const goals = new Map<string, number>();
      const cleanSheets = new Map<string, number>();
      for (const mp of mpRows) {
        const key = String(mp.playerId);
        goals.set(key, (goals.get(key) ?? 0) + (Number(mp.goals) || 0));
        if ((Number(mp.saves) || 0) >= 0 && mp.cleanSheet === true) {
          cleanSheets.set(key, (cleanSheets.get(key) ?? 0) + 1);
        }
      }

      let bootId: string | null = null;
      let bootGoals = 0;
      for (const [pid, g] of goals) {
        if (g > bootGoals) { bootGoals = g; bootId = pid; }
      }
      if (bootId && bootGoals > 0) {
        const p = byId.get(bootId);
        if (p) {
          empty.goldenBoot = { playerId: p._id, playerName: p.name, house: p.house, goals: bootGoals };
        }
      }

      // Golden Glove: most clean sheets among GK/DEF.
      let gloveId: string | null = null;
      let gloveCs = 0;
      for (const [pid, cs] of cleanSheets) {
        const p = byId.get(pid);
        if (!p || (p.position !== "GK" && p.position !== "DEF")) continue;
        if (cs > gloveCs) { gloveCs = cs; gloveId = pid; }
      }
      if (gloveId && gloveCs > 0) {
        const p = byId.get(gloveId);
        if (p) {
          empty.goldenGlove = { playerId: p._id, playerName: p.name, house: p.house, cleanSheets: gloveCs };
        }
      }
      return empty;
    } catch {
      return empty;
    }
  },
});

/**
 * Super Admin: finalize (or un-finalize) the tournament. Finalizing unlocks
 * the Hall of Fame podium app-wide and logs a feed announcement.
 */
export const finalizeTournament = mutation({
  args: { finalized: v.boolean() },
  handler: async (ctx, { finalized }) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Only the Super Admin can finalize the tournament.",
      );
    }
    try {
      const rows = await ctx.db.query("config").collect();
      const existing = rows.find((r) => r.key === "tournamentFinalized");
      if (existing) {
        await ctx.db.patch(existing._id, { value: finalized === true });
      } else {
        await ctx.db.insert("config", {
          key: "tournamentFinalized",
          value: finalized === true,
        });
      }
      if (finalized === true) {
        try {
          await ctx.runMutation(internal.activity.logActivity, {
            type: "settled",
            text: `🏆 The tournament has concluded — the Hall of Fame is now live. Thanks for playing!`,
          });
        } catch {
          // feed failure is non-fatal
        }
      }
      return { finalized: finalized === true };
    } catch {
      throw new Error("Could not finalize the tournament — please try again.");
    }
  },
});

/**
 * Hall of Fame: unlocked once the Super Admin finalizes the tournament.
 * Returns finalized=false until then; every section is independently
 * null-safe so a partially-populated database still renders a podium.
 */
export const getHallOfFame = query({
  args: {},
  handler: async (ctx) => {
    const empty = {
      finalized: false,
      podium: [] as Array<{ userId: Id<"users">; username: string; teamName: string; totalPoints: number; rank: number }>,
      championHouse: null as { house: string; points: number; avgPoints: number } | null,
      mvpPlayer: null as { playerId: Id<"players">; playerName: string; house: string; totalPoints: number } | null,
    };
    try {
      const configRows = await ctx.db.query("config").collect();
      const finalized = configRows.some(
        (r) => r.key === "tournamentFinalized" && r.value === true,
      );
      if (!finalized) return empty;

      const squads = await ctx.db.query("squads").collect();
      const scores = await ctx.db.query("matchScores").collect();
      const users = await ctx.db.query("users").collect();
      const byId = new Map(users.map((u) => [u._id, u]));

      const totals = new Map<string, number>();
      for (const s of scores) {
        totals.set(s.userId, (totals.get(s.userId) ?? 0) + (Number(s.points) || 0));
      }
      const podium = [...totals.entries()]
        .map(([uid, pts]) => ({ uid, pts }))
        .sort((a, b) => b.pts - a.pts)
        .slice(0, 3)
        .map(({ uid, pts }, i) => {
          const u = byId.get(uid as Id<"users">);
          return {
            userId: (uid as Id<"users">),
            username: u?.username ?? "unknown",
            teamName: u?.teamName ?? "Unnamed team",
            totalPoints: pts,
            rank: i + 1,
          };
        });
      empty.podium = podium;

      // House champion: highest average points per house. A manager's house
      // = the most-represented house in their 7 (ties → first found).
      const houseTotals = new Map<string, { sum: number; count: number }>();
      const playerHouse = new Map<string, string>();
      const allPlayers = await ctx.db.query("players").collect();
      for (const p of allPlayers) playerHouse.set(String(p._id), p.house);
      for (const squad of squads) {
        const counts = new Map<string, number>();
        for (const pid of squad.playerIds ?? []) {
          const house = playerHouse.get(String(pid));
          if (house) counts.set(house, (counts.get(house) ?? 0) + 1);
        }
        let best = "";
        let bestN = 0;
        for (const [house, n] of counts) {
          if (n > bestN) { best = house; bestN = n; }
        }
        if (!best) continue;
        const cur = houseTotals.get(best) ?? { sum: 0, count: 0 };
        cur.sum += totals.get(squad.userId) ?? 0;
        cur.count += 1;
        houseTotals.set(best, cur);
      }
      let champ: { house: string; points: number; avgPoints: number } | null = null;
      for (const [house, { sum, count }] of houseTotals) {
        const avg = sum / Math.max(count, 1);
        if (!champ || avg > champ.avgPoints) {
          champ = { house, points: sum, avgPoints: Math.round(avg * 10) / 10 };
        }
      }
      empty.championHouse = champ;

      // Tournament MVP: player with the highest accumulated fantasy points.
      const mpRows = await ctx.db.query("matchPlayers").collect();
      const playerPts = new Map<string, number>();
      for (const mp of mpRows) {
        playerPts.set(
          mp.playerId,
          (playerPts.get(mp.playerId) ?? 0) + (Number(mp.fantasyPoints) || 0),
        );
      }
      let mvpId: string | null = null;
      let mvpPts = 0;
      for (const [pid, pts] of playerPts) {
        if (pts > mvpPts) { mvpPts = pts; mvpId = pid; }
      }
      if (mvpId) {
        const p = await ctx.db.get(mvpId as Id<"players">);
        if (p) {
          empty.mvpPlayer = {
            playerId: p._id,
            playerName: p.name,
            house: p.house,
            totalPoints: mvpPts,
          };
        }
      }

      return empty;
    } catch {
      return empty;
    }
  },
});
