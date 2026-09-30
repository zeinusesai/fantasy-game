import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireSuperAdmin } from "./lib";
import { houseValidator, HOUSES } from "./schema";

export const listHouseLogos = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("houseLogos").collect();
    const map: Record<string, string | null> = {};
    for (const house of HOUSES) {
      const row = rows.find((r) => r.house === house);
      map[house] = row?.logoUrl ?? null;
    }
    return map as Record<(typeof HOUSES)[number], string | null>;
  },
});

export const setHouseLogo = mutation({
  args: { house: houseValidator, logoUrl: v.string() },
  handler: async (ctx, { house, logoUrl }) => {
    await requireSuperAdmin(ctx);
    if (!logoUrl.trim()) throw new Error("Logo URL cannot be empty.");
    if (logoUrl.length > 2_000_000) {
      throw new Error("Logo is too large (max ~2MB).");
    }
    const existing = await ctx.db
      .query("houseLogos")
      .withIndex("by_house", (q) => q.eq("house", house))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { logoUrl, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("houseLogos", { house, logoUrl, updatedAt: Date.now() });
    }
  },
});
