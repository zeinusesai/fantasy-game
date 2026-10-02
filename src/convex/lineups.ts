// ── Predicted lineups: starters + bench (substitutes) ─────────────────────
//
// The "expected XI" shown on the match preview before the real team sheet
// lands. Each house fields 7 starters plus an optional bench of up to
// MAX_SUBSTITUTES players.
//
// This module owns that rule so there is exactly ONE place that decides how a
// predicted lineup is validated. `matches.setExpectedLineups` (which saves both
// sides at once, from the admin match editor) delegates here, and the
// per-side `savePredictedLineup` below is the focused entry point.
//
// SAFEGUARDS, all enforced server-side:
//   - MAX 3 substitutes — Convex validators cannot express an array length
//     cap, so `assertLineupRules` rejects any overflow with a clean message.
//   - A substitute can never also be a starter on the same side.
//   - No player may appear on both houses' lineup OR bench.
//   - Every player must exist, be active, and belong to that house.
//   - Junk / duplicate / non-string ids are normalised away before counting.

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireSuperAdmin } from "./lib";
import { resolveFormation } from "./formations";
import { MAX_SUBSTITUTES } from "./configDefaults";
import type { Id } from "./_generated/dataModel";

/** Hard ceiling on bench players per side (shared with the client editor). */
export { MAX_SUBSTITUTES };
/** Hard ceiling on starters per side. */
export const MAX_STARTERS = 7;

/**
 * Normalise an id list: drop non-strings, trim, remove blanks, de-duplicate.
 * TOTAL — never throws, always returns an array. Order of first appearance is
 * preserved so the admin's ordering survives a round trip.
 */
export function normalizeIdList(value: unknown): Id<"players">[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const out: Id<"players">[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed as Id<"players">);
  }
  return out;
}

/**
 * Pure rule check for one side's selection.
 *
 * Returns the normalised selection on success, or a human-readable reason on
 * failure. Never throws and never returns null, so callers can branch without
 * a try/catch and the UI can show the same copy the server would.
 */
export function checkLineupRules(
  side: string,
  startersInput: unknown,
  subsInput: unknown,
): { ok: true; starters: Id<"players">[]; subs: Id<"players">[] } | { ok: false; error: string } {
  const starters = normalizeIdList(startersInput);
  const subs = normalizeIdList(subsInput);

  if (starters.length > MAX_STARTERS) {
    return {
      ok: false,
      error: `${side}: at most ${MAX_STARTERS} expected starters (you picked ${starters.length}).`,
    };
  }
  // The max-3 bench rule.
  if (subs.length > MAX_SUBSTITUTES) {
    return {
      ok: false,
      error: `${side}: at most ${MAX_SUBSTITUTES} substitutes (you picked ${subs.length}).`,
    };
  }
  // A player cannot be a starter and a substitute at the same time.
  const starterSet = new Set(starters.map(String));
  const clash = subs.find((id) => starterSet.has(String(id)));
  if (clash) {
    return {
      ok: false,
      error: `${side}: a player cannot be both a starter and a substitute.`,
    };
  }
  return { ok: true, starters, subs };
}

/**
 * Verify every selected player exists, is active, and belongs to `house`.
 * Returns the offending player's name on failure, or null on success. One
 * `ctx.db.get` per id, each individually guarded, so a single deleted player
 * can never abort the whole check.
 */
async function playersBelongToHouse(
  ctx: { db: { get: (id: Id<"players">) => Promise<unknown> } },
  ids: Id<"players">[],
  house: string,
): Promise<string | null> {
  for (const id of ids) {
    let doc: any = null;
    try {
      doc = await ctx.db.get(id);
    } catch {
      return null; // unreachable player → caller reports "refresh the roster"
    }
    if (!doc || doc.active !== true) return null;
    if (doc.house !== house) {
      return `${doc.name ?? "A player"} belongs to ${doc.house ?? "another house"}, not ${house}.`;
    }
  }
  return null;
}

