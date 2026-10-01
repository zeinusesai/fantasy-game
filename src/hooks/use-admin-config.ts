import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { HOUSES } from "@/lib/fantasy";
import {
  APP_DEFAULTS,
  DEFAULT_HOUSES,
  DEFAULT_MARKET_RULES,
  DEFAULT_SCORING_RULES,
  type AwardDef,
  type HouseBrand,
  type ScoringRules,
} from "@/convex/defaults";

// ── Global customization, client side ────────────────────────────────────
//
// Every consumer reads global settings through this hook, which layers a
// complete set of defaults UNDER whatever the server returns. That means a
// loading query, a rejected query, a partially-written config row or a
// brand-new deployment all resolve to the same usable shape:
//
//   const { houseName, awardFor, isEnded } = useAdminConfig();
//   houseName("Fire")            // → "Fire" or the custom rename
//   awardFor("tacticalGenius")   // → { title, description }
//   isEnded                      // → false until Zein ends it
//
// No consumer ever needs `?? "..."` on these values; the fallback lives here,
// in one place, once.

export const FALLBACK_HOUSE_NAMES: Record<string, string> = {
  Fire: "Fire",
  Earth: "Earth",
  Wind: "Wind",
  Water: "Water",
};

export const FALLBACK_HOUSES: Record<string, HouseBrand> = { ...DEFAULT_HOUSES };

export const FALLBACK_AWARD_TITLES: Record<
  string,
  { title: string; description: string }
> = {
  tacticalGenius: {
    title: "Tactical Genius",
    description: "Highest total points of the tournament.",
  },
  unluckyManager: {
    title: "Unlucky Manager",
    description: "Lowest total points of the tournament.",
  },
  differentialMaster: {
    title: "Differential Master",
    description: "Most points from players owned by under 15% of managers.",
  },
  playerOfTheWeek: {
    title: "Player of the Week",
    description: "Highest-scoring player of the latest gameweek.",
  },
};

export const FALLBACK_BADGES: Record<string, AwardDef> = {
  tacticalGenius: { title: "Tactical Genius", icon: "🧠", description: "Highest total points of the tournament.", threshold: 0 },
  unluckyManager: { title: "Unlucky Manager", icon: "💔", description: "Lowest total points of the tournament.", threshold: 0 },
  differentialMaster: { title: "Differential Master", icon: "🎯", description: "Most points from players owned by under 15% of managers.", threshold: 0 },
  playerOfTheWeek: { title: "Player of the Week", icon: "👑", description: "Highest-scoring player of the latest gameweek.", threshold: 0 },
  goldenBoot: { title: "Golden Boot", icon: "🥾", description: "Top goalscorer of the tournament.", threshold: 0 },
  goldenGlove: { title: "Golden Glove", icon: "🧤", description: "Most clean sheets by a goalkeeper or defender.", threshold: 0 },
};

export const FALLBACK_MARKET_RULES = { ...DEFAULT_MARKET_RULES };
export const FALLBACK_SCORING_RULES: ScoringRules = { ...DEFAULT_SCORING_RULES };

export const FALLBACK_BADGE_REGISTRY: Record<
  string,
  { emoji: string; label: string; tone: string }
> = {
  star: { emoji: "⭐", label: "Star", tone: "amber" },
  gold_checkmark: { emoji: "✅", label: "Gold Checkmark", tone: "amber" },
  fire: { emoji: "🔥", label: "Fire", tone: "orange" },
  crown: { emoji: "👑", label: "Crown", tone: "yellow" },
  shield: { emoji: "🛡️", label: "Shield", tone: "sky" },
  diamond: { emoji: "💎", label: "Diamond", tone: "cyan" },
  contributor: { emoji: "💡", label: "Idea Contributor", tone: "sky" },
};

export const FALLBACK_YEAR12_MESSAGE = "That's a wrap on Year 11 — see you all in Year 12!";

/**
 * Reads the global customization row. Returns a fully-populated object with
 * every fallback already applied, plus the raw query handle for loading
 * states. Never returns undefined for any documented field.
 */
