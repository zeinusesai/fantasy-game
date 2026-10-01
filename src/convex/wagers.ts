import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { stageValidator } from "./schema";
import { GW_STAGES } from "./configDefaults";

// ── 1v1 manager H2H point wagers ─────────────────────────────────────────

type WagerRow = {
  _id: unknown;
  challengerId: unknown;
  opponentId: unknown;
  stake: number;
  stage: string;
  status: string;
  winnerId?: unknown;
  settledAt?: number;
  _creationTime: number;
};

/**
 * Wagers involving the signed-in manager (as challenger or opponent), with
 * resolved usernames for display. Safe fallback: [] when signed out/empty.
 */
export const getMyWagers = query({
  args: {},
  handler: async (ctx) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (userId === null) return [];
      const all = await ctx.db.query("wagers").collect();
      const users = await ctx.db.query("users").collect();
      const nameById = new Map(users.map((u) => [u._id, u.username ?? "unknown"]));
      const mine = all.filter(
        (w) => w.challengerId === userId || w.opponentId === userId,
      );
      return mine
        .slice()
        .sort((a, b) => b._creationTime - a._creationTime)
        .map((w) => {
          const row = w as unknown as WagerRow;
          return {
            id: String(row._id),
            challengerId: String(row.challengerId),
            challengerName: nameById.get(row.challengerId as never) ?? "unknown",
            opponentId: String(row.opponentId),
            opponentName: nameById.get(row.opponentId as never) ?? "unknown",
            stake: Number(row.stake) || 0,
            stage: row.stage,
            status: row.status,
            winnerId: row.winnerId ? String(row.winnerId) : null,
            amChallenger: String(row.challengerId) === String(userId),
            createdAt: row._creationTime,
          };
        });
    } catch {
      return [];
    }
  },
});

/** Public count of open challenges against the signed-in manager. */
export const getPendingWagerCount = query({
  args: {},
  handler: async (ctx) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (userId === null) return 0;
      const all = await ctx.db
        .query("wagers")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .collect();
      return all.filter((w) => w.opponentId === userId).length;
    } catch {
      return 0;
    }
  },
});

/**
 * Send a 1v1 wager challenge from one manager to another. Stake must be a
 * positive whole number of points; self-challenges and duplicate open
 * challenges between the same pair are rejected.
 */
export const sendWager = mutation({
  args: { opponentId: v.id("users"), stake: v.number(), stage: stageValidator },
  handler: async (ctx, { opponentId, stake, stage }) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (userId === null) throw new Error("Must be signed in.");
      const me = await ctx.db.get(userId);
      if (!me) throw new Error("Account no longer exists.");

      const parsedStake = Math.round(Number(stake));
      if (!Number.isFinite(parsedStake) || parsedStake <= 0 || parsedStake > 50) {
        throw new Error("Stake must be between 1 and 50 points.");
      }
      if (String(opponentId) === String(userId)) {
        throw new Error("You cannot wager against yourself.");
      }
      const opponent = await ctx.db.get(opponentId);
      if (!opponent) throw new Error("That manager no longer exists.");
      if (!GW_STAGES.includes(stage as (typeof GW_STAGES)[number])) {
        throw new Error("Unknown gameweek for the wager.");
      }

      // One open wager per pair per stage.
      const open = await ctx.db
        .query("wagers")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .collect();
      const dup = open.some(
        (w) =>
          w.stage === stage &&
          ((w.challengerId === userId && w.opponentId === opponentId) ||
            (w.challengerId === opponentId && w.opponentId === userId)),
      );
      if (dup) {
        throw new Error("You already have an open challenge with this manager for that gameweek.");
      }

      await ctx.db.insert("wagers", {
        challengerId: userId,
        opponentId,
        stake: parsedStake,
        stage,
        status: "pending" as const,
      });
      return { sent: true };
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith("Uncaught")) throw err;
      throw new Error("Could not send the challenge — please try again.");
    }
  },
});

/** Accept, decline (opponent) or cancel (challenger) a pending wager. */
export const respondToWager = mutation({
  args: { wagerId: v.id("wagers"), action: v.union(v.literal("accept"), v.literal("decline"), v.literal("cancel")) },
  handler: async (ctx, { wagerId, action }) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (userId === null) throw new Error("Must be signed in.");
      const wager = await ctx.db.get(wagerId);
      if (!wager) throw new Error("Wager not found — it may already be resolved.");
      if (wager.status !== "pending") {
        throw new Error("This wager is no longer pending.");
      }
      const isOpponent = String(wager.opponentId) === String(userId);
      const isChallenger = String(wager.challengerId) === String(userId);
      if (action === "accept" && !isOpponent) {
        throw new Error("Only the challenged manager can accept.");
      }
      if (action === "decline" && !isOpponent) {
        throw new Error("Only the challenged manager can decline.");
      }
      if (action === "cancel" && !isChallenger) {
        throw new Error("Only the challenger can cancel.");
      }
      const next =
        action === "accept" ? ("accepted" as const) : action === "decline" ? ("declined" as const) : ("cancelled" as const);
      await ctx.db.patch(wagerId, { status: next });
      return { status: next };
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith("Uncaught")) throw err;
      throw new Error("Could not update the wager — please try again.");
    }
  },
});
