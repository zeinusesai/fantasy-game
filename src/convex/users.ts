import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import { readUserCosmetics } from "./lib";
import type { Doc } from "./_generated/dataModel";

/**
 * Get the current signed in user. Returns null if the user is not signed in.
 * Usage: const signedInUser = await ctx.runQuery(api.users.currentUser);
 * THIS FUNCTION IS READ-ONLY. DO NOT MODIFY.
 */
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user: Doc<"users"> | null = await ctx.db.get(userId);
    // Defensive projection: a missing account degrades to null.
    if (!user) return null;

    // Store cosmetics (pitch theme / golden jersey / border / title). Total —
    // a failed lookup means "nothing unlocked", never a rejected query.
    const cosmetics = await readUserCosmetics(ctx, user);

    return {
      ...user,
      customBadge: user.customBadge ?? null,
      // Cosmetics, already normalised server-side so the client can render
      // `user.activePitchTheme ?? "default"` without another lookup.
      activePitchTheme: cosmetics.activePitchTheme,
      hasGoldenJersey: cosmetics.hasGoldenJersey,
      hasProfileBorder: cosmetics.hasProfileBorder,
      hasCustomTitle: cosmetics.hasCustomTitle,
      // Denormalized conveniences so the Profile / Store pages can render
      // without a second query. `?? ""` keeps them safe empty values.
      customTitle: user.customTitle ?? "",
      extraChips:
        typeof user.extraChips === "number" && Number.isFinite(user.extraChips)
          ? user.extraChips
          : 0,
    };
  },
});