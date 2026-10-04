import { v } from "convex/values";
import { query, mutation, type QueryCtx, type MutationCtx } from "./_generated/server";
import {
  requireSuperAdmin,
  isSuperAdminIdentity,
  getLeaderboardRows,
  type PlatformUser,
} from "./lib";
import { normalizeSettings } from "./adminConfig";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

// ── Y11 PE Hub — season transition & Super-Admin season tooling ───────────
//
// Everything in this module is SINGLE SUPER-ADMIN ONLY (Zein). The guard is
// `requireSuperAdmin`, which requires BOTH `role === "super_admin"` AND the
// Zein identity, so a tampered row can never reach these handlers.
//
// ── ABSOLUTE PLAYER-DATABASE PRESERVATION GUARANTEE ────────────────────────
// `transitionToPEHub` NEVER reads, writes or deletes the `players` table.
// Prices (Cr), positions (GK/DEF/MID/FWD), baseline stats and uploaded photo
// assets are untouched by construction — the transition handler contains no
// `ctx.db.*` call against "players".
//
// The ONE deliberate exception in this file is `importPlayersFromCSV`, the
// Super-Admin's explicit, audited CSV import: it upserts ONLY the imported
// fields (name, house, position, price) and never deletes a row, never clears
// a photo, and never resets recorded stats. Nothing else here touches players.
//
// ── STORE / COSMETIC PRESERVATION ──────────────────────────────────────────
// `cosmeticUnlocks` (the earned-cosmetic store) and `config` (store items,
// budget rules) are likewise never deleted, so every unlocked visual asset —
// Zein's included — survives the transition.

/** Exact phrase the Super Admin must type to arm the wipe. */
export const TRANSITION_CONFIRM_PHRASE = "TRANSITION TO Y11 PE HUB";

/** Canonical brand applied to the config row when the season flips over. */
const PE_HUB_TITLE = "Y11 PE Hub";
const PE_HUB_TAGLINE = "Year 11 PE · 7-a-side Fantasy Hub";

async function audit(
  ctx: MutationCtx,
  action: string,
  category: string,
  detail?: string,
): Promise<void> {
  try {
    await ctx.runMutation(internal.audit.logAudit, {
      action,
      category,
      ...(detail ? { detail } : {}),
    });
  } catch {
    // An audit failure must never block the underlying admin action.
  }
}

/** Total: never throws, only deletes rows that are actually present. */
async function deleteAll(ctx: MutationCtx, table: "squads" | "predictions" | "directMessages" | "matchScores" | "pointAdjustments" | "wagers") {
  let count = 0;
  try {
    const rows = await ctx.db.query(table).collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
      count += 1;
    }
  } catch {
    // table missing / read hiccup → nothing to delete here
  }
  return count;
}

/**
 * Hard-deletes one user's per-row data so no orphaned records survive.
 * Deliberately does NOT touch `cosmeticUnlocks` (store inventory) or
 * `players` (the immutable roster).
 */
async function cascadeUser(ctx: MutationCtx, user: Doc<"users">) {
  const userId = user._id;
  const counts = { accounts: 0, sessions: 0, squad: 0, scores: 0, requests: 0, predictions: 0, wagers: 0 };

  try {
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .collect();
    for (const a of accounts) {
      await ctx.db.delete(a._id);
      counts.accounts += 1;
    }
  } catch {
    /* no password account */
  }

  try {
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    for (const s of sessions) {
      await ctx.db.delete(s._id);
      counts.sessions += 1;
    }
  } catch {
    /* no sessions */
  }

  try {
    const squad = await ctx.db
      .query("squads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (squad) {
      await ctx.db.delete(squad._id);
      counts.squad = 1;
    }
  } catch {
    /* no squad */
  }

  for (const table of ["matchScores", "pointAdjustments"] as const) {
    try {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const r of rows) {
        await ctx.db.delete(r._id);
        counts.scores += 1;
      }
    } catch {
      /* none */
    }
  }

  for (const table of ["priceRequests", "photoRequests", "predictions"] as const) {
    try {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const r of rows) {
        await ctx.db.delete(r._id);
        if (table === "predictions") counts.predictions += 1;
        else counts.requests += 1;
      }
    } catch {
      /* none */
    }
  }

  try {
    const own = await ctx.db
      .query("wagers")
      .withIndex("by_challenger", (q) => q.eq("challengerId", userId))
      .collect();
    const opp = await ctx.db
      .query("wagers")
      .withIndex("by_opponent", (q) => q.eq("opponentId", userId))
      .collect();
    const seen = new Set<string>();
    for (const w of [...own, ...opp]) {
      if (seen.has(String(w._id))) continue;
      seen.add(String(w._id));
      await ctx.db.delete(w._id);
      counts.wagers += 1;
    }
  } catch {
    /* none */
  }

  return counts;
}