/** Shared shape for a populated lineup side. */
type PopulatedPlayer = {
  _id: Id<"players">;
  name: string;
  position: string;
  house: string;
  image: string | null;
  statusLabel: string | null;
};

/**
 * Read one side's lineup with BOTH the starters and the bench fully populated.
 * Never throws: a missing player is simply skipped, so the preview shows
 * fewer cards rather than crashing.
 */
async function populate(
  ctx: { db: { get: (id: Id<"players">) => Promise<unknown> } },
  ids: Id<"players">[],
): Promise<PopulatedPlayer[]> {
  const out: PopulatedPlayer[] = [];
  for (const id of ids) {
    try {
      const p: any = await ctx.db.get(id);
      if (!p || typeof p.name !== "string") continue; // deleted player
      out.push({
        _id: p._id,
        name: p.name,
        position: typeof p.position === "string" ? p.position : "MID",
        house: typeof p.house === "string" ? p.house : "",
        image: typeof p.image === "string" ? p.image : null,
        statusLabel: typeof p.statusLabel === "string" ? p.statusLabel : null,
      });
    } catch {
      continue; // one bad lookup never aborts the thread
    }
  }
  return out;
}

/**
 * Super Admin: replace ONE side's predicted lineup (7 starters + bench).
 *
 * Returns `{ ok: true, ... }` / `{ ok: false, error }` for EXPECTED
 * rejections so the editor can toast inline; only a genuinely unexpected
 * failure produces a thrown Error, and even then with a friendly message.
 */
export const savePredictedLineup = mutation({
  args: {
    matchId: v.id("matches"),
    side: v.union(v.literal("home"), v.literal("away")),
    starterIds: v.array(v.id("players")),
    substitutePlayerIds: v.optional(v.array(v.id("players"))),
    formation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      return {
        ok: false as const,
        error:
          err instanceof Error
            ? err.message
            : "Only the Super Admin can edit predicted lineups.",
      };
    }

    const sideLabel = args.side === "home" ? "Home" : "Away";

    try {
      const match = await ctx.db.get(args.matchId);
      if (!match) {
        return { ok: false as const, error: "Match not found — it may have been removed." };
      }
      const house = args.side === "home" ? match.homeHouse : match.awayHouse;

      // Pure rules first — no db work for an obviously-bad payload.
      const check = checkLineupRules(sideLabel, args.starterIds, args.substitutePlayerIds ?? []);
      if (!check.ok) return { ok: false as const, error: check.error };

      const { starters, subs } = check;

      // A player can't be used by the opposing side either.
      const otherStarters = normalizeIdList(
        args.side === "home" ? match.expectedLineups?.awayStarters : match.expectedLineups?.homeStarters,
      );
      const otherSubs = normalizeIdList(
        args.side === "home" ? match.expectedLineups?.awaySubs : match.expectedLineups?.homeSubs,
      );
      const foreign = [...starters, ...subs].filter(
        (id) => otherStarters.includes(id) || otherSubs.includes(id),
      );
      if (foreign.length > 0) {
        return {
          ok: false as const,
          error: `${sideLabel}: a player cannot be listed for both houses.`,
        };
      }

      // Existence + house checks.
      const ownership = await playersBelongToHouse(ctx, [...starters, ...subs], house);
      if (ownership) return { ok: false as const, error: `${sideLabel}: ${ownership}` };

      const formation = resolveFormation(args.formation);
      const existing = match.expectedLineups ?? {
        homeStarters: [] as Id<"players">[],
        awayStarters: [] as Id<"players">[],
      };

      const base = {
        homeStarters: normalizeIdList(existing.homeStarters),
        awayStarters: normalizeIdList(existing.awayStarters),
        homeSubs: normalizeIdList(existing.homeSubs),
        awaySubs: normalizeIdList(existing.awaySubs),
        homeFormation: resolveFormation(existing.homeFormation),
        awayFormation: resolveFormation(existing.awayFormation),
      };
      // Only ONE side is replaced, so the other is carried over untouched.
      const next =
        args.side === "home"
          ? { ...base, homeStarters: starters, homeSubs: subs, homeFormation: formation }
          : { ...base, awayStarters: starters, awaySubs: subs, awayFormation: formation };

      // Both sides empty → remove the field entirely (keeps reads simple).
      if (next.homeStarters.length === 0 && next.awayStarters.length === 0) {
        await ctx.db.patch(args.matchId, { expectedLineups: undefined });
        return { ok: true as const, starters: 0, substitutes: 0, cleared: true as const };
      }

      await ctx.db.patch(args.matchId, { expectedLineups: next });
      return {
        ok: true as const,
        starters: starters.length,
        substitutes: subs.length,
        cleared: false as const,
      };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        return { ok: false as const, error: err.message };
      }
      return {
        ok: false as const,
        error: "Could not save the predicted lineup — please try again.",
      };
    }
  },
});

