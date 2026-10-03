// ── Achievement-based cosmetic reward engine (PURE) ──────────────────────
//
// WHY THIS MODULE EXISTS
// The platform used to sell cosmetics and gameplay buffs for cash. Both are
// gone. EVERY cosmetic is now an EARNED reward: it can only be unlocked by
// finishing on a gameweek podium or by hitting an in-game feat. Nothing here
// touches money, and nothing here touches the budget or the chip allocation —
// those are fixed and identical for every manager.
//
// This module is the SINGLE source of truth for:
//   1. the cosmetic catalogue and its tiers,
//   2. the GW1 podium cut and the Super-Admin roll-down rule,
//   3. every feat's unlock condition and its progress fraction,
//   4. the deterministic tie-breaker used to rank managers.
//
// It is PURE — no Convex imports, no database access, no side effects — so the
// server that AWARDS a cosmetic and the client that DISPLAYS progress toward
// one can never disagree. Every exported function is TOTAL: it never throws and
// never returns NaN, so a corrupt row or a half-built snapshot degrades to
// "not unlocked yet" instead of breaking a page.

import type { Stage } from "./schema";

// ── Cosmetic catalogue ───────────────────────────────────────────────────

/** What slot a cosmetic occupies. One equipped cosmetic per slot. */
export const COSMETIC_SLOTS = [
  "border",
  "kit",
  "pitch",
  "badge",
  "title",
  "glow",
] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

/**
 * Reward tier. Drives the ordering and the visual treatment in the showcase.
 *  • podium   — awarded purely for a gameweek podium finish
 *  • feat     — awarded for a specific in-game feat
 *  • legacy   — a cosmetic that existed before the earn-only rule; retained so
 *               nothing already unlocked is taken away
 */
export const REWARD_TIERS = ["podium", "feat", "legacy"] as const;
export type RewardTier = (typeof REWARD_TIERS)[number];

export type CosmeticId =
  // ── Podium ──
  | "gw1_podium_border"
  | "pacesetter_badge"
  // ── Feats ──
  | "tactical_mastermind_pitch"
  | "golden_boot_kit"
  | "iron_defence_glow"
  | "bargain_hunter_badge"
  | "clutch_performer_title"
  // ── Legacy cosmetics, retained and now earnable like everything else ──
  | "custom_title"
  | "profile_border"
  | "golden_theme";

export interface CosmeticDef {
  id: CosmeticId;
  name: string;
  blurb: string;
  slot: CosmeticSlot;
  tier: RewardTier;
  /** Lucide icon key the showcase maps to a component. */
  icon:
    | "border"
    | "kit"
    | "pitch"
    | "badge"
    | "title"
    | "glow"
    | "crown";
  /** Tailwind gradient classes for the card. */
  accent: string;
  /**
   * For tier "feat": the id of the feat that unlocks this. For tier "podium":
   * which podium set it belongs to. `null` for legacy items, which are
   * unlocked by any of the `LEGACY_UNLOCK_FEATS` feats.
   */
  unlockKey: string | null;
}

/**
 * The full catalogue.
 *
 * Ordering is meaningful: podium items first, then feats, then the retained
 * legacy cosmetics. The showcase renders it in this order so the rarest
 * rewards read first.
 */
