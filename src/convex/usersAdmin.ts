import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalAction,
  type QueryCtx,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireSuperAdmin } from "./lib";
import { internal } from "./_generated/api";
import { modifyAccountCredentials, invalidateSessions } from "@convex-dev/auth/server";
import { houseValidator } from "./schema";
import type { Doc } from "./_generated/dataModel";

// ── Super admin: user management ─────────────────────────────────────────

/**
 * RBAC check that never throws: returns the caller's user doc when they may
 * VIEW the user list (Super Admin role, or either pre-registered admin
 * username Zein/Cino as a fallback when a role was never written), otherwise
 * `null`. The query then degrades to an empty list instead of surfacing an
 * unhandled error in the client.
 *
 * NOTE: view-only safety net — the mutating functions below still require
 * super_admin strictly, so Cino (moderator) can never edit budgets or reset
 * passwords regardless of this check.
 */
async function safeUserListViewer(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  try {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const isSuperByRole = user.role === "super_admin";
    const isKnownAdmin = user.username === "zein" || user.username === "cino";
    return isSuperByRole || isKnownAdmin ? user : null;
  } catch {
    return null;
  }
}

/** Lists all users for the Super Admin. Empty array when unauthorized. */
export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    const admin = await safeUserListViewer(ctx);
    if (!admin) return [];
    try {
      const users = await ctx.db.query("users").collect();
      return users.map((u) => ({
        _id: u._id,
        username: u.username ?? null,
        teamName: u.teamName ?? null,
        image: u.image ?? null,
        profilePic: u.profilePic ?? null,
        role: u.role ?? null,
        budget: u.budget ?? null,
      }));
    } catch {
      // Never bubble storage errors into a rejected query.
      return [];
    }
  },
});

export const getUserDetail = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireSuperAdmin(ctx);
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const squad = await ctx.db
      .query("squads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return {
      _id: user._id,
      username: user.username ?? null,
      teamName: user.teamName ?? null,
      image: user.image ?? null,
      profilePic: user.profilePic ?? null,
      role: user.role ?? null,
      budget: user.budget ?? null,
      squadSize: squad ? squad.playerIds.length : 0,
    };
  },
});

export const updateUser = mutation({
  args: {
    userId: v.id("users"),
    teamName: v.optional(v.string()),
    image: v.optional(v.string()),
    budget: v.optional(v.number()),
  },
  handler: async (ctx, { userId, teamName, image, budget }) => {
    await requireSuperAdmin(ctx);
    const patch: Record<string, unknown> = {};
    if (teamName !== undefined) {
      const trimmed = teamName.trim();
      if (trimmed.length < 2 || trimmed.length > 40) {
        throw new Error("Team name must be 2-40 characters.");
      }
      patch.teamName = trimmed;
    }
    if (image !== undefined) patch.image = image || undefined;
    if (budget !== undefined) {
      if (!Number.isFinite(budget) || budget < 0) {
        throw new Error("Budget must be a non-negative number.");
      }
      patch.budget = budget;
    }
    await ctx.db.patch(userId, patch);
  },
});

export const getUserIdByUsernameInternal = internalQuery({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
    return user?._id ?? null;
  },
});

/** Internal action: rewrites the scrypt hash + kills the user's sessions. */
export const resetPasswordAction = internalAction({
  args: { username: v.string(), userId: v.id("users"), newPassword: v.string() },
  handler: async (ctx, { username, userId, newPassword }) => {
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: username, secret: newPassword },
    });
    await invalidateSessions(ctx, { userId });
  },
});

/** Super admin resets any user's password. */
export const requestPasswordReset = mutation({
  args: { userId: v.id("users"), newPassword: v.string() },
  handler: async (ctx, { userId, newPassword }) => {
    await requireSuperAdmin(ctx);
    if (!newPassword || newPassword.length < 4) {
      throw new Error("New password must be at least 4 characters.");
    }
    const user = await ctx.db.get(userId);
    if (!user || !user.username) {
      throw new Error("This account has no username credential to reset.");
    }
    await ctx.scheduler.runAfter(0, internal.usersAdmin.resetPasswordAction, {
      username: user.username,
      userId,
      newPassword,
    });
  },
});
