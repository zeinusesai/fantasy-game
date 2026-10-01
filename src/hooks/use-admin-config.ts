import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { HOUSES } from "@/lib/fantasy";

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
  }

  return {
    /** Raw query handle: `undefined` while loading. */
    loading: result === undefined,
    houseNames,
    awardTitles,
    badgeRegistry,
    budgetOverrides,
    isMaintenanceMode: result?.isMaintenanceMode === true,
    tournamentEnded: result?.tournamentEnded === true,
    tournamentEndedAt:
      typeof result?.tournamentEndedAt === "number" ? result.tournamentEndedAt : null,
    year12Message:
      typeof result?.year12Message === "string" && result.year12Message.trim().length > 0
        ? result.year12Message
        : FALLBACK_YEAR12_MESSAGE,

    /**
     * Display name for a house. Always returns a non-empty string — the
     * exact `config?.houseNames?.[house] ?? defaultHouseName` pattern the
     * spec asks for, wrapped so no call site can forget the fallback.
     */
    houseName: (house: string | null | undefined): string => {
      if (typeof house !== "string" || house.length === 0) return "Unknown house";
      return houseNames[house] ?? FALLBACK_HOUSE_NAMES[house] ?? house;
    },

    /** Customisable award copy, falling back to the built-in title. */
    awardFor: (
      key: string,
    ): { title: string; description: string } =>
      awardTitles[key] ?? FALLBACK_AWARD_TITLES[key] ?? { title: key, description: "" },

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
