import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalAction,
  internalMutation,
  type QueryCtx,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireSuperAdmin, isSuperAdminIdentity } from "./lib";
import { FIXED_MANAGER_BUDGET } from "./configDefaults";
import { normalizeSettings, getSettingsRow } from "./adminConfig";
import { internal } from "./_generated/api";
import { modifyAccountCredentials, invalidateSessions } from "@convex-dev/auth/server";
import { houseValidator, SECTIONS } from "./schema";
import { normalizeSection } from "./defaults";
import type { Doc } from "./_generated/dataModel";

// ── Super admin: user management ─────────────────────────────────────────

/**
 * RBAC check that never throws: returns the caller's user doc when they may
 * VIEW the user list — i.e. the single Super Admin (Zein) — otherwise `null`.
 * The query then degrades to an empty list instead of surfacing an unhandled
 * error in the client.
 *
 * Both conditions must hold: the `super_admin` role AND the Zein identity.
 * A mis-promoted row (role flipped by hand) therefore still reads `null`.
 * The mutating functions below run the identical check via
 * `requireSuperAdmin`, so view and write can never disagree.
 */
async function safeUserListViewer(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  try {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return user.role === "super_admin" && isSuperAdminIdentity(user) ? user : null;
  } catch {
    return null;
  }
}

/**
 * Maps any stored role (including legacy values like "admin"/"user") to one
 * of the platform's three canonical roles, so role comparisons downstream
 * never see an unexpected string.
 */
function normalizeRole(role: string | null | undefined) {
  if (role === "super_admin") return "super_admin";
  if (role === "moderator" || role === "admin") return "moderator";
  return "manager";
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
        // Fixed platform budget for every manager (legacy fields ignored).
        budget: FIXED_MANAGER_BUDGET,
        customBadge: u.customBadge ?? null,
      }));
    } catch {
      // Never bubble storage errors into a rejected query.
      return [];
    }
  },
});

/**
 * RBAC view of every registered user with their platform role.
 * Super Admin (Zein) only — anyone else gets `[]` so the admin tab renders
 * a clean empty state instead of surfacing an auth error in the client.
 */
export const listAllUsersWithRoles = query({
  args: {},
  handler: async (ctx) => {
    try {
      const caller = await getAuthUserId(ctx);
      if (caller === null) return [];
      const me = await ctx.db.get(caller);
      // Single Super-Admin restriction: role AND identity must both match.
      if (!me || me.role !== "super_admin" || !isSuperAdminIdentity(me)) return [];

      const users = await ctx.db.query("users").collect();
      // Resolve each manager's favourite player once so the admin table can
      // show (and correct) it without an N+1 query per row.
      const playerNames = new Map<string, string>();
      try {
        const players = await ctx.db.query("players").collect();
        for (const p of players) playerNames.set(String(p._id), p.name);
      } catch {
        // A missing roster only costs the name column, never the row.
      }
      return users
        .map((u) => ({
          _id: u._id,
          username: u.username ?? null,
          teamName: u.teamName ?? null,
          image: u.image ?? null,
          role: normalizeRole(u.role),
          customBadge: u.customBadge ?? null,
          // Mandatory onboarding fields, normalised through the same validator
          // the signup/profile write paths use.
          section: normalizeSection(u.section),
          favoritePlayerId:
            typeof u.favoritePlayerId === "string" && u.favoritePlayerId !== ""
              ? u.favoritePlayerId
              : null,
          favoritePlayerName:
            typeof u.favoritePlayerId === "string"
              ? (playerNames.get(u.favoritePlayerId) ?? null)
              : null,
        }))
        .sort((a, b) => (a.username ?? "").localeCompare(b.username ?? ""));
    } catch {
      return [];
    }
  },
});

/**
 * Assign a role to a user. Super Admin (Zein) only. Accepts the external
 * role names ("super_admin" | "admin" | "user"), validates them, then maps
 * to the platform's stored roles ("admin" -> "moderator"). Cannot be used to
 * demote the last remaining Super Admin — locks Zein out of the panel.
 */
export const updateUserRole = mutation({
  args: { targetUserId: v.id("users"), newRole: v.string() },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "Only the Super Admin can change user roles.",
      );
    }

    // Explicit parsing/validation of client input before any DB access.
    const raw =
      typeof args.newRole === "string" ? args.newRole.trim().toLowerCase() : "";
    const ROLE_MAP: Record<
      string,
      "super_admin" | "moderator" | "manager" | undefined
    > = {
      super_admin: "super_admin",
      admin: "moderator",
      user: "manager",
    };
    const platformRole = ROLE_MAP[raw];
    if (!platformRole) {
      throw new Error(
        `Invalid role "${raw}" — must be super_admin, admin or user.`,
      );
    }

    try {
      const target = await ctx.db.get(args.targetUserId);
      if (!target) throw new Error("User not found.");

      // Guard: never remove the last super admin.
      if (
        target.role === "super_admin" &&
        platformRole !== "super_admin"
      ) {
        const supers = (await ctx.db.query("users").collect()).filter(
          (u) => u.role === "super_admin",
        );
        if (supers.length <= 1) {
          throw new Error(
            "Cannot demote the last Super Admin — promote another admin first.",
          );
        }
      }

      await ctx.db.patch(args.targetUserId, { role: platformRole });
      return { role: platformRole };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err; // rethrow clean validation messages untouched
      }
      throw new Error("Could not update the user's role — please try again.");
    }
  },
});