export const COSMETICS: readonly CosmeticDef[] = [
  {
    id: "gw1_podium_border",
    name: "GW1 Podium Border",
    blurb:
      "An animated champion frame. Awarded to the top three managers of Gameweek 1.",
    slot: "border",
    tier: "podium",
    icon: "crown",
    accent: "from-amber-400/30 via-yellow-500/20 to-orange-500/20",
    unlockKey: "gw1_podium",
  },
  {
    id: "pacesetter_badge",
    name: "Pacesetter",
    blurb:
      "The early-king badge. Awarded to every Gameweek 1 podium finisher.",
    slot: "badge",
    tier: "podium",
    icon: "badge",
    accent: "from-sky-400/25 to-cyan-500/15",
    unlockKey: "gw1_podium",
  },
  {
    id: "tactical_mastermind_pitch",
    name: "Tactical Mastermind",
    blurb:
      "A commander's tactical pitch theme. Awarded for the highest single-gameweek points in the entire league.",
    slot: "pitch",
    tier: "feat",
    icon: "pitch",
    accent: "from-violet-400/25 to-fuchsia-500/15",
    unlockKey: "tactical_mastermind",
  },
  {
    id: "golden_boot_kit",
    name: "Golden Boot Kit",
    blurb:
      "A striker's kit skin. Awarded when your captain scores 3+ goals in a gameweek.",
    slot: "kit",
    tier: "feat",
    icon: "kit",
    accent: "from-yellow-300/30 to-amber-500/15",
    unlockKey: "golden_boot",
  },
  {
    id: "iron_defence_glow",
    name: "Iron Defence",
    blurb:
      "A steel name glow for the chat and leaderboard. Awarded when every starting defender and keeper keeps a clean sheet in a gameweek.",
    slot: "glow",
    tier: "feat",
    icon: "glow",
    accent: "from-slate-300/25 to-zinc-500/15",
    unlockKey: "iron_defence",
  },
  {
    id: "bargain_hunter_badge",
    name: "Bargain Hunter",
    blurb:
      "Awarded for winning a gameweek matchup while spending under 85% of the budget.",
    slot: "badge",
    tier: "feat",
    icon: "badge",
    accent: "from-emerald-400/25 to-teal-500/15",
    unlockKey: "bargain_hunter",
  },
  {
    id: "clutch_performer_title",
    name: "Clutch Performer",
    blurb:
      "A manager title. Awarded when your substitutes contribute 20+ points in a gameweek.",
    slot: "title",
    tier: "feat",
    icon: "title",
    accent: "from-rose-400/25 to-pink-500/15",
    unlockKey: "clutch_performer",
  },
  {
    id: "custom_title",
    name: "Custom Manager Title",
    blurb: "Set your own title beside your name on the leaderboard.",
    slot: "title",
    tier: "legacy",
    icon: "title",
    accent: "from-violet-500/20 to-fuchsia-500/10",
    unlockKey: null,
  },
  {
    id: "profile_border",
    name: "Classic Profile Border",
    blurb: "An animated glowing frame around your profile avatar.",
    slot: "border",
    tier: "legacy",
    icon: "border",
    accent: "from-orange-500/20 to-amber-500/10",
    unlockKey: null,
  },
  {
    id: "golden_theme",
    name: "Golden Jersey & Pitch",
    blurb: "A gold pitch and jersey aesthetic for your squad.",
    slot: "pitch",
    tier: "legacy",
    icon: "pitch",
    accent: "from-yellow-400/25 to-amber-500/10",
    unlockKey: null,
  },
] as const;

/** Every cosmetic id, handy for validation without importing the objects. */
export const COSMETIC_IDS: readonly CosmeticId[] = COSMETICS.map((c) => c.id);

/**
 * Look up a cosmetic by id. TOTAL — never throws; returns `null` for
 * null/undefined, non-strings, junk strings and unknown ids, so an
 * attacker-supplied id can never reach the database.
 */
export function cosmeticById(id: unknown): CosmeticDef | null {
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  return COSMETICS.find((c) => c.id === trimmed) ?? null;
}

/** True when the id belongs to the catalogue. */
export function isCosmeticId(id: unknown): id is CosmeticId {
  return cosmeticById(id) !== null;
}

/**
 * Emoji shown beside a manager's name for an equipped BADGE cosmetic.
 *
 * Kept here (not in a component) so the leaderboard, the profile modal and the
 * showcase can never disagree about which symbol a badge is. TOTAL — an
 * unknown id falls back to a neutral trophy rather than rendering nothing, so
 * an earned badge is never invisible.
 */
const BADGE_EMOJI: Record<string, string> = {
  pacesetter_badge: "\u{1F451}",
  bargain_hunter_badge: "\u{1F9F8}",
};

export function cosmeticEmoji(id: unknown): string {
  const def = cosmeticById(id);
  if (def && def.slot === "badge") return BADGE_EMOJI[def.id] ?? "\u{1F3C6}";
  return "\u{1F3C6}";
}

/** Every cosmetic that fills one slot. */
export function cosmeticsForSlot(slot: unknown): CosmeticDef[] {
  if (typeof slot !== "string") return [];
  return COSMETICS.filter((c) => c.slot === slot);
}

