// ── Earned cosmetic reward engine (SERVER) ──────────────────────────────
//
// This module replaces the old manual-cash store entirely. There is no
// purchase, no price, no currency and no queue here — every cosmetic is EARNED.
//
// It has four jobs:
//   1. Assemble a per-manager, per-gameweek `ManagerGameweekSnapshot` from the
//      real match data (squads, matchScores, matchPlayers, matches).
//   2. Hand those snapshots to the PURE rules in `rewards.ts` and write any
//      newly-unlocked cosmetics into `cosmeticUnlocks`.
//   3. Serve the Hall of Fame showcase (what's unlocked, what it's working
//      toward, what's equipped).
//   4. Serve the Super Admin audit + override panel (GW1 standings, which
//      feat triggered, what was awarded, and any roll-down).
//
// EVALUATION IS IDEMPOTENT. Re-running it never double-grants: an unlock is an
// upsert keyed by (userId, cosmeticId), and a reward already held is left
// exactly as it is — including its `equipped` flag, so re-evaluating can never
// silently unequip something a manager chose.
//
// FAIRNESS: nothing here touches a budget, a chip, or a score. Cosmetics are
// purely visual and are awarded after the fact.

import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUser, requireSuperAdmin } from "./lib";
import { FIXED_MANAGER_BUDGET } from "./configDefaults";
import type { Id } from "./_generated/dataModel";
import {
  COSMETICS,
  FEATS,
  PODIUM_SIZE,
  cosmeticById,
  computeGw1Podium,
  evaluateGameweekSnapshot,
  featById,
  gameweekForStage,
  type CosmeticId,
  type FeatProgress,
  type ManagerGameweekSnapshot,
  type Standing,
} from "./rewards";

// ── Shared data assembly ────────────────────────────────────────────────

/** Per-manager working data, keyed by user id. */
interface ManagerFacts {
  userId: string;
  /** Squad creation time — the deterministic tie-breaker for podiums. */
  firstSeen: number;
  captainId: string | null;
  /** Ids of the starting defenders + goalkeeper (the Iron Defence set). */
  defensiveIds: Set<string>;
  totalSpent: number;
  /** Points per gameweek, accumulated from `matchScores`. */
  points: Record<number, number>;
  /** Captain goals per gameweek. */
  captainGoals: Record<number, number>;
  /** Clean sheets kept by the defensive set, per gameweek. */
  cleanSheets: Record<number, number>;
  /** Defensive players tracked per gameweek (the denominator). */
  defensiveTracked: Record<number, number>;
  /** Substitute contributions per gameweek. */
  benchPoints: Record<number, number>;
}

const bump = (bag: Record<number, number>, key: number, by: number) => {
  bag[key] = (bag[key] ?? 0) + by;
};

const emptyManager = (userId: string): ManagerFacts => ({
  userId,
  firstSeen: Number.MAX_SAFE_INTEGER,
  captainId: null,
  defensiveIds: new Set<string>(),
  totalSpent: 0,
  points: {},
  captainGoals: {},
  cleanSheets: {},
  defensiveTracked: {},
  benchPoints: {},
});

/**
 * Build one snapshot per (manager, gameweek) from the live match data.
 *
 * TOTAL with respect to the database: every read is wrapped so a missing
 * table or a corrupt row yields an empty result rather than throwing. (The
 * pure rules in `rewards.ts` are what guarantee a snapshot can never crash
 * the evaluator.)
 */
