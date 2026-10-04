import type { QueryCtx, MutationCtx } from "./_generated/server";
import { internalQuery, internalMutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { DEFAULT_CONFIG, CONFIG_KEYS, FIXED_MANAGER_BUDGET } from "./configDefaults";
import { cosmeticById } from "./rewards";
import {
  DEFAULT_PITCH_THEME,
  PREMIUM_PITCH_THEME,
  THEME_ITEM_ID,
} from "./pitchThemes";
import type { Doc, Id } from "./_generated/dataModel";

export const getUserIdByUsername = internalQuery({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
    return user?._id ?? null;
  },
});

export type PlatformUser = Doc<"users">;

/**
 * Earned cosmetics a manager currently has EQUIPPED, for rendering their
 * pitch / jersey anywhere it is inspected (own profile, Dashboard, Leaderboard
 * rival inspector, ProfileModal).
 *
 * Derived from `cosmeticUnlocks`, which is the single source of truth for
 * earned rewards, so earning a feat or equipping a different item updates every
 * client reactively.
 *
 * TOTAL: any failure — missing table, corrupt row, db hiccup — degrades to
 * "no cosmetics" instead of throwing, so a cosmetic lookup can never crash a
 * page or a query subscription.
 */
export async function readUserCosmetics(ctx: QueryCtx, user: Doc<"users">) {
  const none = {
    activePitchTheme: DEFAULT_PITCH_THEME,
    hasGoldenJersey: false,
    hasProfileBorder: false,
    hasCustomTitle: false,
    hasEquippedKit: false,
    hasNameGlow: false,
    equippedBadgeId: null as string | null,
  } as const;
  try {
    const rows = await ctx.db
      .query("cosmeticUnlocks")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const equipped = rows.filter((r) => r.equipped === true);
    const has = (id: string) => equipped.some((r) => r.cosmeticId === id);

    // The gold pitch/jersey reads from EITHER the legacy `golden_theme` or the
    // feat-earned `tactical_mastermind_pitch`, so a manager who earned the
    // rarer skin keeps the premium aesthetic without losing it.
    const premiumPitch = has(THEME_ITEM_ID) || has("tactical_mastermind_pitch");
    const equippedBadge = equipped.find(
      (r) => cosmeticById(r.cosmeticId)?.slot === "badge",
    );

    return {
      activePitchTheme: premiumPitch ? PREMIUM_PITCH_THEME : DEFAULT_PITCH_THEME,
      hasGoldenJersey: premiumPitch,
      // Any equipped border (legacy or the GW1 podium border) shows a frame.
      hasProfileBorder: has("profile_border") || has("gw1_podium_border"),
      hasCustomTitle: has("custom_title") || has("clutch_performer_title"),
      hasEquippedKit: has("golden_boot_kit"),
      hasNameGlow: has("iron_defence_glow"),
      equippedBadgeId: equippedBadge?.cosmeticId ?? null,
    };
  } catch {
    return none;
  }
}

/**
 * Platform-wide settings. The budget is FIXED at $70m for every manager, so
 * it is returned from the constant rather than from any stored config row —
 * a stale or tampered `config` row can never raise or lower the cap.
 */
export async function getPlatformConfig(ctx: QueryCtx | MutationCtx) {
  const rows = await ctx.db.query("config").collect();
  const houseRow = rows.find((r) => r.key === CONFIG_KEYS.HOUSE_LIMIT);
  return {
    budget: FIXED_MANAGER_BUDGET,
    houseLimit:
      typeof houseRow?.value === "number" ? houseRow.value : DEFAULT_CONFIG.houseLimit,
  };
}

export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Must be signed in.");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Account no longer exists.");
  return user;
}

// ── Single Super-Admin restriction (Zein) ───────────────────────────────────
//
// The platform has EXACTLY one Super Admin: Zein. `role === "super_admin"`
// alone is no longer sufficient — the identity check below is what actually
// authorises a privileged call, so a tampered or mis-promoted row can never
// unlock the Super-Admin surface.
//
// The check is deliberately total: a missing / malformed / legacy username or
// email simply does NOT match, so every failure mode fails CLOSED.

/** Canonical sign-in name of the one and only Super Admin. */
export const SUPER_ADMIN_USERNAME = "zein";

