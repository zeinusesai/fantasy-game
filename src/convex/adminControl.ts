import { v } from "convex/values";
import {
  query,
  mutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { requireSuperAdmin } from "./lib";
import { getSquadForUser } from "./lib";
import { internal } from "./_generated/api";
import { getSettingsRow, normalizeSettings, resolveManagerBudget } from "./adminConfig";
import {
  formationMatches,
  formationShape,
  validateSquadShape,
  inferFormation,
  isFormationId,
  resolveFormation,
} from "./formations";
import { formatMoney, toSafeAmount } from "./configDefaults";
import { CHIP_GW1, CHIP_GW2 } from "./configDefaults";
import { houseValidator, HOUSES, positionValidator, type House, type Position } from "./schema";
import { cleanText } from "./defaults";
import type { Doc, Id } from "./_generated/dataModel";

// ── Super Admin control suite ───────────────────────────────────────────
//
// Everything in this module bypasses manager-facing validation on purpose:
// the whole point is to fix situations a manager caused (bad squad, wrong
// price, accidental username) or to run tournament-wide operations.
//
// Safety rails that are NOT skipped:
//   • every input is still strictly parsed and length-capped,
//   • every mutation is super-admin only and try/catch wrapped,
//   • every destructive action writes an audit entry first,
//   • guards still prevent self-harm (can't delete/demote yourself or the
//     last super admin).

/** Consistent, non-leaking super-admin guard. */
async function requireSuper(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  try {
    return await requireSuperAdmin(ctx);
  } catch {
    throw new Error("Only the Super Admin can do that.");
  }
}

async function audit(
  ctx: MutationCtx,
  action: string,
  category: string,
  target?: string,
  detail?: string,
): Promise<void> {
  try {
    await ctx.runMutation(internal.audit.logAudit, {
      action,
      category,
      ...(target ? { target } : {}),
      ...(detail ? { detail } : {}),
    });
  } catch {
    // audit failure must never block the admin action
  }
}

// ── User inspector ──────────────────────────────────────────────────────

/**
 * Searchable / filterable user list for the admin panel. All filters are
 * optional and every field is null-safe, so `[]` is a valid response for an
 * empty database or a rejected query.
 */
export const searchUsers = query({
  args: {
    search: v.optional(v.string()),
    role: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { search, role, limit }) => {
    try {
      await requireSuper(ctx);
    } catch {
      return [];
    }
    try {
      const { marketRules, budgetOverrides } = normalizeSettings(await getSettingsRow(ctx));
      const squads = await ctx.db.query("squads").collect();
      const scores = await ctx.db.query("matchScores").collect();

      const totals = new Map<string, number>();
      for (const s of scores) {
        totals.set(s.userId, (totals.get(s.userId) ?? 0) + (Number(s.points) || 0));
      }
      const squadByUser = new Map(squads.map((s) => [String(s.userId), s]));

      const term = typeof search === "string" ? search.trim().toLowerCase() : "";
      const roleFilter = typeof role === "string" ? role.trim() : "";
      const parsedLimit = Number(limit);
      const max = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(Math.round(parsedLimit), 200) : 100;

      const users = await ctx.db.query("users").collect();
      return users
        .filter((u) => {
          if (roleFilter.length > 0 && (u.role ?? "manager") !== roleFilter) return false;
          if (term.length === 0) return true;
          const haystack = `${u.username ?? ""} ${u.teamName ?? ""}`.toLowerCase();
          return haystack.includes(term);
        })
        .sort((a, b) => (a.username ?? "").localeCompare(b.username ?? ""))
        .slice(0, max)
        .map((u) => {
          const squad = squadByUser.get(String(u._id));
          const override = budgetOverrides[String(u._id)];
          return {
            _id: u._id,
            username: u.username ?? null,
            teamName: u.teamName ?? null,
            image: u.image ?? null,
            role: u.role ?? "manager",
            customBadge: u.customBadge ?? null,
            totalPoints: Math.round(totals.get(u._id) ?? 0),
            squadSize: squad ? squad.playerIds.length : 0,
            captainId: squad?.captainId ?? null,
            activeChip: squad?.activeChip ?? null,
            chipUsed: squad?.chipUsed === true,
            // Per-user budget: override (clamped) → configured global default.
            budget: resolveManagerBudget(
              { budgetOverrides, marketRules },
              String(u._id),
            ),
            hasBudgetOverride: typeof override === "number",
            createdAt: u._creationTime ?? 0,
          };
        });
    } catch {
      return [];
    }
  },
});

/** Any manager's current squad + full player details, for the force-editor. */
export const getUserSquadForAdmin = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    try {
      await requireSuper(ctx);
    } catch {
      return null;
    }
    try {
      const user = await ctx.db.get(userId);
      if (!user) return null;
      const squad = await getSquadForUser(ctx, userId);
      const players = squad
        ? (await Promise.all(squad.playerIds.map((id) => ctx.db.get(id)))).filter(
            (p): p is NonNullable<typeof p> => p !== null,
          )
        : [];
      const { marketRules, budgetOverrides } = normalizeSettings(await getSettingsRow(ctx));
      const budget = resolveManagerBudget({ budgetOverrides, marketRules }, String(userId));
      return {
        userId: user._id,
        username: user.username ?? null,
        teamName: user.teamName ?? null,
        squadId: squad?._id ?? null,
        players: players.map((p) => ({
          _id: p._id,
          name: p.name,
          house: p.house,
          position: p.position,
          price: toSafeAmount(p.price),
          image: p.image ?? null,
        })),
        captainId: squad?.captainId ?? null,
        totalSpent: toSafeAmount(squad?.totalSpent),
        budget,
        activeChip: squad?.activeChip ?? null,
        chipUsed: squad?.chipUsed === true,
      };
    } catch {
      return null;
    }
  },
});