async function buildSnapshots(
  ctx: QueryCtx | MutationCtx,
): Promise<Map<string, ManagerGameweekSnapshot[]>> {
  const facts = new Map<string, ManagerFacts>();
  const byFact = (userId: string): ManagerFacts => {
    let f = facts.get(userId);
    if (!f) {
      f = emptyManager(userId);
      facts.set(userId, f);
    }
    return f;
  };

  // ── 1. Squads: the starting XI, the captain, and what was spent ──
  const playersById = new Map<string, { position: string }>();
  try {
    const players = await ctx.db.query("players").collect();
    for (const p of players) playersById.set(String(p._id), p);
  } catch {
    // No players table yet — the defensive set stays empty, so Iron Defence
    // correctly cannot trigger.
  }

  try {
    const squads = await ctx.db.query("squads").collect();
    for (const squad of squads) {
      const f = byFact(String(squad.userId));
      f.firstSeen = Math.min(f.firstSeen, squad._creationTime ?? 0);
      f.captainId = String(squad.captainId);
      f.totalSpent =
        typeof squad.totalSpent === "number" && Number.isFinite(squad.totalSpent)
          ? squad.totalSpent
          : 0;
      for (const id of squad.playerIds) {
        const player = playersById.get(String(id));
        // Iron Defence covers the keeper AND every starting defender.
        if (player && (player.position === "GK" || player.position === "DEF")) {
          f.defensiveIds.add(String(id));
        }
      }
    }
  } catch {
    return new Map();
  }

  // ── 2. Match stage → gameweek lookup ──
  const stageOfMatch = new Map<string, number>();
  const startersOfMatch = new Map<string, Set<string>>();
  try {
    const matches = await ctx.db.query("matches").collect();
    for (const match of matches) {
      const gw = gameweekForStage(match.stage);
      if (gw === null) continue; // legacy group_stage is not a gameweek
      stageOfMatch.set(String(match._id), gw);

      // Which players actually STARTED, so bench contributions can be told
      // apart from starter contributions. Falls back to the predicted lineup
      // (set before kickoff) when the real sheet hasn't landed.
      const starters = new Set<string>();
      const lineup = match.lineups ?? match.expectedLineups;
      if (lineup) {
        for (const id of lineup.homeStarters ?? []) starters.add(String(id));
        for (const id of lineup.awayStarters ?? []) starters.add(String(id));
      }
      startersOfMatch.set(String(match._id), starters);
    }
  } catch {
    return new Map();
  }

  // ── 3. Points from `matchScores` ──
  try {
    const scores = await ctx.db.query("matchScores").collect();
    for (const score of scores) {
      const gw = stageOfMatch.get(String(score.matchId));
      if (gw === undefined) continue;
      const f = byFact(String(score.userId));
      const points =
        typeof score.points === "number" && Number.isFinite(score.points)
          ? score.points
          : 0;
      bump(f.points, gw, points);
    }
  } catch {
    // A missing score table means nobody has scored — the evaluator simply
    // produces no unlocks.
  }

  // ── 4. Per-player stat lines → captain goals, clean sheets, bench ──
  try {
    const rows = await ctx.db.query("matchPlayers").collect();
    for (const row of rows) {
      const gw = stageOfMatch.get(String(row.matchId));
      if (gw === undefined) continue;
      const playerId = String(row.playerId);
      const starters = startersOfMatch.get(String(row.matchId));
      const started = starters ? starters.has(playerId) : true;

      for (const f of facts.values()) {
        // Only the manager who actually OWNS this player is credited.
        const owns = f.captainId === playerId || f.defensiveIds.has(playerId);
        if (!owns && !started) continue;

        if (f.captainId === playerId) {
          bump(
            f.captainGoals,
            gw,
            typeof row.goals === "number" && Number.isFinite(row.goals)
              ? row.goals
              : 0,
          );
        }
        if (f.defensiveIds.has(playerId)) {
          bump(f.defensiveTracked, gw, 1);
          if (row.cleanSheet === true) bump(f.cleanSheets, gw, 1);
        }
        // ── BENCH POINTS ──
        // A substitute is a player the manager owns who did NOT start the
        // match. Their fantasy points count toward the Clutch Performer feat.
        //
        // Note: this platform's squads are a 7-a-side with no separate bench,
        // so "bench" here means a squad member who came off the bench in the
        // real fixture. When no such player exists the feat correctly reads
        // 0 points and cannot trigger.
        if (f.defensiveIds.has(playerId) || f.captainId === playerId) {
          if (!started) {
            bump(
              f.benchPoints,
              gw,
              typeof row.fantasyPoints === "number" &&
                Number.isFinite(row.fantasyPoints)
                ? row.fantasyPoints
                : 0,
            );
          }
        }
      }
    }
  } catch {
    // No stat lines yet — only points-based feats can trigger.
  }

  // ── 5. Assemble snapshots ──
  const out = new Map<string, ManagerGameweekSnapshot[]>();
  // The league-best is a LEAGUE-WIDE comparison, so it is computed first and
  // then injected into every manager's snapshot.
  const leagueBest: Record<number, number> = {};
  for (const f of facts.values()) {
    for (const key of Object.keys(f.points)) {
      const gw = Number(key);
      if (!Number.isFinite(gw)) continue;
      leagueBest[gw] = Math.max(leagueBest[gw] ?? 0, f.points[gw] ?? 0);
    }
  }

  for (const f of facts.values()) {
    const snapshots: ManagerGameweekSnapshot[] = [];
    // GW1 and GW2 are always both evaluated, so a manager who has never been
    // scored still gets a "no points yet" progress row rather than nothing.
    for (const gw of [1, 2]) {
      const points = f.points[gw] ?? 0;
      snapshots.push({
        userId: f.userId,
        gameweek: gw,
        points,
        captainGoals: f.captainGoals[gw] ?? 0,
        cleanSheetDefenders: f.cleanSheets[gw] ?? 0,
        cleanSheetOpponents: f.defensiveTracked[gw] ?? 0,
        benchPoints: f.benchPoints[gw] ?? 0,
        totalSpent: f.totalSpent,
        budget: FIXED_MANAGER_BUDGET,
        isGameweekWinner: points > 0 && points >= (leagueBest[gw] ?? 0),
        leagueBestPoints: leagueBest[gw] ?? 0,
      });
    }
    out.set(f.userId, snapshots);
  }
  return out;
}

