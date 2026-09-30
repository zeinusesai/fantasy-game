import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireAdmin } from "./lib";
import { houseValidator, positionValidator } from "./schema";

export const listPlayers = query({
  args: {},
  handler: async (ctx) => {
    const players = await ctx.db
      .query("players")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    return players.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getPlayer = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => ctx.db.get(playerId),
});

export const addPlayer = mutation({
  args: {
    name: v.string(),
    house: houseValidator,
    position: positionValidator,
    price: v.number(),
  },
  handler: async (ctx, { name, house, position, price }) => {
    await requireAdmin(ctx);
    const trimmed = name.trim();
    if (trimmed.length < 2) throw new Error("Player name must be at least 2 characters.");
    if (price < 0) throw new Error("Price cannot be negative.");
    return ctx.db.insert("players", { name: trimmed, house, position, price, active: true });
  },
});

export const updatePlayer = mutation({
  args: {
    playerId: v.id("players"),
    name: v.string(),
    house: houseValidator,
    position: positionValidator,
    price: v.number(),
  },
  handler: async (ctx, { playerId, name, house, position, price }) => {
    await requireAdmin(ctx);
    const trimmed = name.trim();
    if (trimmed.length < 2) throw new Error("Player name must be at least 2 characters.");
    if (price < 0) throw new Error("Price cannot be negative.");
    await ctx.db.patch(playerId, { name: trimmed, house, position, price });
  },
});

export const deletePlayer = mutation({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requireAdmin(ctx);
    // Soft delete keeps historical match data intact.
    await ctx.db.patch(playerId, { active: false });
  },
});
