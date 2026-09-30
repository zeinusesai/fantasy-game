import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireSuperAdmin, getPlatformConfig } from "./lib";
import { CONFIG_KEYS } from "./configDefaults";

export const getConfig = query({
  args: {},
  handler: async (ctx) => {
    const base = await getPlatformConfig(ctx);
    const rows = await ctx.db.query("config").collect();
    const msgRow = rows.find((r) => r.key === CONFIG_KEYS.ADMIN_MESSAGE);
    return {
      ...base,
      // Optional global announcement — empty string when none exists, so the
      // dashboard banner renders nothing on a fresh/empty database.
      adminMessage: typeof msgRow?.value === "string" ? msgRow.value : "",
    };
  },
});

/**
 * Create, update or clear the global announcement shown on every manager's
 * dashboard. Passing an empty string (or whitespace) clears it entirely.
 * Super Admin only — wrapped so failures surface as clean messages.
 */
export const setAdminMessage = mutation({
  args: { message: v.string() },
  handler: async (ctx, { message }) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "Only the Super Admin can update the announcement.",
      );
    }

    const trimmed = typeof message === "string" ? message.trim() : "";
    if (trimmed.length > 500) {
      throw new Error("Announcement must be 500 characters or fewer.");
    }

    try {
      const existing = await ctx.db
        .query("config")
        .withIndex("by_key", (q) => q.eq("key", CONFIG_KEYS.ADMIN_MESSAGE))
        .unique();
      if (trimmed === "") {
        // Clear: remove the row so no message exists at all.
        if (existing) await ctx.db.delete(existing._id);
        return "";
      }
      if (existing) {
        await ctx.db.patch(existing._id, { value: trimmed });
      } else {
        await ctx.db.insert("config", {
          key: CONFIG_KEYS.ADMIN_MESSAGE,
          value: trimmed,
        });
      }
      return trimmed;
    } catch {
      throw new Error("Could not save the announcement — please try again.");
    }
  },
});

export const setBudget = mutation({
  args: { budget: v.number() },
  handler: async (ctx, { budget }) => {
    await requireSuperAdmin(ctx);
    if (!Number.isFinite(budget) || budget < 0) {
      throw new Error("Budget must be a non-negative number.");
    }
    const existing = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", CONFIG_KEYS.BUDGET))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { value: budget });
    } else {
      await ctx.db.insert("config", { key: CONFIG_KEYS.BUDGET, value: budget });
    }
    return budget;
  },
});

export const setHouseLimit = mutation({
  args: { houseLimit: v.number() },
  handler: async (ctx, { houseLimit }) => {
    await requireSuperAdmin(ctx);
    if (!Number.isInteger(houseLimit) || houseLimit < 1 || houseLimit > 7) {
      throw new Error("House limit must be between 1 and 7.");
    }
    const existing = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", CONFIG_KEYS.HOUSE_LIMIT))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { value: houseLimit });
    } else {
      await ctx.db.insert("config", {
        key: CONFIG_KEYS.HOUSE_LIMIT,
        value: houseLimit,
      });
    }
    return houseLimit;
  },
});