// ── Granting ─────────────────────────────────────────────────────────────

/**
 * Write one earned cosmetic, idempotently.
 *
 * An existing unlock is left ALONE (including its `equipped` flag) so a
 * re-evaluation never revokes a choice the manager made. A new unlock is
 * written unequipped — earning something must not change how their profile
 * looks until they choose to wear it.
 */
async function grantCosmetic(
  ctx: MutationCtx,
  userId: Id<"users">,
  cosmeticId: CosmeticId,
  opts: { featId?: string; gameweek?: number; via?: "earned" | "admin_grant" } = {},
): Promise<boolean> {
  const existing = await ctx.db
    .query("cosmeticUnlocks")
    .withIndex("by_user_cosmetic", (q) =>
      q.eq("userId", userId).eq("cosmeticId", cosmeticId),
    )
    .first();
  if (existing) return false; // already held — idempotent no-op
  await ctx.db.insert("cosmeticUnlocks", {
    userId,
    cosmeticId,
    unlockedAt: Date.now(),
    via: opts.via ?? "earned",
    ...(opts.featId ? { featId: opts.featId } : {}),
    ...(opts.gameweek ? { gameweek: opts.gameweek } : {}),
  });
  return true;
}

/** Log an unlock in the activity feed. Best-effort; never throws. */
async function announce(
  ctx: MutationCtx,
  userId: Id<"users">,
  text: string,
): Promise<void> {
  try {
    await ctx.runMutation(internal.activity.logActivity, {
      type: "badge",
      text,
      actorUserId: userId,
    });
  } catch {
    // The feed must never break the award.
  }
}

// ── The evaluation pass ──────────────────────────────────────────────────

export interface EvaluationResult {
  awarded: Array<{ userId: string; cosmeticId: CosmeticId; featId: string }>;
  podium: ReturnType<typeof computeGw1Podium>;
  evaluated: number;
}

/**
 * Recompute every reward and persist anything newly earned.
 *
 * Called by the Super Admin from the audit panel, and safe to call repeatedly.
 * Returns a summary of what was newly awarded (empty on a no-op re-run) plus
 * the resolved GW1 podium so the caller can render it immediately.
 */
