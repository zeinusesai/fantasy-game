import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { getLeaderboardRows, requireSuperAdmin } from "./lib";
import { normalizeSection } from "./defaults";
import { SECTIONS, type Section } from "./schema";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Y11 PE Hub — Section Leaderboard + the temporary weekly "Section Champions"
 * cosmetic.
 *
 * Two things live here because they share one computation:
 *
 *   1. `getSectionLeaderboard` — the aggregate points table for Section A–H.
 *      Every manager's lifetime points are summed into their section, so a
 *      section's total is simply the sum of its members' totals.
 *
 *   2. `awardSectionChampions` — run automatically when the Super Admin
 *      CLOSES a gameweek (see convex/matches.ts). It tallies the points
 *      scored in THAT gameweek only, grouped by section, and writes a single
 *      `sectionChampions` row naming the winner.
 *
 * Expiration is structural rather than scheduled: the read path always uses
 * the row with the HIGHEST gameweek number. The instant the next gameweek is
 * closed, a newer row exists, so the previous winner's glow disappears with
 * no cleanup job and no chance of a stale badge lingering.
 */

// ── Weekly points per section ───────────────────────────────────────────

/**
 * Points scored in ONE gameweek, grouped by the scorer's PE section.
 *
 * Reads `matchScores` joined to `matches.gameweek`, so a friendly that was
 * never attached to a gameweek contributes nothing. Returns a plain map from
 * section → points, containing only sections that actually scored.
 */
async function weeklyPointsBySection(ctx: QueryCtx | MutationCtx, gameweek: number) {
  const totals = new Map<string, number>();
  try {
    const matches = await ctx.db.query("matches").collect();
    const matchGameweek = new Map<string, number>();
    for (const m of matches) {
      if (typeof m.gameweek === "number") {
        matchGameweek.set(String(m._id), m.gameweek);
      }
    }
    const scores = await ctx.db.query("matchScores").collect();
    const users = await ctx.db.query("users").collect();
    const sectionByUser = new Map<string, Section>();
    for (const u of users) {
      const section = normalizeSection(u.section);
      if (section) sectionByUser.set(String(u._id), section);
    }

    for (const s of scores) {
      const gw = matchGameweek.get(String(s.matchId));
      if (gw !== gameweek) continue;
      const section = sectionByUser.get(String(s.userId));
      if (!section) continue; // manager without a section can't win one
      totals.set(section, (totals.get(section) ?? 0) + (Number(s.points) || 0));
    }
  } catch {
    // Storage hiccup → "no points this week" rather than a rejected query.
  }
  return totals;
}

/**
 * The currently-active weekly cosmetic, or `null`.
 *
 * "Active" = the newest `sectionChampions` row, and only while a later
 * gameweek has not already been closed. Because a new row is written on every
 * closure, this single lookup is both the award AND the expiry check.
 */
