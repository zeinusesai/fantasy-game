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
 * Super Admin only: strip a player's photo entirely.
 *
 * Distinct from `setPlayerImage({ image: "" })` on purpose — this is the
 * dedicated moderation entry point used by the Admin panel's "Remove photo"
 * button and by approving a `photoRequests` row. It is idempotent (clearing an
 * already-clear player is a no-op success rather than an error) so a double
 * click, a replayed mutation, or a stale admin tab can never surface an
 * exception or toast failure to the Super Admin.
 *
 * Patching with `undefined` *removes* the field (Convex semantics); `null` is
 * not assignable to the optional `image` field, so it must never be used.
 */
export const removePlayerPhoto = mutation({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "Only the Super Admin can remove a player photo.",
      );
    }

    try {
      const player = await ctx.db.get(playerId);
      if (!player) {
        throw new Error("Player not found — it may have already been removed.");
      }

      // Already photo-less: report success so the UI stays calm and converges.
      const current = typeof player.image === "string" ? player.image.trim() : "";
      if (current === "") return { removed: false as const, image: null };

      await ctx.db.patch(playerId, { image: undefined });

      try {
        await ctx.runMutation(internal.audit.logAudit, {
          action: "remove_player_photo",
          category: "config",
          target: player.name,
          detail: "photo cleared — UI falls back to the default avatar",
        });
      } catch {
        // audit is non-fatal
      }

      return { removed: true as const, image: null };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err; // rethrow our own clean validation messages untouched
      }
      throw new Error("Could not remove the player photo — please try again.");
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
 * Super Admin: set a player's availability / injury state.
 *
 * Replaces the old starter/sub/reserve designations with a single simple
 * three-state value: available (default), injured (out of the upcoming
 * gameweek) or doubtful (unlikely to play). SquadBuilder and the player market
 * surface this immediately as a badge, and a warning icon when picking a
 * doubtful or injured player for a squad.
 */