async function runEvaluation(
  ctx: MutationCtx,
): Promise<EvaluationResult> {
  const snapshots = await buildSnapshots(ctx);
  const awarded: EvaluationResult["awarded"] = [];

  // ── GW1 podium + Super Admin roll-down ──
  // The Super Admin competes like everyone else: they are looked up by ROLE,
  // not special-cased out, so if they finish top three they take the podium
  // items and fourth place is rolled in.
  let superAdminId: string | null = null;
  try {
    const admins = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "super_admin"))
      .collect();
    superAdminId = admins[0] ? String(admins[0]._id) : null;
  } catch {
    // No by_role index (or no admins) — treat as "no super admin", which
    // simply means no roll-down.
  }

  const gw1Points: Standing[] = [];
  for (const [userId, list] of snapshots) {
    const gw1 = list.find((s) => s.gameweek === 1);
    if (!gw1) continue;
    gw1Points.push({ userId, points: gw1.points, firstSeen: 0 });
  }
  const podium = computeGw1Podium(gw1Points, superAdminId);

  for (const award of podium.awards) {
    const userId = award.userId as Id<"users">;
    // A podium place with zero points is not a podium — before kickoff every
    // manager sits at 0 and ranking that table would be pure noise.
    if (award.points <= 0) continue;
    for (const cosmeticId of podium.cosmetics) {
      const def = cosmeticById(cosmeticId);
      const fresh = await grantCosmetic(ctx, userId, cosmeticId, {
        featId: FEATS.GW1_PODIUM,
        gameweek: 1,
      });
      if (fresh) {
        awarded.push({ userId, cosmeticId, featId: FEATS.GW1_PODIUM });
        await announce(
          ctx,
          userId,
          `🏆 @${award.userId} finished #${award.rank} in Gameweek 1 and unlocked ${def?.name ?? cosmeticId}!`,
        );
      }
    }
  }

  // ── Per-gameweek feats, for both gameweeks ──
  for (const [userId, list] of snapshots) {
    const typedId = userId as Id<"users">;
    for (const snapshot of list) {
      // A gameweek that hasn't been scored has nothing to evaluate.
      if (snapshot.points <= 0 && snapshot.benchPoints <= 0) continue;
      const { unlocked } = evaluateGameweekSnapshot(snapshot);
      for (const cosmeticId of unlocked) {
        const def = cosmeticById(cosmeticId);
        const fresh = await grantCosmetic(ctx, typedId, cosmeticId, {
          featId: def?.unlockKey ?? undefined,
          gameweek: snapshot.gameweek,
        });
        if (fresh) {
          awarded.push({
            userId,
            cosmeticId,
            featId: def?.unlockKey ?? "unknown",
          });
          await announce(
            ctx,
            typedId,
            `⭐ A manager unlocked ${def?.name ?? cosmeticId} — ${featById(def?.unlockKey)?.name ?? "feat"}.`,
          );
        }
      }
    }
  }

  return { awarded, podium, evaluated: snapshots.size };
}

// ── Queries ──────────────────────────────────────────────────────────────

/**
 * The Hall of Fame: every cosmetic with its unlock state, plus the manager's
 * progress toward each active feat.
 *
 * Null-safe by contract — a signed-out visitor gets the catalogue with every
 * item locked and no progress, so the page renders without a guard.
 */
