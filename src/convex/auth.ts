import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ROLES, SECTIONS } from "./schema";
import { DEFAULT_CONFIG, normalizeUsername } from "./configDefaults";
import { normalizeSection } from "./defaults";

// Username + password credentials auth ("password" provider keeps scrypt
// hashes in authAccounts with providerAccountId = lowercase username).
// The two pre-registered admin accounts (Zein / Cino) are bootstrapped by
// seedAdmins.ts the first time the app loads.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      id: "password",
      validatePasswordRequirements(password) {
        if (!password || password.length < 4) {
          throw new Error("Password must be at least 4 characters.");
        }
      },
      profile(params) {
        const rawUsername = String(params.username ?? "").trim();
        const username = normalizeUsername(rawUsername);
        if (!rawUsername || !username) {
          throw new Error("Username is required.");
        }

        if (params.flow === "signUp") {
          const teamName = String(params.teamName ?? "").trim();
          const avatar = params.avatar ? String(params.avatar) : undefined;
          // ── Mandatory onboarding ─────────────────────────────────────
          // A PE class section and a favourite player are REQUIRED to
          // register. The signup form blocks submit until both are chosen,
          // and this server-side check is the backstop that makes it
          // impossible to create an account through any other path.
          const section = normalizeSection(params.section);
          if (!section) {
            throw new Error(
              `Choose your PE class section (${SECTIONS.join(", ")}) before registering.`,
            );
          }
          const favoritePlayerId = String(params.favoritePlayerId ?? "").trim();
          if (favoritePlayerId === "") {
            throw new Error("Choose your favourite player before registering.");
          }

          if (rawUsername.length < 3 || rawUsername.length > 24) {
            throw new Error("Username must be 3-24 characters.");
          }
          if (!/^[a-zA-Z0-9_]+$/.test(rawUsername)) {
            throw new Error(
              "Username can only contain letters, numbers and underscores.",
            );
          }
          if (teamName.length < 2 || teamName.length > 40) {
            throw new Error("Team name must be 2-40 characters.");
          }
          if (
            teamName.toLowerCase() === "zein" ||
            teamName.toLowerCase() === "cino"
          ) {
            throw new Error("Please choose a different team name.");
          }

          return {
            email: username,
            username,
            teamName,
            ...(avatar ? { image: avatar } : {}),
            role: ROLES.MANAGER,
            budget: DEFAULT_CONFIG.budget,
            section,
            favoritePlayerId,
          };
        }

        // sign-in / reset flows only need the account lookup id.
        return { email: username };
      },
    }),
  ],
});