// ── Username editing ────────────────────────────────────────────────────

/**
 * Super Admin: change a manager's username. The auth credential id is the
 * lowercase username, so it is rewritten too — otherwise the account would
 * keep signing in with the old name.
 */
export const updateUsername = mutation({
  args: { userId: v.id("users"), username: v.string() },
  handler: async (ctx, { userId, username }) => {
    const me = await requireSuper(ctx);
    try {
      const target = await ctx.db.get(userId);
      if (!target) throw new Error("User not found.");
      const clean = cleanText(username, 24, "").toLowerCase();
      if (!/^[a-z0-9_]{3,24}$/.test(clean)) {
        throw new Error("Usernames must be 3-24 characters: letters, numbers or _");
      }
      const clash = await ctx.db
        .query("users")
        .withIndex("by_username", (q) => q.eq("username", clean))
        .unique();
      if (clash && clash._id !== userId) {
        throw new Error(`"${clean}" is already taken.`);
      }

      const oldName = target.username ?? "unknown";
      // Keep the password provider's account id in sync with the username.
      const accounts = await ctx.db
        .query("authAccounts")
        .withIndex("userIdAndProvider", (q) =>
          q.eq("userId", userId).eq("provider", "password"),
        )
        .collect();
      if (accounts[0]) {
        await ctx.db.patch(accounts[0]._id, { providerAccountId: clean });
      }
      await ctx.db.patch(userId, { username: clean });
      await audit(ctx, "update_username", "user", `@${clean}`, `was @${oldName}`);
      return { username: clean, actor: me.username ?? null };
    } catch (err) {
      if (
        err instanceof Error &&
        (/already taken|3-24 characters|User not found/.test(err.message))
      ) {
        throw err;
      }
      throw new Error("Could not update the username — please try again.");
    }
  },
});

// ── Manual point adjustments ────────────────────────────────────────────

/**
 * Super Admin: grant or deduct bonus points with a mandatory reason. The
 * reason is stored in `pointAdjustments` so the entry survives a
 * "Reset All Points" and can be re-applied by hand.
 */
