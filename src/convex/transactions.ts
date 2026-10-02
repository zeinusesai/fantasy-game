// ── Manual Cash Micro-Transaction Store engine ────────────────────────────
//
// The store is a tiny, offline, cash-only shop. A manager pays Zein in person,
// then files a request; the Super Admin confirms the cash arrived and approves,
// which atomically flips the transaction to "approved" AND grants the perk.
//
// Safety contract (every rule here is enforced server-side, never trusted from
// the client):
//   1. HARD 10 AED CEILING — a request whose price exceeds `MAX_PRICE_AED` is
//      rejected, and the price is always re-read from the catalogue rather than
//      accepted from the client payload.
//   2. IDEMPOTENCY — approving/rejecting an already-decided transaction throws a
//      clean error and grants nothing, so a double click (or a replayed
//      mutation) can never double-deliver an item.
//   3. FALLBACK SAFE STATE — every query returns a fully-populated, finite
//      shape (empty arrays, `null`s) rather than throwing, so the store UI
//      renders cleanly during auth races or for signed-out visitors.
//   4. The Super Admin auto-owns every catalogue item. No purchase, no payment
//      and no request needed; they simply toggle items on and off.

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireUser, requireSuperAdmin } from "./lib";
import { internal } from "./_generated/api";
import { getSettingsRow, normalizeSettings, patchSettings } from "./adminConfig";
import {
  MAX_PRICE_AED,
  STORE_ITEMS,
  priceForItem,
  storeItemById,
  type StoreItem,
} from "./storeItems";
import { clampInt } from "./defaults";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type Entitlement = {
  itemId: string;
  enabled: boolean;
  via: "purchase" | "super_admin";
  grantedAt: number;
  grantedBy?: string | null;
};

/** Coerce an unknown value into a clean `Enabled` flag. */
function toEnabled(value: unknown): boolean {
  return value === true;
}

/** Coerce anything into a bounded non-negative integer. */
function toCount(value: unknown, max = 1000): number {
  return clampInt(value, 0, max, 0);
}

/**
 * Read a user's entitlements into a Map keyed by itemId.
 * TOTAL — a missing table (pre-migration DB) or a corrupt row degrades to an
 * empty map instead of throwing.
 */
