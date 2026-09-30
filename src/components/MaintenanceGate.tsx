import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import { useLocation } from "react-router";
import { api } from "@/convex/_generated/api";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { MaintenanceScreen } from "@/components/MaintenanceScreen";

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

  // The sign-in page must stay reachable during maintenance so staff who
  // were signed out can still authenticate (they pass the gate right after).
  const isAuthRoute = location.pathname === "/auth";

  // Frontend fallback + loading guard: `undefined` means the query hasn't
  // resolved yet (or the client is offline) — default to "not maintaining".
  const status = statusResult ?? { isMaintenanceMode: false };

  // ROLE FIRST: wait until the viewer's identity is known before blocking.
  if (statusResult === undefined || user === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
      </div>
    );
  }

  // Cast to string: the stored union is "super_admin"|"moderator"|"manager",
  // but we also tolerate the legacy "admin" value defensively.
  const role: string = user?.role ?? "manager";
  const isStaff =
    role === "super_admin" || role === "moderator" || role === "admin";

  if (status.isMaintenanceMode && !isStaff && !isAuthRoute) {
    return <MaintenanceScreen />;
  }

  return <>{children}</>;
}