/**
 * Super Admin only: assign or clear a custom badge on any manager. Badge
 * keys are strictly validated against the known set; "none" clears the
 * badge (field removed server-side). Invalid keys throw a clean error.
 */
export const assignUserBadge = mutation({
  args: { targetUserId: v.id("users"), badgeType: v.string() },
  handler: async (ctx, { targetUserId, badgeType }) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "Only the Super Admin can assign badges.",
      );
    }

    const key = typeof badgeType === "string" ? badgeType.trim().toLowerCase() : "";
    if (!key) throw new Error("Unknown badge.");

    try {
      const target = await ctx.db.get(targetUserId);
      if (!target) throw new Error("User not found — they may already be deleted.");

      if (key === "none") {
        // Clearing: patching with undefined removes the field.
        await ctx.db.patch(targetUserId, { customBadge: undefined });
        return { badge: null };
      }

      // Validate against the LIVE registry: built-ins plus any custom badge
      // ids the Super Admin created in the Customization tab.
      const registry = normalizeSettings(await getSettingsRow(ctx)).badgeRegistry;
      const meta = registry[key];
      if (!meta) throw new Error(`Unknown badge "${key}".`);

      await ctx.db.patch(targetUserId, { customBadge: key });
      // Activity feed: badge assignment (defensive, non-fatal).
      try {
        await ctx.runMutation(internal.activity.logActivity, {
          type: "badge",
          text: `🏅 @${target.username ?? "a manager"} was awarded the "${meta.label}" badge by the Super Admin!`,
          actorUserId: targetUserId,
        });
      } catch {
        // feed failure is non-fatal
      }
      return { badge: key };
      } catch (err) {
      if (err instanceof Error && !err.message.startsWith("Uncaught")) throw err;
      throw new Error("Could not assign the badge — please try again.");
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
      budget: FIXED_MANAGER_BUDGET,
      squadSize: squad ? squad.playerIds.length : 0,
    };
  },
});

export const updateUser = mutation({
  args: {
    userId: v.id("users"),
    teamName: v.optional(v.string()),
    image: v.optional(v.string()),
  },
  handler: async (ctx, { userId, teamName, image }) => {
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
    // NOTE: the budget argument was removed — the budget is a fixed $70m for
    // every manager and can no longer be edited per user.
    await ctx.db.patch(userId, patch);
  },
});

/**
 * Internal (server/CLI tooling only): normalise every existing user record to
 * the fixed $70m budget. Writes `budget: 70_000_000` and clears the legacy
 * `customBudget` override on all rows, so no stale override can survive the
 * migration. Safe to re-run — idempotent.
 */
export const normalizeBudgetsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    try {
      const users = await ctx.db.query("users").collect();
      let updated = 0;
      for (const user of users) {
        if (user.budget === FIXED_MANAGER_BUDGET && user.customBudget === undefined) {
          continue; // already correct — skip the write
        }
        await ctx.db.patch(user._id, {
          budget: FIXED_MANAGER_BUDGET,
          customBudget: undefined, // patching undefined removes the field
        });
        updated += 1;
      }
      return { total: users.length, updated, budget: FIXED_MANAGER_BUDGET };
    } catch {
      throw new Error("Could not normalise budgets.");
    }
  },
});

/**
 * Super Admin only: permanently delete a user account and cascade-delete
 * everything tied to it — auth accounts, their fantasy squad, per-match
 * score rows and price requests — so no orphaned records remain.
 * Guards: you cannot delete yourself, and the last Super Admin is protected.
 */
export const deleteUserWithCascade = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await requireSuperAdmin(ctx);

    const target = await ctx.db.get(userId);
    if (!target) throw new Error("User not found — they may already be deleted.");
    if (target._id === me._id) {
      throw new Error("You cannot delete your own account while signed in.");
    }

    // Guard: never remove the last super admin.
    if (target.role === "super_admin") {
      const supers = (await ctx.db.query("users").collect()).filter(
        (u) => u.role === "super_admin",
      );
      if (supers.length <= 1) {
        throw new Error(
          "Cannot delete the last Super Admin — promote another admin first.",
        );
      }
    }

    // Explicit annotation breaks the circular type inference that TS7022
    // would otherwise hit through ctx.runMutation.
    const result: {
      accounts: number;
      squadDeleted: boolean;
      scoresDeleted: number;
      requestsDeleted: number;
    } = await ctx.runMutation(internal.lib.deleteUserAndAccount, {
      userId,
    });
    return {
      deleted: true as const,
      squadDeleted: result?.squadDeleted ?? false,
      scoresDeleted: result?.scoresDeleted ?? 0,
      requestsDeleted: result?.requestsDeleted ?? 0,
    };
  },
});

