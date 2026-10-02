import { v } from "convex/values";
import { query, mutation, type QueryCtx, type MutationCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireUser, requireSuperAdmin, getPlatformConfig, getSquadForUser, getLeaderboardRows, readUserCosmetics } from "./lib";
import { formatMoney, safeBudget, toSafeAmount, FIXED_MANAGER_BUDGET, CHIP_GW1, CHIP_GW2, GW_STAGES } from "./configDefaults";
import { transferLockReason } from "./gameweekStructure";
import { getSettingsRow, normalizeSettings, resolveManagerBudget } from "./adminConfig";
import { stageValidator } from "./schema";
import {
  resolveFormation,
  validateSquadShape,
} from "./formations";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Shape check for a seven-player selection. Delegates to the shared
 * `validateSquadShape` validator, which is a TOTAL function — it never throws
 * for any input, so a bad squad can never escape as an unhandled server
 * exception. Returns the formation id to store, or a clean message.
 */
function resolveSquadFormation(
  counts: Record<"GK" | "DEF" | "MID" | "FWD", number>,
  requested?: string | null,
): { formation: string } | { error: string } {
  const result = validateSquadShape(counts, requested);
  return result.ok ? { formation: result.formation } : { error: result.message };
}

export type SquadPlayer = Doc<"players">;

// ── Budget enforcement helpers (shared by reads, saves and resets) ────────

/**
 * Sum of player prices. Strict numeric parsing per price (toSafeAmount) means
 * a malformed / NaN price contributes 0 instead of poisoning the sum, and the
 * final total is re-asserted finite — an over-budget squad can never slip
 * through because of corrupt data.
 */
function squadCostFromPlayers(players: Array<SquadPlayer | null | undefined>): number {
  let total = 0;
  for (const p of players) total += toSafeAmount(p?.price);
  return Number.isFinite(total) ? total : 0;
}

/** Safe per-player lookups — one bad id can never reject the whole batch. */
async function loadSquadPlayers(ctx: QueryCtx | MutationCtx, squad: Doc<"squads">) {
  const players: Array<SquadPlayer | null> = [];
  for (const id of squad.playerIds ?? []) {
    try {
      players.push(await ctx.db.get(id));
    } catch {
      players.push(null);
    }
  }
  return players;
}

/**
 * The manager's effective spend cap: the fixed $70m platform budget unless
 * the Super Admin set a (capped, lower-only) per-manager override. Falls back
 * to the platform constant if settings can't be read, so a config problem can
 * never disable enforcement.
 */
async function effectiveBudgetFor(ctx: QueryCtx | MutationCtx, userId: string): Promise<number> {
  try {
    const settings = normalizeSettings(await getSettingsRow(ctx));
    return safeBudget(
      resolveManagerBudget(settings, userId),
      settings.marketRules.defaultBudget,
    );
  } catch {
    return FIXED_MANAGER_BUDGET;
  }
}

/**
 * True when the STORED squad costs more than its owner's effective budget.
 * Used by read paths (flag + sanitize) and by saveSquad's repair gate.
 * Fails open (false) so an infra hiccup never hides or nukes a legal squad.
 */
async function isSquadOverBudget(ctx: QueryCtx | MutationCtx, squad: Doc<"squads">): Promise<boolean> {
  try {
    const players = await loadSquadPlayers(ctx, squad);
    const cost = squadCostFromPlayers(players);
    const budget = await effectiveBudgetFor(ctx, String(squad.userId));
    return cost > budget;
  } catch {
    return false;
  }
}

/**
 * Returns the signed-in user's squad, or `null` when there isn't one.
 * Never throws: not-signed-in (including the brief auth-attachment race on
 * mount) and missing accounts both yield `null` so the client can render an
 * empty state instead of crashing on a rejected query.
 */
