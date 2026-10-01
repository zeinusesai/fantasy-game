import { v } from "convex/values";
import { query, mutation, type QueryCtx, type MutationCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireSuperAdmin } from "./lib";
import { normalizeSettings, getSettingsRow, DEFAULT_YEAR12_MESSAGE } from "./adminConfig";
import { internal } from "./_generated/api";
import { GAMEWEEKS, activeGameweek, transferLockReason } from "./gameweekStructure";
import type { Id } from "./_generated/dataModel";

// ── Tournament results, Hall of Fame, Year 12 transition ─────────────────
//
// One query powers every post-tournament surface (dashboard celebration,
// leaderboard badges, Hall of Fame). It is null-safe by construction: an
// empty database, a single manager, or a tournament with no results yet all
// return a fully-populated object with empty arrays rather than throwing.

type PodiumEntry = {
  userId: Id<"users"> | null;
  username: string;
  teamName: string;
  totalPoints: number;
  rank: number;
  avatar: string | null;
  customBadge: string | null;
  role: string | null;
};

function emptyResults() {
  return {
    tournamentEnded: false,
    tournamentEndedAt: null as number | null,
    year12Message: DEFAULT_YEAR12_MESSAGE,
    podium: [] as PodiumEntry[],
    champion: null as PodiumEntry | null,
    forfeits: [] as PodiumEntry[],
    managerCount: 0,
    hasResults: false,
  };
}

/**
 * Standings with an explicit, deterministic tie-break:
 *   1. higher total points
 *   2. earlier squad creation (registered first)
 *   3. username alphabetically
 * Returns every manager, including zero-point ones.
 */
async function buildStandings(ctx: QueryCtx | MutationCtx) {
  const squads = await ctx.db.query("squads").collect();
  const scores = await ctx.db.query("matchScores").collect();
  const users = await ctx.db.query("users").collect();
  const userById = new Map(users.map((u) => [u._id, u]));

  const totals = new Map<string, number>();
  const createdAt = new Map<string, number>();
  for (const squad of squads) {
    const uid = String(squad.userId);
    if (!totals.has(uid)) {
      totals.set(uid, 0);
      createdAt.set(uid, squad._creationTime ?? 0);
    }
  }
  for (const s of scores) {
    const uid = String(s.userId);
    totals.set(uid, (totals.get(uid) ?? 0) + (Number(s.points) || 0));
  }

  return [...totals.entries()]
    .map(([uid, points]) => ({ uid, points, createdAt: createdAt.get(uid) ?? 0 }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      const an = userById.get(a.uid as Id<"users">)?.username ?? "";
      const bn = userById.get(b.uid as Id<"users">)?.username ?? "";
      return an.localeCompare(bn);
    })
    .map((e, i) => {
      const u = userById.get(e.uid as Id<"users">);
      // Squad whose owner was deleted — render a placeholder, never crash.
      return {
        userId: (u?._id ?? e.uid) as Id<"users"> | null,
        username: u?.username ?? "Deleted manager",
        teamName: u?.teamName ?? "Unnamed team",
        totalPoints: Math.round(e.points),
        rank: i + 1,
        avatar: u?.image ?? null,
        customBadge: u?.customBadge ?? null,
        role: u?.role ?? null,
      } satisfies PodiumEntry;
    });
}

/**
 * Public tournament results. `tournamentEnded` drives the Year 12 dashboard
 * transition; the podium and forfeit list are available at all times so the
 * leaderboard can show its badges on both active and finalized boards.
 */
export const getTournamentResults = query({
  args: {},
  handler: async (ctx) => {
    const base = emptyResults();
    try {
      const settings = normalizeSettings(await getSettingsRow(ctx));
      base.tournamentEnded = settings.tournamentEnded;
      base.tournamentEndedAt = settings.tournamentEndedAt;
      base.year12Message = settings.year12Message;

      const standings = await buildStandings(ctx);
      base.managerCount = standings.length;
      base.hasResults = standings.length > 0;

      if (standings.length > 0) {
        base.podium = standings.slice(0, 3);
        base.champion = standings[0] ?? null;

        // Bottom place forfeits. On an exact tie at the bottom EVERY tied
        // manager forfeits — that's the honest reading of "bottom place".
        if (standings.length >= 2) {
          const lowest = standings[standings.length - 1].totalPoints;
          base.forfeits = standings.filter((m) => m.totalPoints === lowest);
        } else {
          // A single manager can't "forfeit" against nobody.
          base.forfeits = [];
        }
      }
      return base;
    } catch {
      return base;
    }
  },
});