function normaliseIdentity(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/**
 * Is this row the Super Admin (Zein)?
 *
 * Matches on the canonical username ("zein", how the seeded account stores
 * it), the display name, or a "zein@…" email — all case-insensitive. Every
 * branch is guarded so a corrupt row can never throw.
 */
export function isSuperAdminIdentity(user: Doc<"users"> | null | undefined): boolean {
  if (!user) return false;
  try {
    if (normaliseIdentity(user.username) === SUPER_ADMIN_USERNAME) return true;
    if (normaliseIdentity(user.name) === SUPER_ADMIN_USERNAME) return true;
    const email = normaliseIdentity(user.email);
    if (email === SUPER_ADMIN_USERNAME) return true;
    if (email.startsWith(`${SUPER_ADMIN_USERNAME}@`)) return true;
    return false;
  } catch {
    return false;
  }
}

export async function requireSuperAdmin(ctx: QueryCtx | MutationCtx) {
  const user = await requireUser(ctx);
  if (user.role !== "super_admin" || !isSuperAdminIdentity(user)) {
    throw new Error("Unauthorized access");
  }
  return user;
}

/**
 * Admin surface guard.
 *
 * Historically this also admitted `moderator` accounts. With the single
 * Super-Admin restriction the whole admin surface — players, requests,
 * points, matches, config — now resolves to exactly one identity (Zein), so
 * `requireAdmin` and `requireSuperAdmin` converge on the same authorization.
 * The two functions stay separate so call-sites keep their intent readable.
 */
export async function requireAdmin(ctx: QueryCtx | MutationCtx) {
  const user = await requireUser(ctx);
  if (user.role !== "super_admin" || !isSuperAdminIdentity(user)) {
    throw new Error("Unauthorized access");
  }
  return user;
}

/**
 * Internal: deletes a user and everything tied to them — password auth
 * accounts, their fantasy squad, per-match score rows and price requests —
 * so no orphaned records are left behind (admin tooling).
 */
export const deleteUserAndAccount = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", userId).eq("provider", "password"),
      )
      .collect();
    for (const a of accounts) await ctx.db.delete(a._id);

    // Cascade: the user's squad (if any) — prevents orphaned squads.
    const squad = await getSquadForUser(ctx, userId);
    if (squad) await ctx.db.delete(squad._id);

    // Cascade: per-match fantasy score rows belonging to the user.
    const scores = await ctx.db
      .query("matchScores")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const s of scores) await ctx.db.delete(s._id);

    // Cascade: price requests submitted by the user.
    const requests = await ctx.db
      .query("priceRequests")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const r of requests) await ctx.db.delete(r._id);

    await ctx.db.delete(userId);
    return {
      accounts: accounts.length,
      squadDeleted: squad !== null,
      scoresDeleted: scores.length,
      requestsDeleted: requests.length,
    };
  },
});

export async function getSquadForUser(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  return ctx.db
    .query("squads")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

export type SquadPointsRow = {
  /** Null for a manager who has not submitted a squad yet (pre-season). */
  squadId: Id<"squads"> | null;
  userId: Id<"users">;
  total: number;
  lastMatch: number | null;
};

/**
 * Aggregated fantasy points for EVERY registered manager.
 *
 * Pre-season visibility guarantee: a manager appears the moment their account
 * exists — with 0 pts if they have no squad and no settled gameweek yet — so
 * the leaderboard is never empty before GW1 and never drops an account that
 * was created but has not picked a team. Previously only managers WITH a
 * squad row were emitted, which is exactly what produced the blank state.
 *
 * Ordering: points descending, then account id ascending (creation order) so
 * a board full of zeroes is still deterministic instead of reshuffling.
 */
export async function getLeaderboardRows(ctx: QueryCtx | MutationCtx) {
  const squads = await ctx.db.query("squads").collect();
  const scores = await ctx.db.query("matchScores").collect();
  let lastMatchId: Id<"matches"> | null = null;
  for (const s of scores) {
    if (lastMatchId === null || s.matchId > lastMatchId) lastMatchId = s.matchId;
  }

  const bySquad = new Map<string, { total: number; lastMatch: number | null }>();
  for (const s of scores) {
    const cur = bySquad.get(s.squadId) ?? { total: 0, lastMatch: null as number | null };
    cur.total += s.points;
    if (lastMatchId !== null && s.matchId === lastMatchId) {
      cur.lastMatch = (cur.lastMatch ?? 0) + s.points;
    }
    bySquad.set(s.squadId, cur);
  }

  const rows: SquadPointsRow[] = squads.map((squad) => {
    const agg = bySquad.get(squad._id) ?? { total: 0, lastMatch: null };
    return {
      squadId: squad._id,
      userId: squad.userId,
      total: agg.total,
      lastMatch: agg.lastMatch,
    };
  });

  // ── Register every account that has no squad yet, at 0 pts. ──
  // Defensive: if the users table cannot be read we still return the squads
  // we already have rather than rejecting the whole query.
  const covered = new Set<string>(rows.map((r) => String(r.userId)));
  try {
    const users = await ctx.db.query("users").collect();
    for (const u of users) {
      if (covered.has(String(u._id))) continue;
      const username = typeof u.username === "string" ? u.username.trim() : "";
      // Bare auth rows (no manager profile) are not managers — skip them.
      if (username === "") continue;
      rows.push({ squadId: null, userId: u._id, total: 0, lastMatch: null });
    }
  } catch {
    // users table unavailable → keep the squad-derived rows.
  }

  rows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    // Convex ids sort by creation time, so ties break into signup order.
    if (a.userId < b.userId) return -1;
    if (a.userId > b.userId) return 1;
    return 0;
  });
  return rows;
}