// ── Reward thresholds ────────────────────────────────────────────────────

/** How many managers reach the podium. */
export const PODIUM_SIZE = 3;

/**
 * Extra winners pulled in when the Super Admin takes a podium place.
 *
 * The Super Admin IS eligible to compete, rank and unlock cosmetics — they are
 * not exempt from anything. But the podium allocation is a fixed number of
 * slots, so if they take one of the top three, the next manager down (4th) is
 * rolled in so the podium still awards `PODIUM_SIZE + 1` real places.
 */
export const ROLL_DOWN_EXTRA = 1;

/** Captain goals needed in a single gameweek for the Golden Boot kit. */
export const GOLDEN_BOOT_CAPTAIN_GOALS = 3;

/**
 * Fraction of the budget a manager must stay under for Bargain Hunter.
 * 0.85 of the fixed budget — the budget itself is identical for everyone, so
 * this is purely about how the manager spent it.
 */
export const BARGAIN_HUNTER_SPEND_FRACTION = 0.85;

/** Substitute points needed in a single gameweek for the Clutch title. */
export const CLUTCH_BENCH_POINTS = 20;

/**
 * Feat ids. Kept as a const object so a typo in a `unlockKey` is a type error
 * rather than a cosmetic that silently never unlocks.
 */
export const FEATS = {
  TACTICAL_MASTERMIND: "tactical_mastermind",
  GOLDEN_BOOT: "golden_boot",
  IRON_DEFENCE: "iron_defence",
  BARGAIN_HUNTER: "bargain_hunter",
  CLUTCH_PERFORMER: "clutch_performer",
  GW1_PODIUM: "gw1_podium",
} as const;
export type FeatId = (typeof FEATS)[keyof typeof FEATS];

export interface FeatDefinition {
  id: string;
  name: string;
  description: string;
  /** Human-readable target, e.g. "3 goals". */
  target: string;
}

export const FEAT_DEFINITIONS: readonly FeatDefinition[] = [
  {
    id: FEATS.GW1_PODIUM,
    name: "GW1 Podium",
    description:
      "Finish in the top three of the Gameweek 1 leaderboard. If the Super Admin takes a podium place, fourth place is rolled in too.",
    target: `Top ${PODIUM_SIZE}`,
  },
  {
    id: FEATS.TACTICAL_MASTERMIND,
    name: "Tactical Mastermind",
    description:
      "Score the highest points of any manager in a single gameweek.",
    target: "Highest in league",
  },
  {
    id: FEATS.GOLDEN_BOOT,
    name: "Golden Boot",
    description: `Your captain scores ${GOLDEN_BOOT_CAPTAIN_GOALS}+ goals in a gameweek.`,
    target: `${GOLDEN_BOOT_CAPTAIN_GOALS}+ goals`,
  },
  {
    id: FEATS.IRON_DEFENCE,
    name: "Iron Defence",
    description:
      "Every starting defender and your goalkeeper keep a clean sheet in a gameweek.",
    target: "Full XI clean sheet",
  },
  {
    id: FEATS.BARGAIN_HUNTER,
    name: "Bargain Hunter",
    description:
      "Win a gameweek matchup while spending under 85% of the budget.",
    target: "Under 85% spent",
  },
  {
    id: FEATS.CLUTCH_PERFORMER,
    name: "Clutch Performer",
    description:
      "Your substitutes contribute 20+ points in a gameweek.",
    target: `${CLUTCH_BENCH_POINTS}+ bench pts`,
  },
] as const;

/** Look up a feat definition. TOTAL — `null` for anything unknown. */
export function featById(id: unknown): FeatDefinition | null {
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  return FEAT_DEFINITIONS.find((f) => f.id === trimmed) ?? null;
}

// ── Deterministic ranking ────────────────────────────────────────────────

/** A single manager's standing in one leaderboard. */
export interface Standing {
  userId: string;
  points: number;
  /**
   * When the manager first appeared (squad creation time). Used ONLY as a
   * tie-breaker so the order is stable and explainable rather than dependent
   * on database iteration order.
   */
  firstSeen: number;
}