async function readEntitlements(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Map<string, Entitlement>> {
  const out = new Map<string, Entitlement>();
  try {
    const rows = (await ctx.db
      .query("storeEntitlements")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const itemId = typeof row.itemId === "string" ? row.itemId : "";
      if (!itemId) continue;
      out.set(itemId, {
        itemId,
        enabled: toEnabled(row.enabled),
        via: row.via === "super_admin" ? "super_admin" : "purchase",
        grantedAt: toCount(row.grantedAt, Number.MAX_SAFE_INTEGER),
        grantedBy: typeof row.grantedBy === "string" ? row.grantedBy : null,
      });
    }
  } catch {
    return out; // empty map = "owns nothing", never an exception
  }
  return out;
}

/** Build the projection the Store page and Admin queue both render. */
function buildItemView(
  item: StoreItem,
  ent: Entitlement | undefined,
  pendingPurchaseId: Id<"purchases"> | null,
  ownedViaSuperAdmin: boolean,
) {
  return {
    ...item,
    // Super Admin owns + has unlocked everything by default.
    owned: Boolean(ent) || ownedViaSuperAdmin,
    unlocked: ent ? ent.enabled : ownedViaSuperAdmin,
    ownedVia: ent ? ent.via : ownedViaSuperAdmin ? ("super_admin" as const) : null,
    grantedAt: ent ? ent.grantedAt : null,
    // True when the manager already has a live request for this item — the UI
    // shows "Pending Approval" and blocks a duplicate submission.
    pendingPurchaseId,
  };
}

// ── Queries (null-safe: never throw for the subscribing client) ──────────

/**
 * Everything the signed-in manager's Store page needs: the catalogue, what
 * they own / have switched on, and their own purchase history.
 * Signed-out callers get an empty-but-valid shape.
 */
export const getStore = query({
  args: {},
  handler: async (ctx) => {
    const empty = {
      isSuper: false,
      maxPriceAED: MAX_PRICE_AED,
      items: [],
      purchases: [],
      extraChips: 0,
      budgetBonus: 0,
    };
    try {
      const userId = await getAuthUserId(ctx);
      if (userId === null) return empty;
      const user = await ctx.db.get(userId);
      if (!user) return empty;

      const isSuper = user.role === "super_admin";
      const entitlements = await readEntitlements(
        ctx,
        userId as Id<"users">,
      );

      // The manager's own requests, so a pending item can never be re-bought.
      let purchases: Array<Record<string, unknown>> = [];
      try {
        const rows = await ctx.db
          .query("purchases")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect();
        purchases = rows as unknown as Array<Record<string, unknown>>;
      } catch {
        purchases = [];
      }

      const pendingByItem = new Map<string, Id<"purchases">>();
      for (const row of purchases) {
        if (row.status !== "pending") continue;
        const itemId = typeof row.itemId === "string" ? row.itemId : "";
        if (!itemId) continue;
        // First write wins (newest rows come last) — defensive against a
        // pathological duplicate row.
        if (!pendingByItem.has(itemId)) {
          pendingByItem.set(itemId, row._id as Id<"purchases">);
        }
      }

      const items = STORE_ITEMS.map((item) =>
        buildItemView(
          item,
          entitlements.get(item.id),
          pendingByItem.get(item.id) ?? null,
          isSuper,
        ),
      );

      const purchasesOut = purchases
        .slice()
        .sort((a, b) => toCount(b.createdAt) - toCount(a.createdAt))
        .slice(0, 50)
        .map((row) => ({
          _id: row._id as Id<"purchases">,
          itemId: typeof row.itemId === "string" ? row.itemId : "",
          itemName: typeof row.itemName === "string" ? row.itemName : "Unknown item",
          priceAED: Math.min(toCount(row.priceAED, MAX_PRICE_AED), MAX_PRICE_AED),
          status:
            row.status === "approved" || row.status === "rejected" ? row.status : "pending",
          createdAt: toCount(row.createdAt, Number.MAX_SAFE_INTEGER),
          decidedBy: typeof row.decidedBy === "string" ? row.decidedBy : null,
          decidedAt:
            typeof row.decidedAt === "number" ? row.decidedAt : null,
          note: typeof row.note === "string" ? row.note : null,
        }));

      return {
        isSuper,
        maxPriceAED: MAX_PRICE_AED,
        items,
        purchases: purchasesOut,
        extraChips: toCount(user.extraChips),
        // A bought budget expansion shows as a bonus, never as a raw override.
        budgetBonus: entitlements.has("budget_expansion") ? 2_000_000 : 0,
      };
    } catch {
      // Never let a store read crash the page.
      return {
        isSuper: false,
        maxPriceAED: MAX_PRICE_AED,
        items: STORE_ITEMS.map((item) => buildItemView(item, undefined, null, false)),
        purchases: [],
        extraChips: 0,
        budgetBonus: 0,
      };
    }
  },
});

/**
 * Super Admin only: every micro-transaction, newest first, with buyer details
 * resolved defensively (a deleted manager degrades to "unknown", never throws).
 */
export const listPurchases = query({
  args: {},
  handler: async (ctx) => {
    // Return [] instead of throwing so the admin tab renders cleanly during
    // auth attachment races or for non-admin viewers.
    try {
      const userId = await getAuthUserId(ctx);
      if (userId === null) return [];
      const viewer = await ctx.db.get(userId);
      if (!viewer || viewer.role !== "super_admin") return [];

      const rows = await ctx.db.query("purchases").collect();
      const out = [];
      for (const row of rows) {
        let username: string | null = null;
        let avatar: string | null = null;
        try {
          const buyer = await ctx.db.get(row.userId);
          username = buyer?.username ?? null;
          avatar = buyer?.image ?? null;
        } catch {
          username = null;
          avatar = null;
        }
        out.push({
          _id: row._id,
          userId: row.userId,
          username,
          avatar,
          itemId: row.itemId,
          itemName: row.itemName,
          priceAED: Math.min(toCount(row.priceAED, MAX_PRICE_AED), MAX_PRICE_AED),
          status: row.status,
          createdAt: toCount(row.createdAt, Number.MAX_SAFE_INTEGER),
          decidedBy: row.decidedBy ?? null,
          decidedAt: row.decidedAt ?? null,
          note: row.note ?? null,
        });
      }
      return out.sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  },
});

// ── Mutations (guarded: clean human-readable errors) ─────────────────────

/**
 * Apply an item's real-world effect to the buyer's account. Called ONLY from
 * `approvePurchase`, inside the same transaction as the status flip.
 *
 * - cosmetic   → an entitlement row the buyer can toggle on/off later
 * - extra_chip → `users.extraChips += n`
 * - budget_expansion → a permanent budget override at $72m
 *
 * Idempotent: re-granting a cosmetic is an upsert, and the non-cosmetic grants
 * are guarded by their own entitlement check, so a retry cannot double-grant.
 */
async function grantItem(
  ctx: MutationCtx,
  userId: Id<"users">,
  item: StoreItem,
  grantedBy: string,
): Promise<void> {
  const existing = await ctx.db
    .query("storeEntitlements")
    .withIndex("by_user_item", (q) =>
      q.eq("userId", userId).eq("itemId", item.id),
    )
    .collect();

  if (existing.length > 0) {
    // Already owned — only (re)enable it, never re-deliver the effect.
    await ctx.db.patch(existing[0]._id, { enabled: true, grantedAt: Date.now() });
    return;
  }

  await ctx.db.insert("storeEntitlements", {
    userId,
    itemId: item.id,
    grantedAt: Date.now(),
    grantedBy,
    via: "purchase",
    enabled: true,
  });

  if (item.grant === "extra_chip") {
    const user = await ctx.db.get(userId);
    const next = toCount((user?.extraChips ?? 0) + toCount(item.extraChips, 10));
    await ctx.db.patch(userId, { extraChips: next });
  }

  if (item.grant === "budget_expansion") {
    const settings = normalizeSettings(await getSettingsRow(ctx));
    const overrides = { ...settings.budgetOverrides };
    const amount = Math.min(
      toCount(item.budgetAmount, settings.marketRules.maxBudget),
      settings.marketRules.maxBudget,
    );
    overrides[String(userId)] = amount;
    await patchSettings(ctx, { budgetOverrides: overrides });
  }
}

/**
 * Manager: file a purchase request after paying cash in person.
 *
 * Validations (all defensive, all clean messages):
 *  - signed in;
 *  - the item id exists in the catalogue;
 *  - the price is within the hard 10 AED ceiling — the price is read from the
 *    CATALOGUE, so a tampered `priceAED` argument is ignored outright and a
 *    client that tries to pay more is rejected;
 *  - the Super Admin never needs to buy anything (everything is auto-unlocked);
 *  - no duplicate pending request for the same item.
 */
export const requestPurchase = mutation({
  args: {
    itemId: v.string(),
    // Accepted for transparency/anti-tamper, but NEVER trusted: the server
    // always uses the catalogue price.
    priceAED: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let user;
    try {
      user = await requireUser(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "You must be signed in to buy an item.",
      );
    }

    const item = storeItemById(args.itemId);
    if (!item) {
      throw new Error("That store item doesn't exist.");
    }
    const price = priceForItem(item.id);
    if (price === null || !Number.isFinite(price) || price <= 0) {
      throw new Error("That item has no valid price.");
    }

    // HARD CEILING — checked on the server, on the catalogue price AND on the
    // number the client claimed to be paying.
    if (price > MAX_PRICE_AED) {
      throw new Error(`Store items are capped at ${MAX_PRICE_AED} AED.`);
    }
    if (args.priceAED !== undefined && Number(args.priceAED) > MAX_PRICE_AED) {
      throw new Error(
        `Store items are capped at ${MAX_PRICE_AED} AED — nothing costs more.`,
      );
    }
    if (args.priceAED !== undefined && Number(args.priceAED) !== price) {
      throw new Error(
        `The price of ${item.name} is ${price} AED — please restart the purchase.`,
      );
    }

    if (user.role === "super_admin") {
      throw new Error(
        "You're the Super Admin — every store item is already unlocked for you.",
      );
    }

    try {
      const existing = await ctx.db
        .query("purchases")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      const duplicate = existing.some(
        (r) => r.itemId === item.id && r.status === "pending",
      );
      if (duplicate) {
        throw new Error(
          `You already have a pending request for ${item.name} — waiting on Zein.`,
        );
      }
      // Already own it? Don't take their money twice.
      const owned = await ctx.db
        .query("storeEntitlements")
        .withIndex("by_user_item", (q) =>
          q.eq("userId", user._id).eq("itemId", item.id),
        )
        .collect();
      if (owned.length > 0) {
        throw new Error(`You already own ${item.name}.`);
      }

      const id = await ctx.db.insert("purchases", {
        userId: user._id,
        username: (user.username ?? "unknown").trim() || "unknown",
        itemId: item.id,
        itemName: item.name,
        priceAED: price,
        status: "pending",
        createdAt: Date.now(),
      });
      return { purchaseId: id, priceAED: price, itemName: item.name };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err; // rethrow our own clean validation messages untouched
      }
      throw new Error("Could not submit the purchase request — please try again.");
    }
  },
});

/**
 * Super Admin only: confirm the cash arrived, mark the transaction approved and
 * grant the perk — all in ONE transaction, so a failure can never leave an
 * approved purchase undelivered (or deliver an item for a rejected one).
 *
 * IDEMPOTENCY GUARD: an already-approved or already-rejected transaction
 * throws a clean error and grants nothing.
 */
export const approvePurchase = mutation({
  args: { purchaseId: v.id("purchases"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    let admin;
    try {
      admin = await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "Only the Super Admin can approve purchases.",
      );
    }
    const note =
      typeof args.note === "string" ? args.note.trim().slice(0, 200) : "";

    try {
      const purchase = await ctx.db.get(args.purchaseId);
      if (!purchase) {
        throw new Error("Transaction not found — it may have already been removed.");
      }
      // ── Idempotency guard ──
      if (purchase.status === "approved") {
        throw new Error("This transaction was already approved.");
      }
      if (purchase.status === "rejected") {
        throw new Error(
          "This transaction was already rejected — ask the manager to request it again.",
        );
      }
      if (purchase.priceAED > MAX_PRICE_AED) {
        throw new Error(
          `Blocked: that transaction is ${purchase.priceAED} AED, over the ${MAX_PRICE_AED} AED ceiling.`,
        );
      }

      const item = storeItemById(purchase.itemId);
      const buyer = await ctx.db.get(purchase.userId);

      if (item && buyer) {
        await grantItem(ctx, purchase.userId, item, admin.username ?? "admin");
      }

      await ctx.db.patch(args.purchaseId, {
        status: "approved",
        decidedBy: admin.username ?? "admin",
        decidedAt: Date.now(),
        ...(note ? { note } : {}),
      });

      try {
        await ctx.runMutation(internal.activity.logActivity, {
          type: "store",
          text: `🎉 @${buyer?.username ?? purchase.username ?? "a manager"} unlocked ${item?.name ?? purchase.itemName}!`,
          actorUserId: purchase.userId,
        });
      } catch {
        // the feed must never break the grant
      }

      return {
        status: "approved" as const,
        granted: Boolean(item && buyer),
        itemName: item?.name ?? purchase.itemName,
      };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err;
      }
      throw new Error("Could not approve the transaction — please try again.");
    }
  },
});