export const getMySquad = query({
  args: {},
  handler: async (ctx) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (userId === null) return null; // not signed in (yet)
      const user = await ctx.db.get(userId);
      if (!user) return null; // account no longer exists
      const squad = await getSquadForUser(ctx, userId);
      if (!squad) return null; // no squad built yet (e.g. admins)
      const players = (await Promise.all(squad.playerIds.map((id) => ctx.db.get(id)))).filter(
        Boolean,
      ) as SquadPlayer[];
      const captain = squad.captainId ? await ctx.db.get(squad.captainId) : null;
      // Never trust a stored formation string — resolveFormation collapses
      // unknown values to the 2-3-1 default so pitch layout can't break.
      const formation = resolveFormation(squad.formation);

      // On-load sanitization: a squad costing more than the manager's
      // effective budget ($70m unless the Super Admin lowered it) is illegal.
      // Serve it EMPTY + flagged so every view shows a clean builder, and the
      // Squad Builder can auto-clear the stored row (see clearMyOverBudgetSquad).
      const totalSpent = squadCostFromPlayers(players);
      const budget = await effectiveBudgetFor(ctx, String(userId));
      if (totalSpent > budget) {
        return {
          squadId: squad._id,
          totalSpent: 0,
          players: [] as SquadPlayer[],
          captainId: null,
          budget,
          formation,
          overBudgetReset: true,
        };
      }
      return {
        squadId: squad._id,
        totalSpent,
        players,
        captainId: captain ? squad.captainId : null,
        budget,
        formation,
        overBudgetReset: false,
      };
    } catch {
      // Never bubble a storage hiccup into a rejected query.
      return null;
    }
  },
});

/**
 * Most-picked player across all fantasy squads (popularity aggregation).
 * Null-safe: returns null when there are no squads, no picks or the top
 * player was deleted — the UI renders no badge instead of crashing.
 */
export const getMostPickedPlayer = query({
  args: {},
  handler: async (ctx) => {
    try {
      const squads = await ctx.db.query("squads").collect();
      if (squads.length === 0) return null;

      const counts = new Map<string, number>();
      for (const squad of squads) {
        for (const pid of squad.playerIds ?? []) {
          counts.set(String(pid), (counts.get(String(pid)) ?? 0) + 1);
        }
      }
      if (counts.size === 0) return null;

      let topId: string | null = null;
      let topCount = 0;
      for (const [pid, count] of counts) {
        if (count > topCount) {
          topId = pid;
          topCount = count;
        }
      }
      if (!topId) return null;

      const player = await ctx.db.get(topId as Id<"players">);
      if (!player) return null; // deleted player — no badge

      // Guarded percentage: squads.length >= 1 here, so no division by zero.
      const percentage = Math.round((topCount / squads.length) * 100);
      return {
        playerId: player._id,
        playerName: player.name,
        house: player.house,
        pickCount: topCount,
        percentage,
      };
    } catch {
      return null;
    }
  },
});

/**
 * Ownership counts for the draft market: how many active squads picked each
 * player. Returns a flat map keyed by player id (as string) plus the total
 * number of squads — the UI computes percentages defensively (0 squads →
 * 0% everywhere, never a division error).
 */
export const getPickCounts = query({
  args: {},
  handler: async (ctx) => {
    try {
      const squads = await ctx.db.query("squads").collect();
      const counts: Record<string, number> = {};
      let totalPicks = 0;
      for (const squad of squads) {
        for (const pid of squad.playerIds ?? []) {
          const key = String(pid);
          counts[key] = (counts[key] ?? 0) + 1;
          totalPicks += 1;
        }
      }
      return {
        totalSquads: squads.length,
        counts,
        totalPicks,
      };
    } catch {
      // Never bubble a storage hiccup into a rejected query.
      return { totalSquads: 0, counts: {} as Record<string, number>, totalPicks: 0 };
    }
  },
});