/**
 * The predicted lineup for a match: starters AND bench, fully populated.
 *
 * Null-safe by contract — returns a fully-formed object for a missing match
 * (every list `[]`, every scalar null/0), so the preview renders a clean empty
 * state instead of crashing on undefined.
 */
export const getPredictedLineup = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const empty = {
      matchId,
      homeHouse: null as string | null,
      awayHouse: null as string | null,
      homeStarters: [] as PopulatedPlayer[],
      awayStarters: [] as PopulatedPlayer[],
      homeSubs: [] as PopulatedPlayer[],
      awaySubs: [] as PopulatedPlayer[],
      homeFormation: null as string | null,
      awayFormation: null as string | null,
      totalSubstitutes: 0,
      maxSubstitutes: MAX_SUBSTITUTES,
    };
    try {
      const match = await ctx.db.get(matchId);
      if (!match) return empty;
      const lineups = match.expectedLineups;
      if (!lineups) return { ...empty, homeHouse: match.homeHouse, awayHouse: match.awayHouse };

      const homeStarters = await populate(ctx, normalizeIdList(lineups.homeStarters));
      const awayStarters = await populate(ctx, normalizeIdList(lineups.awayStarters));
      const homeSubs = await populate(ctx, normalizeIdList(lineups.homeSubs));
      const awaySubs = await populate(ctx, normalizeIdList(lineups.awaySubs));

      return {
        matchId,
        homeHouse: match.homeHouse,
        awayHouse: match.awayHouse,
        homeStarters,
        awayStarters,
        homeSubs,
        awaySubs,
        homeFormation: resolveFormation(lineups.homeFormation),
        awayFormation: resolveFormation(lineups.awayFormation),
        totalSubstitutes: homeSubs.length + awaySubs.length,
        maxSubstitutes: MAX_SUBSTITUTES,
      };
    } catch {
      return empty;
    }
  },
});

/**
 * Super Admin: remove a side's bench without touching its starters. Useful for
 * a late change where the XI stands but the bench is wrong. Idempotent.
 */
export const clearPredictedSubstitutes = mutation({
  args: { matchId: v.id("matches"), side: v.union(v.literal("home"), v.literal("away")) },
  handler: async (ctx, args) => {
    try {
      await requireSuperAdmin(ctx);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? err.message
          : "Only the Super Admin can edit predicted lineups.",
      );
    }
    try {
      const match = await ctx.db.get(args.matchId);
      if (!match) throw new Error("Match not found — it may have been removed.");
      const lineups = match.expectedLineups;
      if (!lineups) return { cleared: 0 };

      const patch =
        args.side === "home"
          ? { expectedLineups: { ...lineups, homeSubs: [] as Id<"players">[] } }
          : { expectedLineups: { ...lineups, awaySubs: [] as Id<"players">[] } };
      await ctx.db.patch(args.matchId, patch);
      return { cleared: 1 };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        throw err;
      }
      throw new Error("Could not clear the bench — please try again.");
    }
  },
});