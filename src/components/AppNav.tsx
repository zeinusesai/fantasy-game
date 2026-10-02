import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { avatarPresetUrl } from "@/lib/fantasy";
import { UserBadges } from "@/components/UserBadge";
import { useDeadlineBanner } from "@/hooks/use-deadline";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  AlertTriangle,
  BarChart3,
  Crown,
  LayoutDashboard,
  LogOut,
  Settings2,
  Shield,
  ShoppingBag,
  Sword,
  Trophy,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate, NavLink } from "react-router";
import { Bell } from "lucide-react";

const LINKS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/squad", label: "My Squad", icon: Users },
  { to: "/tournament", label: "Tournament", icon: Trophy },
  { to: "/leaderboard", label: "Leaderboard", icon: BarChart3 },
  { to: "/store", label: "Store", icon: ShoppingBag },
] as const;

export function AppNav({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const role = user?.role ?? "manager";
  const isAdmin = role === "super_admin" || role === "moderator";
  const avatar = user?.image?.startsWith("data:") || user?.image?.startsWith("http")
    ? user.image
    : avatarPresetUrl(user?.image);
  const deadline = useDeadlineBanner();

  // Maintenance flag — safe default while loading / when unset.
  const statusResult = useQuery(api.system.getMaintenanceStatus);
  const isMaintenanceMode = statusResult?.isMaintenanceMode === true;

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="stadium-bg min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-4">
          <button
            onClick={() => navigate("/dashboard")}
            className="mr-2 flex items-center gap-2"
            aria-label="Home"
          >
            <span className="from-primary to-primary/60 flex size-8 items-center justify-center rounded-lg bg-gradient-to-br text-primary-foreground shadow-md">
              <Sword className="size-4" />
            </span>
            <span className="font-display hidden text-lg font-bold tracking-wide sm:block">
              YEAR 11 <span className="text-primary">INTERHOUSE</span>
            </span>
          </button>

          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            {LINKS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )
                }
              >
                <Icon className="size-4 shrink-0" />
                <span className="hidden md:inline">{label}</span>
              </NavLink>
            ))}
            {isAdmin && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )
                }
              >
                <Settings2 className="size-4 shrink-0" />
                <span className="hidden md:inline">Admin</span>
              </NavLink>
            )}
          </nav>

          {/* One-click PWA alert opt-in (feature-detected, fail-silent). */}
          {typeof window !== "undefined" && "Notification" in window && Notification.permission === "default" && (
            <Button
              variant="ghost"
              size="sm"
              title="Enable deadline & result alerts"
              onClick={async () => {
                try {
                  const { requestNotificationPermission } = await import("@/lib/notifications");
                  await requestNotificationPermission();
                } catch {
                  // notifications unsupported — silently ignore
                }
              }}
            >
              <Bell className="size-4" />
              <span className="hidden lg:inline text-xs">Alerts</span>
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2">
                <Avatar className="size-7">
                  <AvatarImage
                    src={avatar ?? undefined}
                    alt={user?.username ?? "avatar"}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.visibility = "hidden";
                    }}
                  />
                  <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">
                    {(user?.username ?? "?").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden max-w-28 truncate text-sm font-medium sm:block">
                  {user?.teamName ?? user?.username}
                </span>
                {/* Role checkmark + custom badge (top navigation). */}
                <UserBadges
                  sizeClass="size-3.5"
                  role={user?.role ?? null}
                  customBadge={user?.customBadge ?? null}
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  @{user?.username}
                  <UserBadges
                    sizeClass="size-3.5"
                    role={user?.role ?? null}
                    customBadge={user?.customBadge ?? null}
                  />
                </span>
                {role === "super_admin" && (
                  <Badge className="bg-primary text-primary-foreground gap-1">
                    <Crown className="size-3" /> Super Admin
                  </Badge>
                )}
                {role === "moderator" && (
                  <Badge variant="outline" className="gap-1">
                    <Shield className="size-3" /> Moderator
                  </Badge>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/profile")} className="cursor-pointer">
                <Users className="mr-2 size-4" /> Profile & Squad
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleSignOut}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 size-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* 🚨 Panic banner — any deadline < 60 min away (all signed-in users). */}
        {deadline.panic && deadline.minutesLeft !== null && (
          <div className="border-b border-red-500/50 bg-red-600/20 backdrop-blur-md">
            <div className="mx-auto flex w-full max-w-7xl items-center justify-center gap-2 px-4 py-1.5">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-red-400" />
              </span>
              <span className="animate-pulse text-[11px] font-black uppercase tracking-[0.18em] text-red-300">
                🚨 GW{deadline.gameweek ?? 1} transfers lock in {deadline.minutesLeft} min{deadline.minutesLeft === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        )}

        {/* Pulsing banner — staff only, and only while maintenance is active. */}
        {isMaintenanceMode && isAdmin && (
          <div className="border-b border-amber-400/40 bg-amber-400/15 backdrop-blur-md">
            <div className="mx-auto flex w-full max-w-7xl items-center justify-center gap-2 px-4 py-1.5">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-amber-400" />
              </span>
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
                ⚠️ Maintenance Mode Active
              </span>
              <AlertTriangle className="size-3 text-amber-300" />
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
