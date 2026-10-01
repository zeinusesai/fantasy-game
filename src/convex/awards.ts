import { v } from "convex/values";
import { query, internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal as internalApi } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// ── Live weekly tournament awards engine ────────────────────────────────
//
// `recalculateAwards` recomputes every award from the current matchScores
// and matchPlayers data and rewrites the singleton `awards` snapshot. It is
// invoked from `matches.recalculateMatchPoints`, which every match mutation
// already calls — so awards stay correct automatically after ANY match edit
// (score, timeline event, lineup, ratings, PotM) with no manual reset and no
// admin action required.
//
// Everything is defensive: a missing squad, a deleted user or a deleted
// player degrades that ONE award to "not awarded" instead of failing the
// whole recalculation (and therefore the match mutation that triggered it).

type AwardUser = {
  userId: Id<"users">;
  username: string;
  teamName: string;
  points: number;
};

const EMPTY_AWARDS = {
  tacticalGenius: null as AwardUser | null,
  unluckyManager: null as AwardUser | null,
  differentialMaster: null as AwardUser | null,
  playerOfTheWeek: null as {
    playerId: Id<"players">;
    playerName: string;
    house: string;
    points: number;
  } | null,
  updatedAt: null as number | null,
};

/**
 * Deterministic tie-breaker: higher points wins; on a tie the manager whose
 * squad was created/registered earliest wins (stable, explainable, and it
 * never depends on iteration order).
 */
function compareByPoints(
  a: { userId: string; points: number; firstSeen: number },
  b: { userId: string; points: number; firstSeen: number },
): number {
  if (b.points !== a.points) return b.points - a.points;
  if (a.firstSeen !== b.firstSeen) return a.firstSeen - b.firstSeen;
  return String(a.userId).localeCompare(String(b.userId));
}

/**
 * Compute the current awards. Pure with respect to the database — reads
 * only, never writes, never throws.
 */
async function computeAwards(ctx: QueryCtx | MutationCtx) {
  const out = { ...EMPTY_AWARDS };
  try {
    const squads = await ctx.db.query("squads").collect();
    if (squads.length === 0) return out;

    const scores = await ctx.db.query("matchScores").collect();
    const users = await ctx.db.query("users").collect();
    const players = await ctx.db.query("players").collect();

    const userById = new Map(users.map((u) => [u._id, u]));
    const playerById = new Map(players.map((p) => [p._id, p]));

    // ── Per-manager totals ──
    const totals = new Map<string, number>();
    // Squads without any score row still count as 0 so a manager who hasn't
    // scored yet can legitimately be "Unlucky Manager".
    const firstSeen = new Map<string, number>();
    for (const squad of squads) {
      const uid = String(squad.userId);
      if (!firstSeen.has(uid)) firstSeen.set(uid, squad._creationTime ?? 0);
      if (!totals.has(uid)) totals.set(uid, 0);
    }
    for (const s of scores) {
      const uid = String(s.userId);
      totals.set(uid, (totals.get(uid) ?? 0) + (Number(s.points) || 0));
    }

    const entries = [...totals.entries()].map(([uid, points]) => ({
      userId: uid,
      points,
      firstSeen: firstSeen.get(uid) ?? 0,
    }));
    if (entries.length === 0) return out;

    const ranked = entries.slice().sort(compareByPoints);

    // ── Performance-badge gate ──────────────────────────────────────────
    // Before kickoff (or after a "Reset All Points") EVERY manager sits at
    // exactly 0. Ranking that table would hand "Tactical Genius" to whoever
    // happened to be registered first and "Unlucky Manager" to the rest —
    // pure noise that reads as a bug. Performance badges therefore only
    // compute once at least one manager has actually banked points.
    //
    // `some(points !== 0)` (rather than `some(points > 0)`) so a penalty-only
    // round, which can legitimately push totals negative, still counts as
    // "the tournament has started".
    const anyPointsScored = entries.some((e) => e.points !== 0);

    const toAwardUser = (
      e: { userId: string; points: number } | undefined,
    ): AwardUser | null => {
      if (!e) return null;
      const u = userById.get(e.userId as Id<"users">);
      // Deleted user with an orphaned squad — skip rather than crash.
      if (!u) return null;
      return {
        userId: u._id,
        username: u.username ?? "unknown",
        teamName: u.teamName ?? "Unnamed team",
        points: Math.round(e.points),
      };
    };

    // Tactical Genius = highest total. Unlucky Manager = lowest total, but
    // never the same person — if there's only one manager, no "unlucky" tag.
    if (anyPointsScored) {
      out.tacticalGenius = toAwardUser(ranked[0]);
      if (ranked.length > 1) {
        out.unluckyManager = toAwardUser(ranked[ranked.length - 1]);
      }
    }

    // ── Differential Master ──
    // Points attributed to players owned by fewer than 15% of managers.
    // Score rows are per squad, so a squad's points are split evenly across
    // its low-owned players — a stable, explainable approximation.
    const ownership = new Map<string, number>();
    for (const squad of squads) {
      for (const pid of squad.playerIds ?? []) {
        ownership.set(String(pid), (ownership.get(String(pid)) ?? 0) + 1);
      }
    }
    const totalSquads = Math.max(squads.length, 1);
    const DIFF_THRESHOLD = 0.15;
    const diffByUser = new Map<string, number>();
    for (const squad of squads) {
      const lowOwned = (squad.playerIds ?? []).filter((pid) => {
        const pickedBy = ownership.get(String(pid)) ?? 0;
        return pickedBy / totalSquads < DIFF_THRESHOLD;
      });
      if (lowOwned.length === 0) continue;
      const squadTotal = scores
        .filter((s) => s.squadId === squad._id)
        .reduce((sum, s) => sum + (Number(s.points) || 0), 0);
      const perPlayer = squadTotal / Math.max(squad.playerIds.length, 1);
      const diffPts = Math.round(perPlayer * lowOwned.length);
      const uid = String(squad.userId);
      diffByUser.set(uid, (diffByUser.get(uid) ?? 0) + diffPts);
    }
    const diffRanked = [...diffByUser.entries()]
      .map(([uid, points]) => ({ userId: uid, points, firstSeen: firstSeen.get(uid) ?? 0 }))
      .filter((e) => e.points > 0)
      .sort(compareByPoints);
    if (diffRanked.length > 0) {
      out.differentialMaster = toAwardUser(diffRanked[0]);
    }

    // ── Player of the Week ──
    // Top fantasy scorer from the most recent gameweek that has any recorded
    // player performance. Determined by match createdAt (newest first), so
    // GW2's performances automatically displace GW1's.
    const completedMatches = (await ctx.db.query("matches").collect())
      .filter((m) => m.status === "completed")
      .sort((a, b) => b.createdAt - a.createdAt);
    if (completedMatches.length > 0) {
      const newestGw = completedMatches[0].createdAt;
      // Everything created within 48h of the newest match = latest gameweek.
      const latestIds = new Set(
        completedMatches
          .filter((m) => Math.abs(newestGw - m.createdAt) < 1000 * 60 * 60 * 48)
          .map((m) => String(m._id)),
      );
      const mpRows = await ctx.db.query("matchPlayers").collect();
      const pool = mpRows.filter((mp) => latestIds.has(String(mp.matchId)));
      const best = pool
        .slice()
        .sort((a, b) => (Number(b.fantasyPoints) || 0) - (Number(a.fantasyPoints) || 0))[0];
      // Require a non-zero score: a completed match whose player rows are all
      // 0 hasn't produced a genuine "Player of the Week".
      if (best && (Number(best.fantasyPoints) || 0) > 0) {
        const player = playerById.get(best.playerId);
        if (player) {
          out.playerOfTheWeek = {
            playerId: player._id,
            playerName: player.name,
            house: player.house,
            points: Number(best.fantasyPoints) || 0,
          };
        }
      }
    }

    return out;
  } catch {
    return { ...EMPTY_AWARDS };
  }
}

