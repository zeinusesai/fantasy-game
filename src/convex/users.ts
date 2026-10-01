import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";

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
    const user = await ctx.db.get(userId);
    // Defensive projection: append customBadge (null-safe) so the badge
    // system is available app-wide; a missing account degrades to null.
    if (!user) return null;
    return { ...user, customBadge: user.customBadge ?? null };
  },
});