export const getShowcase = query({
  args: {},
  handler: async (ctx) => {
    const empty = {
      unlocked: [] as string[],
      equipped: [] as string[],
      items: COSMETICS.map((c) => ({
        id: c.id,
        name: c.name,
        blurb: c.blurb,
        slot: c.slot,
        tier: c.tier,
        icon: c.icon,
        accent: c.accent,
        unlocked: false,
        equipped: false,
        featId: null as string | null,
        unlockedAt: null as number | null,
        unlockedVia: null as string | null,
        gameweek: null as number | null,
      })),
      progress: [] as FeatProgress[],
      podium: null as ReturnType<typeof computeGw1Podium> | null,
    };
    try {
      const user = await requireUser(ctx);
      const rows = await ctx.db
        .query("cosmeticUnlocks")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      const byId = new Map(
        rows.map((r) => [String(r.cosmeticId), r] as const),
      );
      const items = empty.items.map((item) => {
        const row = byId.get(item.id);
        if (!row) return item;
        return {
          ...item,
          unlocked: true,
          equipped: row.equipped === true,
          featId: row.featId ?? null,
          unlockedAt: row.unlockedAt ?? null,
          unlockedVia: row.via ?? null,
          gameweek: row.gameweek ?? null,
        };
      });

      // Progress toward the feats that aren't unlocked yet.
      const snapshots = await buildSnapshots(ctx);
      const mine = snapshots.get(String(user._id)) ?? [];
      const progress: FeatProgress[] = [];
      for (const snapshot of mine) {
        const { progress: gw } = evaluateGameweekSnapshot(snapshot);
        for (const p of gw) {
          if (p.unlocked) continue;
          // Show the closest gameweek — the best shot at the feat.
          const existing = progress.find((e) => e.featId === p.featId);
          if (!existing || p.progress > existing.progress) {
            const index = progress.findIndex((e) => e.featId === p.featId);
            const entry = {
              ...p,
              detail: `GW${snapshot.gameweek} — ${p.detail}`,
            };
            if (index >= 0) progress[index] = entry;
            else progress.push(entry);
          }
        }
      }

      // The GW1 podium, so a manager can see exactly how close they are.
      const gw1Standings: Standing[] = [];
      for (const [id, list] of snapshots) {
        const gw1 = list.find((s) => s.gameweek === 1);
        if (gw1) gw1Standings.push({ userId: id, points: gw1.points, firstSeen: 0 });
      }
      let superId: string | null = null;
      try {
        const admins = await ctx.db
          .query("users")
          .withIndex("by_role", (q) => q.eq("role", "super_admin"))
          .collect();
        superId = admins[0] ? String(admins[0]._id) : null;
      } catch {
        superId = null;
      }
      const podium = computeGw1Podium(gw1Standings, superId);

      return {
        unlocked: items.filter((i) => i.unlocked).map((i) => i.id),
        equipped: items.filter((i) => i.equipped).map((i) => i.id),
        items,
        progress,
        podium,
      };
    } catch {
      return empty;
    }
  },
});

/**
 * Super Admin audit panel: the GW1 standings, which feat each manager has
 * triggered, everything currently awarded, and the roll-down allocation.
 *
 * Returns `[]`/`null` for anyone who is not a Super Admin — it never throws,
 * so a non-admin visiting the panel renders an empty state.
 */
export const getRewardAudit = query({
  args: {},
  handler: async (ctx): Promise<{
    standings: Array<{
      rank: number;
      userId: string;
      username: string;
      teamName: string;
      points: number;
      isSuperAdmin: boolean;
      awarded: boolean;
      rolledIn: boolean;
    }>;
    rollDownApplied: boolean;
    slotCount: number;
    awards: Array<{ userId: string; cosmeticId: string; featId: string }>;
    byCosmetic: Array<{ cosmeticId: string; name: string; holders: number }>;
    feats: Array<{ featId: string; name: string; unlockedBy: number }>;
  }> => {
    const empty = {
      standings: [],
      rollDownApplied: false,
      slotCount: PODIUM_SIZE,
      awards: [],
      byCosmetic: [],
      feats: [],
    };
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return empty;
    }

    try {
      const snapshots = await buildSnapshots(ctx);
      const users = await ctx.db.query("users").collect();
      const byUserId = new Map(users.map((u) => [String(u._id), u]));

      let superId: string | null = null;
      for (const u of users) {
        if (u.role === "super_admin") {
          superId = String(u._id);
          break;
        }
      }

      const gw1Points: Standing[] = [];
      for (const [userId, list] of snapshots) {
        const gw1 = list.find((s) => s.gameweek === 1);
        if (gw1) gw1Points.push({ userId, points: gw1.points, firstSeen: 0 });
      }
      const podium = computeGw1Podium(gw1Points, superId);
      const awardByUser = new Map<string, (typeof podium.awards)[number]>();
      for (const a of podium.awards) awardByUser.set(a.userId, a);

      const standings = gw1Points
        .map((s) => {
          const u = byUserId.get(s.userId);
          const award = awardByUser.get(s.userId);
          return {
            rank: award?.rank ?? 0,
            userId: s.userId,
            username: u?.username ?? "unknown",
            teamName: u?.teamName ?? "Unnamed team",
            points: s.points,
            isSuperAdmin: s.userId === superId,
            awarded: Boolean(award) && s.points > 0,
            rolledIn: award?.rolledIn === true,
          };
        })
        // Ranked winners first, then everyone else by points.
        .sort((a, b) => {
          if (a.rank > 0 && b.rank > 0) return a.rank - b.rank;
          if (a.rank > 0) return -1;
          if (b.rank > 0) return 1;
          if (b.points !== a.points) return b.points - a.points;
          return a.username.localeCompare(b.username);
        });

      // Every unlock currently in the database, with the feat that earned it.
      const unlockRows = await ctx.db.query("cosmeticUnlocks").collect();
      const awards = unlockRows.map((r) => ({
        userId: String(r.userId),
        cosmeticId: String(r.cosmeticId),
        featId: r.featId ?? "admin_grant",
      }));

      const counts = new Map<string, number>();
      const featCounts = new Map<string, number>();
      for (const row of unlockRows) {
        const cid = String(row.cosmeticId);
        counts.set(cid, (counts.get(cid) ?? 0) + 1);
        const fid = row.featId ?? null;
        if (fid) featCounts.set(fid, (featCounts.get(fid) ?? 0) + 1);
      }

      return {
        standings,
        rollDownApplied: podium.rollDownApplied,
        slotCount: podium.slotCount,
        awards,
        byCosmetic: COSMETICS.map((c) => ({
          cosmeticId: c.id,
          name: c.name,
          holders: counts.get(c.id) ?? 0,
        })),
        feats: [
          FEATS.GW1_PODIUM,
          FEATS.TACTICAL_MASTERMIND,
          FEATS.GOLDEN_BOOT,
          FEATS.IRON_DEFENCE,
          FEATS.BARGAIN_HUNTER,
          FEATS.CLUTCH_PERFORMER,
        ].map((fid) => ({
          featId: fid,
          name: featById(fid)?.name ?? fid,
          unlockedBy: featCounts.get(fid) ?? 0,
        })),
      };
    } catch {
      return empty;
    }
  },
});