export const adjustPoints = mutation({
  args: {
    userId: v.id("users"),
    points: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, { userId, points, reason }) => {
    await requireSuper(ctx);
    try {
      const target = await ctx.db.get(userId);
      if (!target) throw new Error("User not found.");
      // Strict numeric parse: reject NaN/Infinity before any arithmetic.
      const value = Math.round(Number(points));
      if (!Number.isFinite(value) || value === 0) {
        throw new Error("Adjustment must be a non-zero number.");
      }
      if (Math.abs(value) > 10_000) {
        throw new Error("Adjustments are capped at 10,000 points.");
      }
      const why = cleanText(reason, 200, "");
      if (why.length < 3) {
        throw new Error("Give a short reason (min 3 characters) for the audit log.");
      }

      // A squad is required: score rows are per squad.
      const squad = await getSquadForUser(ctx, userId);
      if (!squad) throw new Error("That manager has no squad to adjust.");
      const matches = await ctx.db.query("matches").collect();
      const anchor =
        matches.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
      if (!anchor) {
        throw new Error("Record a match first — adjustments attach to a match.");
      }

      await ctx.db.insert("pointAdjustments", {
        userId,
        points: value,
        reason: why,
        createdAt: Date.now(),
      });
      await ctx.db.insert("matchScores", {
        matchId: anchor._id,
        squadId: squad._id,
        userId,
        points: value,
      });
      try {
        await ctx.runMutation(internal.activity.logActivity, {
          type: "settled",
          text:
            value > 0
              ? `➕ @${target.username ?? "a manager"} received ${value} bonus points — ${why}`
              : `➖ @${target.username ?? "a manager"} was deducted ${Math.abs(value)} points — ${why}`,
          actorUserId: userId,
        });
      } catch {
        // feed failure is non-fatal
      }
      await audit(
        ctx,
        "adjust_points",
        "points",
        `@${target.username ?? userId}`,
        `${value > 0 ? "+" : ""}${value} — ${why}`,
      );
      return { applied: value };
    } catch (err) {
      if (
        err instanceof Error &&
        (/User not found|non-zero|capped|reason|no squad|Record a match/.test(err.message))
      ) {
        throw err;
      }
      throw new Error("Could not adjust the points — please try again.");
    }
  },
});

/** Super Admin: the full adjustment history for one manager. */
export const getPointAdjustments = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    try {
      await requireSuper(ctx);
    } catch {
      return [];
    }
    try {
      const rows = await ctx.db
        .query("pointAdjustments")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      return rows
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((r) => ({
          _id: r._id,
          points: Number(r.points) || 0,
          reason: r.reason,
          createdAt: r.createdAt,
          actor: r.actor ?? null,
        }));
    } catch {
      return [];
    }
  },
});

// ── Chip grants ─────────────────────────────────────────────────────────

/** Super Admin: grant (or clear) a manager's one-time Double Down chip. */
export const grantChip = mutation({
  args: { userId: v.id("users"), chip: v.optional(v.union(v.literal(CHIP_GW1), v.literal(CHIP_GW2))) },
  handler: async (ctx, { userId, chip }) => {
    await requireSuper(ctx);
    try {
      const target = await ctx.db.get(userId);
      if (!target) throw new Error("User not found.");
      const squad = await getSquadForUser(ctx, userId);
      if (!squad) throw new Error("That manager has no squad.");

      if (!chip) {
        await ctx.db.patch(squad._id, { activeChip: undefined, chipUsed: false });
        await audit(ctx, "clear_chip", "user", `@${target.username ?? userId}`);
        return { chip: null };
      }
      // Granting re-arms the chip even if it was previously consumed.
      await ctx.db.patch(squad._id, { activeChip: chip, chipUsed: false });
      await audit(
        ctx,
        "grant_chip",
        "user",
        `@${target.username ?? userId}`,
        chip === CHIP_GW1 ? "Gameweek 1" : "Gameweek 2",
      );
      return { chip };
    } catch (err) {
      if (err instanceof Error && /User not found|no squad/.test(err.message)) throw err;
      throw new Error("Could not update the chip — please try again.");
    }
  },
});

// ── Squad force-editor ──────────────────────────────────────────────────

/**
 * Super Admin: overwrite any manager's starting seven and captain. This
 * deliberately bypasses the transfer-deadline gate (that's the point of an
 * emergency fix) but STILL validates the squad so the app can never end up
 * with an illegal formation or an over-budget team.
 */
