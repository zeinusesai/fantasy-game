import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { readUserCosmetics, requireUser } from "./lib";
import { getLeaderboardRows } from "./lib";
import { DEFAULT_BADGE_REGISTRY, cleanBadgeId, cleanSocialHandle, normalizeHouse } from "./defaults";
import { cosmeticById } from "./rewards";
import { HOUSES, type House } from "./schema";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Get the current signed in user. Returns null if the user is not signed in.
 * Usage: const signedInUser = await ctx.runQuery(api.users.currentUser);
 * THIS FUNCTION IS READ-ONLY. DO NOT MODIFY.
 */
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user: Doc<"users"> | null = await ctx.db.get(userId);
    // Defensive projection: a missing account degrades to null.
    if (!user) return null;

    // Store cosmetics (pitch theme / golden jersey / border / title). Total —
    // a failed lookup means "nothing unlocked", never a rejected query.
    const cosmetics = await readUserCosmetics(ctx, user);

    return {
      ...user,
      customBadge: user.customBadge ?? null,
      // Cosmetics, already normalised server-side so the client can render
      // `user.activePitchTheme ?? "default"` without another lookup.
      activePitchTheme: cosmetics.activePitchTheme,
      hasGoldenJersey: cosmetics.hasGoldenJersey,
      hasProfileBorder: cosmetics.hasProfileBorder,
      hasCustomTitle: cosmetics.hasCustomTitle,
      hasEquippedKit: cosmetics.hasEquippedKit,
      hasNameGlow: cosmetics.hasNameGlow,
      equippedBadgeId: cosmetics.equippedBadgeId,
      // Denormalized conveniences so the Profile / Store pages can render
      // without a second query. `?? ""` keeps them safe empty values.
      customTitle: user.customTitle ?? "",
      // Social handles — normalised WITHOUT the "@" by updateProfile, and
      // re-cleaned here so a hand-edited row can never put a scheme or a
      // script into the public profile card.
      instagram: cleanSocialHandle(user.instagram),
      tiktok: cleanSocialHandle(user.tiktok),
    };
  },
});

/**
 * The full public manager profile behind the profile card: identity, social
 * handles, store cosmetics, achievements (points, rank, favourite house) and
 * the pinned MVP player.
 *
 * Null-safe by contract: returns `null` for a signed-out viewer or a
 * non-existent manager, and EVERY nested value has a safe fallback, so the
 * card can render `cosmetics ?? {}` / `socials ?? {}` without a guard on the
 * client for each individual field.
 */
export const getPublicProfile = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    if ((await getAuthUserId(ctx)) === null) return null;
    try {
      const user = await ctx.db.get(userId);
      if (!user) return null;

      const cosmetics = await readUserCosmetics(ctx, user);

      // ── Achievements: points + rank, from the shared leaderboard ──
      let totalPoints = 0;
      let rank: number | null = null;
      let managerCount = 0;
      try {
        const rows = await getLeaderboardRows(ctx);
        managerCount = rows.length;
        const idx = rows.findIndex((r) => r.userId === userId);
        if (idx >= 0) {
          rank = idx + 1;
          totalPoints = rows[idx]?.total ?? 0;
        }
      } catch {
        // A leaderboard hiccup must never hide a profile.
      }

      // ── House: the manager's MANUAL preference (users.supportedHouse).
      //
      //    This used to be tallied from squad composition, which meant a
      //    manager's displayed house changed silently whenever they made a
      //    transfer. It is now a stored choice only.
      //
      //    `normalizeHouse` is total: a null/unset value stays null, and a
      //    value that is somehow not one of the four real houses (legacy or
      //    hand-edited row) degrades to null instead of rendering garbage.
      const supportedHouse = normalizeHouse(user.supportedHouse);

      // ── Pinned MVP player. The stored id may point at a deleted player or
      //    be a malformed string, so it is resolved defensively. ──
      let favouritePlayer: {
        playerId: string;
        name: string;
        house: string;
        position: string;
        image: string | null;
      } | null = null;
      const favId = user.favoritePlayerId;
      if (typeof favId === "string" && favId.length > 0) {
        try {
          // The stored value is a plain string (legacy rows predate strict
          // typing), so it is validated and cast here. A deleted/malformed id
          // throws here and is caught → favouritePlayer stays null.
          const p = await ctx.db.get(favId as Id<"players">);
          if (p && typeof p.name === "string") {
            favouritePlayer = {
              playerId: String(p._id),
              name: p.name,
              house: String(p.house),
              position: String(p.position),
              image: p.image ?? null,
            };
          }
        } catch {
          favouritePlayer = null;
        }
      }

      // ── EARNED cosmetics (the showcase chips). ──
      // Nothing here is bought: every row was written by the reward engine
      // or by a Super Admin override.
      let unlockedItems: Array<{
        cosmeticId: string;
        name: string;
        featId: string | null;
      }> = [];
      try {
        const rows = await ctx.db
          .query("cosmeticUnlocks")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect();
        unlockedItems = rows.map((r) => ({
          cosmeticId: String(r.cosmeticId),
          name: cosmeticById(r.cosmeticId)?.name ?? String(r.cosmeticId),
          featId: r.featId ?? null,
        }));
      } catch {
        unlockedItems = [];
      }

      return {
        userId: user._id,
        username: user.username ?? "unknown",
        teamName: user.teamName ?? "Unnamed team",
        avatar: user.image ?? null,
        role: user.role ?? null,
        customBadge: user.customBadge ?? null,
        badgeMeta: (() => {
          const id = cleanBadgeId(user.customBadge ?? "");
          if (!id) return null;
          const registry = { ...DEFAULT_BADGE_REGISTRY };
          const meta = registry[id];
          return meta ? { id, emoji: meta.emoji, label: meta.label } : null;
        })(),
        // Social — null when unlinked, never an empty string.
        instagram: cleanSocialHandle(user.instagram),
        tiktok: cleanSocialHandle(user.tiktok),
        // Cosmetics — always fully populated.
        cosmetics: {
          activePitchTheme: cosmetics.activePitchTheme,
          hasGoldenJersey: cosmetics.hasGoldenJersey,
          hasProfileBorder: cosmetics.hasProfileBorder,
          hasCustomTitle: cosmetics.hasCustomTitle,
          customTitle:
            typeof user.customTitle === "string" && user.customTitle.trim() !== ""
              ? user.customTitle.trim().slice(0, 24)
              : null,
          unlockedItems,
        },
        // Achievements — always fully populated.
        stats: {
          totalPoints,
          rank,
          managerCount,
          /**
           * Kept under its original name so existing consumers (and the
           * response shape) don't change, but it is now the stored
           * preference rather than a derived tally. Null = not chosen yet.
           */
          favouriteHouse: supportedHouse,
        },
        supportedHouse,
        favouritePlayer,
      };
    } catch {
      return null;
    }
  },
});