/**
 * Super Admin only: reject a request WITHOUT touching the buyer's items or
 * stats. Same idempotency guard as `approvePurchase`, so a rejected purchase
 * can never later be approved and double-deliver.
 */
export const rejectPurchase = mutation({
  args: { purchaseId: v.id("purchases"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    let admin;
    try {
      admin = await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "Only the Super Admin can reject purchases.",
      );
    }
    const note =
      typeof args.note === "string" ? args.note.trim().slice(0, 200) : "";

    try {
      const purchase = await ctx.db.get(args.purchaseId);
      if (!purchase) {
        throw new Error("Transaction not found — it may have already been removed.");
      }
      if (purchase.status === "rejected") {
        throw new Error("This transaction was already rejected.");
      }
      if (purchase.status === "approved") {
        throw new Error(
          "This transaction was already approved and the item granted — it cannot be rejected.",
        );
      }

      // Deliberately does NOT touch storeEntitlements, extraChips or the
      // buyer's budget — a rejection changes the status and nothing else.
      await ctx.db.patch(args.purchaseId, {
        status: "rejected",
        decidedBy: admin.username ?? "admin",
        decidedAt: Date.now(),
        ...(note ? { note } : {}),
      });

      return {
        status: "rejected" as const,
        itemName: purchase.itemName,
      };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err;
      }
      throw new Error("Could not reject the transaction — please try again.");
    }
  },
});