export const setPlayerAvailability = mutation({
  args: {
    playerId: v.id("players"),
    status: v.union(
      v.literal("available"),
      v.literal("injured"),
      v.literal("doubtful"),
    ),
  },
  handler: async (ctx, { playerId, status }) => {
    await requireSuperAdmin(ctx);
    const player = await ctx.db.get(playerId);
    if (!player) throw new Error("Player not found — it may have already been removed.");
    if (player.status === status) return { status };
    try {
      await ctx.db.patch(playerId, { status });
      try {
        await ctx.runMutation(internal.audit.logAudit, {
          action: "set_player_availability",
          category: "config",
          target: player.name,
          detail: status,
        });
      } catch {
        // audit is non-fatal
      }
      return { status };
    } catch (err) {
      if (err instanceof Error && err.message.includes("not found")) throw err;
      throw new Error("Could not update availability — please try again.");
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

/**
 * Clamp a raw price into the effective market window and round it to a whole
 * dollar. Returns null for anything that is not a usable positive number, so
 * the caller can raise a clean message instead of writing NaN/Infinity.
 *
 * The window comes from the Super Admin's market rules (defaults $4m–$22m) and
 * is re-asserted here: a corrupt config can never produce a min > max.
 */
function clampPrice(
  value: unknown,
  min: number,
  max: number,
): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const lo = Math.max(0, Number.isFinite(min) ? min : 0);
  const hi = Math.max(lo, Number.isFinite(max) ? max : lo);
  return Math.round(Math.max(lo, Math.min(hi, n)));
}

/**
 * Normalise a status label. Accepts the canonical labels plus the common
 * synonyms an admin might type, and returns null for a blank string (clear)
 * or throws for an unrecognised one.
 */
function resolveStatusLabel(value: string): PlayerStatusLabel | null {
  const trimmed = value.trim();
  if (trimmed === "") return null; // explicit clear
  const lower = trimmed.toLowerCase();
  const direct = PLAYER_STATUS_LABELS.find((s) => s.toLowerCase() === lower);
  if (direct) return direct;
  const aliases: Record<string, PlayerStatusLabel> = {
    "expected sub": "Sub",
    "likely sub": "Sub",
    "not playing": "Not Play",
    "out": "Not Play",
    "unavailable": "Not Play",
    "starting": "Expected to Start",
  };
  const aliased = aliases[lower];
  if (aliased) return aliased;
  throw new Error(
    `Invalid status "${trimmed}" — must be ${PLAYER_STATUS_LABELS.join(", ")}.`,
  );
}

/**
 * Normalise a photo value. Returns the trimmed URL to set, or undefined to
 * clear (Convex removes an optional field when it is patched to undefined —
 * the same mechanism setPlayerImage uses). Only called when the caller
 * actually sent the field, so "absent" never reaches this function.
 */
function normalizeImage(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined; // clear
  if (trimmed.length > 2_000_000) {
    throw new Error("Image URL/data is too large — use an image link under ~1.5MB.");
  }
  const isHttp = /^https?:\/\//i.test(trimmed);
  const isData = /^data:image\//i.test(trimmed);
  if (!isHttp && !isData) {
    throw new Error("Invalid image — paste an http(s):// or data:image/… URL.");
  }
  return trimmed;
}

/**
 * Super Admin only: partial update of a player.
 *
 * Every field is optional and only the ones actually sent are written, so the
 * caller can update a single column (e.g. just the status label) without
 * resending the whole record. Unknown/blank values are validated here rather
 * than by a strict arg validator, which is what turns a bad payload into a
 * friendly message instead of an unhandled server exception.
 */
export const updatePlayer = mutation({
  args: {
    id: v.id("players"),
    name: v.optional(v.string()),
    price: v.optional(v.number()),
    // Plain strings (not the enum validators) so a typo produces the friendly
    // "Invalid house …" error below instead of an ArgumentValidationError.
    position: v.optional(v.string()),
    house: v.optional(v.string()),
    image: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);

    try {
      // Existence check first — a deleted player is a normal, reportable state.
      const player = await ctx.db.get(args.id).catch(() => null);
      if (!player) {
        throw new Error("Player not found — it may have already been removed.");
      }

      const patch: {
        name?: string;
        house?: House;
        position?: Position;
        price?: number;
        image?: string;
        statusLabel?: PlayerStatusLabel;
      } = {};
      const changes: string[] = [];

      if (args.name !== undefined) {
        const name = args.name.trim();
        if (name.length < 2) {
          throw new Error("Invalid name: player name must be at least 2 characters.");
        }
        patch.name = name;
        if (name !== player.name) changes.push(`name → ${name}`);
      }

      if (args.house !== undefined) {
        const house = args.house.trim();
        if (!HOUSES.includes(house as (typeof HOUSES)[number])) {
          throw new Error(`Invalid house "${house}" — must be Fire, Earth, Wind or Water.`);
        }
        patch.house = house as House;
        if (house !== player.house) changes.push(`house → ${house}`);
      }

      if (args.position !== undefined) {
        const position = args.position.trim();
        if (!POSITIONS.includes(position as (typeof POSITIONS)[number])) {
          throw new Error(`Invalid position "${position}" — must be GK, DEF, MID or FWD.`);
        }
        patch.position = position as Position;
        if (position !== player.position) changes.push(`position → ${position}`);
      }

      if (args.price !== undefined) {
        // Clamp into the effective market window ($4m–$22m by default).
        const { marketRules } = normalizeSettings(await getSettingsRow(ctx));
        const price = clampPrice(
          args.price,
          marketRules.minPlayerPrice,
          marketRules.maxPlayerPrice,
        );
        if (price === null) {
          throw new Error(
            "Invalid price — use a positive number (e.g. 12m or 8,500,000).",
          );
        }
        patch.price = price;
        if (price !== player.price) changes.push(`price → ${formatMoney(price)}`);
      }

      if (args.image !== undefined) {
        // Only reached when the caller sent the field, so a blank string
        // means "clear" and patches the key to undefined, removing it.
        const image = normalizeImage(args.image);
        patch.image = image;
        changes.push(image === undefined ? "photo cleared" : "photo updated");
      }

      if (args.status !== undefined) {
        // Blank string clears the label; the UI already reads a missing label
        // as the "Expected to Start" default, so clearing is non-destructive.
        const status = resolveStatusLabel(args.status);
        patch.statusLabel = status ?? undefined;
        changes.push(status ? `status → ${status}` : "status cleared");
      }

      if (Object.keys(patch).length === 0) {
        throw new Error("Nothing to update — change at least one field first.");
      }

      await ctx.db.patch(args.id, patch);

      const updated = await ctx.db.get(args.id);
      try {
        await ctx.runMutation(internal.audit.logAudit, {
          action: "update_player",
          category: "config",
          target: patch.name ?? player.name,
          detail:
            changes.length > 0
              ? changes.join(" · ")
              : `${player.house} ${player.position} · ${formatMoney(player.price)}`,
        });
      } catch {
        // audit is non-fatal
      }

      return {
        ok: true as const,
        player: updated
          ? {
              _id: updated._id,
              name: updated.name,
              house: updated.house,
              position: updated.position,
              price: updated.price,
              // Absent means "Expected to Start" everywhere in the UI.
              statusLabel: updated.statusLabel ?? "Expected to Start",
              image: updated.image ?? null,
            }
          : null,
        changed: changes,
      };
    } catch (err) {
      // Validation Errors rethrow untouched so the client toast keeps its
      // specific guidance; anything else becomes a friendly message.
      if (err instanceof Error && !err.message.startsWith("Uncaught")) throw err;
      throw new Error(
        "Could not update the player — please refresh the roster and try again.",
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
