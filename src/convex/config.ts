import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { requireSuperAdmin, getPlatformConfig } from "./lib";
import { CONFIG_KEYS, FIXED_MANAGER_BUDGET } from "./configDefaults";
import { getSettingsRow, normalizeSettings } from "./adminConfig";

export const getConfig = query({
  args: {},
  handler: async (ctx) => {
    const base = await getPlatformConfig(ctx);
    const rows = await ctx.db.query("config").collect();
    const msgRow = rows.find((r) => r.key === CONFIG_KEYS.ADMIN_MESSAGE);
    // Live scoring matrix, so the dashboard's "Scoring Rules" card updates the
    // instant the Super Admin retunes it (useQuery is reactive). `normalize`
    // guarantees a complete, in-range object — never partial, never NaN.
    const scoringRules = normalizeSettings(await getSettingsRow(ctx)).scoringRules;
    return {
      ...base,
      // Optional global announcement — empty string when none exists, so the
      // dashboard banner renders nothing on a fresh/empty database.
      adminMessage: typeof msgRow?.value === "string" ? msgRow.value : "",
      scoringRules,
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

/**
 * DEPRECATED — the starting budget is a fixed $70m for every manager and can
 * no longer be changed, so this mutation always resolves to the constant and
 * never writes anything. Kept only so older clients calling it get a clean
 * response instead of "function not found".
 */
export const setBudget = mutation({
  args: { budget: v.optional(v.number()) },
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);
    return FIXED_MANAGER_BUDGET;
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

/**
 * Internal (server/CLI tooling only — unreachable from the client): deletes
 * the legacy stored global-budget config row. The budget now lives in
 * FIXED_MANAGER_BUDGET, so any leftover row is dead weight that could
 * confuse a future reader. Idempotent — safe to re-run.
 */
export const clearStoredBudgetInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", CONFIG_KEYS.BUDGET))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return { removed: existing !== null, budget: FIXED_MANAGER_BUDGET };
  },
});