/**
 * Super Admin only: correct any manager's PE class section (e.g. they picked
 * the wrong one at registration).
 *
 * A blank value CLEARS the section; anything outside Section A–H is rejected
 * rather than stored. Both branches go through `normalizeSection`, the same
 * normaliser the signup and self-service paths use, so the admin panel can
 * never write a value the rest of the app would refuse to read.
 */
export const setUserSection = mutation({
  args: { targetUserId: v.id("users"), section: v.optional(v.string()) },
  handler: async (ctx, { targetUserId, section }) => {
    await requireSuperAdmin(ctx);
    const target = await ctx.db.get(targetUserId);
    if (!target) throw new Error("User not found — they may already be deleted.");

    const raw = typeof section === "string" ? section : "";
    const resolved = normalizeSection(raw);
    if (raw.trim() !== "" && resolved === null) {
      throw new Error(`Section must be one of: ${SECTIONS.join(", ")}.`);
    }

    await ctx.db.patch(targetUserId, { section: resolved ?? undefined });
    return { section: resolved };
  },
});

/**
 * Super Admin only: correct (or clear) any manager's favourite player.
 *
 * The id must resolve to a real player row — a dangling id is rejected rather
 * than stored, because it would render blank everywhere the favourite is shown.
 */
export const setUserFavoritePlayer = mutation({
  args: { targetUserId: v.id("users"), playerId: v.optional(v.string()) },
  handler: async (ctx, { targetUserId, playerId }) => {
    await requireSuperAdmin(ctx);
    const target = await ctx.db.get(targetUserId);
    if (!target) throw new Error("User not found — they may already be deleted.");

    const raw = typeof playerId === "string" ? playerId.trim() : "";
    if (raw === "") {
      await ctx.db.patch(targetUserId, { favoritePlayerId: undefined });
      return { favoritePlayerId: null as string | null };
    }

    let resolvedId: string | null = null;
    try {
      const player = await ctx.db.get(raw as Doc<"players">["_id"]);
      if (player && typeof player.name === "string") resolvedId = String(player._id);
    } catch {
      resolvedId = null;
    }
    if (!resolvedId) {
      throw new Error("That player could not be found — pick someone from the roster.");
    }

    await ctx.db.patch(targetUserId, { favoritePlayerId: resolvedId });
    return { favoritePlayerId: resolvedId };
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
    // Defensive: never forward a malformed credential to the auth layer.
    const secret = typeof newPassword === "string" ? newPassword : "";
    if (secret.length < 4) throw new Error("Invalid credential.");
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: username, secret },
    });
    await invalidateSessions(ctx, { userId });
  },
});

/**
 * Cryptographically-flavoured temporary password generator (server-side so
 * the value only ever exists in this response — it is never written to the
 * database in plaintext; the auth provider stores only its scrypt hash).
 */
function generateTemporaryPassword(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(12);
  // `crypto` is available in the Convex runtime; fall back to Math.random
  // only if the global is somehow missing so this can never throw.
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/**
 * Super Admin only: resets any user's password.
 *
 * Pass `newPassword` to set a specific one, or omit it to have the server
 * generate a strong temporary password which is returned ONCE in the response
 * so the admin can hand it to the manager. This is the safe stand-in for
 * "viewing" a password: Convex Auth only ever stores a one-way scrypt hash, so
 * the original secret is genuinely unrecoverable — resetting is the only
 * correct operation, and no plaintext is ever persisted.
 *
 * Errors are generic on purpose so a non-super-admin caller cannot use this to
 * probe which accounts exist.
 */
export const requestPasswordReset = mutation({
  args: { userId: v.id("users"), newPassword: v.optional(v.string()) },
  handler: async (ctx, { userId, newPassword }) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      // Generic message: never reveal whether the target account exists.
      throw new Error("Could not reset the password — please try again.");
    }

    const provided = typeof newPassword === "string" ? newPassword.trim() : "";
    if (provided !== "" && provided.length < 4) {
      throw new Error("New password must be at least 4 characters.");
    }
    const usingGenerated = provided === "";
    const secret = usingGenerated ? generateTemporaryPassword() : provided;
    if (!Number.isFinite(secret.length) || secret.length < 4) {
      throw new Error("Could not generate a password — please try again.");
    }

    try {
      const user = await ctx.db.get(userId);
      const username = typeof user?.username === "string" ? user.username : null;
      if (!user || !username) {
        // Same generic message as every other failure path.
        throw new Error("Could not reset the password — please try again.");
      }
      await ctx.scheduler.runAfter(0, internal.usersAdmin.resetPasswordAction, {
        username,
        userId,
        newPassword: secret,
      });
      // Only ever returned to the Super Admin, only for a generated password.
      return { ok: true as const, temporaryPassword: usingGenerated ? secret : null };
    } catch (err) {
      if (
        err instanceof Error &&
        !err.message.startsWith("Could not reset the password")
      ) {
        throw new Error("Could not reset the password — please try again.");
      }
      throw err;
    }
  },
});
