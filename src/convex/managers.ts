import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { normalizeUsername } from "./configDefaults";
import {
  requireUser,
  getPlatformConfig,
  getLeaderboardRows,
} from "./lib";

// ── Avatar uploads (Convex file storage) ─────────────────────────────────

// 2MB hard cap — matches the client-side check and protects storage.
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

/**
 * Hands the signed-in user a one-time upload URL for their custom avatar.
 * The file itself never passes through a mutation — the client PUTs it
 * straight to storage, then calls finalizeAvatarUpload.
 */
export const generateAvatarUploadUrl = mutation({
  args: { fileType: v.string() },
  handler: async (ctx, { fileType }) => {
    try {
      await requireUser(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Sign in to upload an avatar.",
      );
    }
    if (
      !ALLOWED_AVATAR_TYPES.includes(
        fileType as (typeof ALLOWED_AVATAR_TYPES)[number],
      )
    ) {
      throw new Error(
        "Unsupported image type — use PNG, JPG, WEBP or GIF.",
      );
    }
    try {
      return await ctx.storage.generateUploadUrl();
    } catch {
      throw new Error("Could not start the upload — please try again.");
    }
  },
});

/** App bootstrap: seeds the pre-registered admin accounts (idempotent). */
export const bootstrap = mutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.seedAdmins.ensureSeedAdmins, {});
  },
});

/** Public availability probe for the signup form (case-insensitive). */
export const getUsernameExists = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) =>
        q.eq("username", normalizeUsername(username)),
      )
      .unique();
    return user !== null;
  },
});

// ── Profile ──────────────────────────────────────────────────────────────

/**
 * Store a custom avatar: the client uploads the file straight to Convex
 * storage, then calls this with the resulting id. We validate type + size
 * server-side (2MB cap, PNG/JPG/WEBP/GIF) and persist both the auth `image`
 * field and the `profilePic` alias. The display URL is resolved server-side
 * via ctx.storage.getUrl — the client never supplies it.
 */
export const finalizeAvatarUpload = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    let user;
    try {
      user = await requireUser(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Sign in to upload an avatar.",
      );
    }

    try {
      const meta = await ctx.db.system.get(storageId);
      if (!meta) throw new Error("Upload not found — please try again.");
      if (!ALLOWED_AVATAR_TYPES.includes(meta.contentType as never)) {
        throw new Error(
          "Unsupported image type — use PNG, JPG, WEBP or GIF.",
        );
      }
      if (meta.size > MAX_AVATAR_BYTES) {
        throw new Error("Image is over the 2MB limit — please use a smaller file.");
      }

      const url = await ctx.storage.getUrl(storageId);
      if (!url) {
        throw new Error("Could not load the uploaded image — please try again.");
      }

      await ctx.db.patch(user._id, {
        image: url,
        profilePic: url,
      });
      return { url };
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith("Uncaught")) throw err;
      throw new Error("Could not save your avatar — please try again.");
    }
  },
});

/**
 * Switch the signed-in user's profile picture to a preset avatar id.
 * Preset ids are validated server-side (non-empty string) before writing.
 */
export const updateAvatar = mutation({
  args: { avatarId: v.string() },
  handler: async (ctx, { avatarId }) => {
    let user;
    try {
      user = await requireUser(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Sign in to change your avatar.",
      );
    }
    const id = typeof avatarId === "string" ? avatarId.trim() : "";
    if (!id) throw new Error("Missing avatar selection.");

    try {
      await ctx.db.patch(user._id, {
        image: id,
        profilePic: id,
      });
      return { avatarId: id };
    } catch {
      throw new Error("Could not save your avatar — please try again.");
    }
  },
});

