import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { houseValidator, stageValidator } from "./schema";
import { GW_STAGES } from "./configDefaults";

// ── Match result predictor (+2 fantasy points per correct pick) ──────────

/**
 * The manager's own predictions joined with match state. Safe defaults:
 * not signed in / no predictions → [].
 */
export const getMyPredictions = query({
  args: {},
  handler: async (ctx) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (userId === null) return [];
      const rows = await ctx.db
        .query("predictions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      const matches = await ctx.db.query("matches").collect();
      return rows.map((r) => {
        const match = matches.find((m) => m.stage === r.stage) ?? null;
        return {
          stage: r.stage,
          pick: r.pick,
          correct: r.correct ?? null,
          awarded: r.awarded ?? 0,
          fixture: match
            ? { home: match.homeHouse, away: match.awayHouse, status: match.status, homeGoals: match.homeGoals, awayGoals: match.awayGoals }
            : null,
        };
      });
    } catch {
      return [];
    }
  },
});

/** Public: how many managers have predicted (community signal). */
export const getPredictionCounts = query({
  args: {},
  handler: async (ctx) => {
    try {
      const rows = await ctx.db.query("predictions").collect();
      const byStage: Record<string, number> = {};
      for (const r of rows) {
        byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;
      }
      return { byStage, total: rows.length };
    } catch {
      return { byStage: {}, total: 0 };
    }
  },
});

/**
 * Save (or change) the manager's pick for one stage. Changing an unresolved
 * pick is allowed; settled gameweeks reject edits.
 */
export const savePrediction = mutation({
  args: { stage: stageValidator, pick: houseValidator },
  handler: async (ctx, { stage, pick }) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (userId === null) throw new Error("Must be signed in.");
      const user = await ctx.db.get(userId);
      if (!user) throw new Error("Account no longer exists.");

      if (!GW_STAGES.includes(stage as (typeof GW_STAGES)[number])) {
        throw new Error("Unknown fixture.");
      }

      // Block edits after the gameweek settled or its deadline passed.
      const gwRows = await ctx.db
        .query("gameweeks")
        .withIndex("by_stage", (q) => q.eq("stage", stage))
        .collect();
      const gw = gwRows[0];
      if (gw?.settled === true) {
        throw new Error("This fixture has been settled — predictions are closed.");
      }
      if (gw?.locked === true) {
        throw new Error("Predictions are locked for this fixture.");
      }
      if (typeof gw?.deadlineAt === "number" && Date.now() > gw.deadlineAt) {
        throw new Error("The deadline for this prediction has passed.");
      }

      const existing = await ctx.db
        .query("predictions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      const mine = existing.find((r) => r.stage === stage);
      if (mine) {
        if (mine.correct !== undefined) {
          throw new Error("This prediction was already scored and cannot change.");
        }
        await ctx.db.patch(mine._id, { pick });
        return { stage, pick, changed: true };
      }
      await ctx.db.insert("predictions", { userId, stage, pick });
      return { stage, pick, changed: false };
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith("Uncaught")) throw err;
      throw new Error("Could not save your prediction — please try again.");
    }
  },
});