/**
 * Rank managers by points, breaking ties deterministically.
 *
 * Higher points wins. On a tie the manager who registered earliest wins (the
 * squad that existed first), and finally the user id is compared as a last
 * resort so two rows can never compare equal — which is what keeps the podium
 * cut free of ties and keeps the Super-Admin roll-down deterministic.
 *
 * Returns a NEW array; never mutates the input and never throws.
 */
export function rankStandings(standings: readonly Standing[]): Standing[] {
  const safe = (standings ?? []).filter(
    (s): s is Standing => Boolean(s) && typeof s.userId === "string",
  );
  return safe.slice().sort((a, b) => {
    const pa = Number.isFinite(a.points) ? a.points : 0;
    const pb = Number.isFinite(b.points) ? b.points : 0;
    if (pb !== pa) return pb - pa;
    const fa = Number.isFinite(a.firstSeen) ? a.firstSeen : 0;
    const fb = Number.isFinite(b.firstSeen) ? b.firstSeen : 0;
    if (fa !== fb) return fa - fb;
    return String(a.userId).localeCompare(String(b.userId));
  });
}

// ── GW1 podium + Super-Admin roll-down ───────────────────────────────────

/** One awarded podium place. */
export interface PodiumAward {
  userId: string;
  /** 1-based finishing position in the gameweek leaderboard. */
  rank: number;
  points: number;
  /** True when this place exists only because of the roll-down rule. */
  rolledIn: boolean;
  /** True when the recipient is the Super Admin. */
  isSuperAdmin: boolean;
}

export interface PodiumResult {
  awards: PodiumAward[];
  /**
   * True when the Super Admin finished inside the top three, so the
   * allocation was rolled down to include fourth place as well.
   */
  rollDownApplied: boolean;
  /** How many places were awarded in total (3, or 4 after a roll-down). */
  slotCount: number;
  /** Cosmetic ids every podium winner receives. */
  cosmetics: CosmeticId[];
}

/** The cosmetic ids a GW1 podium finisher receives. */
export const PODIUM_COSMETICS: readonly CosmeticId[] = [
  "gw1_podium_border",
  "pacesetter_badge",
];

/**
 * Resolve the GW1 podium from a ranked-or-unranked standings list, applying
 * the Super-Admin roll-down rule.
 *
 * RULE (as specified): the Super Admin IS eligible to compete, rank and unlock
 * cosmetics. If they finish inside the top three they receive the podium items
 * like anyone else — and because the podium has a fixed number of places, the
 * next manager down (4th) is rolled in so a place is never left unallocated.
 *
 * TOTAL: an empty or malformed standings list yields zero awards (nobody has
 * scored, so nobody has podiumed). It never throws.
 */
export function computeGw1Podium(
  standings: readonly Standing[],
  superAdminUserId: string | null | undefined,
): PodiumResult {
  const ranked = rankStandings(standings);
  if (ranked.length === 0) {
    return {
      awards: [],
      rollDownApplied: false,
      slotCount: PODIUM_SIZE,
      cosmetics: [...PODIUM_COSMETICS],
    };
  }

  const superId =
    typeof superAdminUserId === "string" && superAdminUserId.trim() !== ""
      ? superAdminUserId.trim()
      : null;

  const podium = ranked.slice(0, PODIUM_SIZE);
  const superInPodium =
    superId !== null && podium.some((s) => s.userId === superId);
  const rollDownApplied = superInPodium;

  // How many places we actually hand out: the normal three, plus one more
  // when the Super Admin took a place.
  const slotCount = PODIUM_SIZE + (rollDownApplied ? ROLL_DOWN_EXTRA : 0);
  const winners = ranked.slice(0, slotCount);

  const awards: PodiumAward[] = winners.map((s, index) => ({
    userId: s.userId,
    rank: index + 1,
    points: Number.isFinite(s.points) ? s.points : 0,
    rolledIn: rollDownApplied && index >= PODIUM_SIZE,
    isSuperAdmin: superId !== null && s.userId === superId,
  }));

  return {
    awards,
    rollDownApplied,
    slotCount: Math.min(slotCount, winners.length),
    cosmetics: [...PODIUM_COSMETICS],
  };
}

// ── Per-gameweek feat evaluation ─────────────────────────────────────────