/**
 * "Most Captained" league-wide analytics.
 *
 * Aggregates every saved squad to work out what share of managers have made
 * each player their captain. Returned in two shapes at once so the UI never
 * has to sort or compute anything:
 *  - `percentages` / `counts`: lookup dictionaries keyed by playerId, for O(1)
 *    badge rendering on a market card;
 *  - `top`: the top 5, with resolved player names, for the "Top Captain
 *    Choice" highlight.
 *
 * ZERO-ERROR CONTRACT:
 *  - DIVISION BY ZERO — `totalCaptains` is 0 on a fresh database; every
 *    percentage then resolves to 0 and `topCaptainId` stays null, so an empty
 *    league renders clean 0% badges instead of NaN.
 *  - NULL-SAFE — a squad with a missing / empty / malformed `captainId` is
 *    skipped, not counted. A captain pointing at a deleted player still counts
 *    in the dictionaries (they'd render on nobody's card) but is omitted from
 *    `top` when the name can't be resolved.
 *  - NEVER THROWS — any storage hiccup returns the same fully-formed zero
 *    shape, so the captain modal can subscribe unconditionally.
 */
export const getMostCaptainedPlayers = query({
  args: {},
  handler: async (ctx) => {
    const empty = {
      totalSquads: 0,
      totalCaptains: 0,
      percentages: {} as Record<string, number>,
      counts: {} as Record<string, number>,
      topCaptainId: null as string | null,
      topPercentage: 0,
      top: [] as Array<{
        playerId: string;
        count: number;
        percentage: number;
        name: string | null;
        house: string | null;
        position: string | null;
      }>,
    };
    try {
      const squads = await ctx.db.query("squads").collect();

      // Tally the raw captain choices first.
      const counts: Record<string, number> = {};
      let totalCaptains = 0;
      for (const squad of squads) {
        const captainId = squad?.captainId;
        // Skip squads with no usable captain (fresh squad, legacy row, junk id).
        if (typeof captainId !== "string" || captainId.trim().length === 0) continue;
        counts[captainId] = (counts[captainId] ?? 0) + 1;
        totalCaptains += 1;
      }

      // Guard: an empty league means every percentage is exactly 0.
      const percentages: Record<string, number> = {};
      for (const [id, n] of Object.entries(counts)) {
        percentages[id] =
          totalCaptains > 0
            ? Math.round((n / totalCaptains) * 1000) / 10 // 1 decimal place
            : 0;
      }

      // Ranked list. Ties break on playerId so the order is STABLE across
      // renders — a jittering "Top Captain" badge would look broken.
      const ranked = Object.entries(counts).sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      });

      const topCaptainId = ranked.length > 0 ? ranked[0][0] : null;
      const topPercentage = topCaptainId ? percentages[topCaptainId] ?? 0 : 0;

      // Resolve names for the top 5 only (keeps the query cheap).
      const top = [];
      for (const [playerId, n] of ranked.slice(0, 5)) {
        let name: string | null = null;
        let house: string | null = null;
        let position: string | null = null;
        try {
          const p = await ctx.db.get(playerId as Id<"players">).catch(() => null);
          if (p) {
            name = typeof p.name === "string" ? p.name : null;
            house = typeof p.house === "string" ? p.house : null;
            position = typeof p.position === "string" ? p.position : null;
          }
        } catch {
          // Deleted player — keep the row, just without a name.
        }
        top.push({
          playerId,
          count: n,
          percentage: percentages[playerId] ?? 0,
          name,
          house,
          position,
        });
      }

      return {
        totalSquads: squads.length,
        totalCaptains,
        percentages,
        counts,
        topCaptainId,
        topPercentage,
        top,
      };
    } catch {
      // Never bubble a storage hiccup into a rejected query.
      return empty;
    }
  },
});

/**
 * Public rival-squad view for the Leaderboard inspector: the manager's
 * 7-a-side lineup, captain, points breakdown and remaining budget.
 * Null-safe: unknown/deleted user or missing squad returns null so the
 * drawer renders a clean empty state instead of throwing.
 */