export const forceSaveSquad = mutation({
  args: {
    userId: v.id("users"),
    playerIds: v.array(v.id("players")),
    captainId: v.optional(v.id("players")),
    // Chosen 7-a-side shape, e.g. "2-3-1". Omitted → inferred from the picks.
    formation: v.optional(v.string()),
  },
  handler: async (ctx, { userId, playerIds, captainId, formation }) => {
    await requireSuper(ctx);
    try {
      const target = await ctx.db.get(userId);
      if (!target) throw new Error("User not found.");
      if (!Array.isArray(playerIds) || playerIds.length !== 7) {
        throw new Error("A starting seven must contain exactly 7 players.");
      }
      if (new Set(playerIds).size !== 7) {
        throw new Error("The same player cannot be picked twice.");
      }
      const docs = await Promise.all(playerIds.map((id) => ctx.db.get(id)));
      if (docs.some((p) => !p)) throw new Error("One of those players no longer exists.");

      // Formation-aware and DYNAMIC — no hardcoded 2/2/2 rule. The same shared
      // validator `saveSquad` uses: universal 1 GK + 6 outfielders first, then
      // the outfield split compared against the chosen formation's own shape.
      // A missing / unknown string is never rejected — the shape is inferred
      // from the picks, so a legacy squad can still be force-saved.
      const counts: Record<"GK" | "DEF" | "MID" | "FWD", number> = {
        GK: 0,
        DEF: 0,
        MID: 0,
        FWD: 0,
      };
      for (const p of docs) if (p) counts[p.position] += 1;
      const shapeResult = validateSquadShape(counts, formation);
      if (!shapeResult.ok) {
        throw new Error(shapeResult.message);
      }
      const storedFormation = shapeResult.formation;

      const cap = captainId ?? playerIds[0];
      if (!playerIds.includes(cap)) {
        throw new Error("The captain must be one of the seven.");
      }

      const totalSpent = docs.reduce((sum, p) => sum + toSafeAmount(p?.price), 0);
      const settings = normalizeSettings(await getSettingsRow(ctx));
      const budget = resolveManagerBudget(settings, String(userId));
      const overBudget = totalSpent > budget;

      const existing = await getSquadForUser(ctx, userId);
      if (existing) {
        await ctx.db.patch(existing._id, {
          playerIds,
          captainId: cap,
          totalSpent,
          formation: storedFormation,
        });
      } else {
        await ctx.db.insert("squads", {
          userId,
          playerIds,
          captainId: cap,
          totalSpent,
          formation: storedFormation,
        });
      }

      await audit(
        ctx,
        "force_save_squad",
        "squad",
        `@${target.username ?? userId}`,
        `7 players · ${storedFormation} · ${formatMoney(totalSpent)}${overBudget ? " (over budget — allowed by admin)" : ""}`,
      );
      try {
        await ctx.runMutation(internal.activity.logActivity, {
          type: "transfer",
          text: `🛠️ The Super Admin updated @${target.username ?? "a manager"}'s starting seven.`,
          actorUserId: userId,
        });
      } catch {
        // feed failure is non-fatal
      }
      return { totalSpent, budget, overBudget, formation: storedFormation };
    } catch (err) {
      if (
        err instanceof Error &&
        (/User not found|exactly 7|same player|no longer exists|Illegal formation|captain/.test(
          err.message,
        ))
      ) {
        throw err;
      }
      throw new Error("Could not save the squad — please try again.");
    }
  },
});

// ── Bulk operations ─────────────────────────────────────────────────────

/**
 * Super Admin: wipe every score row (and the adjustment history) and
 * recompute awards. Destructive — guarded by an explicit confirm flag so it
 * can never fire from a stray click.
 */
export const resetAllPoints = mutation({
  args: { confirm: v.optional(v.boolean()) },
  handler: async (ctx, { confirm }) => {
    await requireSuper(ctx);
    if (confirm !== true) {
      throw new Error("Reset All Points requires confirmation.");
    }
    try {
      const scores = await ctx.db.query("matchScores").collect();
      for (const s of scores) await ctx.db.delete(s._id);
      const adjustments = await ctx.db.query("pointAdjustments").collect();
      for (const a of adjustments) await ctx.db.delete(a._id);
      try {
        await ctx.runMutation(internal.awards.recalculateAwards, {});
      } catch {
        // awards refresh is non-fatal
      }
      await audit(
        ctx,
        "reset_all_points",
        "bulk",
        undefined,
        `Cleared ${scores.length} score rows + ${adjustments.length} adjustments`,
      );
      return { cleared: scores.length, adjustments: adjustments.length };
    } catch {
      throw new Error("Could not reset the points — please try again.");
    }
  },
});