/**
 * Super Admin only: flip one of THEIR OWN store items on or off. The Super
 * Admin auto-owns everything, so this writes an `enabled: false` /
 * `enabled: true` entitlement row to record the choice.
 *
 * `v.union(v.boolean(), v.null())` would be cleaner but Convex has no
 * exactOptional — `null` is explicit here and means "clear the flag".
 */
export const setSuperUnlock = mutation({
  args: { itemId: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    let admin;
    try {
      admin = await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "Only the Super Admin can change their own unlocks.",
      );
    }
    const item = storeItemById(args.itemId);
    if (!item) throw new Error("That store item doesn't exist.");
    const enabled = args.enabled === true;

    try {
      const existing = await ctx.db
        .query("storeEntitlements")
        .withIndex("by_user_item", (q) =>
          q.eq("userId", admin._id).eq("itemId", item.id),
        )
        .collect();

      if (existing.length === 0) {
        await ctx.db.insert("storeEntitlements", {
          userId: admin._id,
          itemId: item.id,
          grantedAt: Date.now(),
          grantedBy: admin.username ?? "admin",
          via: "super_admin",
          enabled,
        });
      } else if (enabled) {
        await ctx.db.patch(existing[0]._id, { enabled: true });
      } else {
        // Patching with `undefined` removes the optional field entirely, which
        // the UI reads as "not switched on".
        await ctx.db.patch(existing[0]._id, { enabled: undefined });
      }
      return { itemId: item.id, enabled };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err;
      }
      throw new Error("Could not change the unlock — please try again.");
    }
  },
});