export const getSquadByUserId = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    try {
      const user = await ctx.db.get(userId);
      if (!user) return null;
      const squad = await getSquadForUser(ctx, userId);
      if (!squad) return null;

      const players = (await Promise.all(squad.playerIds.map((id) => ctx.db.get(id)))).filter(
        (p): p is NonNullable<typeof p> => p !== null,
      );
      const captain = squad.captainId ? await ctx.db.get(squad.captainId) : null;
      const formation = resolveFormation(squad.formation);

      // Points breakdown via the shared leaderboard aggregation (safe at 0 matches).
      const rows = await getLeaderboardRows(ctx);
      const mine = rows.find((r) => r.userId === userId);
      const rank = mine ? rows.findIndex((r) => r.userId === userId) + 1 : null;

      // Fixed $70m platform budget, unless the Super Admin set a (capped)
      // per-manager override.
      const settings = normalizeSettings(await getSettingsRow(ctx));
      const effectiveBudget = resolveManagerBudget(settings, String(userId));

      // Store cosmetics for the inspected manager, so a rival's premium pitch
      // / golden jerseys render in the inspector and the ProfileModal. Derived
      // from entitlements (switched-off perks don't apply) with the Super Admin
      // auto-owning everything. TOTAL — a failed lookup means "no cosmetics".
      const cosmetics = await readUserCosmetics(ctx, user);

      // On-load sanitization: an over-budget stored squad is illegal — serve
      // it empty + flagged so the rival inspector renders a clean builder and
      // the owner is pushed to re-draft within budget.
      if (squadCostFromPlayers(players) > effectiveBudget) {
        return {
          squadId: squad._id,
          userId: user._id,
          username: user.username ?? "?",
          teamName: user.teamName ?? "Unnamed team",
          avatar: user.image ?? null,
          players: [],
          captainId: null,
          captainName: null,
          totalSpent: 0,
          effectiveBudget,
          remainingBudget: effectiveBudget,
          formation,
          totalPoints: mine?.total ?? 0,
          lastMatchPoints: mine?.lastMatch ?? 0,
          rank,
          managerCount: rows.length,
          customBadge: user.customBadge ?? null,
          role: user.role ?? null,
          activePitchTheme: cosmetics.activePitchTheme,
          hasGoldenJersey: cosmetics.hasGoldenJersey,
          overBudgetReset: true,
        };
      }

      return {
        squadId: squad._id,
        userId: user._id,
        username: user.username ?? "?",
        teamName: user.teamName ?? "Unnamed team",
        avatar: user.image ?? null,
        players,
        captainId: captain ? squad.captainId : null,
        captainName: captain?.name ?? null,
        totalSpent: toSafeAmount(squad.totalSpent),
        effectiveBudget,
        formation,
        remainingBudget: Math.max(effectiveBudget - toSafeAmount(squad.totalSpent), 0),
        totalPoints: mine?.total ?? 0,
        lastMatchPoints: mine?.lastMatch ?? 0,
        rank,
        managerCount: rows.length,
        customBadge: user.customBadge ?? null,
        role: user.role ?? null,
        activePitchTheme: cosmetics.activePitchTheme,
        hasGoldenJersey: cosmetics.hasGoldenJersey,
        overBudgetReset: false,
      };
    } catch {
      return null;
    }
  },
});

/**
 * Managers who currently have a given player in their starting 7.
 * Returns a plain array of public user info — `[]` when nobody has picked
 * the player (or anything at all goes wrong), so the client renders a clean
 * empty state instead of a rejected query.
 */
export const getManagersWhoPickedPlayer = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    try {
      const squads = await ctx.db.query("squads").collect();
      const out: Array<{
        userId: Id<"users">;
        username: string;
        teamName: string;
        profilePic: string | null;
        customBadge: string | null;
        role: string | null;
      }> = [];
      for (const squad of squads) {
        const ids = squad.playerIds ?? [];
        if (!ids.some((id) => String(id) === String(playerId))) continue;
        const user = await ctx.db.get(squad.userId);
        // Deleted user with an orphaned squad row — skip, never crash.
        if (!user) continue;
        out.push({
          userId: user._id,
          username: user.username ?? "unknown",
          teamName: user.teamName ?? "Unnamed team",
          profilePic: user.image ?? null,
          customBadge: user.customBadge ?? null,
          role: user.role ?? null,
        });
      }
      return out;
    } catch {
      // Storage hiccup / empty DB — degrade to an empty list.
      return [];
    }
  },
});