/**
 * Everything the feat rules need to know about one manager in one gameweek.
 *
 * The caller (the server) assembles this from `matchScores`, `matchPlayers`,
 * `squads` and `matches`; the pure rules below then decide what it unlocks.
 * Every field is read defensively — a missing value is treated as "did not
 * happen" rather than as a crash.
 */
export interface ManagerGameweekSnapshot {
  userId: string;
  /** 1 or 2. */
  gameweek: number;
  /** Total fantasy points this manager banked in the gameweek. */
  points: number;
  /** Goals scored by the manager's chosen captain in the gameweek. */
  captainGoals: number;
  /** How many starting defenders + keeper kept a clean sheet. */
  cleanSheetDefenders: number;
  /** How many starting defenders + keeper there were to keep one. */
  cleanSheetOpponents: number;
  /** Fantasy points from substitutes (players who came off the bench). */
  benchPoints: number;
  /** What the manager spent on the squad, in raw dollars. */
  totalSpent: number;
  /** The fixed budget every manager shares. */
  budget: number;
  /** True when this manager topped the gameweek outright. */
  isGameweekWinner: boolean;
  /**
   * The highest single-gameweek points scored by ANY manager in this gameweek.
   * Needed for "highest in the league", which is a league-wide comparison and
   * therefore cannot be decided from a single manager's own numbers.
   */
  leagueBestPoints: number;
}

const safeNum = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** A feat's unlock state for the showcase: unlocked, and how close they are. */
export interface FeatProgress {
  featId: string;
  unlocked: boolean;
  /** 0..1, clamped. `1` when unlocked. */
  progress: number;
  /** A short human line describing the current standing. */
  detail: string;
}

const ratio = (have: number, need: number): number => {
  if (!Number.isFinite(need) || need <= 0) return 1;
  return Math.min(1, Math.max(0, have / need));
};

/**
 * Evaluate every per-gameweek feat for one manager/gameweek.
 *
 * Rules, exactly as specified:
 *   • Tactical Mastermind — highest points in a single gameweek league-wide.
 *     Requires a STRICT win so two managers tied on the same total does not
 *     hand the same exclusive skin to both.
 *   • Golden Boot — the captain scores 3+ goals in a single gameweek.
 *   • Iron Defence — every starting defender AND the goalkeeper keep a clean
 *     sheet. Requires at least one defender/keeper to be tracked, so an empty
 *     lineup can never "achieve" a clean sheet.
 *   • Bargain Hunter — win a gameweek matchup while spending under 85% of the
 *     budget.
 *   • Clutch Performer — substitutes contribute 20+ points in a gameweek.
 *
 * Returns the cosmetics unlocked by THIS snapshot (not cumulative) plus the
 * progress toward each, which the showcase renders as a progress bar.
 *
 * TOTAL: never throws.
 */