// ── Mutations ────────────────────────────────────────────────────────────

/**
 * Recompute and persist every earned cosmetic.
 *
 * Super Admin only — but note it is an ENGINE, not a cheat: it applies the
 * same public rules to the same data the showcase shows, so it can only ever
 * award something the manager had already earned.
 */
export const runRewardEvaluation = mutation({
  args: {},
  handler: async (ctx) => {
    let admin;
    try {
      admin = await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "Only the Super Admin can run the reward engine.",
      );
    }
    try {
      const result = await runEvaluation(ctx);
      // The evaluation itself is the record, but a short audit line makes a
      // manual re-run traceable in the log.
      try {
        await ctx.runMutation(internal.audit.logAudit, {
          action: "reward_evaluation",
          category: "config",
          actor: admin.username ?? "admin",
          actorUserId: admin._id,
          detail: `${result.awarded.length} new unlock(s) across ${result.evaluated} manager(s)${
            result.podium.rollDownApplied ? " (roll-down applied)" : ""
          }`,
        });
      } catch {
        // Audit is best-effort.
      }
      return {
        awardedCount: result.awarded.length,
        awarded: result.awarded,
        rollDownApplied: result.podium.rollDownApplied,
        slotCount: result.podium.slotCount,
        evaluated: result.evaluated,
      };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err;
      }
      throw new Error("Could not run the reward engine — please try again.");
    }
  },
});

/**
 * Equip or unequip one of the manager's OWN unlocked cosmetics.
 *
 * Only one cosmetic per slot can be worn at a time, so equipping clears the
 * previous holder of that slot. Unlocking is checked server-side, so a
 * tampered client cannot equip something it never earned.
 */
export const setCosmeticEquipped = mutation({
  args: { cosmeticId: v.string(), equipped: v.boolean() },
  handler: async (ctx, args) => {
    let user;
    try {
      user = await requireUser(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "You must be signed in.",
      );
    }
    const def = cosmeticById(args.cosmeticId);
    if (!def) throw new Error("That cosmetic doesn't exist.");

    try {
      const mine = await ctx.db
        .query("cosmeticUnlocks")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      const target = mine.find(
        (r) => String(r.cosmeticId) === def.id,
      );
      if (!target) {
        throw new Error(`You haven't unlocked ${def.name} yet.`);
      }

      // Clear the current wearer of this slot so exactly one is equipped.
      for (const row of mine) {
        const rowDef = cosmeticById(row.cosmeticId);
        if (!rowDef || rowDef.slot !== def.slot) continue;
        if (row.equipped === true) {
          await ctx.db.patch(row._id, { equipped: undefined });
        }
      }

      // `undefined` removes the field, which the UI reads as "not equipped".
      await ctx.db.patch(target._id, {
        equipped: args.equipped === true ? true : undefined,
      });
      return { cosmeticId: def.id, equipped: args.equipped === true };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err;
      }
      throw new Error("Could not change your cosmetic — please try again.");
    }
  },
});