/** Points the signed-in user's squad earned from one match (null-safe). */
export const getSquadPointsByMatch = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { squadId: null, points: 0 };
    const squad = await getSquadForUser(ctx, userId);
    if (!squad) return { squadId: null, points: 0 };
    const all = await ctx.db
      .query("matchScores")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .collect();
    const score = all.find((s) => s.squadId === squad._id);
    return { squadId: squad._id, points: score?.points ?? 0 };
  },
});

export const saveSquad = mutation({
  args: {
    playerIds: v.array(v.id("players")),
    captainId: v.id("players"),
    // Chosen 7-a-side shape, e.g. "2-3-1". Omitted → inferred from the picks.
    formation: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SaveSquadResult> => {
    // ZERO-THROW contract: an invalid squad (wrong shape, over budget, house
    // limit, transfers locked) is an EXPECTED outcome, so it is RETURNED as
    // `{ ok: false, error }` and toasted by the client. Nothing a manager can
    // send can surface as an unhandled `CONVEX M(squads:saveSquad)` server
    // exception any more.
    try {
      return await saveSquadInner(ctx, args);
    } catch (err) {
      // Genuinely unexpected (db hiccup, feed write, stale payload) still
      // degrades to a readable message rather than a raw server error.
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        return { ok: false, error: err.message };
      }
      return {
        ok: false,
        error: "Could not save your squad — please refresh the page and try again.",
      };
    }
  },
});

/** Result of saveSquad — always resolves; never rejects for an expected error. */
export type SaveSquadResult =
  | { ok: true; squadId: Id<"squads">; formation: string }
  | { ok: false; error: string };

