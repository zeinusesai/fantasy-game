import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { readUserCosmetics, requireUser } from "./lib";
import { getLeaderboardRows } from "./lib";
import { DEFAULT_BADGE_REGISTRY, cleanBadgeId, cleanSocialHandle, normalizeHouse, normalizeSection } from "./defaults";
import { readActiveSectionChampion } from "./leaderboard";
import { cosmeticById } from "./rewards";
import { HOUSES, SECTIONS, type House } from "./schema";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Get the current signed in user. Returns null if the user is not signed in.
 * Usage: const signedInUser = await ctx.runQuery(api.users.currentUser);
 * THIS FUNCTION IS READ-ONLY. DO NOT MODIFY.
 */
/**
 * Y11 PE Hub — retro 8-bit arcade toggle.
 *
 * Stores a single boolean on the manager's profile; the client mirrors it to
 * a `pixel-mode` class on <html> so player cards, pitch turf and badges switch
 * to the 1980s pixel treatment. Total: any failure surfaces a readable error
 * instead of a raw server message.
 */
export const setPixelMode = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    let user: Doc<"users">;
    try {
      user = await requireUser(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Sign in to change your theme.",
      );
    }
    try {
      await ctx.db.patch(user._id, { pixelMode: enabled === true });
      return { pixelMode: enabled === true };
    } catch {
      throw new Error("Could not save your theme — please try again.");
    }
  },
});

/**
 * Y11 PE Hub — equip an entrance audio stinger and/or a stadium pitch skin
 * from "My Locker". Both values are plain preset ids / bounded URLs and are
 * re-sanitised server-side, so a tampered client can never store a script.
 */