/**
 * Set (or clear) the signed-in manager's manually-chosen supported house.
 *
 * This is the single-purpose counterpart to `managers.updateProfile`: the
 * house dropdown can save on its own without dragging a team name, avatar or
 * social handle along with it, so a rejected house can never clobber an
 * unrelated field on the profile.
 *
 * Accepts EITHER form a client might send:
 *   • `supportedHouse`   — the display name, e.g. "Fire" or "Fire House"
 *   • `supportedHouseId` — the stable house key / id, e.g. "fire"
 *
 * Both are normalised through `normalizeHouse`, which is TOTAL and
 * case/whitespace tolerant, so " fire ", "FIRE" and "Fire House" all resolve
 * to the same stored value. A blank value CLEARS the preference (patching
 * `undefined` removes the field) rather than writing a sentinel.
 *
 * Typed as plain optional strings rather than `houseValidator` so a stale or
 * tampered client gets a readable message instead of an opaque
 * `ArgumentValidationError`. Every failure path throws a friendly error; the
 * client is expected to wrap the call in try/catch and toast it.
 */
export const updateSupportedHouse = mutation({
  args: {
    supportedHouse: v.optional(v.string()),
    supportedHouseId: v.optional(v.string()),
  },
  handler: async (ctx, { supportedHouse, supportedHouseId }) => {
    let user: Doc<"users">;
    try {
      user = await requireUser(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Sign in to choose a supported house.",
      );
    }

    // `supportedHouseId` wins when both are sent: it is the more specific
    // field. A missing/blank value on EITHER arg means "clear", but only if
    // the caller actually asked for a house change.
    const requested = supportedHouseId ?? supportedHouse;
    if (requested === undefined) {
      throw new Error("No house was provided.");
    }

    const raw = requested.trim();
    // Tolerate the display form ("Fire House") as well as the key ("Fire").
    const withoutSuffix = raw.replace(/\s*house$/i, "").trim();
    const resolved: House | null = normalizeHouse(withoutSuffix);

    if (raw !== "" && resolved === null) {
      throw new Error(
        `"${raw}" is not a house. Supported house must be one of: ${HOUSES.join(", ")}.`,
      );
    }

    try {
      // `undefined` REMOVES the optional field in Convex (`null` is not
      // assignable), which is exactly how the preference is cleared.
      await ctx.db.patch(user._id, { supportedHouse: resolved ?? undefined });
      return { supportedHouse: resolved };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err;
      }
      throw new Error("Could not update your supported house — please try again.");
    }
  },
});