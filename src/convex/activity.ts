import { v } from "convex/values";
import { query, mutation, internalMutation, type MutationCtx } from "./_generated/server";
import { requireSuperAdmin } from "./lib";
import { houseValidator } from "./schema";

// ── Community activity feed (sports-card style) ──────────────────────────

/**
 * Internal: append one activity event. Text is baked at log time so deleted
 * users/players degrade to the stored string instead of breaking the feed.
 * Called from other mutations (transfers, badges, chips, wagers, results).
 */
export const logActivity = internalMutation({
  args: {
    type: v.string(),
    text: v.string(),
    actorUserId: v.optional(v.id("users")),
    house: v.optional(houseValidator),
  },
  handler: async (ctx, { type, text, actorUserId, house }) => {
    try {
      const trimmed = typeof text === "string" ? text.trim() : "";
      if (!trimmed) return null; // never log an empty card
      const doc = {
        type: typeof type === "string" && type ? type : "event",
        text: trimmed.slice(0, 280), // defensive cap
        ts: Date.now(),
        ...(actorUserId ? { actorUserId } : {}),
        ...(house ? { house } : {}),
      };
      return await ctx.db.insert("activityEvents", doc);
    } catch {
      return null; // feed logging must never break the caller
    }
  },
});

/**
 * Internal: append several events at once (best-effort per row).
 */
export const logActivityBatch = internalMutation({
  args: {
    events: v.array(
      v.object({
        type: v.string(),
        text: v.string(),
        actorUserId: v.optional(v.id("users")),
        house: v.optional(houseValidator),
      }),
    ),
  },
  handler: async (ctx, { events }) => {
    let written = 0;
    for (const ev of events) {
      try {
        const trimmed = typeof ev.text === "string" ? ev.text.trim() : "";
        if (!trimmed) continue;
        await ctx.db.insert("activityEvents", {
          type: typeof ev.type === "string" && ev.type ? ev.type : "event",
          text: trimmed.slice(0, 280),
          ts: Date.now(),
          ...(ev.actorUserId ? { actorUserId: ev.actorUserId } : {}),
          ...(ev.house ? { house: ev.house } : {}),
        });
        written += 1;
      } catch {
        // skip failed rows individually
      }
    }
    return { written };
  },
});

/**
 * Public: the latest feed cards (newest first). Safe fallbacks everywhere —
 * an empty/missing table simply returns [] so the dashboard renders its
 * empty state.
 */
export const getRecentActivity = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    try {
      const parsedLimit = Number(limit);
      const n = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(Math.round(parsedLimit), 50) : 12;
      const all = await ctx.db.query("activityEvents").collect();
      return all
        .filter((r) => r.type !== "rank_meta") // machine rows never render
        .sort((a, b) => b.ts - a.ts)
        .slice(0, n);
    } catch {
      return [];
    }
  },
});

/** Public: count of feed cards (used for empty-state checks). */
export const getActivityCount = query({
  args: {},
  handler: async (ctx) => {
    try {
      const rows = await ctx.db.query("activityEvents").collect();
      return rows.length;
    } catch {
      return 0;
    }
  },
});

/**
 * Internal: log leaderboard rank shifts by comparing the current ordering
 * against the previously snapshotted one (stored in activityEvents as the
 * latest "rank" row). Best-effort; never throws.
 */
export const logRankShifts = internalMutation({
  args: {},
  handler: async (ctx) => {
    try {
      const squads = await ctx.db.query("squads").collect();
      const scores = await ctx.db.query("matchScores").collect();
      const users = await ctx.db.query("users").collect();
      const byId = new Map(users.map((u) => [u._id, u]));

      const totals = new Map<string, number>();
      for (const s of scores) {
        totals.set(s.userId, (totals.get(s.userId) ?? 0) + (Number(s.points) || 0));
      }
      const ordered = [...totals.entries()]
        .map(([uid, pts]) => ({ uid, pts }))
        .sort((a, b) => b.pts - a.pts);

      // Latest previous snapshot (stored as a machine-readable "rank_meta" row).
      const prevRows = await ctx.db
        .query("activityEvents")
        .collect();
      const prevRankRows = prevRows.filter((r) => r.type === "rank_meta");
      const lastSnapshot = prevRankRows
        .slice()
        .sort((a, b) => b.ts - a.ts)[0];
      const prevMap = new Map<string, number>();
      if (lastSnapshot && typeof lastSnapshot.text === "string") {
        try {
          const parsed = JSON.parse(lastSnapshot.text) as {
            order?: Array<{ uid: string; rank: number }>;
          };
          for (const entry of parsed.order ?? []) {
            prevMap.set(entry.uid, entry.rank);
          }
        } catch {
          // malformed snapshot — treat as "no previous ranking"
        }
      }

      const events: Array<{
        type: string;
        text: string;
        ts: number;
      }> = [];
      ordered.forEach(({ uid, pts }, i) => {
        const rank = i + 1;
        const prev = prevMap.get(uid);
        const username = byId.get(uid as never)?.username ?? "a manager";
        if (prev !== undefined && prev !== rank) {
          if (rank < prev) {
            events.push({
              type: "rank",
              text: `📈 @${username} climbed ${prev - rank} place${prev - rank === 1 ? "" : "s"} to #${rank} (${pts} pts).`,
              ts: Date.now(),
            });
          } else {
            events.push({
              type: "rank",
              text: `📉 @${username} slipped ${rank - prev} place${rank - prev === 1 ? "" : "s"} to #${rank} (${pts} pts).`,
              ts: Date.now(),
            });
          }
        }
      });

      // Persist events + a fresh machine-readable snapshot (rank_meta rows
      // are filtered out of the public feed).
      for (const ev of events) {
        await ctx.db.insert("activityEvents", { ...ev, type: "rank" } as never);
      }
      await ctx.db.insert("activityEvents", {
        type: "rank_meta",
        text: JSON.stringify({
          order: ordered.map(({ uid }, i) => ({ uid: String(uid), rank: i + 1 })),
        }),
        ts: Date.now(),
      } as never);
      return { logged: events.length };
    } catch {
      return { logged: 0 };
    }
  },
});

/**
 * Public super-admin helper: broadcast a custom feed card.
 */
export const postAnnouncementEvent = mutation({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Only the Super Admin can post to the feed.",
      );
    }
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!trimmed) throw new Error("Write something first.");
    if (trimmed.length > 280) throw new Error("Keep it under 280 characters.");
    try {
      await ctx.db.insert("activityEvents", {
        type: "announcement",
        text: trimmed,
        ts: Date.now(),
      });
      return { posted: true };
    } catch {
      throw new Error("Could not post — please try again.");
    }
  },
});
