import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireSuperAdmin, getPlatformConfig } from "./lib";
import { CONFIG_KEYS } from "./configDefaults";

export const getConfig = query({
  args: {},
  handler: async (ctx) => getPlatformConfig(ctx),
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
