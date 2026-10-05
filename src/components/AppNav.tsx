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
  Sparkles,
  Sword,
  
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate, NavLink } from "react-router";
import { Bell } from "lucide-react";
import { UnreadBadge, DirectMessages } from "@/components/DirectMessages";
import { isZeinSuperAdmin } from "@/lib/adminGuard";
import { MessageSquare } from "lucide-react";
import { useState } from "react";

const LINKS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/squad", label: "My Squad", icon: Users },
  
  { to: "/leaderboard", label: "Leaderboard", icon: BarChart3 },
  { to: "/hall-of-fame", label: "Hall of Fame", icon: Sparkles },
] as const;

export function AppNav({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const role = user?.role ?? "manager";
  // Single Super-Admin restriction: the Admin entry point is only rendered for
  // Zein. Non-admins never see a link they cannot use, and the `/admin` route
  // itself redirects everyone else away (see pages/Admin.tsx).
  const isAdmin = isZeinSuperAdmin(user);
  const avatar = user?.image?.startsWith("data:") || user?.image?.startsWith("http")
    ? user.image
    : avatarPresetUrl(user?.image);
  const deadline = useDeadlineBanner();
  // The messages slide-over is mounted once here so any page can open it.
  const [messagesOpen, setMessagesOpen] = useState(false);

  // Maintenance flag — safe default while loading / when unset.
  const statusResult = useQuery(api.system.getMaintenanceStatus);
  const isMaintenanceMode = statusResult?.isMaintenanceMode === true;

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    // `min-h-[100dvh]` — the DYNAMIC viewport height. Unlike `h-screen` /
    // `100vh`, this shrinks and grows with the mobile URL bar as it collapses
    // on scroll, so the page never renders taller than the visible viewport
    // (which was the classic "extra scroll + cut-off footer" iOS bug).
    <div className="stadium-bg min-h-[100dvh] overflow-x-hidden">
      // Liquid Glass header: a translucent slab that samples the stadium gradient
      // scrolling underneath it, rather than an opaque bar that hides it.
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/60 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] backdrop-blur-xl">
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
              Y11 <span className="text-primary">PE HUB</span>
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

          {/* Direct messages + unread counter for incoming DMs. */}
          <Button
            variant="ghost"
            className="gap-2 px-2"
            onClick={() => setMessagesOpen(true)}
            title="Messages"
          >
            <span className="relative inline-flex">
              <MessageSquare className="size-4" />
              <span className="absolute -right-2 -top-2">
                <UnreadBadge />
              </span>
            </span>
            <span className="hidden lg:inline text-xs">Messages</span>
          </Button>

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

      {/* `pb-nav-safe` clears the fixed bottom tab bar + the iOS home
          indicator so the last card is never trapped underneath them. */}
      <main className="mx-auto w-full max-w-7xl px-4 pt-4 pb-4 sm:py-6 pb-nav-safe sm:pb-6">
        {children}
      </main>

      {/* ── Sticky bottom tab bar (mobile) ──
          Hidden from `sm:` up, where the top nav takes over. `env(safe-area-
          inset-bottom)` keeps the tap targets clear of the iOS home swipe bar. */}
      <nav
        aria-label="Primary"
        className="bg-slate-900/95 border-slate-800 backdrop-blur-md border-t fixed inset-x-0 bottom-0 z-50 flex h-16 items-center justify-around pb-safe sm:hidden"
      >
        {LINKS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                // 44px+ tap target, column layout, label always visible on
                // mobile (the header nav hides it to save space).
                "flex min-h-[44px] min-w-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[10px] font-medium transition-colors",
                isActive ? "text-primary" : "text-slate-400 active:text-slate-200",
              )
            }
          >
            <Icon className="size-5 shrink-0" />
            <span className="max-w-full truncate">{label}</span>
          </NavLink>
        ))}
        {isAdmin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              cn(
                "flex min-h-[44px] min-w-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[10px] font-medium transition-colors",
                isActive ? "text-primary" : "text-slate-400 active:text-slate-200",
              )
            }
          >
            <Settings2 className="size-5 shrink-0" />
            <span className="max-w-full truncate">Admin</span>
          </NavLink>
        )}
        {/* Messages live in the bar so DMs stay reachable from every page. */}
        <button
          type="button"
          onClick={() => setMessagesOpen(true)}
          className="text-slate-400 active:text-slate-200 relative flex min-h-[44px] min-w-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[10px] font-medium transition-colors"
        >
          <span className="relative inline-flex">
            <MessageSquare className="size-5 shrink-0" />
            <span className="absolute -right-2 -top-1.5">
              <UnreadBadge />
            </span>
          </span>
          <span className="max-w-full truncate">Messages</span>
        </button>
      </nav>

      {/* In-app direct messages. Rendered at the shell level so the thread
          list and the unread badge stay live on every page. */}
      <DirectMessages open={messagesOpen} onOpenChange={setMessagesOpen} />
    </div>
  );
}