export function useAdminConfig() {
  const result = useQuery(api.adminConfig.getAdminConfig);

  const houseNames: Record<string, string> = { ...FALLBACK_HOUSE_NAMES };
  const awardTitles: Record<string, { title: string; description: string }> = {
    ...FALLBACK_AWARD_TITLES,
  };
  const badgeRegistry: Record<string, { emoji: string; label: string; tone: string }> = {
    ...FALLBACK_BADGE_REGISTRY,
  };
  const budgetOverrides: Record<string, number> = {};

  // Rich config blocks, each layered key-by-key over its hardcoded default.
  const houses: Record<string, HouseBrand> = { ...FALLBACK_HOUSES };
  const awards: Record<string, AwardDef> = { ...FALLBACK_BADGES };
  const marketRules = { ...FALLBACK_MARKET_RULES };
  const scoringRules: ScoringRules = { ...FALLBACK_SCORING_RULES };
  const uiText = {
    appTitle: APP_DEFAULTS.appTitle,
    appTagline: APP_DEFAULTS.appTagline,
    maintenanceTitle: APP_DEFAULTS.maintenanceTitle,
    maintenanceMessage: APP_DEFAULTS.maintenanceMessage,
    instagramHandle: APP_DEFAULTS.instagramHandle,
    year12Banner: APP_DEFAULTS.year12Banner,
    year12Message: APP_DEFAULTS.year12Message,
    goldMedalText: APP_DEFAULTS.goldMedalText,
    goldMedalHeadline: APP_DEFAULTS.goldMedalHeadline,
    forfeitText: APP_DEFAULTS.forfeitText,
  };

  const rawAwards = (result?.awardTitles ?? null) as Record<
    string,
    { title?: unknown; description?: unknown }
  > | null;

  if (result) {
    // Layer server values over the fallbacks, key by key, so a malformed
    // single field can never blank out the others.
    if (result.houseNames && typeof result.houseNames === "object") {
      for (const house of HOUSES) {
        const value = result.houseNames[house];
        if (typeof value === "string" && value.trim().length > 0) {
          houseNames[house] = value;
        }
      }
    }
    if (rawAwards && typeof rawAwards === "object") {
      for (const key of Object.keys(FALLBACK_AWARD_TITLES)) {
        const entry = rawAwards[key];
        if (entry && typeof entry === "object") {
          awardTitles[key] = {
            title:
              typeof entry.title === "string" && entry.title.trim().length > 0
                ? entry.title
                : FALLBACK_AWARD_TITLES[key].title,
            description:
              typeof entry.description === "string" && entry.description.trim().length > 0
                ? entry.description
                : FALLBACK_AWARD_TITLES[key].description,
          };
        }
      }
    }
    if (result.badgeRegistry && typeof result.badgeRegistry === "object") {
      for (const [id, meta] of Object.entries(result.badgeRegistry)) {
        if (!meta || typeof meta !== "object") continue;
        const m = meta as { emoji?: unknown; label?: unknown; tone?: unknown };
        badgeRegistry[id] = {
          emoji: typeof m.emoji === "string" ? m.emoji : "🏅",
          label: typeof m.label === "string" ? m.label : id,
          tone: typeof m.tone === "string" ? m.tone : "amber",
        };
      }
    }
    if (result.budgetOverrides && typeof result.budgetOverrides === "object") {
      for (const [userId, amount] of Object.entries(result.budgetOverrides)) {
        if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
          budgetOverrides[userId] = amount;
        }
      }
    }

    // House branding (name/color/logo/motto).
    if (result.houses && typeof result.houses === "object") {
      for (const house of HOUSES) {
        const entry = (result.houses as Record<string, unknown>)[house];
        if (!entry || typeof entry !== "object") continue;
        const h = entry as Partial<HouseBrand>;
        houses[house] = {
          name: typeof h.name === "string" && h.name.length > 0 ? h.name : houses[house].name,
          color: typeof h.color === "string" && /^#[0-9a-fA-F]{6}$/.test(h.color) ? h.color : houses[house].color,
          logoUrl: typeof h.logoUrl === "string" ? h.logoUrl : houses[house].logoUrl,
          motto: typeof h.motto === "string" && h.motto.length > 0 ? h.motto : houses[house].motto,
        };
      }
    }

    // Award definitions (title/icon/description/threshold).
    if (result.awards && typeof result.awards === "object") {
      for (const [key, entry] of Object.entries(result.awards as Record<string, unknown>)) {
        if (!entry || typeof entry !== "object") continue;
        const a = entry as Partial<AwardDef>;
        const base = awards[key] ?? {
          title: key,
          icon: "🏅",
          description: "",
          threshold: 0,
        };
        awards[key] = {
          title: typeof a.title === "string" && a.title.length > 0 ? a.title : base.title,
          icon: typeof a.icon === "string" && a.icon.length > 0 ? a.icon : base.icon,
          description: typeof a.description === "string" ? a.description : base.description,
          threshold:
            typeof a.threshold === "number" && Number.isFinite(a.threshold)
              ? a.threshold
              : base.threshold,
        };
      }
    }

    // Market rules — every numeric field guarded.
    if (result.marketRules && typeof result.marketRules === "object") {
      const m = result.marketRules as unknown as Record<string, unknown>;
      const target = marketRules as unknown as Record<string, number>;
      for (const key of Object.keys(target)) {
        const value = m[key];
        if (typeof value === "number" && Number.isFinite(value)) {
          target[key] = value;
        }
      }
    }

    // Scoring matrix — every numeric field guarded.
    if (result.scoringRules && typeof result.scoringRules === "object") {
      const s = result.scoringRules as unknown as Record<string, unknown>;
      const target = scoringRules as unknown as Record<string, number>;
      for (const key of Object.keys(target)) {
        const value = s[key];
        if (typeof value === "number" && Number.isFinite(value)) {
          target[key] = value;
        }
      }
    }

    // UI text.
    if (result.uiText && typeof result.uiText === "object") {
      const u = result.uiText as unknown as Record<string, unknown>;
      const target = uiText as unknown as Record<string, string>;
      for (const key of Object.keys(target)) {
        const value = u[key];
        if (typeof value === "string" && value.trim().length > 0) {
          target[key] = value;
        }
      }
    }
  }

  return {
    /** Raw query handle: `undefined` while loading. */
    loading: result === undefined,
    houseNames,
    houses,
    awardTitles,
    awards,
    badgeRegistry,
    budgetOverrides,
    marketRules,
    scoringRules,
    uiText,
    instagramUrl: `https://www.instagram.com/${encodeURIComponent(uiText.instagramHandle)}`,
    isMaintenanceMode: result?.isMaintenanceMode === true,
    /** Master switch: false = every manager's squad builder is read-only. */
    editableSquads: result?.editableSquads !== false,
    tournamentEnded: result?.tournamentEnded === true,
    tournamentEndedAt:
      typeof result?.tournamentEndedAt === "number" ? result.tournamentEndedAt : null,
    year12Message:
      typeof result?.year12Message === "string" && result.year12Message.trim().length > 0
        ? result.year12Message
        : FALLBACK_YEAR12_MESSAGE,

    /**
     * Display name for a house. Always returns a non-empty string — the
     * exact `config?.houses?.[houseId]?.name ?? defaultHouseName` pattern the
     * spec asks for, wrapped so no call site can forget the fallback.
     */
    houseName: (house: string | null | undefined): string => {
      if (typeof house !== "string" || house.length === 0) return "Unknown house";
      return houses[house]?.name ?? houseNames[house] ?? FALLBACK_HOUSE_NAMES[house] ?? house;
    },

    /** Customisable award copy, falling back to the built-in title. */
    awardFor: (
      key: string,
    ): { title: string; description: string } =>
      awardTitles[key] ?? FALLBACK_AWARD_TITLES[key] ?? { title: key, description: "" },

    /** Full award definition incl. icon + threshold. Never undefined. */
    awardDef: (key: string): AwardDef =>
      awards[key] ??
      FALLBACK_BADGES[key] ??
      { title: key, icon: "🏅", description: "", threshold: 0 },

    /** Full house brand (name, color, logo, motto). Never undefined. */
    houseBrand: (house: string | null | undefined): HouseBrand =>
      (typeof house === "string" ? houses[house] : undefined) ??
      FALLBACK_HOUSES[String(house)] ?? {
        name: typeof house === "string" && house.length > 0 ? house : "Unknown house",
        color: "#64748b",
        logoUrl: "",
        motto: "",
      },

    /** Effective budget for a manager (override → global default). */
    budgetFor: (userId: string | null | undefined): number => {
      const override = userId ? budgetOverrides[userId] : undefined;
      if (typeof override === "number" && Number.isFinite(override) && override > 0) {
        return Math.min(override, marketRules.maxBudget);
      }
      return marketRules.defaultBudget;
    },

    /**
     * Badge metadata for a stored badge key. Unknown / missing keys resolve
     * to `null`, which the badge renderer treats as "render nothing" — so an
     * unresolvable badge can never throw inside a React render.
     */
    badgeFor: (key: string | null | undefined) => {
      const userBadge = key ?? "none";
      if (userBadge === "none" || typeof userBadge !== "string") return null;
      return badgeRegistry[userBadge] ?? null;
    },
  };
}