/**
 * Internal: recompute every award and persist the snapshot. Called after
 * every match mutation. Never throws — an award refresh must never roll back
 * the match that triggered it.
 */
export const recalculateAwards = internalMutation({
  args: {},
  handler: async (ctx) => {
    try {
      const a = await computeAwards(ctx);
      const patch: Record<string, unknown> = {
        tacticalGeniusUserId: a.tacticalGenius?.userId,
        tacticalGeniusName: a.tacticalGenius?.username,
        tacticalGeniusTeam: a.tacticalGenius?.teamName,
        tacticalGeniusPoints: a.tacticalGenius?.points,
        unluckyUserId: a.unluckyManager?.userId,
        unluckyName: a.unluckyManager?.username,
        unluckyTeam: a.unluckyManager?.teamName,
        unluckyPoints: a.unluckyManager?.points,
        differentialUserId: a.differentialMaster?.userId,
        differentialName: a.differentialMaster?.username,
        differentialTeam: a.differentialMaster?.teamName,
        differentialPoints: a.differentialMaster?.points,
        playerOfWeekId: a.playerOfTheWeek?.playerId,
        playerOfWeekName: a.playerOfTheWeek?.playerName,
        playerOfWeekHouse: a.playerOfTheWeek?.house,
        playerOfWeekPoints: a.playerOfTheWeek?.points,
        updatedAt: Date.now(),
      };
      // Any winner that is `undefined` above is patched as undefined, which
      // removes the field server-side — so a stale champion can never linger
      // on the leaderboard after a correction.
      const rows = await ctx.db.query("awards").collect();
      const previous = rows[0];
      if (previous) {
        await ctx.db.patch(previous._id, patch as never);
      } else {
        await ctx.db.insert("awards", patch as never);
      }

      // Announce to the community feed ONLY when a winner actually changed.
      // Without this comparison every match tweak (a rating edit, a timeline
      // event) would append a duplicate feed card.
      try {
        const geniusChanged =
          (previous?.tacticalGeniusUserId ?? null) !==
          (a.tacticalGenius?.userId ?? null);
        const potwChanged =
          (previous?.playerOfWeekId ?? null) !== (a.playerOfTheWeek?.playerId ?? null);
        const notes: string[] = [];
        if (geniusChanged && a.tacticalGenius) {
          notes.push(
            `🧠 @${a.tacticalGenius.username} holds the "Tactical Genius" award with ${a.tacticalGenius.points} pts.`,
          );
        }
        if (potwChanged && a.playerOfTheWeek) {
          notes.push(
            `👑 ${a.playerOfTheWeek.playerName} (${a.playerOfTheWeek.house}) is Player of the Week with ${a.playerOfTheWeek.points} pts.`,
          );
        }
        if (notes.length > 0) {
          await ctx.runMutation(internalApi.activity.logActivity, {
            type: "settled",
            text: notes.join(" "),
          });
        }
      } catch {
        // feed failure is non-fatal
      }

      return { ok: true, updatedAt: patch.updatedAt };
    } catch {
      return { ok: false };
    }
  },
});