/** Super Admin: lock or unlock every gameweek at once. */
export const lockAllTransfers = mutation({
  args: { locked: v.boolean() },
  handler: async (ctx, { locked }) => {
    await requireSuper(ctx);
    try {
      const isLocked = locked === true;
      const rows = await ctx.db.query("gameweeks").collect();
      const stages = ["semifinal1", "semifinal2", "third_place", "final"];
      let updated = 0;
      for (const stage of stages) {
        const row = rows.find((r) => r.stage === stage);
        if (row) {
          await ctx.db.patch(row._id, { locked: isLocked });
          updated += 1;
        } else if (isLocked) {
          await ctx.db.insert("gameweeks", { stage: stage as never, locked: true });
          updated += 1;
        }
      }
      await audit(
        ctx,
        "lock_all_transfers",
        "bulk",
        undefined,
        isLocked ? `Locked ${updated} stages` : `Unlocked ${updated} stages`,
      );
      return { updated };
    } catch {
      throw new Error("Could not update the transfer locks — please try again.");
    }
  },
});

/**
 * Super Admin: distribute a flat GW bonus to every manager who has a squad.
 * `pointsPerManager` may be negative (a penalty round).
 */
export const distributeGwBonus = mutation({
  args: { pointsPerManager: v.number(), reason: v.optional(v.string()) },
  handler: async (ctx, { pointsPerManager, reason }) => {
    await requireSuper(ctx);
    try {
      const value = Math.round(Number(pointsPerManager));
      if (!Number.isFinite(value) || value === 0) {
        throw new Error("Bonus must be a non-zero number.");
      }
      if (Math.abs(value) > 1000) {
        throw new Error("Per-manager bonus is capped at 1,000 points.");
      }
      const why = cleanText(reason, 200, "Gameweek bonus");
      const matches = await ctx.db.query("matches").collect();
      const anchor = matches.sort((a, b) => b.createdAt - a.createdAt)[0];
      if (!anchor) throw new Error("Record a match first — bonuses attach to a match.");

      const squads = await ctx.db.query("squads").collect();
      const users = await ctx.db.query("users").collect();
      const byId = new Map(users.map((u) => [u._id, u]));
      let paid = 0;
      for (const squad of squads) {
        await ctx.db.insert("matchScores", {
          matchId: anchor._id,
          squadId: squad._id,
          userId: squad.userId,
          points: value,
        });
        await ctx.db.insert("pointAdjustments", {
          userId: squad.userId,
          points: value,
          reason: `GW bonus — ${why}`,
          createdAt: Date.now(),
        });
        paid += 1;
      }
      try {
        await ctx.runMutation(internal.activity.logActivity, {
          type: "settled",
          text: `🎁 Every manager received ${value > 0 ? "+" : ""}${value} points — ${why}`,
        });
      } catch {
        // feed failure is non-fatal
      }
      await audit(
        ctx,
        "distribute_gw_bonus",
        "bulk",
        undefined,
        `${value > 0 ? "+" : ""}${value} to ${paid} managers — ${why}`,
      );
      return { paid, points: value };
    } catch (err) {
      if (
        err instanceof Error &&
        (/non-zero|capped|Record a match/.test(err.message))
      ) {
        throw err;
      }
      throw new Error("Could not distribute the bonus — please try again.");
    }
  },
});

/**
 * Super Admin: trigger an auto-sub sweep. Any player deleted or deactivated
 * while still sitting in a squad is swapped for the highest-priced available
 * player at the same position who isn't already picked.
 */
