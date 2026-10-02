import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireUser, requireAdmin, requireSuperAdmin } from "./lib";
import { formatMoney } from "./configDefaults";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// ── Queries (null-safe: never throw for the subscribing client) ──────────

/** All price change requests, newest first. Admin only. */
export const listPriceRequests = query({
  args: {},
  handler: async (ctx) => {
    // Return [] instead of throwing so the admin tab renders a clean empty
    // state during auth attachment races or for non-admin viewers.
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const viewer = await ctx.db.get(userId);
    if (
      !viewer ||
      (viewer.role !== "super_admin" && viewer.role !== "moderator")
    ) {
      return [];
    }
    const requests = await ctx.db.query("priceRequests").collect();
    const users = await ctx.db.query("users").collect();
    const avatarById = new Map(users.map((u) => [u._id, u.image ?? null]));
    return requests
      .sort((a, b) => b._creationTime - a._creationTime)
      .map((r) => ({ ...r, avatar: avatarById.get(r.userId) ?? null }));
  },
});

/** The signed-in manager's own requests — for "pending review" indicators. */
export const getMyPriceRequests = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const user = await ctx.db.get(userId);
    if (!user) return [];
    const requests = await ctx.db
      .query("priceRequests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return requests.sort((a, b) => b._creationTime - a._creationTime);
  },
});

// ── Mutations (guarded: clean human-readable errors) ─────────────────────

/**
 * Submit a price change request for a player. Any signed-in manager may
 * submit; one open (pending) request per player per manager.
 */
export const submitPriceRequest = mutation({
  args: {
    playerId: v.id("players"),
    requestedPrice: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    let user;
    try {
      user = await requireUser(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "You must be signed in to request a price change.",
      );
    }

    // Normalize inputs defensively — never trust raw client values.
    const requestedPrice = Number(args.requestedPrice);
    const reason = typeof args.reason === "string" ? args.reason.trim() : "";
    const username = (user.username ?? "unknown").trim();

    if (!Number.isFinite(requestedPrice) || requestedPrice < 0) {
      throw new Error("Invalid requested price — enter a non-negative number.");
    }
    if (reason.length < 5) {
      throw new Error("Please provide a short reason (at least 5 characters).");
    }
    if (reason.length > 400) {
      throw new Error("Reason must be 400 characters or fewer.");
    }

    try {
      const player = await ctx.db.get(args.playerId);
      if (!player || !player.active) {
        throw new Error("That player is no longer on the market.");
      }
      if (requestedPrice === player.price) {
        throw new Error("Requested price is the same as the current price.");
      }

      const existing = await ctx.db
        .query("priceRequests")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      if (
        existing.some((r) => r.playerId === args.playerId && r.status === "pending")
      ) {
        throw new Error(
          `You already have a pending request for ${player.name} — wait for it to be reviewed.`,
        );
      }

      return await ctx.db.insert("priceRequests", {
        userId: user._id,
        username,
        playerId: args.playerId,
        playerName: player.name,
        currentPrice: player.price,
        requestedPrice: Math.round(requestedPrice),
        reason,
        status: "pending",
      });
    } catch (err) {
      if (err instanceof Error && err.message.length > 0 && !err.message.startsWith("Uncaught")) {
        throw err; // rethrow our own clean validation messages untouched
      }
      throw new Error("Could not submit the request — please try again.");
    }
  },
});

/**
 * Admin decision on a price request.
 *  - "approve": set the player's price to requestedPrice
 *  - "adjust":  set the player's price to customPrice, mark approved-with-adjustment
 *  - "deny":    no price change
 * Price updates and status changes happen in the same transaction, so a
 * failure can never leave a request approved without the price applied.
 */
