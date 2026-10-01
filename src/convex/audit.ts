import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireSuperAdmin } from "./lib";

// ── Super Admin audit log ───────────────────────────────────────────────
//
// Every privileged action is recorded here so a misconfiguration can always
// be traced back to who made it, when, and what changed.
//
// Two properties matter more than completeness:
//   • It NEVER throws. A failed audit write must never roll back the admin
//     action the user actually asked for.
//   • The actor's username is BAKED into the row. If the admin account is
//     later deleted the entry still reads "zein" instead of vanishing.

export const AUDIT_CATEGORIES = [
  "config",
  "user",
  "points",
  "squad",
  "tournament",
  "bulk",
  "auth",
] as const;

/**
 * Internal: append one audit entry. Best-effort — returns null on failure
 * instead of throwing, so callers can `await` it without a try/catch.
 */
export const logAudit = internalMutation({
  args: {
    action: v.string(),
    category: v.optional(v.string()),
    target: v.optional(v.string()),
    detail: v.optional(v.string()),
    actor: v.optional(v.string()),
    actorUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    try {
      const action =
        typeof args.action === "string" && args.action.trim().length > 0
          ? args.action.trim().slice(0, 60)
          : "unknown_action";
      // Resolve the actor from the session when the caller didn't pass one,
      // so an entry always has a name attached.
      let actor = typeof args.actor === "string" ? args.actor.slice(0, 40) : "";
      let actorUserId = args.actorUserId;
      if (!actor || !actorUserId) {
        try {
          const uid = await getAuthUserId(ctx);
          if (uid) {
            const user = await ctx.db.get(uid);
            if (user) {
              actorUserId = actorUserId ?? uid;
              actor = actor || (user.username ?? "unknown");
            }
          }
        } catch {
          // no session (internal/CLI call) — fall through with what we have
        }
      }
      return await ctx.db.insert("auditLog", {
        ts: Date.now(),
        action,
        actor: actor || "system",
        ...(actorUserId ? { actorUserId } : {}),
        category: (typeof args.category === "string" ? args.category : "config").slice(0, 24),
        ...(typeof args.target === "string" && args.target.length > 0
          ? { target: args.target.slice(0, 120) }
          : {}),
        ...(typeof args.detail === "string" && args.detail.length > 0
          ? { detail: args.detail.slice(0, 280) }
          : {}),
      });
    } catch {
      // Audit logging must never break the action it is recording.
      return null;
    }
  },
});

/**
 * Super Admin only: the audit trail, newest first, with an optional category
 * filter and a hard 200-row cap so a long history can't stall the dashboard.
 * Returns `[]` for non-admins rather than throwing.
 */
export const getAuditLogs = query({
  args: {
    limit: v.optional(v.number()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, { limit, category }) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return []; // not authorized → empty viewer, no error modal
    }
    try {
      const parsed = Number(limit);
      const n =
        Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.round(parsed), 200) : 100;
      const cat = typeof category === "string" ? category.trim() : "";
      const all = await ctx.db.query("auditLog").collect();
      return all
        .filter((r) => (cat.length > 0 ? r.category === cat : true))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, n)
        .map((r) => ({
          _id: r._id,
          ts: r.ts,
          actor: r.actor ?? "system",
          category: r.category ?? "config",
          action: r.action,
          target: r.target ?? null,
          detail: r.detail ?? null,
        }));
    } catch {
      return [];
    }
  },
});

/** Super Admin: distinct categories actually present, for the filter UI. */
export const getAuditCategories = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return [];
    }
    try {
      const all = await ctx.db.query("auditLog").collect();
      const set = new Set<string>();
      for (const row of all) {
        if (typeof row.category === "string" && row.category.length > 0) {
          set.add(row.category);
        }
      }
      return [...set].sort();
    } catch {
      return [];
    }
  },
});