/**
 * Super Admin: end (or reopen) the entire tournament. This is the single
 * authoritative action behind the Admin "End Entire Tournament" button — it
 * locks every stage, flips the dashboard into the Year 12 celebration state,
 * refreshes the awards one final time and announces it to the feed.
 */
export const endTournament = mutation({
  args: { ended: v.boolean() },
  handler: async (ctx, { ended }) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      // Generic message — never reveals role/account details.
      throw new Error("Only the Super Admin can end the tournament.");
    }

    const isEnded = ended === true;
    try {
      // Lock every stage so no transfer or match edit can happen afterwards.
      const rows = await ctx.db.query("gameweeks").collect();
      const stages = GAMEWEEKS.flatMap((gw) => gw.stages) as string[];
      for (const stage of stages) {
        const row = rows.find((r) => r.stage === stage);
        if (row) {
          await ctx.db.patch(row._id, { locked: true });
        } else {
          await ctx.db.insert("gameweeks", { stage: stage as never, locked: true });
        }
      }

      const settingsRow = await getSettingsRow(ctx);
      const patch: Record<string, unknown> = {
        tournamentEnded: isEnded,
        tournamentEndedAt: isEnded ? Date.now() : undefined,
      };
      if (settingsRow) {
        await ctx.db.patch(settingsRow._id, patch as never);
      } else {
        await ctx.db.insert("systemConfig", {
          isMaintenanceMode: false,
          ...patch,
        } as never);
      }

      // Final award recalculation so the Hall of Fame matches the last score.
      if (isEnded) {
        try {
          await ctx.runMutation(internal.awards.recalculateAwards, {});
        } catch {
          // awards refresh is non-fatal
        }
        try {
          await ctx.runMutation(internal.activity.logActivity, {
            type: "settled",
            text: `🏆 The tournament is officially over. The Hall of Fame is sealed — see you in Year 12!`,
          });
        } catch {
          // feed failure is non-fatal
        }
      } else {
        try {
          await ctx.runMutation(internal.activity.logActivity, {
            type: "announcement",
            text: `🔓 The Super Admin reopened the tournament — transfers are live again.`,
          });
        } catch {
          // feed failure is non-fatal
        }
      }
      return { tournamentEnded: isEnded };
    } catch {
      throw new Error(
        isEnded
          ? "Could not end the tournament — please try again."
          : "Could not reopen the tournament — please try again.",
      );
    }
  },
});

/**
 * Public: which gameweek is live for transfers right now, plus the reason
 * transfers are closed. Used by the panic banner and read-only mode so they
 * never disagree with the server-side gate in `saveSquad`.
 */
export const getTransferStatus = query({
  args: {},
  handler: async (ctx) => {
    const safe = {
      readOnly: false,
      reason: null as string | null,
      activeGameweek: null as number | null,
    };
    try {
      const rows = await ctx.db.query("gameweeks").collect();
      const byStage: Record<
        string,
        { deadlineAt: number | null; locked: boolean; settled: boolean }
      > = {};
      for (const gw of GAMEWEEKS) {
        for (const stage of gw.stages) {
          const row = rows.find((r) => r.stage === stage);
          byStage[stage] = {
            deadlineAt: typeof row?.deadlineAt === "number" ? row.deadlineAt : null,
            locked: row?.locked === true,
            settled: row?.settled === true,
          };
        }
      }
      const reason = transferLockReason(byStage);
      return {
        readOnly: reason !== null,
        reason,
        activeGameweek: activeGameweek(byStage),
      };
    } catch {
      // Fail-open: a storage error must never soft-lock the whole app.
      return safe;
    }
  },
});

/**
 * Public: is the viewer signed in and is the tournament over? Tiny helper so
 * the dashboard can branch on `isEnded` without subscribing twice.
 */
export const getTournamentEnded = query({
  args: {},
  handler: async (ctx) => {
    try {
      const settings = normalizeSettings(await getSettingsRow(ctx));
      return { isEnded: settings.tournamentEnded };
    } catch {
      return { isEnded: false };
    }
  },
});

/** Signed-in check used by the celebration screen to personalise the copy. */
export const getViewerId = query({
  args: {},
  handler: async (ctx) => {
    try {
      return { userId: (await getAuthUserId(ctx)) ?? null };
    } catch {
      return { userId: null };
    }
  },
});