export const reviewPriceRequest = mutation({
  args: {
    requestId: v.id("priceRequests"),
    decision: v.union(
      v.literal("approve"),
      v.literal("deny"),
      v.literal("adjust"),
    ),
    customPrice: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let admin;
    try {
      admin = await requireAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "Only admins can review price requests.",
      );
    }

    const customPrice =
      args.customPrice !== undefined ? Number(args.customPrice) : undefined;

    if (args.decision === "adjust") {
      if (customPrice === undefined || !Number.isFinite(customPrice) || customPrice < 0) {
        throw new Error("Enter a valid custom price to adjust this request.");
      }
    }

    try {
      const request = await ctx.db.get(args.requestId);
      if (!request) {
        throw new Error("Request not found — it may have already been reviewed.");
      }
      if (request.status !== "pending") {
        throw new Error(
          `This request was already ${request.status} — it can no longer be reviewed.`,
        );
      }

      if (args.decision === "deny") {
        await ctx.db.patch(args.requestId, {
          status: "denied",
          decidedBy: admin.username ?? "admin",
          decidedAt: Date.now(),
        });
        return { status: "denied" as const };
      }

      const player = await ctx.db.get(request.playerId);
      if (!player) {
        throw new Error("The player for this request no longer exists.");
      }
      const finalPrice =
        args.decision === "adjust"
          ? Math.round(customPrice as number)
          : request.requestedPrice;

      if (args.decision === "approve" && player.price === request.requestedPrice) {
        throw new Error(
          `The player's price is already ${formatMoney(request.requestedPrice)}.`,
        );
      }

      // Same-transaction price update + status stamp: atomic and idempotent-safe.
      await ctx.db.patch(player._id, { price: finalPrice });
      await ctx.db.patch(args.requestId, {
        status: args.decision === "adjust" ? "adjusted" : "approved",
        decidedBy: admin.username ?? "admin",
        decidedAt: Date.now(),
        finalPrice,
      });
      return { status: args.decision === "adjust" ? "adjusted" : "approved" };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err; // rethrow our own clean validation messages untouched
      }
      throw new Error("Could not record the review decision — please try again.");
    }
  },
});

/**
 * Super Admin only: hard-delete a reviewed request to keep the list tidy.
 * Pending requests must be reviewed (approve/deny) instead.
 */
export const deletePriceRequest = mutation({
  args: { requestId: v.id("priceRequests") },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Only the Super Admin can delete requests.",
      );
    }
    try {
      const request = await ctx.db.get(args.requestId);
      if (!request) throw new Error("Request not found.");
      if (request.status === "pending") {
        throw new Error("Review pending requests (approve/deny) instead of deleting them.");
      }
      await ctx.db.delete(args.requestId);
      return { deleted: true };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err;
      }
      throw new Error("Could not delete the request — please try again.");
    }
  },
});

// ── Player photo removal requests (moderation) ──────────────────────────
//
// Mirrors the price-request flow above: a manager flags a player photo, the
// Super Admin either clears the photo ("Approve Removal") or dismisses it.
// Every mutation is defensive — null-safe reads, trimmed/validated input, a
// generic fallback message for anything unexpected — so a stale client or a
// half-removed player can never throw an unhandled server error.

// ── Queries (null-safe: never throw for the subscribing client) ──────────

/** All photo removal requests, newest first. Admins only. */
export const listPhotoRequests = query({
  args: {},
  handler: async (ctx) => {
    // Return [] instead of throwing so the admin tab renders a clean empty
    // state during auth attachment races or for non-admin viewers.
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const viewer = await ctx.db.get(userId);
    if (
      !viewer ||
      (viewer.role !== "super_admin" && viewer.role !== "moderator")
    ) {
      return [];
    }
    const requests = await ctx.db.query("photoRequests").collect();
    const users = await ctx.db.query("users").collect();
    const avatarById = new Map(users.map((u) => [u._id, u.image ?? null]));
    // Player photos are read back defensively: a player that was deleted (or a
    // photo that was already cleared) simply reports `hasPhoto: false` instead
    // of breaking the moderation queue.
    const playerIds = Array.from(new Set(requests.map((r) => r.playerId)));
    const photoById = new Map<string, string | null>();
    for (const playerId of playerIds) {
      const player = await ctx.db.get(playerId);
      const raw = player && typeof player.image === "string" ? player.image : "";
      photoById.set(playerId, raw.trim() === "" ? null : raw);
    }
    return requests
      .sort((a, b) => b._creationTime - a._creationTime)
      .map((r) => ({
        ...r,
        avatar: avatarById.get(r.userId) ?? null,
        currentPhoto: photoById.get(r.playerId) ?? null,
      }));
  },
});

/** The signed-in manager's own photo requests — for "pending" indicators. */
export const getMyPhotoRequests = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const user = await ctx.db.get(userId);
    if (!user) return [];
    const requests = await ctx.db
      .query("photoRequests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return requests.sort((a, b) => b._creationTime - a._creationTime);
  },
});

// ── Mutations (guarded: clean human-readable errors) ─────────────────────

/**
 * Submit a photo-removal request for a player. Any signed-in manager may
 * submit; the reason is optional (stored as "" when blank). One open
 * (pending) request per player per manager, so the admin queue can't be
 * flooded with duplicates from a double click.
 */