export const setLockerItem = mutation({
  args: {
    entranceStinger: v.optional(v.string()),
    pitchSkin: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let user: Doc<"users">;
    try {
      user = await requireUser(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Sign in to equip a locker item.",
      );
    }

    const clean = (raw: string | undefined) => {
      if (raw === undefined) return undefined;
      const value = raw.trim();
      if (value === "") return ""; // explicitly unequipped
      if (value.length > 200) {
        throw new Error("That locker item is too long — pick a preset instead.");
      }
      if (!/^[a-z0-9:/._-]+$/i.test(value)) {
        throw new Error("That locker item isn't valid — pick a preset instead.");
      }
      return value;
    };

    try {
      const patch: Partial<Doc<"users">> = {};
      const stinger = clean(args.entranceStinger);
      const skin = clean(args.pitchSkin);
      if (stinger !== undefined) patch.entranceStinger = stinger;
      if (skin !== undefined) patch.pitchSkin = skin;
      await ctx.db.patch(user._id, patch);
      return {
        entranceStinger: stinger !== undefined ? stinger : (user.entranceStinger ?? ""),
        pitchSkin: skin !== undefined ? skin : (user.pitchSkin ?? ""),
      };
    } catch (err) {
      if (err instanceof Error && err.message.includes("locker item")) throw err;
      throw new Error("Could not equip that item — please try again.");
    }
  },
});

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

    // Normalised server-side so the client renders `user.section` without
    // re-validating, and so a legacy/garbage value can never leak into the UI.
    const section = normalizeSection(user.section);
    // Temporary weekly cosmetic — true only while this manager's section holds
    // the "Section Champions" award. Re-evaluated on every gameweek closure.
    const champion = await readActiveSectionChampion(ctx);
    const isSectionChampion = section !== null && champion?.section === section;

    return {
      ...user,
      customBadge: user.customBadge ?? null,
      section,
      favoritePlayerId: typeof user.favoritePlayerId === "string" ? user.favoritePlayerId : undefined,
      isSectionChampion,
      // Included so Profile can render the "expires after GW{n+1}" hint without
      // a second query.
      sectionChampionGameweek: isSectionChampion ? (champion?.gameweek ?? null) : null,
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

      // Temporary weekly cosmetic, resolved once for the whole card.
      const champion = await readActiveSectionChampion(ctx);
      const managerSection = normalizeSection(user.section);
      const isSectionChampion =
        managerSection !== null && champion?.section === managerSection;

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
        // Y11 PE Hub grouping — normalised through the SAME validator the
        // write paths use, so a profile can never display a section the server
        // would not accept, and a legacy/garbage value degrades to `null`
        // rather than reaching for a grouping that does not exist.
        section: normalizeSection(user.section),
        // Temporary weekly cosmetic: true only while this manager's section is
        // the most recent "Section Champions" winner.
        isSectionChampion,
        sectionChampionGameweek: isSectionChampion ? (champion?.gameweek ?? null) : null,
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
/**
 * Y11 PE Hub — mandatory onboarding.
 *
 * Every manager picks a PE class section and a favourite player when they
 * register, and can change either at any time from Profile. Both writes are
 * validated against the SAME normalisers the read paths use (`normalizeSection`
 * in defaults.ts), so a value can never be stored one way and displayed
 * another.
 */

/** The eight selectable sections. Public: the signup dropdown reads this. */
export const listSections = query({
  args: {},
  handler: async () => SECTIONS,
});

/**
 * Set (or clear) the signed-in manager's PE class section.
 *
 * A blank value CLEARS the preference rather than writing a sentinel, and a
 * value outside Section A–H is rejected outright — never stored. Typed as a
 * plain optional string (not `sectionValidator`) so a stale or tampered client
 * gets this readable message instead of an opaque `ArgumentValidationError`.
 */
export const setSection = mutation({
  args: { section: v.optional(v.string()) },
  handler: async (ctx, { section }) => {
    let user: Doc<"users">;
    try {
      user = await requireUser(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Sign in to choose your section.",
      );
    }

    const raw = typeof section === "string" ? section : "";
    const resolved = normalizeSection(raw);
    // A non-empty value that does not resolve is a genuine mistake (typo, or a
    // client sending something outside the list) and must not be swallowed.
    if (raw.trim() !== "" && resolved === null) {
      throw new Error(`Section must be one of: ${SECTIONS.join(", ")}.`);
    }

    try {
      await ctx.db.patch(user._id, { section: resolved ?? undefined });
      return { section: resolved };
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Section must be")) throw err;
      throw new Error("Could not save your section — please try again.");
    }
  },
});

/**
 * Set (or clear) the signed-in manager's favourite player.
 *
 * The id must resolve to a real player row; a dangling or hand-typed id is
 * rejected instead of being stored, because a stored-but-dead id renders as a
 * blank favourite everywhere it is displayed. Clearing sends an empty string,
 * which removes the field.
 */
export const setFavoritePlayer = mutation({
  args: { playerId: v.optional(v.string()) },
  handler: async (ctx, { playerId }) => {
    let user: Doc<"users">;
    try {
      user = await requireUser(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Sign in to pick a favourite player.",
      );
    }

    const raw = typeof playerId === "string" ? playerId.trim() : "";
    if (raw === "") {
      await ctx.db.patch(user._id, { favoritePlayerId: undefined });
      return { favoritePlayerId: null as string | null };
    }

    // The stored value is a plain string (legacy rows predate strict typing),
    // so it is validated and cast here; a malformed id throws and is caught.
    let resolvedId: string | null = null;
    try {
      const player = await ctx.db.get(raw as Id<"players">);
      if (player && typeof player.name === "string") resolvedId = String(player._id);
    } catch {
      resolvedId = null;
    }
    if (!resolvedId) {
      throw new Error("That player could not be found — pick someone from the list.");
    }

    try {
      await ctx.db.patch(user._id, { favoritePlayerId: resolvedId });
      return { favoritePlayerId: resolvedId };
    } catch {
      throw new Error("Could not save your favourite player — please try again.");
    }
  },
});

/**
 * Whether the signed-in manager still owes the mandatory onboarding fields.
 *
 * The client uses this to keep a signed-in but incomplete account out of the
 * rest of the app until both a section and a favourite player exist.
 */
export const getOnboardingStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { signedIn: false as const, complete: true as const };
    const user = await ctx.db.get(userId);
    if (!user) return { signedIn: false as const, complete: true as const };
    const section = normalizeSection(user.section);
    const favoritePlayerId =
      typeof user.favoritePlayerId === "string" && user.favoritePlayerId !== ""
        ? user.favoritePlayerId
        : null;
    return {
      signedIn: true as const,
      complete: section !== null && favoritePlayerId !== null,
      section,
      favoritePlayerId,
    };
  },
});
