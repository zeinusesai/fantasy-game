"use node";
import { createAccount } from "@convex-dev/auth/server";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { ROLES } from "./schema";
import { DEFAULT_CONFIG, normalizeUsername } from "./configDefaults";

// Pre-registered admin accounts, booted into the database on first run.
export const SEED_ADMINS = [
  {
    username: "Zein",
    password: "Zeineldin2010!",
    role: ROLES.SUPER_ADMIN,
    teamName: "Tournament Control",
  },
  {
    username: "Cino",
    password: "200003",
    role: ROLES.MODERATOR,
    teamName: "Player Registry",
  },
] as const;

function adminProfile(admin: (typeof SEED_ADMINS)[number]) {
  return {
    email: normalizeUsername(admin.username),
    username: normalizeUsername(admin.username),
    teamName: admin.teamName,
    role: admin.role,
    budget: DEFAULT_CONFIG.budget,
  };
}

/**
 * Idempotently creates the pre-registered admin accounts (scrypt-hashed via
 * Convex Auth's password provider). Scheduled by the `bootstrap` mutation in
 * managers.ts the first time the app loads.
 */
export const ensureSeedAdmins = internalAction({
  args: {},
  handler: async (ctx) => {
    for (const admin of SEED_ADMINS) {
      const normalized = normalizeUsername(admin.username);
      const existing = await ctx.runQuery(internal.lib.getUserIdByUsername, {
        username: normalized,
      });
      if (existing) continue;
      await createAccount(ctx, {
        provider: "password",
        account: { id: normalized, secret: admin.password },
        profile: adminProfile(admin),
      });
    }
  },
});