export const submitPhotoRequest = mutation({
  args: {
    playerId: v.id("players"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let user;
    try {
      user = await requireUser(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "You must be signed in to report a photo.",
      );
    }

    // Normalize inputs defensively — never trust raw client values.
    const reason = typeof args.reason === "string" ? args.reason.trim() : "";
    if (reason.length > 400) {
      throw new Error("Reason must be 400 characters or fewer.");
    }
    const username = (user.username ?? "unknown").trim() || "unknown";

    try {
      const player = await ctx.db.get(args.playerId);
      if (!player || !player.active) {
        throw new Error("That player is no longer on the market.");
      }

      const currentImage =
        typeof player.image === "string" ? player.image.trim() : "";
      if (currentImage === "") {
        throw new Error(`${player.name} doesn't have a photo to remove.`);
      }

      const existing = await ctx.db
        .query("photoRequests")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      if (
        existing.some((r) => r.playerId === args.playerId && r.status === "pending")
      ) {
        throw new Error(
          `You already have a pending request for ${player.name} — wait for it to be reviewed.`,
        );
      }

      return await ctx.db.insert("photoRequests", {
        userId: user._id,
        username,
        playerId: args.playerId,
        playerName: player.name,
        // Denormalized snapshot: the admin queue can still show what was
        // reported even after the photo changes or the player is deleted.
        currentImage: currentImage.slice(0, 400),
        reason,
        status: "pending",
      });
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err; // rethrow our own clean validation messages untouched
      }
      throw new Error("Could not submit the request — please try again.");
    }
  },
});

/**
 * Super Admin decision on a photo-removal request.
 *  - "approve": clears the player's photo AND marks the request approved
 *  - "deny":    leaves the photo alone, marks the request denied
 * The photo clear and the status stamp happen in the same transaction, so a
 * failure can never leave a request "approved" while the photo survives.
 */
export const reviewPhotoRequest = mutation({
  args: {
    requestId: v.id("photoRequests"),
    decision: v.union(v.literal("approve"), v.literal("deny")),
  },
  handler: async (ctx, args) => {
    let admin;
    try {
      admin = await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "Only the Super Admin can review photo requests.",
      );
    }

    try {
      const request = await ctx.db.get(args.requestId);
      if (!request) {
        throw new Error("Request not found — it may have already been reviewed.");
      }
      if (request.status !== "pending") {
        throw new Error(
          `This request was already ${request.status} — it can no longer be reviewed.`,
        );
      }

      if (args.decision === "deny") {
        await ctx.db.patch(args.requestId, {
          status: "denied",
          decidedBy: admin.username ?? "admin",
          decidedAt: Date.now(),
        });
        return { status: "denied" as const, removed: false as const };
      }

      // Approve: clear the photo (same-transaction, idempotent) then stamp
      // the request. A deleted player still records the decision so the
      // manager's report isn't left dangling.
      const player = await ctx.db.get(request.playerId);
      if (player) {
        const raw = typeof player.image === "string" ? player.image.trim() : "";
        if (raw !== "") {
          // Patching with `undefined` removes the field — `null` is not
          // assignable to the optional `image` field.
          await ctx.db.patch(player._id, { image: undefined });
        }
        try {
          await ctx.runMutation(internal.audit.logAudit, {
            action: "remove_player_photo",
            category: "config",
            target: player.name,
            detail: `approved photo request from @${request.username ?? "unknown"}`,
          });
        } catch {
          // audit is non-fatal
        }
      }

      await ctx.db.patch(args.requestId, {
        status: "approved",
        decidedBy: admin.username ?? "admin",
        decidedAt: Date.now(),
      });
      return { status: "approved" as const, removed: player !== null };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err; // rethrow our own clean validation messages untouched
      }
      throw new Error("Could not record the review decision — please try again.");
    }
  },
});

/**
 * Super Admin only: hard-delete a reviewed photo request to keep the queue
 * tidy. Pending requests must be reviewed (approve/deny) instead.
 */
export const deletePhotoRequest = mutation({
  args: { requestId: v.id("photoRequests") },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "Only the Super Admin can delete photo requests.",
      );
    }
    try {
      const request = await ctx.db.get(args.requestId);
      if (!request) throw new Error("Request not found.");
      if (request.status === "pending") {
        throw new Error(
          "Review pending requests (approve/dismiss) instead of deleting them.",
        );
      }
      await ctx.db.delete(args.requestId);
      return { deleted: true };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err;
      }
      throw new Error("Could not delete the request — please try again.");
    }
  },
});