export function evaluateGameweekSnapshot(snapshot: ManagerGameweekSnapshot): {
  unlocked: CosmeticId[];
  progress: FeatProgress[];
} {
  const s = snapshot ?? ({} as ManagerGameweekSnapshot);
  const points = safeNum(s.points);
  const captainGoals = safeNum(s.captainGoals);
  const cleanDef = safeNum(s.cleanSheetDefenders);
  const cleanOpp = safeNum(s.cleanSheetOpponents);
  const benchPoints = safeNum(s.benchPoints);
  const spent = safeNum(s.totalSpent);
  const budget = safeNum(s.budget);
  const spendLimit = budget * BARGAIN_HUNTER_SPEND_FRACTION;
  const leagueBest = safeNum(s.leagueBestPoints);

  // ── Tactical Mastermind ──
  const tacticalUnlocked =
    points > 0 && leagueBest > 0 && points >= leagueBest;

  // ── Golden Boot ──
  const goldenBootUnlocked = captainGoals >= GOLDEN_BOOT_CAPTAIN_GOALS;

  // ── Iron Defence ──
  const ironDefenceUnlocked = cleanOpp > 0 && cleanDef >= cleanOpp;

  // ── Bargain Hunter ──
  const underBudget = budget > 0 && spent < spendLimit;
  const bargainUnlocked = s.isGameweekWinner === true && underBudget;

  // ── Clutch Performer ──
  const clutchUnlocked = benchPoints >= CLUTCH_BENCH_POINTS;

  const unlocked: CosmeticId[] = [];
  if (tacticalUnlocked) unlocked.push("tactical_mastermind_pitch");
  if (goldenBootUnlocked) unlocked.push("golden_boot_kit");
  if (ironDefenceUnlocked) unlocked.push("iron_defence_glow");
  if (bargainUnlocked) unlocked.push("bargain_hunter_badge");
  if (clutchUnlocked) unlocked.push("clutch_performer_title");

  const progress: FeatProgress[] = [
    {
      featId: FEATS.TACTICAL_MASTERMIND,
      unlocked: tacticalUnlocked,
      progress: tacticalUnlocked
        ? 1
        : leagueBest > 0
          ? ratio(points, leagueBest)
          : 0,
      detail: tacticalUnlocked
        ? `Led the league with ${points} points.`
        : leagueBest > 0
          ? `${points} pts · best in league is ${leagueBest}.`
          : "No gameweek scored yet.",
    },
    {
      featId: FEATS.GOLDEN_BOOT,
      unlocked: goldenBootUnlocked,
      progress: ratio(captainGoals, GOLDEN_BOOT_CAPTAIN_GOALS),
      detail: goldenBootUnlocked
        ? `Captain scored ${captainGoals} goals.`
        : `Captain: ${captainGoals} of ${GOLDEN_BOOT_CAPTAIN_GOALS} goals.`,
    },
    {
      featId: FEATS.IRON_DEFENCE,
      unlocked: ironDefenceUnlocked,
      progress: ratio(cleanDef, Math.max(1, cleanOpp)),
      detail:
        cleanOpp <= 0
          ? "No starting defenders tracked for this gameweek."
          : ironDefenceUnlocked
            ? `All ${cleanOpp} defenders kept a clean sheet.`
            : `${cleanDef} of ${cleanOpp} defenders kept a clean sheet.`,
    },
    {
      featId: FEATS.BARGAIN_HUNTER,
      unlocked: bargainUnlocked,
      progress: underBudget ? ratio(spent, Math.max(1, spendLimit)) : 1,
      detail: bargainUnlocked
        ? `Won the gameweek spending ${formatSpend(spent)} of ${formatSpend(budget)}.`
        : !underBudget
          ? `Spent ${formatSpend(spent)} — over the ${Math.round(
              BARGAIN_HUNTER_SPEND_PCT,
            )}% limit.`
          : "Under budget, but didn't win the gameweek.",
    },
    {
      featId: FEATS.CLUTCH_PERFORMER,
      unlocked: clutchUnlocked,
      progress: ratio(benchPoints, CLUTCH_BENCH_POINTS),
      detail: clutchUnlocked
        ? `Substitutes contributed ${benchPoints} points.`
        : `Bench: ${benchPoints} of ${CLUTCH_BENCH_POINTS} points.`,
    },
  ];

  return { unlocked, progress };
}

/** Convenience: the percentage form of the spend limit, for copy. */
export const BARGAIN_HUNTER_SPEND_PCT = BARGAIN_HUNTER_SPEND_FRACTION * 100;

/** Raw-dollar formatting used only in detail copy. Total for any input. */
function formatSpend(value: number): string {
  const n = safeNum(value);
  if (n <= 0) return "$0";
  return `$${Math.round(n / 1_000_000)}m`;
}

// ── Gameweek labels ──────────────────────────────────────────────────────

/** The stages belonging to a gameweek, from the fixed tournament structure. */
export const GW1_STAGES: readonly Stage[] = ["semifinal1", "semifinal2"];

/** Human label for a gameweek number. Safe for any input. */
export function gameweekName(n: unknown): string {
  return n === 1 ? "Gameweek 1" : n === 2 ? "Gameweek 2" : "Tournament";
}

/**
 * Which gameweek a stage belongs to. `1` / `2`, or `null` for a stage outside
 * the tournament structure (the legacy `group_stage`) so a stray stage can
 * never be silently scored as a gameweek.
 */
export function gameweekForStage(stage: unknown): 1 | 2 | null {
  if (typeof stage !== "string") return null;
  if (GW1_STAGES.includes(stage as Stage)) return 1;
  if (stage === "third_place" || stage === "final") return 2;
  return null;
}