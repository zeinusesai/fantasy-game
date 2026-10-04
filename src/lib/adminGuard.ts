/**
 * Client-side mirror of the backend single Super-Admin restriction.
 *
 * The platform has EXACTLY one Super Admin — Zein. `role === "super_admin"`
 * alone is no longer enough to see privileged chrome: the identity must match
 * too, so a mis-promoted or hand-edited row never unlocks the Admin panel,
 * the Admin nav link or the `/admin` route.
 *
 * This is presentation-only hardening — every privileged read/write is also
 * enforced server side in `convex/lib.ts` (`requireSuperAdmin` /
 * `requireAdmin`), so bypassing the UI still yields nothing.
 *
 * Every branch is total: a missing / malformed / legacy username or email
 * simply does not match, so every failure mode fails CLOSED.
 */

/** Canonical sign-in name of the one and only Super Admin. */
export const SUPER_ADMIN_USERNAME = "zein";

type MaybeUser = {
  username?: string | null;
  name?: string | null;
  email?: string | null;
  role?: string | null;
} | null | undefined;

function normalise(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/** Does this user row carry the Zein identity (username / name / email)? */
export function isZein(user: MaybeUser): boolean {
  if (!user) return false;
  try {
    if (normalise(user.username) === SUPER_ADMIN_USERNAME) return true;
    if (normalise(user.name) === SUPER_ADMIN_USERNAME) return true;
    const email = normalise(user.email);
    if (email === SUPER_ADMIN_USERNAME) return true;
    if (email.startsWith(`${SUPER_ADMIN_USERNAME}@`)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Full Super-Admin check: the `super_admin` role AND the Zein identity.
 * Total and null-safe — `undefined` (still loading) is treated as `false`.
 */
export function isZeinSuperAdmin(user: MaybeUser): boolean {
  if (!user) return false;
  try {
    return user.role === "super_admin" && isZein(user);
  } catch {
    return false;
  }
}
