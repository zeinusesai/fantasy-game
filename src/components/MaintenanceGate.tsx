import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { useLocation } from "react-router";
import { api } from "@/convex/_generated/api";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { MaintenanceScreen } from "@/components/MaintenanceScreen";
import { isZeinSuperAdmin } from "@/lib/adminGuard";

/**
 * Root-level maintenance gate.
 *
 * Order of operations (role-first, as required):
 *  1. While the maintenance flag OR the signed-in user is still resolving,
 *     render a neutral full-screen spinner — never a premature lockout and
 *     never a flash of the app behind it.
 *  2. Resolve the viewer's role BEFORE applying any block: super_admin and
 *     moderator/admin accounts are never locked out, even mid-maintenance.
 *  3. Only then, if maintenance is active and the viewer is not staff,
 *     render the animated lock screen.
 *
 * Every value has a safe fallback: the status query defaults to
 * `{ isMaintenanceMode: false }` and a signed-out visitor is treated as a
 * standard (non-admin) viewer.
 */
export function MaintenanceGate({ children }: { children: ReactNode }) {
  const statusResult = useQuery(api.system.getMaintenanceStatus);
  const { user } = useAuth();
  const location = useLocation();

  // ── Outage guard (fail-open only while UNKNOWN) ────────────────────────
  // If the Convex backend is unreachable, both the status query and the auth
  // state stay `undefined` forever. Without this grace timer that meant an
  // infinite full-screen spinner and a completely blank site. After the
  // grace period we render the app with the safe "not maintaining" /
  // signed-out fallbacks; the moment real data arrives the gate re-evaluates
  // and (if maintenance is actually on) swaps to the lock screen. Security
  // is unaffected: admin routes and every backend mutation keep their own
  // fail-closed Zein checks.
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setGraceOver(true), 4000);
    return () => clearTimeout(timer);
  }, []);

  // The sign-in page must stay reachable during maintenance so staff who
  // were signed out can still authenticate (they pass the gate right after).
  const isAuthRoute = location.pathname === "/auth";

  // Frontend fallback + loading guard: `undefined` means the query hasn't
  // resolved yet (or the client is offline) — default to "not maintaining".
  const status = statusResult ?? { isMaintenanceMode: false };

  // ROLE FIRST: wait until the viewer's identity is known before blocking —
  // but never wait forever: once the grace period expires with the backend
  // still unreachable, fall through to the safe defaults below.
  if ((statusResult === undefined || user === undefined) && !graceOver) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
      </div>
    );
  }

  // Cast to string: the stored union is "super_admin"|"moderator"|"manager",
  // but we also tolerate the legacy "admin" value defensively.
  const role: string = user?.role ?? "manager";
  // Staff bypass: with the single Super-Admin restriction only Zein sees
  // past a maintenance lock — every other account hits the maintenance screen.
  const isStaff =
    role === "super_admin" && isZeinSuperAdmin(user);

  if (status.isMaintenanceMode && !isStaff && !isAuthRoute) {
    return <MaintenanceScreen />;
  }

  // Backend still unreachable after the grace window: render the app (above)
  // but say so plainly. Sign-in and live data cannot work without the server,
  // so an explicit status bar beats an app that just looks broken.
  if (graceOver && statusResult === undefined) {
    return (
      <>
        <div className="flex items-center justify-center gap-2 border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-center text-xs font-semibold text-amber-200">
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
          Connecting to the server… sign-in and live scores resume automatically.
        </div>
        {children}
      </>
    );
  }

  return <>{children}</>;
}
