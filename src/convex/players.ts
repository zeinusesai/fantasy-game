import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireAdmin, requireSuperAdmin } from "./lib";
import { getSettingsRow, normalizeSettings } from "./adminConfig";
import { formatMoney } from "./configDefaults";
import { internal } from "./_generated/api";
import {
  houseValidator,
  positionValidator,
  statusLabelValidator,
  HOUSES,
  POSITIONS,
  PLAYER_STATUS_LABELS,
} from "./schema";
import type { House, PlayerStatusLabel, Position } from "./schema";

/**
 * Defensive normaliser for a status label. Unknown / missing / non-string
 * values collapse to null (meaning "no label stored" → the UI shows the
 * "Expected to Start" default), so a bad client payload can never write junk
 * into the `statusLabel` field or blow up the market UI.
 */
function normalizeStatusLabel(value: unknown): PlayerStatusLabel | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = PLAYER_STATUS_LABELS.find((s) => s === trimmed);
  return match ?? null;
}

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

/**
 * Super Admin only: set (or clear) one player's availability label.
 * `statusLabel: null` removes the field so the player falls back to the
 * "Expected to Start" default everywhere.
 */
export const setPlayerStatus = mutation({
  args: {
    playerId: v.id("players"),
    statusLabel: v.union(statusLabelValidator, v.null()),
  },
  handler: async (ctx, { playerId, statusLabel }) => {
    await requireSuperAdmin(ctx);

    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found — it may have already been removed.");

    const next = normalizeStatusLabel(statusLabel);
    const current = normalizeStatusLabel(player.statusLabel);
    if (next === current) return { statusLabel: current };

    try {
      await ctx.db.patch(playerId, { statusLabel: next ?? undefined });
      try {
        await ctx.runMutation(internal.audit.logAudit, {
          action: next ? "set_player_status" : "clear_player_status",
          category: "config",
          target: player.name,
          detail: next ? `${next}` : "cleared (defaults to Expected to Start)",
        });
      } catch {
        // audit is non-fatal
      }
      return { statusLabel: next };
    } catch (err) {
      if (err instanceof Error && err.message.includes("not found")) throw err;
      throw new Error("Could not update the player status — please try again.");
    }
  },
});

/**
 * Super Admin only: set the same availability label on many players at once
 * (e.g. a whole house or the entire roster). Only ids that still exist are
 * touched; unknown ids are skipped instead of failing the whole batch.
 */
export const bulkSetPlayerStatus = mutation({
  args: {
    playerIds: v.array(v.id("players")),
    statusLabel: v.union(statusLabelValidator, v.null()),
  },
  handler: async (ctx, { playerIds, statusLabel }) => {
    await requireSuperAdmin(ctx);

    const next = normalizeStatusLabel(statusLabel);
    // De-dupe defensively so a repeated id is never double-patched.
    const ids = Array.from(
      new Set((Array.isArray(playerIds) ? playerIds : []).filter((id) => typeof id === "string")),
    );
    if (ids.length === 0) {
      throw new Error("Select at least one player to update.");
    }
    if (ids.length > 200) {
      throw new Error("Too many players selected — update 200 at a time.");
    }

    let updated = 0;
    let skipped = 0;
    const names: string[] = [];
    for (const id of ids) {
      try {
        const player = await ctx.db.get(id);
        if (!player) {
          skipped += 1;
          continue;
        }
        const current = normalizeStatusLabel(player.statusLabel);
        if (current === next) {
          skipped += 1;
          continue;
        }
        await ctx.db.patch(id, { statusLabel: next ?? undefined });
        updated += 1;
        if (names.length < 5) names.push(player.name);
      } catch {
        skipped += 1;
      }
    }

    if (updated > 0) {
      try {
        await ctx.runMutation(internal.audit.logAudit, {
          action: next ? "bulk_set_player_status" : "bulk_clear_player_status",
          category: "config",
          target: `${updated} player${updated === 1 ? "" : "s"}`,
          detail: `${next ?? "cleared"} · ${names.join(", ")}${names.length < updated ? "…" : ""}`,
        });
      } catch {
        // audit is non-fatal
      }
    }

    return { updated, skipped, statusLabel: next };
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
    // Enforce the Super-Admin price window (defaults $4m–$22m).
    const { marketRules } = normalizeSettings(await getSettingsRow(ctx));
    if (price < marketRules.minPlayerPrice || price > marketRules.maxPlayerPrice) {
      throw new Error(
        `Price must be between ${formatMoney(marketRules.minPlayerPrice)} and ${formatMoney(marketRules.maxPlayerPrice)}.`,
      );
    }

    try {
      const id = await ctx.db.insert("players", {
        name,
        house: house as House,
        position: position as Position,
        price: Math.round(price),
        active: true,
      });
      try {
        await ctx.runMutation(internal.audit.logAudit, {
          action: "add_player",
          category: "config",
          target: name,
          detail: `${house} ${position} · ${formatMoney(price)}`,
        });
      } catch {
        // audit is non-fatal
      }
      return id;
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
    // Enforce the Super-Admin price window (defaults $4m–$22m).
    const { marketRules } = normalizeSettings(await getSettingsRow(ctx));
    if (price < marketRules.minPlayerPrice || price > marketRules.maxPlayerPrice) {
      throw new Error(
        `Price must be between ${formatMoney(marketRules.minPlayerPrice)} and ${formatMoney(marketRules.maxPlayerPrice)}.`,
      );
    }

    try {
      await ctx.db.patch(args.playerId, {
        name,
        house: house as House,
        position: position as Position,
        price: Math.round(price),
      });
      try {
        await ctx.runMutation(internal.audit.logAudit, {
          action: "update_player",
          category: "config",
          target: name,
          detail: `${house} ${position} · ${formatMoney(price)}`,
        });
      } catch {
        // audit is non-fatal
      }
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