/** Body of saveSquad, split out so the wrapper can add the friendly catch. */
async function saveSquadInner(
  ctx: MutationCtx,
  args: {
    playerIds: Array<Id<"players">>;
    captainId: Id<"players">;
    formation?: string;
  },
): Promise<SaveSquadResult> {
  const user = await requireUser(ctx);
  const { houseLimit } = await getPlatformConfig(ctx);

  // Defensive input normalization: the arg validator already guarantees
  // strings, but a stale/cached client could still send null/undefined/junk
  // entries — drop them so the payload degrades to a clean validation error
  // ("pick exactly 7") instead of an unhandled server exception.
  const playerIds = (Array.isArray(args.playerIds) ? args.playerIds : []).filter(
    (id): id is Id<"players"> => typeof id === "string" && id.trim().length > 0,
  );
  const captainId =
    typeof args.captainId === "string" && args.captainId.trim().length > 0
      ? args.captainId
      : null;

  if (playerIds.length !== 7) {
    return { ok: false, error: `Pick exactly 7 players (currently ${playerIds.length}).` };
  }
  if (new Set(playerIds).size !== playerIds.length) {
    return { ok: false, error: "You cannot pick the same player twice." };
  }
  if (captainId === null || !playerIds.includes(captainId)) {
    return { ok: false, error: "Your captain must be one of your 7 starters." };
  }

  // Safe record fetching: a well-formed id can still point at a player that
  // was deleted or deactivated after the client loaded its roster. A failed
  // lookup degrades to null and is caught by the existence check below.
  const players = await Promise.all(playerIds.map((id) => ctx.db.get(id).catch(() => null)));
  if (players.some((p) => !p || !p.active)) {
    return {
      ok: false,
      error:
        "One or more selected players could not be found. Refresh the player list and try again.",
    };
  }

    // Formation: DYNAMIC, never hardcoded. The universal platform rule is
    // exactly 1 GK + 6 outfielders; the outfield split is then compared against
    // the CHOSEN formation's own shape (resolved from the string, so "2-3-1"
    // and "1-2-3-1" are the same shape).
    const counts: Record<"GK" | "DEF" | "MID" | "FWD", number> = {
      GK: 0,
      DEF: 0,
      MID: 0,
      FWD: 0,
    };
    for (const p of players) if (p) counts[p.position] += 1;
    const shapeResult = resolveSquadFormation(counts, args.formation);
    if (!("formation" in shapeResult)) {
      // Clean, human-readable message — returned, never thrown.
      return { ok: false, error: shapeResult.error };
    }
    const storedFormation = shapeResult.formation;

    // House limit
    const houseCounts = new Map<string, number>();
    for (const p of players) {
      if (!p) continue;
      houseCounts.set(p.house, (houseCounts.get(p.house) ?? 0) + 1);
    }
    for (const [house, count] of houseCounts) {
      if (count > houseLimit) {
        return {
          ok: false,
          error: `House limit exceeded: max ${houseLimit} players from ${house} (you picked ${count}).`,
        };
      }
    }

    // Budget — wrapped so an unexpected math failure surfaces as a clean
    // message instead of a raw server error; validation Errors rethrow
    // untouched so the client toast keeps its specific guidance.
    //
    // Strict numeric parsing per price: a malformed / NaN / negative price
    // becomes 0 rather than poisoning the sum (NaN > x is always false, which
    // would otherwise let a corrupt squad slip past the cap).
    const totalSpent = players.reduce((sum, p) => sum + toSafeAmount(p?.price), 0);
    // The budget is the fixed $70m platform default unless the Super Admin
    // set a per-manager override. resolveManagerBudget always caps at the
    // platform budget, so an override can only ever LOWER it — and
    // safeBudget re-asserts that the result is finite and non-negative.
    const settings = normalizeSettings(await getSettingsRow(ctx));
    const myBudget = safeBudget(
      resolveManagerBudget(settings, String(user._id)),
      settings.marketRules.defaultBudget,
    );
    try {
      if (!Number.isFinite(totalSpent)) {
        throw new Error("Squad value could not be calculated — please refresh and try again.");
      }
      // Strict server-side $70m verification — the client check is cosmetic;
      // this is the one that counts. The Super Admin's only override path is
      // the separate forceSaveSquad mutation, never this one.
      if (totalSpent > myBudget) {
        throw new Error(
          `Squad exceeds your budget: ${formatMoney(totalSpent)} spent of ${formatMoney(myBudget)}.`,
        );
      }
      // Price window guard — a player repriced above the cap after the squad
      // was built would otherwise make an existing squad unsavable.
      const { minPlayerPrice, maxPlayerPrice } = settings.marketRules;
      for (const p of players) {
        const price = toSafeAmount(p?.price);
        if (price < minPlayerPrice || price > maxPlayerPrice) {
          throw new Error(
            `${p?.name ?? "A player"} is priced outside the current market range (${formatMoney(minPlayerPrice)}–${formatMoney(maxPlayerPrice)}).`,
          );
        }
      }
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.length > 0 &&
        !err.message.startsWith("Uncaught")
      ) {
        return { ok: false, error: err.message };
      }
      return { ok: false, error: "Could not validate your squad budget — please try again." };
    }

    const existing = await getSquadForUser(ctx, user._id);
    if (existing) {
      // Transfer deadline gate: a squad may only change while at least ONE
      // gameweek is still open (unsettled, unlocked, deadline not passed).
      // First-time saves stay allowed so a manager joining late can still
      // field a team.
      const change = existing.playerIds.map(String).join(",") !== playerIds.map(String).join(",");
      // Repair path: if the STORED squad is itself over budget (e.g. the
      // Super Admin repriced a player after it was saved), always allow the
      // rebuild — deadline locks must never trap a manager with an illegal
      // squad they are required to fix.
      const storedIllegal = await isSquadOverBudget(ctx, existing);
      if (change && !storedIllegal) {
        // Master switch: the Super Admin can lock the Squad Builder for
        // everyone, independent of any gameweek deadline.
        if (settings.editableSquads === false) {
          return {
            ok: false,
            error: "The Super Admin has locked the squad builder platform-wide.",
          };
        }
        const gwRows = await ctx.db.query("gameweeks").collect();
        const byStage: Record<
          string,
          { deadlineAt: number | null; locked: boolean; settled: boolean }
        > = {};
        for (const stage of GW_STAGES) {
          const row = gwRows.find((g) => g.stage === stage);
          byStage[stage] = {
            deadlineAt: typeof row?.deadlineAt === "number" ? row.deadlineAt : null,
            locked: row?.locked === true,
            settled: row?.settled === true,
          };
        }
        const reason = transferLockReason(byStage);
        if (reason) return { ok: false, error: reason };
      }
      await ctx.db.patch(existing._id, {
        playerIds,
        captainId,
        totalSpent,
        formation: storedFormation,
      });
      // Activity feed: transfer made (defensive, non-fatal).
      if (change) {
        try {
          const removed = existing.playerIds.filter((id) => !playerIds.includes(id));
          const added = playerIds.filter((id) => !existing.playerIds.includes(id));
          const parts: string[] = [];
          for (const pid of added.slice(0, 3)) {
            const p = await ctx.db.get(pid);
            if (p) parts.push(`IN ${p.name}`);
          }
          for (const pid of removed.slice(0, 3)) {
            const p = await ctx.db.get(pid);
            if (p) parts.push(`OUT ${p.name}`);
          }
          if (parts.length > 0) {
            await ctx.runMutation(internal.activity.logActivity, {
              type: "transfer",
              text: `🔄 @${user.username ?? "a manager"}: ${parts.join(" · ")}`,
              actorUserId: user._id,
            });
          }
        } catch {
          // feed failure is non-fatal
        }
      }
      return { ok: true, squadId: existing._id, formation: storedFormation };
    }
    const newId = await ctx.db.insert("squads", {
      userId: user._id,
      playerIds,
      captainId,
      totalSpent,
      formation: storedFormation,
    });
    try {
      await ctx.runMutation(internal.activity.logActivity, {
        type: "transfer",
        text: `🆕 @${user.username ?? "a manager"} drafted their starting 7!`,
        actorUserId: user._id,
      });
    } catch {
      // feed failure is non-fatal
    }
    return { ok: true, squadId: newId, formation: storedFormation };
}

