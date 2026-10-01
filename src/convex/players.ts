import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireAdmin, requireSuperAdmin } from "./lib";
import {
  houseValidator,
  positionValidator,
  HOUSES,
  POSITIONS,
} from "./schema";
import type { House, Position } from "./schema";

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

/**
 * Super Admin only: set or clear a player's custom photo URL. Shown on pitch
 * cards, the draft market and match lineups. Passing an empty string clears
 * the image (the field is removed server-side).
 */
export const setPlayerImage = mutation({
  args: { playerId: v.id("players"), image: v.string() },
  handler: async (ctx, { playerId, image }) => {
    await requireSuperAdmin(ctx);

    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found — it may have already been removed.");

    const trimmed = typeof image === "string" ? image.trim() : "";
    if (trimmed === "") {
      // Clearing: patching with undefined removes the field.
      await ctx.db.patch(playerId, { image: undefined });
      return { image: null };
    }

    if (trimmed.length > 2_000_000) {
      throw new Error("Image URL/data is too large — use an image link under ~1.5MB.");
    }
    const isHttp = /^https?:\/\//i.test(trimmed);
    const isData = /^data:image\//i.test(trimmed);
    if (!isHttp && !isData) {
      throw new Error('Invalid image — paste an http(s):// or data:image/… URL.');
    }

    try {
      await ctx.db.patch(playerId, { image: trimmed });
      return { image: trimmed };
    } catch {
      throw new Error("Could not save the player image — please try again.");
    }
  },
});

export const addPlayer = mutation({
  args: {
    name: v.string(),
    house: houseValidator,
    position: positionValidator,
    price: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    // Explicit input normalization — never trust raw client values.
    const name = typeof args.name === "string" ? args.name.trim() : "";
    const house = typeof args.house === "string" ? args.house.trim() : "";
    const position = typeof args.position === "string" ? args.position.trim() : "";
    const price = Number(args.price);

    if (name.length < 2) {
      throw new Error("Invalid name: player name must be at least 2 characters.");
    }
    if (!HOUSES.includes(house as (typeof HOUSES)[number])) {
      throw new Error(`Invalid house "${house}" — must be Fire, Earth, Wind or Water.`);
    }
    if (!POSITIONS.includes(position as (typeof POSITIONS)[number])) {
      throw new Error(`Invalid position "${position}" — must be GK, DEF, MID or FWD.`);
    }
    if (!Number.isFinite(price) || price < 0) {
      throw new Error("Invalid price format or missing field — use a non-negative number.");
    }

    try {
      return await ctx.db.insert("players", {
        name,
        house: house as House,
        position: position as Position,
        price: Math.round(price),
        active: true,
      });
    } catch {
      throw new Error(
        "Could not add player — invalid price format or missing field. Please check the form and try again.",
      );
    }
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
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const player = await ctx.db.get(args.playerId);
    if (!player) throw new Error("Player not found — it may have already been removed.");

    // Explicit input normalization — never trust raw client values.
    const name = typeof args.name === "string" ? args.name.trim() : "";
    const house = typeof args.house === "string" ? args.house.trim() : "";
    const position = typeof args.position === "string" ? args.position.trim() : "";
    const price = Number(args.price);

    if (name.length < 2) {
      throw new Error("Invalid name: player name must be at least 2 characters.");
    }
    if (!HOUSES.includes(house as (typeof HOUSES)[number])) {
      throw new Error(`Invalid house "${house}" — must be Fire, Earth, Wind or Water.`);
    }
    if (!POSITIONS.includes(position as (typeof POSITIONS)[number])) {
      throw new Error(`Invalid position "${position}" — must be GK, DEF, MID or FWD.`);
    }
    if (!Number.isFinite(price) || price < 0) {
      throw new Error("Invalid price format or missing field — use a non-negative number.");
    }

    try {
      await ctx.db.patch(args.playerId, {
        name,
        house: house as House,
        position: position as Position,
        price: Math.round(price),
      });
    } catch {
      throw new Error(
        "Could not update player — invalid price format or missing field. Please check the form and try again.",
      );
    }
  },
});

export const deletePlayer = mutation({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    await requireAdmin(ctx);
    try {
      const player = await ctx.db.get(playerId);
      if (!player) {
        throw new Error("Player not found — it may have already been removed.");
      }
      // Soft delete keeps historical match data intact.
      await ctx.db.patch(playerId, { active: false });
    } catch (err) {
      if (err instanceof Error && err.message.includes("not found")) throw err;
      throw new Error("Could not remove player — please refresh and try again.");
    }
  },
});