/**
 * Super Admin override: grant or revoke one cosmetic for one manager.
 *
 * This is the escape hatch for a data-entry problem (a match result was
 * entered wrong, so a feat that was genuinely earned never fired). It is
 * audited and shown in the panel as `admin_grant` so an override is always
 * distinguishable from an earned unlock.
 */
export const overrideCosmetic = mutation({
  args: {
    userId: v.id("users"),
    cosmeticId: v.string(),
    grant: v.boolean(),
  },
  handler: async (ctx, args) => {
    let admin;
    try {
      admin = await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "Only the Super Admin can override cosmetics.",
      );
    }
    const def = cosmeticById(args.cosmeticId);
    if (!def) throw new Error("That cosmetic doesn't exist.");

    try {
      const target = await ctx.db.get(args.userId);
      if (!target) throw new Error("That manager no longer exists.");

      const existing = await ctx.db
        .query("cosmeticUnlocks")
        .withIndex("by_user_cosmetic", (q) =>
          q.eq("userId", args.userId).eq("cosmeticId", def.id),
        )
        .first();

      if (args.grant) {
        if (!existing) {
          await ctx.db.insert("cosmeticUnlocks", {
            userId: args.userId,
            cosmeticId: def.id,
            unlockedAt: Date.now(),
            unlockedBy: admin.username ?? "admin",
            via: "admin_grant",
          });
        }
      } else if (existing) {
        await ctx.db.delete(existing._id);
      }

      try {
        await ctx.runMutation(internal.audit.logAudit, {
          action: args.grant ? "grant_cosmetic" : "revoke_cosmetic",
          category: "user",
          target: args.userId,
          detail: `${def.name} for @${target.username ?? "unknown"}`,
          actor: admin.username ?? "admin",
          actorUserId: admin._id,
        });
      } catch {
        // Best-effort.
      }

      return { cosmeticId: def.id, granted: args.grant };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err;
      }
      throw new Error("Could not apply the override — please try again.");
    }
  },
});

/**
 * Set (or clear) the manager's custom title.
 *
 * Gated server-side on having earned EITHER title cosmetic — the legacy
 * `custom_title` or the feat-earned `clutch_performer_title` — so the field
 * can never be set by someone who hasn't earned it. The Super Admin is not
 * exempt; they earn their titles like everyone else.
 */
export const setCustomTitle = mutation({
  args: { title: v.string() },
  handler: async (ctx, args) => {
    let user;
    try {
      user = await requireUser(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "You must be signed in.",
      );
    }

    const raw = typeof args.title === "string" ? args.title : "";
    const title = raw.replace(/\s+/g, " ").trim().slice(0, 24);
    if (title.length > 0 && title.length < 2) {
      throw new Error("Title must be at least 2 characters.");
    }

    try {
      const owned = await ctx.db
        .query("cosmeticUnlocks")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      const hasTitle = owned.some(
        (r) =>
          r.cosmeticId === "custom_title" ||
          r.cosmeticId === "clutch_performer_title",
      );
      if (!hasTitle) {
        throw new Error("You haven't earned a manager title yet.");
      }
      await ctx.db.patch(user._id, {
        customTitle: title === "" ? undefined : title,
      });
      return { customTitle: title === "" ? null : title };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err;
      }
      throw new Error("Could not save your title — please try again.");
    }
  },
});

/**
 * Internal hook so the match/settlement path can award rewards as soon as a
 * gameweek is scored. Best-effort and never throws: a reward hiccup must
 * never roll back the score that triggered it.
 */
export const evaluateRewardsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    try {
      return await runEvaluation(ctx);
    } catch {
      return null;
    }
  },
});