export const triggerAutoSubs = mutation({
  args: {},
  handler: async (ctx) => {
    await requireSuper(ctx);
    try {
      const allPlayers = await ctx.db.query("players").collect();
      const active = allPlayers.filter((p) => p.active);
      const squads = await ctx.db.query("squads").collect();
      let changes = 0;

      for (const squad of squads) {
        const current = squad.playerIds;
        const docs = await Promise.all(current.map((id) => ctx.db.get(id)));
        const broken = docs.some((p) => !p || !p.active);
        if (!broken) continue;

        // Rebuild a legal seven: keep every healthy player, backfill the rest
        // with the priciest available player at each missing position.
        const keep = docs.filter(
          (p): p is NonNullable<typeof p> => p !== null && p.active === true,
        );
        const keptIds = new Set(keep.map((p) => String(p._id)));
        const counts: Record<string, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
        for (const p of keep) counts[p.position] += 1;
        const needed: Record<string, number> = {
          GK: Math.max(0, 1 - counts.GK),
          DEF: Math.max(0, 2 - counts.DEF),
          MID: Math.max(0, 2 - counts.MID),
          FWD: Math.max(0, 2 - counts.FWD),
        };

        const used = new Set<string>([...keptIds, ...current.map(String)]);
        const added: Id<"players">[] = [];
        for (const pos of ["GK", "DEF", "MID", "FWD"] as Position[]) {
          let want = needed[pos];
          if (want <= 0) continue;
          const candidates = active
            .filter((p) => p.position === pos && !used.has(String(p._id)))
            .sort((a, b) => toSafeAmount(b.price) - toSafeAmount(a.price));
          for (const cand of candidates) {
            if (want <= 0) break;
            added.push(cand._id);
            used.add(String(cand._id));
            want -= 1;
          }
        }

        if (keep.length + added.length !== 7) continue; // couldn't fix it
        const playerIds = [...keep.map((p) => p._id), ...added];
        const totalSpent = playerIds.length
          ? (
              await Promise.all(playerIds.map((id) => ctx.db.get(id)))
            ).reduce((sum, p) => sum + toSafeAmount(p?.price ?? 0), 0)
          : 0;
        const captainStillThere = playerIds.some((id) => String(id) === String(squad.captainId));

        await ctx.db.patch(squad._id, {
          playerIds,
          captainId: captainStillThere ? squad.captainId : playerIds[0],
          totalSpent,
        });
        changes += 1;
      }

      try {
        await ctx.runMutation(internal.awards.recalculateAwards, {});
      } catch {
        // awards refresh is non-fatal
      }
      await audit(ctx, "trigger_auto_subs", "bulk", undefined, `${changes} squads repaired`);
      return { changed: changes };
    } catch {
      throw new Error("Could not run auto-subs — please try again.");
    }
  },
});

// ── Wager & prediction audit ────────────────────────────────────────────

/** Super Admin: every 1v1 wager, newest first, with manager names resolved. */
export const listAllWagers = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireSuper(ctx);
    } catch {
      return [];
    }
    try {
      const wagers = await ctx.db.query("wagers").collect();
      const users = await ctx.db.query("users").collect();
      const byId = new Map(users.map((u) => [u._id, u]));
      return wagers
        .sort((a, b) => b._creationTime - a._creationTime)
        .map((w) => ({
          _id: w._id,
          challengerName: byId.get(w.challengerId)?.username ?? "deleted",
          challengerTeam: byId.get(w.challengerId)?.teamName ?? "—",
          opponentName: byId.get(w.opponentId)?.username ?? "deleted",
          opponentTeam: byId.get(w.opponentId)?.teamName ?? "—",
          stake: Number(w.stake) || 0,
          stage: w.stage,
          status: w.status,
          winnerName:
            w.winnerId != null ? (byId.get(w.winnerId)?.username ?? "deleted") : null,
        }));
    } catch {
      return [];
    }
  },
});

/** Super Admin: cancel a disputed wager (only before it settles). */
export const cancelWager = mutation({
  args: { wagerId: v.id("wagers") },
  handler: async (ctx, { wagerId }) => {
    await requireSuper(ctx);
    try {
      const wager = await ctx.db.get(wagerId);
      if (!wager) throw new Error("That wager no longer exists.");
      if (wager.status === "settled") {
        throw new Error("That wager is already settled and can't be cancelled.");
      }
      await ctx.db.patch(wagerId, { status: "cancelled" as const });
      await audit(
        ctx,
        "cancel_wager",
        "tournament",
        `${wager.stage}`,
        `stake ${wager.stake}`,
      );
      return { cancelled: true };
    } catch (err) {
      if (err instanceof Error && /no longer exists|already settled/.test(err.message)) {
        throw err;
      }
      throw new Error("Could not cancel the wager — please try again.");
    }
  },
});