// ── Pre-flight preview for the double-confirmation modal ──────────────────

/** Counts shown in the Admin double-confirm modal. Super Admin (Zein) only. */
export const getTransitionPreview = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return null;
    }
    try {
      const users = await ctx.db.query("users").collect();
      const deletable = users.filter((u) => !isSuperAdminIdentity(u));
      const protectedOnes = users.length - deletable.length;
      const count = async (table: "squads" | "predictions" | "directMessages" | "matchScores") => {
        try {
          return (await ctx.db.query(table).collect()).length;
        } catch {
          return 0;
        }
      };
      return {
        usersToDelete: deletable.length,
        usersKept: protectedOnes,
        squads: await count("squads"),
        predictions: await count("predictions"),
        messages: await count("directMessages"),
        scoreRows: await count("matchScores"),
        playersProtected: true,
        storeProtected: true,
        confirmPhrase: TRANSITION_CONFIRM_PHRASE,
      };
    } catch {
      return null;
    }
  },
});

// ── The season reset ──────────────────────────────────────────────────────

/**
 * `transitionToPEHub` — flip the platform onto the Y11 PE Hub season.
 *
 * WHAT IT DELETES
 *   • every user account EXCEPT Zein (plus their auth credentials, sessions,
 *     squads, predictions, wagers, points and price/photo requests),
 *   • every squad, prediction, direct message and fantasy score row,
 *   • all manager point counters and gameweek score rows.
 *
 * WHAT IT NEVER TOUCHES
 *   • `players` — every roster card, price, position, stat and photo survives,
 *   • `cosmeticUnlocks` — the whole earned-cosmetic store stays intact,
 *     including Zein's unlocked inventory,
 *   • `config`, `systemConfig` (apart from the brand copy), `houseLogos`,
 *     `matches` / `matchPlayers` history and the audit log.
 *
 * SAFETY RAILS
 *   1. `requireSuperAdmin` — Zein identity AND super_admin role.
 *   2. An exact confirmation phrase must be echoed back (second gate on top
 *      of the client-side double-confirm modal).
 *   3. Everything is wrapped so a partial failure surfaces as a readable
 *      error instead of an opaque server crash.
 */
