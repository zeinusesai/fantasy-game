import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireSuperAdmin } from "./lib";

/**
 * Public maintenance flag. Never throws: with no systemConfig row (fresh
 * database) it returns the safe default `{ isMaintenanceMode: false }` so
 * every subscribing client renders normally instead of crashing.
 */
export const getMaintenanceStatus = query({
  args: {},
  handler: async (ctx) => {
    try {
      const rows = await ctx.db.query("systemConfig").collect();
      const flag = rows.find(
        (r) => typeof r.isMaintenanceMode === "boolean",
      );
      return { isMaintenanceMode: flag?.isMaintenanceMode === true };
    } catch {
      // Storage hiccup must never take the frontend down with it.
      return { isMaintenanceMode: false };
    }
  },
});

/**
 * Toggle maintenance mode. Super Admin only. The boolean is re-validated
 * server-side (never trust the client) and all DB work is wrapped so a
 * failure surfaces as a clean, human-readable message.
 */
export const toggleMaintenanceMode = mutation({
  args: { isMaintenanceMode: v.boolean() },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "Only the Super Admin can toggle maintenance mode.",
      );
    }

    // Explicit type parsing before touching the database.
    const isMaintenanceMode = args.isMaintenanceMode === true;

    try {
      const rows = await ctx.db.query("systemConfig").collect();
      const existing = rows.find(
        (r) => typeof r.isMaintenanceMode === "boolean",
      );
      if (existing) {
        await ctx.db.patch(existing._id, { isMaintenanceMode });
      } else {
        await ctx.db.insert("systemConfig", { isMaintenanceMode });
      }
      return { isMaintenanceMode };
    } catch {
      throw new Error(
        "Could not update maintenance mode — please try again.",
      );
    }
  },
});