/**
 * Public: the current awards. Served from the persisted snapshot (fast and
 * consistent), and computed live as a fallback when no snapshot exists yet —
 * so a fresh database shows real awards immediately rather than blanks.
 *
 * Every award is independently null-safe: a partially-populated database
 * yields `null` for the awards it cannot determine, never an exception.
 */
export const getAwards = query({
  args: {},
  handler: async (ctx) => {
    try {
      const rows = await ctx.db.query("awards").collect();
      const row = rows[0];
      if (row && typeof row.updatedAt === "number") {
        const tactical =
          typeof row.tacticalGeniusUserId === "string"
            ? {
                userId: row.tacticalGeniusUserId,
                username: row.tacticalGeniusName ?? "unknown",
                teamName: row.tacticalGeniusTeam ?? "Unnamed team",
                points: row.tacticalGeniusPoints ?? 0,
              }
            : null;
        const unlucky =
          typeof row.unluckyUserId === "string"
            ? {
                userId: row.unluckyUserId,
                username: row.unluckyName ?? "unknown",
                teamName: row.unluckyTeam ?? "Unnamed team",
                points: row.unluckyPoints ?? 0,
              }
            : null;
        const differential =
          typeof row.differentialUserId === "string"
            ? {
                userId: row.differentialUserId,
                username: row.differentialName ?? "unknown",
                teamName: row.differentialTeam ?? "Unnamed team",
                points: row.differentialPoints ?? 0,
              }
            : null;
        const potw =
          typeof row.playerOfWeekId === "string"
            ? {
                playerId: row.playerOfWeekId,
                playerName: row.playerOfWeekName ?? "Unknown",
                house: row.playerOfWeekHouse ?? "—",
                points: row.playerOfWeekPoints ?? 0,
              }
            : null;
        return {
          tacticalGenius: tactical,
          unluckyManager: unlucky,
          differentialMaster: differential,
          playerOfTheWeek: potw,
          updatedAt: row.updatedAt,
        };
      }
      // No snapshot yet (fresh DB, or matches recorded before this release)
      // → compute live so the UI is never blank.
      const live = await computeAwards(ctx);
      return { ...live, updatedAt: null };
    } catch {
      return { ...EMPTY_AWARDS };
    }
  },
});

/** Super Admin: force an award refresh without touching a match. */
export const refreshAwards = internalMutation({
  args: {},
  handler: async (ctx) => {
    try {
      const a = await computeAwards(ctx);
      const patch: Record<string, unknown> = {
        tacticalGeniusUserId: a.tacticalGenius?.userId,
        tacticalGeniusName: a.tacticalGenius?.username,
        tacticalGeniusTeam: a.tacticalGenius?.teamName,
        tacticalGeniusPoints: a.tacticalGenius?.points,
        unluckyUserId: a.unluckyManager?.userId,
        unluckyName: a.unluckyManager?.username,
        unluckyTeam: a.unluckyManager?.teamName,
        unluckyPoints: a.unluckyManager?.points,
        differentialUserId: a.differentialMaster?.userId,
        differentialName: a.differentialMaster?.username,
        differentialTeam: a.differentialMaster?.teamName,
        differentialPoints: a.differentialMaster?.points,
        playerOfWeekId: a.playerOfTheWeek?.playerId,
        playerOfWeekName: a.playerOfTheWeek?.playerName,
        playerOfWeekHouse: a.playerOfTheWeek?.house,
        playerOfWeekPoints: a.playerOfTheWeek?.points,
        updatedAt: Date.now(),
      };
      const rows = await ctx.db.query("awards").collect();
      if (rows[0]) {
        await ctx.db.patch(rows[0]._id, patch as never);
      } else {
        await ctx.db.insert("awards", patch as never);
      }
      return { ok: true };
    } catch {
      return { ok: false };
    }
  },
});