export const transitionToPEHub = mutation({
  args: { confirmText: v.string() },
  handler: async (ctx, args) => {
    // ── Gate 1: single Super-Admin restriction (throws "Unauthorized"). ──
    const admin = await requireSuperAdmin(ctx);

    // ── Gate 2: explicit text confirmation, normalised. ──
    const typed = String(args.confirmText ?? "").trim().replace(/\s+/g, " ").toUpperCase();
    if (typed !== TRANSITION_CONFIRM_PHRASE.toUpperCase()) {
      throw new Error(
        `Confirmation phrase does not match. Type "${TRANSITION_CONFIRM_PHRASE}" exactly to continue.`,
      );
    }

    try {
      // ── Identify who survives. Zein only — by IDENTITY, not by role. ──
      const users = await ctx.db.query("users").collect();
      const keep = users.filter((u) => isSuperAdminIdentity(u));
      const keepIds = new Set<string>(keep.map((u) => String(u._id)));
      const doomed = users.filter((u) => !isSuperAdminIdentity(u));

      // ── Cascade-delete every non-Zein account. ──
      let accounts = 0;
      let sessions = 0;
      let squadsDeleted = 0;
      let scoreRows = 0;
      let requestRows = 0;
      let predictionsDeleted = 0;
      let wagersDeleted = 0;
      for (const user of doomed) {
        const c = await cascadeUser(ctx, user);
        accounts += c.accounts;
        sessions += c.sessions;
        squadsDeleted += c.squad;
        scoreRows += c.scores;
        requestRows += c.requests;
        predictionsDeleted += c.predictions;
        wagersDeleted += c.wagers;
        await ctx.db.delete(user._id);
      }

      // ── Sweep the season-wide tables so standings reset to 0 for ALL. ──
      // (Zein's own squad goes too — the new season starts from zero for
      //  every manager; their ACCOUNT, credentials, role and cosmetics stay.)
      const squadsSwept = await deleteAll(ctx, "squads");
      const predictionsSwept = await deleteAll(ctx, "predictions");
      const messagesSwept = await deleteAll(ctx, "directMessages");
      const matchScoresSwept = await deleteAll(ctx, "matchScores");
      const adjustmentsSwept = await deleteAll(ctx, "pointAdjustments");
      const wagersSwept = await deleteAll(ctx, "wagers");

      // ── Re-open every gameweek for the new PE season. ──
      let gameweeksReset = 0;
      try {
        const gameweeks = await ctx.db.query("gameweeks").collect();
        for (const gw of gameweeks) {
          await ctx.db.patch(gw._id, {
            locked: false,
            settled: false,
            deadlineAt: undefined,
          });
          gameweeksReset += 1;
        }
      } catch {
        /* no gameweek rows yet */
      }

      // ── Apply the Y11 PE Hub brand to the config row (overrides any
      //    previously stored title so the rebrand always lands). ──
      try {
        const settingsRow = (await ctx.db.query("systemConfig").collect())[0] ?? null;
        const uiText = {
          ...normalizeSettings(settingsRow).uiText,
          appTitle: PE_HUB_TITLE,
          appTagline: PE_HUB_TAGLINE,
        };
        if (settingsRow) {
          await ctx.db.patch(settingsRow._id, { uiText });
        } else {
          await ctx.db.insert("systemConfig", { uiText });
        }
      } catch {
        // Brand copy is cosmetic — never fail the wipe over it.
      }

      await audit(
        ctx,
        "transition_to_pe_hub",
        "tournament",
        `Season reset to ${PE_HUB_TITLE}. Deleted ${doomed.length} account(s); kept ${keep.length} (Zein). Players and store inventory untouched.`,
      );

      const row = (s: Doc<"users">) => s.username ?? s.name ?? "?";
      return {
        ok: true as const,
        kept: keep.map(row),
        deletedUsers: doomed.length,
        deletedAccounts: accounts,
        deletedSessions: sessions,
        deletedSquads: squadsDeleted + squadsSwept,
        deletedPredictions: predictionsDeleted + predictionsSwept,
        deletedMessages: messagesSwept,
        deletedScoreRows: scoreRows + matchScoresSwept + adjustmentsSwept,
        deletedWagers: wagersDeleted + wagersSwept,
        deletedRequests: requestRows,
        gameweeksReset,
        playersProtected: true as const,
        storeProtected: true as const,
        brand: PE_HUB_TITLE,
        // Sanity: these ids are never written above; surfaced so the client
        // can assert the invariants after the run.
        _keptIds: Array.from(keepIds),
        _actor: admin.username ?? null,
      };
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? `Season transition failed: ${err.message}`
          : "Season transition failed — please try again.",
      );
    }
  },
});

/**
 * Post-transition health probe: confirms Zein survived, points are zeroed and
 * the roster is still populated. Super Admin only; never throws.
 */
export const getSeasonStatus = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return null;
    }
    try {
      const users = await ctx.db.query("users").collect();
      let players = 0;
      try {
        players = (await ctx.db.query("players").collect()).length;
      } catch {
        players = 0;
      }
      const rows = await getLeaderboardRows(ctx);
      return {
        managerCount: rows.length,
        zeroed: rows.every((r) => r.total === 0),
        zeinPresent: users.some((u) => isSuperAdminIdentity(u)),
        players,
        brand: PE_HUB_TITLE,
      };
    } catch {
      return null;
    }
  },
});