/**
 * The signed-in manager's chip status (armed chip, used flag) — null-safe.
 */
export const getMyChip = query({
  args: {},
  handler: async (ctx) => {
    const empty = {
      chip: null,
      used: false,
      available: false,
      extraChips: 0,
      extraChipsLeft: 0,
    };
    try {
      const userId = await getAuthUserId(ctx);
      if (userId === null) return empty;
      const squad = await getSquadForUser(ctx, userId);
      if (!squad) return empty;
      const armed = typeof squad.activeChip === "string" ? squad.activeChip : null;
      const used = squad.chipUsed === true;

      // Store-bought extra chips (see transactions.approvePurchase). Defensive
      // on every field: a missing squad/user row just means "no extras".
      const user = await ctx.db.get(userId);
      const ownedExtra =
        typeof user?.extraChips === "number" && Number.isFinite(user.extraChips)
          ? Math.max(0, Math.floor(user.extraChips))
          : 0;
      const burnedExtra =
        typeof squad.extraChipsUsed === "number" &&
        Number.isFinite(squad.extraChipsUsed)
          ? Math.max(0, Math.floor(squad.extraChipsUsed))
          : 0;
      const extraChipsLeft = Math.max(0, ownedExtra - burnedExtra);
      // Free tournament chip + any unspent extra chips = how many are left.
      const chipsLeft = (used ? 0 : 1) + extraChipsLeft;

      return {
        chip: armed,
        used,
        available: armed === null && chipsLeft > 0,
        extraChips: ownedExtra,
        extraChipsLeft,
      };
    } catch {
      return empty;
    }
  },
});

// ── Over-budget enforcement & resets ─────────────────────────────────────

/**
 * Auto-repair: deletes the signed-in manager's squad when the STORED squad
 * costs more than their effective budget ($70m unless the Super Admin set a
 * lower per-manager override). The Squad Builder calls this once when a read
 * path flags the squad as over budget. The server re-verifies before
 * deleting, so this mutation can never clear a legal squad — and a missing
 * or already-clean squad is a silent no-op, never an error.
 */