export async function readActiveSectionChampion(ctx: QueryCtx | MutationCtx) {
  try {
    const rows = await ctx.db.query("sectionChampions").collect();
    if (rows.length === 0) return null;
    // Highest gameweek wins; the id breaks a (theoretically impossible) tie.
    let best = rows[0];
    for (const r of rows) {
      if (r.gameweek > best.gameweek) best = r;
      else if (r.gameweek === best.gameweek && r._id > best._id) best = r;
    }
    const section = normalizeSection(best.section);
    if (!section) return null;
    return {
      gameweek: best.gameweek,
      section,
      totalPoints: best.totalPoints,
      managerCount: best.managerCount,
      awardedAt: best.awardedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Tally one closed gameweek and persist the winning section.
 *
 * Shared by the automatic path (`awardSectionChampions`, fired on gameweek
 * closure) and the manual re-run in the Admin panel, so both can never drift.
 *
 * Idempotent per gameweek: re-running for the same gameweek REPLACES that
 * game's row rather than stacking duplicates, so a double-click on "Close GW2"
 * can never leave two winners.
 *
 * Total: any storage failure returns `{ awarded: false }` so a cosmetic problem
 * can never block the gameweek closure itself.
 */
async function computeAndWriteChampion(
  ctx: MutationCtx,
  gameweek: number,
): Promise<
  | { awarded: true; gameweek: number; section: Section; totalPoints: number; managerCount: number }
  | { awarded: false; reason?: string }
> {
  const gw = Number(gameweek);
  if (!Number.isFinite(gw) || gw < 1) return { awarded: false, reason: "bad gameweek" };

  // An open gameweek has not been played — awarding now would crown a section
  // on zero points.
  const gwRows = await ctx.db.query("seasonGameweeks").collect();
  const gwRow = gwRows.find((r) => r.number === gw);
  if (gwRow && gwRow.status !== "closed") {
    return { awarded: false, reason: "gameweek is not closed" };
  }

  const weekly = await weeklyPointsBySection(ctx, gw);
  if (weekly.size === 0) return { awarded: false, reason: "no points scored" };

  // Highest points wins. Ties break alphabetically by section so the award is
  // deterministic rather than dependent on map iteration order.
  let winner: Section | null = null;
  let best = -Infinity;
  for (const section of SECTIONS) {
    const points = weekly.get(section);
    if (points === undefined) continue;
    if (points > best) {
      best = points;
      winner = section;
    }
  }
  if (!winner) return { awarded: false, reason: "no points scored" };

  // How many managers actually scored for the winning section this week — the
  // number shown on the cosmetic ("5 managers earned it").
  const scores = await ctx.db.query("matchScores").collect();
  const matches = await ctx.db.query("matches").collect();
  const matchGameweek = new Map<string, number>();
  for (const m of matches) {
    if (typeof m.gameweek === "number") matchGameweek.set(String(m._id), m.gameweek);
  }
  const users = await ctx.db.query("users").collect();
  const sectionByUser = new Map<string, Section>();
  for (const u of users) {
    const section = normalizeSection(u.section);
    if (section) sectionByUser.set(String(u._id), section);
  }
  const contributing = new Set<string>();
  for (const s of scores) {
    if (matchGameweek.get(String(s.matchId)) !== gw) continue;
    if (sectionByUser.get(String(s.userId)) === winner) {
      contributing.add(String(s.userId));
    }
  }

  const totalPoints = weekly.get(winner) ?? 0;
  const managerCount = contributing.size;

  // Replace this gameweek's row if it already exists (idempotent re-run).
  const prior = await ctx.db.query("sectionChampions").collect();
  for (const row of prior) {
    if (row.gameweek === gw) await ctx.db.delete(row._id);
  }
  await ctx.db.insert("sectionChampions", {
    gameweek: gw,
    section: winner,
    totalPoints,
    managerCount,
    awardedAt: Date.now(),
  });

  return { awarded: true, gameweek: gw, section: winner, totalPoints, managerCount };
}

/**
 * Internal: award the "Section Champions" cosmetic for a closed gameweek.
 * Fired by `matches.setSeasonGameweekStatus` when the Super Admin closes one.
 */
export const awardSectionChampions = internalMutation({
  args: { gameweek: v.number() },
  handler: async (ctx, { gameweek }) => {
    try {
      return await computeAndWriteChampion(ctx, gameweek);
    } catch {
      // Never block a gameweek closure on a cosmetic write.
      return { awarded: false as const, reason: "storage error" };
    }
  },
});

/**
 * Super Admin: manually re-run the award for an already-closed gameweek.
 *
 * Needed after a late points correction or a section change — the gameweek
 * must already be `closed`, which is the same guard the automatic path uses.
 */
export const recomputeSectionChampion = mutation({
  args: { gameweek: v.number() },
  handler: async (ctx, { gameweek }) => {
    await requireSuperAdmin(ctx);
    return computeAndWriteChampion(ctx, gameweek);
  },
});

/**
 * Super Admin: revoke the active "Section Champions" cosmetic entirely.
 *
 * The escape hatch for a wrongly-awarded week — e.g. points were corrected
 * after the gameweek closed, or the winning section itself was wrong. Deleting
 * the rows makes the read path fall back to "no champion" immediately, which is
 * the same neutral state a pre-season platform is in.
 */
export const clearSectionChampion = mutation({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);
    const rows = await ctx.db.query("sectionChampions").collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return { cleared: rows.length };
  },
});

// ── Public section leaderboard ──────────────────────────────────────────

export type SectionStanding = {
  section: Section;
  totalPoints: number;
  managerCount: number;
  /** Points scored in the most recently closed gameweek. */
  weeklyPoints: number;
  rank: number;
  /** True while this section holds the "Section Champions" cosmetic. */
  isChampion: boolean;
  /** Top managers in the section, already sorted by points descending. */
  members: Array<{
    userId: Id<"users">;
    username: string;
    teamName: string;
    avatar: string | null;
    totalPoints: number;
  }>;
};

/**
 * The Section Leaderboard: Section A–H ranked by the aggregate points of every
 * manager in them.
 *
 * Always returns all eight sections, even empty ones (at 0 points / 0
 * managers), so the table has a stable shape from day one and a brand-new
 * section never makes the grid jump around. Members are capped per section so
 * a single large section cannot blow the response size.
 *
 * `weeklyPoints` is the section's haul in the most recently CLOSED gameweek —
 * the same figure the cosmetic is decided on, so the card shows exactly what
 * it was judged on.
 */
export const getSectionLeaderboard = query({
  args: { membersPerSection: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cap = (() => {
      const n = Number(args.membersPerSection ?? 5);
      if (!Number.isFinite(n)) return 5;
      return Math.min(20, Math.max(1, Math.floor(n)));
    })();

    const champion = await readActiveSectionChampion(ctx);

    // Points per manager, straight from the shared leaderboard so the two
    // tabs can never disagree about a total.
    const rows = await getLeaderboardRows(ctx);
    let users: Doc<"users">[] = [];
    try {
      users = await ctx.db.query("users").collect();
    } catch {
      users = [];
    }
    const byId = new Map(users.map((u) => [u._id, u]));

    // Weekly points per section for the most recently closed gameweek.
    let weekly = new Map<string, number>();
    try {
      const gwRows = await ctx.db.query("seasonGameweeks").collect();
      const closedNumbers = gwRows
        .filter((r) => r.status === "closed")
        .map((r) => r.number);
      const latestClosed = closedNumbers.length
        ? Math.max(...closedNumbers)
        : null;
      if (latestClosed !== null) {
        weekly = await weeklyPointsBySection(ctx, latestClosed);
      }
    } catch {
      weekly = new Map();
    }

    type Member = SectionStanding["members"][number];
    const membersBySection = new Map<Section, Member[]>();
    const totalsBySection = new Map<Section, number>();

    for (const row of rows) {
      const user = byId.get(row.userId);
      const section = normalizeSection(user?.section);
      if (!section) continue; // no section → not on the section board
      totalsBySection.set(section, (totalsBySection.get(section) ?? 0) + row.total);
      const list = membersBySection.get(section) ?? [];
      list.push({
        userId: row.userId,
        username: user?.username ?? "?",
        teamName: user?.teamName ?? "Unnamed team",
        avatar: user?.image ?? null,
        totalPoints: row.total,
      });
      membersBySection.set(section, list);
    }

    const standings: SectionStanding[] = SECTIONS.map((section) => {
      const members = (membersBySection.get(section) ?? [])
        .sort((a, b) =>
          b.totalPoints !== a.totalPoints
            ? b.totalPoints - a.totalPoints
            : a.username.localeCompare(b.username),
        )
        .slice(0, cap);
      return {
        section,
        totalPoints: totalsBySection.get(section) ?? 0,
        managerCount: membersBySection.get(section)?.length ?? 0,
        weeklyPoints: weekly.get(section) ?? 0,
        // Filled in below once the ordering is known.
        rank: 0,
        isChampion: champion?.section === section,
        members,
      };
    });

    standings.sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      return a.section.localeCompare(b.section);
    });
    standings.forEach((s, i) => {
      s.rank = i + 1;
    });

    return { standings, champion, sections: [...SECTIONS] };
  },
});

/**
 * The active "Section Champions" cosmetic on its own — a tiny query the
 * leaderboard rows, the public profile and the dashboard can all subscribe to
 * without pulling the whole section table.
 */
export const getSectionChampion = query({
  args: {},
  handler: async (ctx) => readActiveSectionChampion(ctx),
});