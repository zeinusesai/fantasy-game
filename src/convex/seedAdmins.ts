"use node";
import { createAccount } from "@convex-dev/auth/server";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { ROLES } from "./schema";
import { DEFAULT_CONFIG, normalizeUsername } from "./configDefaults";

// Pre-registered admin accounts, booted into the database on first run.
//
// The Super-Admin credentials below are the canonical, source-of-truth values
// for the `zein` account: username is normalized to lowercase (`zein`) before
// it is stored as the password provider's account id, and the secret is
// scrypt-hashed by Convex Auth. They are hard-coded on purpose — the Super
// Admin is the single recovery path into the platform, so it must exist even
// when no environment variable is set and no signed-in user is around to
// trigger anything else.
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

export type SeedReport = {
  username: string;
  /** `created` = account was just made; `exists` = already seeded, skipped. */
  status: "created" | "exists" | "failed";
  error?: string;
}[];

/**
 * Idempotently creates the pre-registered admin accounts (scrypt-hashed via
 * Convex Auth's password provider). Scheduled by the `bootstrap` mutation in
 * managers.ts the first time the app loads.
 *
 * Defensive by design:
 *  - each admin is seeded in its own try/catch, so a single failure (e.g. a
 *    half-written account from an interrupted run) can no longer abort the
 *    loop and leave the *remaining* admins permanently unseeded;
 *  - a per-admin report is returned and logged, so a seeding problem is
 *    observable in the Convex logs instead of failing silently — which is
 *    exactly what made "I can't sign in" impossible to diagnose before.
 */
export const ensureSeedAdmins = internalAction({
  args: {},
  handler: async (ctx): Promise<SeedReport> => {
    const report: SeedReport = [];
    for (const admin of SEED_ADMINS) {
      const normalized = normalizeUsername(admin.username);
      try {
        const existing = await ctx.runQuery(internal.lib.getUserIdByUsername, {
          username: normalized,
        });
        if (existing) {
          report.push({ username: normalized, status: "exists" });
          continue;
        }
        await createAccount(ctx, {
          provider: "password",
          account: { id: normalized, secret: admin.password },
          profile: adminProfile(admin),
        });
        report.push({ username: normalized, status: "created" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        report.push({ username: normalized, status: "failed", error: message });
        console.error(`[seedAdmins] could not seed "${normalized}":`, message);
      }
    }
    console.log("[seedAdmins] report:", JSON.stringify(report));
    return report;
  },
});