export const clearMyOverBudgetSquad = mutation({
  args: {},
  handler: async (ctx) => {
    try {
      const user = await requireUser(ctx);
      const squad = await getSquadForUser(ctx, user._id);
      if (!squad) return { cleared: false };
      const cost = squadCostFromPlayers(await loadSquadPlayers(ctx, squad));
      const budget = await effectiveBudgetFor(ctx, String(user._id));
      if (cost <= budget) return { cleared: false }; // legal squad — never touch it
      await ctx.db.delete(squad._id);
      return { cleared: true };
    } catch {
      // Never bubble a repair failure into a UI crash; the admin sweep and
      // the next save attempt still recover the account.
      return { cleared: false };
    }
  },
});

/**
 * Super Admin sweep: deletes ONLY the squads whose stored player prices
 * exceed their owner's effective budget ($70m cap unless a lower per-manager
 * override exists). Legal $70m teams are untouched. Publishes one community
 * activity alert when anything was reset, and writes an audit entry.
 */
export const resetOverBudgetSquads = mutation({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);
    const resetTeams: string[] = [];
    let examined = 0;
    try {
      const squads = await ctx.db.query("squads").collect();
      for (const squad of squads) {
        examined += 1;
        try {
          const cost = squadCostFromPlayers(await loadSquadPlayers(ctx, squad));
          const budget = await effectiveBudgetFor(ctx, String(squad.userId));
          if (cost <= budget) continue; // valid team — do not affect it
          await ctx.db.delete(squad._id);
          const owner = await ctx.db.get(squad.userId);
          resetTeams.push(owner?.username ?? "unknown");
        } catch {
          continue; // one bad row never aborts the sweep
        }
      }

      if (resetTeams.length > 0) {
        try {
          await ctx.runMutation(internal.activity.logActivity, {
            type: "system",
            text: "🚨 System Alert: Squads exceeding the $70m budget cap have been automatically reset. Please check and rebuild your team!",
          });
        } catch {
          // feed failure is non-fatal
        }
      }
      try {
        await ctx.runMutation(internal.audit.logAudit, {
          action: "reset_over_budget_squads",
          category: "squad",
          detail: `Examined ${examined} squad(s); reset ${resetTeams.length}${
            resetTeams.length > 0 ? `: ${resetTeams.slice(0, 20).join(", ")}` : ""
          }`,
        });
      } catch {
        // audit failure is non-fatal
      }
      return { reset: resetTeams.length, examined, teams: resetTeams.slice(0, 50) };
    } catch {
      throw new Error("Could not run the over-budget sweep — please try again.");
    }
  },
});

/**
 * Super Admin full reset: deletes EVERY fantasy squad so the whole pool
 * re-drafts from scratch. Requires an explicit confirm flag; publishes a
 * community activity alert and an audit entry. Points/scores are managed by
 * the separate Reset All Points tool and are intentionally left alone.
 */
export const resetAllSquads = mutation({
  args: { confirm: v.optional(v.boolean()) },
  handler: async (ctx, { confirm }) => {
    await requireSuperAdmin(ctx);
    if (confirm !== true) {
      throw new Error("Reset All Squads requires confirmation.");
    }
    let deleted = 0;
    try {
      const squads = await ctx.db.query("squads").collect();
      for (const squad of squads) {
        try {
          await ctx.db.delete(squad._id);
          deleted += 1;
        } catch {
          continue; // one bad row never aborts the reset
        }
      }
      try {
        await ctx.runMutation(internal.activity.logActivity, {
          type: "system",
          text: "🧹 All fantasy squads have been reset by the Super Admin — please draft your starting 7 again!",
        });
      } catch {
        // feed failure is non-fatal
      }
      try {
        await ctx.runMutation(internal.audit.logAudit, {
          action: "reset_all_squads",
          category: "squad",
          detail: `Deleted ${deleted} squad(s)`,
        });
      } catch {
        // audit failure is non-fatal
      }
      return { deleted };
    } catch {
      throw new Error("Could not reset the squads — please try again.");
    }
  },
});