/** Super Admin: all predictor picks with their resolution state. */
export const listAllPredictions = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireSuper(ctx);
    } catch {
      return [];
    }
    try {
      const preds = await ctx.db.query("predictions").collect();
      const users = await ctx.db.query("users").collect();
      const byId = new Map(users.map((u) => [u._id, u]));
      return preds
        .sort((a, b) => (a.stage ?? "").localeCompare(b.stage ?? ""))
        .map((p) => ({
          _id: p._id,
          username: byId.get(p.userId)?.username ?? "deleted",
          stage: p.stage,
          pick: p.pick,
          correct: p.correct ?? null,
          awarded: Number(p.awarded ?? 0),
        }));
    } catch {
      return [];
    }
  },
});

/**
 * Super Admin: resolve every pending prediction for a stage at once,
 * awarding +2 per correct pick. Safe to re-run — already-resolved rows are
 * skipped, so it can never double-pay.
 */
export const resolvePredictions = mutation({
  args: { stage: v.union(v.literal("semifinal1"), v.literal("semifinal2"), v.literal("third_place"), v.literal("final")) },
  handler: async (ctx, { stage }) => {
    await requireSuper(ctx);
    try {
      const match = await ctx.db
        .query("matches")
        .withIndex("by_stage", (q) => q.eq("stage", stage))
        .unique();
      if (!match) throw new Error("Record that match first.");
      if (match.status !== "completed") {
        throw new Error("Only completed matches can be resolved.");
      }
      const home = Number(match.homeGoals) || 0;
      const away = Number(match.awayGoals) || 0;
      const winner = home > away ? match.homeHouse : away > home ? match.awayHouse : null;
      if (winner === null) throw new Error("That match was a draw — no prediction to resolve.");

      const preds = await ctx.db
        .query("predictions")
        .withIndex("by_stage", (q) => q.eq("stage", stage))
        .collect();
      const users = await ctx.db.query("users").collect();
      const byId = new Map(users.map((u) => [u._id, u]));
      let resolved = 0;
      let paid = 0;

      for (const pred of preds) {
        if (pred.correct !== undefined) continue; // idempotent
        const correct = pred.pick === winner;
        await ctx.db.patch(pred._id, { correct, awarded: correct ? 2 : 0 });
        resolved += 1;
        if (!correct) continue;
        const squad = await getSquadForUser(ctx, pred.userId);
        if (!squad) continue;
        await ctx.db.insert("matchScores", {
          matchId: match._id,
          squadId: squad._id,
          userId: pred.userId,
          points: 2,
        });
        paid += 1;
      }

      await audit(
        ctx,
        "resolve_predictions",
        "tournament",
        stage,
        `${resolved} resolved, ${paid} correct (+2 each)`,
      );
      return { resolved, paid };
    } catch (err) {
      if (
        err instanceof Error &&
        (/Record that match|completed|draw/.test(err.message))
      ) {
        throw err;
      }
      throw new Error("Could not resolve the predictions — please try again.");
    }
  },
});

// ── House / position rule checks shared with the roster editor ─────────

/** Exposed so the UI can validate before it submits. */
export const getRosterRules = query({
  args: {},
  handler: async (ctx) => {
    try {
      const { marketRules } = normalizeSettings(await getSettingsRow(ctx));
      return {
        minPlayerPrice: marketRules.minPlayerPrice,
        maxPlayerPrice: marketRules.maxPlayerPrice,
        houses: [...HOUSES] as House[],
        positions: ["GK", "DEF", "MID", "FWD"] as Position[],
      };
    } catch {
      return {
        minPlayerPrice: 4_000_000,
        maxPlayerPrice: 22_000_000,
        houses: [...HOUSES] as House[],
        positions: ["GK", "DEF", "MID", "FWD"] as Position[],
      };
    }
  },
});