export const updateProfile = mutation({
  args: {
    teamName: v.string(),
    avatar: v.optional(v.string()),
    favoritePlayerId: v.optional(v.string()),
  },
  handler: async (ctx, { teamName, avatar, favoritePlayerId }) => {
    let user;
    try {
      user = await requireUser(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Sign in to update your profile.",
      );
    }
    const trimmed = typeof teamName === "string" ? teamName.trim() : "";
    if (trimmed.length < 2 || trimmed.length > 40) {
      throw new Error("Team name must be 2-40 characters.");
    }
    try {
      await ctx.db.patch(user._id, {
        teamName: trimmed,
        ...(avatar !== undefined ? { image: avatar || undefined } : {}),
        ...(favoritePlayerId !== undefined
          ? { favoritePlayerId: favoritePlayerId || undefined }
          : {}),
      });
    } catch {
      throw new Error("Could not save your profile — please try again.");
    }
  },
});

// ── Global fantasy leaderboard ───────────────────────────────────────────

export const getLeaderboard = query({
  args: {},
  handler: async (ctx) => {
    const rows = await getLeaderboardRows(ctx);
    const users = await ctx.db.query("users").collect();
    const byId = new Map(users.map((u) => [u._id, u]));
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const user = byId.get(row.userId);
      // Favorite player lookup — defensive: unset id, deleted player or any
      // storage hiccup degrades to null (UI renders "N/A").
      let favoritePlayerName: string | null = null;
      const favId = user?.favoritePlayerId;
      if (typeof favId === "string" && favId.length > 0) {
        try {
          favoritePlayerName =
            (await ctx.db.get(favId as Id<"players">))?.name ?? null;
        } catch {
          favoritePlayerName = null;
        }
      }
      out.push({
        rank: i + 1,
        userId: row.userId,
        username: user?.username ?? "?",
        teamName: user?.teamName ?? "Unnamed team",
        avatar: user?.image ?? null,
        favoritePlayerName,
        customBadge: user?.customBadge ?? null,
        role: user?.role ?? null,
        totalPoints: row.total,
        lastMatchPoints: row.lastMatch ?? 0,
      });
    }
    return out;
  },
});

// ── Tournament leaders (golden boot / playmaker) ─────────────────────────

export const getTournamentLeaders = query({
  args: {},
  handler: async (ctx) => {
    const matchPlayers = await ctx.db.query("matchPlayers").collect();
    const players = await ctx.db.query("players").collect();
    const byId = new Map(players.map((p) => [p._id, p]));

    const goals = new Map<string, { goals: number; assists: number }>();
    for (const mp of matchPlayers) {
      const cur = goals.get(mp.playerId) ?? { goals: 0, assists: 0 };
      cur.goals += mp.goals;
      cur.assists += mp.assists;
      goals.set(mp.playerId, cur);
    }

    const scorers = [...goals.entries()]
      .map(([playerId, agg]) => ({
        player: byId.get(playerId as Id<"players">) ?? null,
        playerId,
        goals: agg.goals,
        assists: agg.assists,
      }))
      .filter((r) => r.player !== null && r.goals > 0)
      .sort((a, b) => b.goals - a.goals)
      .slice(0, 10);

    const assisters = [...goals.entries()]
      .map(([playerId, agg]) => ({
        player: byId.get(playerId as Id<"players">) ?? null,
        playerId,
        goals: agg.goals,
        assists: agg.assists,
      }))
      .filter((r) => r.player !== null && r.assists > 0)
      .sort((a, b) => b.assists - a.assists)
      .slice(0, 10);

    return { topScorers: scorers, topAssisters: assisters };
  },
});

// ── Stats for the signed-in manager (null-safe: never throws) ────────────

export const getMyStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null; // not signed in (yet)
    const rows = await getLeaderboardRows(ctx);
    const mine = rows.find((r) => r.userId === userId);
    const rank = mine ? rows.findIndex((r) => r.userId === userId) + 1 : null;
    return {
      totalPoints: mine?.total ?? 0,
      lastMatchPoints: mine?.lastMatch ?? 0,
      rank,
      managerCount: rows.length,
    };
  },
});
