import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireUser, getPlatformConfig, getSquadForUser, getLeaderboardRows } from "./lib";
import { formatMoney, safeBudget, toSafeAmount, CHIP_GW1, CHIP_GW2, GW_STAGES } from "./configDefaults";
import { transferLockReason } from "./gameweekStructure";
import { getSettingsRow, normalizeSettings, resolveManagerBudget } from "./adminConfig";
import { stageValidator } from "./schema";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

const REQUIRED_FORMATION: Record<string, number> = {
  GK: 1,
  DEF: 2,
  MID: 2,
  FWD: 2,
};

export type SquadPlayer = Doc<"players">;

/**
 * Returns the signed-in user's squad, or `null` when there isn't one.
 * Never throws: not-signed-in (including the brief auth-attachment race on
 * mount) and missing accounts both yield `null` so the client can render an
 * empty state instead of crashing on a rejected query.
 */
export const getMySquad = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null; // not signed in (yet)
    const user = await ctx.db.get(userId);
    if (!user) return null; // account no longer exists
    const squad = await getSquadForUser(ctx, userId);
    if (!squad) return null; // no squad built yet (e.g. admins)
    const players = await Promise.all(squad.playerIds.map((id) => ctx.db.get(id)));
    const captain = squad.captainId ? await ctx.db.get(squad.captainId) : null;
    return {
      squadId: squad._id,
      totalSpent: toSafeAmount(squad.totalSpent),
      players: players.filter(Boolean) as SquadPlayer[],
      captainId: captain ? squad.captainId : null,
    };
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

      // Points breakdown via the shared leaderboard aggregation (safe at 0 matches).
      const rows = await getLeaderboardRows(ctx);
      const mine = rows.find((r) => r.userId === userId);
      const rank = mine ? rows.findIndex((r) => r.userId === userId) + 1 : null;

      // Fixed $70m platform budget, unless the Super Admin set a (capped)
      // per-manager override.
      const settings = normalizeSettings(await getSettingsRow(ctx));
      const effectiveBudget = resolveManagerBudget(settings, String(userId));

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
        remainingBudget: Math.max(effectiveBudget - toSafeAmount(squad.totalSpent), 0),
        totalPoints: mine?.total ?? 0,
        lastMatchPoints: mine?.lastMatch ?? 0,
        rank,
        managerCount: rows.length,
        customBadge: user.customBadge ?? null,
        role: user.role ?? null,
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
  },
  handler: async (ctx, { playerIds, captainId }) => {
    const user = await requireUser(ctx);
    const { budget, houseLimit } = await getPlatformConfig(ctx);

    if (playerIds.length !== 7) {
      throw new Error(`Pick exactly 7 players (currently ${playerIds.length}).`);
    }
    if (new Set(playerIds).size !== playerIds.length) {
      throw new Error("You cannot pick the same player twice.");
    }
    const captainInSquad = playerIds.includes(captainId);
    if (!captainInSquad) {
      throw new Error("Your captain must be one of your 7 starters.");
    }

    const players = await Promise.all(playerIds.map((id) => ctx.db.get(id)));
    if (players.some((p) => !p || !p.active)) {
      throw new Error("One of your selected players no longer exists.");
    }

    // Formation: 1 GK / 2 DEF / 2 MID / 2 FWD
    const counts: Record<string, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const p of players) if (p) counts[p.position] += 1;
    for (const [pos, need] of Object.entries(REQUIRED_FORMATION)) {
      if (counts[pos] !== need) {
        throw new Error(
          `Illegal formation: you need exactly ${need} × ${pos} (you picked ${counts[pos]}).`,
        );
      }
    }

    // House limit
    const houseCounts = new Map<string, number>();
    for (const p of players) {
      if (!p) continue;
      houseCounts.set(p.house, (houseCounts.get(p.house) ?? 0) + 1);
    }
    for (const [house, count] of houseCounts) {
      if (count > houseLimit) {
        throw new Error(
          `House limit exceeded: max ${houseLimit} players from ${house} (you picked ${count}).`,
        );
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
    try {
      if (!Number.isFinite(totalSpent)) {
        throw new Error("Squad value could not be calculated — please refresh and try again.");
      }
      // The budget is the fixed $70m platform default unless the Super Admin
      // set a per-manager override. resolveManagerBudget always caps at the
      // platform budget, so an override can only ever LOWER it — and
      // safeBudget re-asserts that the result is finite and non-negative.
      const settings = normalizeSettings(await getSettingsRow(ctx));
      const myBudget = safeBudget(
        resolveManagerBudget(settings, String(user._id)),
        settings.marketRules.defaultBudget,
      );
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
      if (err instanceof Error && !err.message.startsWith("Uncaught")) throw err;
      throw new Error("Could not validate your squad budget — please try again.");
    }

    const existing = await getSquadForUser(ctx, user._id);
    if (existing) {
      // Transfer deadline gate: a squad may only change while at least ONE
      // gameweek is still open (unsettled, unlocked, deadline not passed).
      // First-time saves stay allowed so a manager joining late can still
      // field a team.
      const change = existing.playerIds.map(String).join(",") !== playerIds.map(String).join(",");
      if (change) {
        // Master switch: the Super Admin can lock the Squad Builder for
        // everyone, independent of any gameweek deadline.
        const settingsForLock = normalizeSettings(await getSettingsRow(ctx));
        if (settingsForLock.editableSquads === false) {
          throw new Error("The Super Admin has locked the squad builder platform-wide.");
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
        if (reason) throw new Error(reason);
      }
      await ctx.db.patch(existing._id, { playerIds, captainId, totalSpent });
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
      return existing._id;
    }
    const newId = await ctx.db.insert("squads", {
      userId: user._id,
      playerIds,
      captainId,
      totalSpent,
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
    return newId;
  },
});

/**
 * The signed-in manager's chip status (armed chip, used flag) — null-safe.
 */
export const getMyChip = query({
  args: {},
  handler: async (ctx) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (userId === null) return { chip: null, used: false, available: false };
      const squad = await getSquadForUser(ctx, userId);
      if (!squad) return { chip: null, used: false, available: false };
      const armed = typeof squad.activeChip === "string" ? squad.activeChip : null;
      const used = squad.chipUsed === true;
      return {
        chip: armed,
        used,
        available: armed === null && !used,
      };
    } catch {
      return { chip: null, used: false, available: false };
    }
  },
});