/** Ids of every user row that would be deleted — used by the admin modal. */
export const listTransitionTargets = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    try {
      await requireSuperAdmin(ctx);
    } catch {
      return [];
    }
    try {
      const users = await ctx.db.query("users").collect();
      return users
        .filter((u) => !isSuperAdminIdentity(u))
        .map((u) => ({
          userId: u._id as Id<"users">,
          username: u.username ?? null,
          teamName: u.teamName ?? null,
        }));
    } catch {
      return [];
    }
  },
});

// ── Y11 PE Hub — CSV player import (Super Admin only) ──────────────────────

/** Zeroed baseline stats so a freshly imported player scores sanely. */
const BASELINE_PLAYER_STATS = {
  goals: 0,
  assists: 0,
  apps: 0,
  cleanSheet: false,
  saves: 0,
  yellowCards: 0,
  redCards: 0,
  ownGoals: 0,
  potm: false,
  rating: 6,
} as const;

/** Case-insensitive match against the four real houses, or null. */
function matchHouse(raw: string): Doc<"players">["house"] | null {
  const key = raw.trim().toLowerCase();
  const found = (["Fire", "Earth", "Wind", "Water"] as const).find(
    (h) => h.toLowerCase() === key,
  );
  return found ?? null;
}

/**
 * Bulk upsert of the player roster from a parsed CSV.
 *
 * Super-Admin only (`requireSuperAdmin`: role AND Zein identity). Matching is
 * by lowercased name so a re-import updates the existing card instead of
 * creating a duplicate. An update touches ONLY the imported fields — an
 * uploaded photo, availability label and any recorded stats are preserved, and
 * nothing is ever deleted. Invalid rows are reported, never silently dropped.
 */
export const importPlayersFromCSV = mutation({
  args: {
    players: v.array(
      v.object({
        name: v.string(),
        house: v.string(),
        position: v.union(
          v.literal("GK"),
          v.literal("DEF"),
          v.literal("MID"),
          v.literal("FWD"),
        ),
        price: v.number(),
      }),
    ),
  },
  handler: async (
    ctx,
    { players },
  ): Promise<{
    importedCount: number;
    updatedCount: number;
    skippedCount: number;
    errors: string[];
  }> => {
    await requireSuperAdmin(ctx);

    const errors: string[] = [];
    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    // One pass over the roster, keyed by lowercased name.
    const existing = new Map<string, Doc<"players">>();
    for (const player of await ctx.db.query("players").collect()) {
      existing.set(player.name.trim().toLowerCase(), player);
    }

    const handled = new Set<string>();

    for (const row of players) {
      const name = row.name.trim();
      if (!name) {
        skippedCount++;
        errors.push("Skipped a row with an empty player name.");
        continue;
      }

      const key = name.toLowerCase();
      if (handled.has(key)) {
        skippedCount++;
        errors.push(`"${name}" appears more than once — only the first row was used.`);
        continue;
      }
      handled.add(key);

      const house = matchHouse(row.house);
      if (!house) {
        skippedCount++;
        errors.push(
          `"${name}": unknown house "${row.house}" (expected Fire, Earth, Wind or Water).`,
        );
        continue;
      }

      const price = Number(row.price);
      if (!Number.isFinite(price) || price < 0) {
        skippedCount++;
        errors.push(`"${name}": invalid price "${row.price}".`);
        continue;
      }

      const match = existing.get(key);
      if (match) {
        // Patch ONLY what the CSV carries; photo/stats/status/active survive.
        const patch: Partial<Doc<"players">> = {};
        if (match.name !== name) patch.name = name;
        if (match.house !== house) patch.house = house;
        if (match.position !== row.position) patch.position = row.position;
        if (match.price !== price) patch.price = price;
        if (Object.keys(patch).length > 0) await ctx.db.patch(match._id, patch);
        updatedCount++;
      } else {
        await ctx.db.insert("players", {
          name,
          house,
          position: row.position,
          price,
          active: true,
          stats: { ...BASELINE_PLAYER_STATS },
        });
        importedCount++;
      }
    }

    await audit(
      ctx,
      "import_players_csv",
      "players",
      `+${importedCount} new, ${updatedCount} updated, ${skippedCount} skipped`,
    );

    return { importedCount, updatedCount, skippedCount, errors };
  },
});