/**
 * Manager: turn a cosmetic perk they own on or off. Non-toggleable items
 * (extra chips, budget expansion) are rejected with a clean message.
 */
export const setEntitlementEnabled = mutation({
  args: { itemId: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    let user;
    try {
      user = await requireUser(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "You must be signed in.",
      );
    }
    const item = storeItemById(args.itemId);
    if (!item) throw new Error("That store item doesn't exist.");
    if (!item.toggleable) {
      throw new Error(`${item.name} can't be switched off — it's always active.`);
    }

    try {
      const existing = await ctx.db
        .query("storeEntitlements")
        .withIndex("by_user_item", (q) =>
          q.eq("userId", user._id).eq("itemId", item.id),
        )
        .collect();
      if (existing.length === 0) {
        throw new Error(`You don't own ${item.name} yet.`);
      }
      if (args.enabled === true) {
        await ctx.db.patch(existing[0]._id, { enabled: true });
      } else {
        await ctx.db.patch(existing[0]._id, { enabled: undefined });
      }
      return { itemId: item.id, enabled: args.enabled === true };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err;
      }
      throw new Error("Could not change the perk — please try again.");
    }
  },
});

/**
 * Manager: set (or clear) the custom manager title unlocked by the
 * "Custom Manager Title & Badge" store item. Gated server-side: without the
 * entitlement the write is refused, so the field can never be abused.
 */
export const setCustomTitle = mutation({
  args: { title: v.string() },
  handler: async (ctx, args) => {
    let user;
    try {
      user = await requireUser(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "You must be signed in.",
      );
    }

    const raw = typeof args.title === "string" ? args.title : "";
    const title = raw.replace(/\s+/g, " ").trim().slice(0, 24);
    // A blank title clears the field; anything else must be a real title.
    if (title.length > 0 && title.length < 2) {
      throw new Error("Title must be at least 2 characters.");
    }

    try {
      const owned = await ctx.db
        .query("storeEntitlements")
        .withIndex("by_user_item", (q) =>
          q.eq("userId", user._id).eq("itemId", "custom_title"),
        )
        .collect();
      if (owned.length === 0 && user.role !== "super_admin") {
        throw new Error(
          "You haven't unlocked the Custom Manager Title yet.",
        );
      }
      await ctx.db.patch(user._id, {
        customTitle: title === "" ? undefined : title,
      });
      return { customTitle: title === "" ? null : title };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err;
      }
      throw new Error("Could not save your title — please try again.");
    }
  },
});