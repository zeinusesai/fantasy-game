import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppNav } from "@/components/AppNav";
import { PitchView } from "@/components/PitchView";
import { HouseCrest, PositionChip } from "@/components/houses";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMoney } from "@/convex/configDefaults";
import { STAGE_LABELS, STAGE_ORDER } from "@/lib/fantasy";
import { useAuth } from "@/hooks/use-auth";
import {
  ArrowRight,
  BarChart3,
  Clock,
  Crown,
  Flame,
  Loader2,
  Megaphone,
  Shield,
  Star,
  Trophy,
  Users,
} from "lucide-react";
import { useNavigate } from "react-router";

export default function Dashboard() {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();

  // `undefined` = query still resolving; `null` = resolved, no squad yet.
  const mySquad = useQuery(api.squads.getMySquad);
  const myStats = useQuery(api.managers.getMyStats);
  const matches = useQuery(api.matches.listMatches);
  const config = useQuery(api.config.getConfig);

  // Loading guards: never render squad-dependent UI before queries resolve.
  if (authLoading || mySquad === undefined || myStats === undefined) {
    return (
      <AppNav>
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="text-muted-foreground size-8 animate-spin" />
        </div>
      </AppNav>
    );
  }

  const stats = myStats ?? {
    totalPoints: 0,
    lastMatchPoints: 0,
    rank: null,
    managerCount: 0,
  };

  // Global announcement from the Super Admin ("" when none exists).
  const adminMessage = config?.adminMessage ?? "";

  const role = user?.role ?? "manager";
  const isAdmin = role === "super_admin" || role === "moderator";

  const completed = (matches ?? []).filter((m) => m.status === "completed");
  const upcoming = (matches ?? []).filter((m) => m.status !== "completed");
  const latest = completed.slice(-3).reverse();

  const squadPlayers = mySquad?.players ?? [];
  const byPosition = squadPlayers.reduce(
    (acc, p) => {
      (acc[p.position] ??= []).push({
        playerId: p._id,
        name: p.name,
        position: p.position,
        house: p.house,
        isCaptain: mySquad?.captainId === p._id,
      });
      return acc;
    },
    {} as Record<string, Array<{
      playerId: string;
      name: string;
      position: string;
      house: string;
      isCaptain: boolean;
    }>>,
  );

  return (
    <AppNav>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-muted-foreground flex items-center gap-1.5 text-sm font-medium">
              {role === "super_admin" ? (
                <>
                  <Crown className="text-primary size-3.5" /> Super Admin console
                </>
              ) : role === "moderator" ? (
                <>
                  <Shield className="text-primary size-3.5" /> Moderator console
                </>
              ) : (
                "Manager dashboard"
              )}
            </p>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              {user?.teamName ?? `Welcome, ${user?.username}`}
            </h1>
          </div>
          <div className="flex gap-2">
            {isAdmin && (
              <Button variant="outline" onClick={() => navigate("/admin")}>
                <Shield className="mr-1.5 size-4" /> Admin panel
              </Button>
            )}
            <Button onClick={() => navigate("/squad")}>
              <Users className="mr-1.5 size-4" />
              {mySquad ? "Edit squad" : "Create squad"}
            </Button>
            <Button variant="outline" onClick={() => navigate("/tournament")}>
              <Trophy className="mr-1.5 size-4" /> Tournament
            </Button>
          </div>
        </div>

        {/* Global announcement banner (only rendered when the admin set one) */}
        {adminMessage && (
          <div className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3">
            <Megaphone className="text-primary mt-0.5 size-5 shrink-0" />
            <div className="min-w-0">
              <p className="text-primary text-[11px] font-bold uppercase tracking-widest">
                Announcement
              </p>
              <p className="mt-0.5 text-sm font-medium whitespace-pre-wrap">{adminMessage}</p>
            </div>
          </div>
        )}

        {/* Stat cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<Star className="size-4" />}
            label="Total points"
            value={String(stats.totalPoints)}
          />
          <StatCard
            icon={<Flame className="size-4" />}
            label="Last match"
            value={String(stats.lastMatchPoints)}
          />
          <StatCard
            icon={<BarChart3 className="size-4" />}
            label="Global rank"
            value={
              stats.rank
                ? `#${stats.rank} of ${stats.managerCount}`
                : `of ${stats.managerCount} managers`
            }
          />
          <StatCard
            icon={<Users className="size-4" />}
            label={mySquad ? "Squad value" : "Starting budget"}
            value={
              mySquad
                ? formatMoney(mySquad.totalSpent)
                : formatMoney(config?.budget ?? 100_000_000)
            }
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Squad pitch */}
          <Card className="card-sheen border-border/80 lg:col-span-2">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="font-display text-lg font-bold uppercase tracking-wide">
                  {mySquad ? "My squad" : isAdmin ? "No squad yet" : "My squad"}
                </CardTitle>
                <CardDescription>
                  {mySquad
                    ? `${squadPlayers.length}/7 picked · Captain starred`
                    : isAdmin
                      ? "You're an admin — build a squad to join the fantasy league, or run the tournament from the admin panel."
                      : "You haven't picked a squad yet — draft your seven to start earning points."}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate("/squad")}>
                {mySquad ? "Transfer" : "Draft now"} <ArrowRight className="ml-1 size-3.5" />
              </Button>
            </CardHeader>
            <CardContent>
              <div className="mx-auto max-w-md">
                <PitchView byPosition={byPosition} emptyLabel="Pick" />
              </div>
            </CardContent>
          </Card>

          {/* Fixtures + results */}
          <div className="space-y-6">
            <Card className="border-border/80">
              <CardHeader>
                <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
                  <Clock className="text-primary size-4" /> Upcoming
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {upcoming.length === 0 && (
                  <p className="text-muted-foreground text-sm">No fixtures scheduled yet.</p>
                )}
                {upcoming.slice(0, 3).map((m) => (
                  <button
                    key={m._id}
                    onClick={() => navigate(`/match/${m._id}`)}
                    className="w-full rounded-xl border border-border/70 bg-secondary/40 p-3 text-left transition-colors hover:border-primary/40"
                  >
                    <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-widest">
                      {STAGE_LABELS[m.stage]}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        <HouseCrest house={m.homeHouse} size={22} /> {m.homeHouse}
                      </span>
                      <span className="font-score text-muted-foreground text-xs font-bold">vs</span>
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        {m.awayHouse} <HouseCrest house={m.awayHouse} size={22} />
                      </span>
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/80">
              <CardHeader>
                <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
                  <Flame className="text-primary size-4" /> Latest results
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {latest.length === 0 && (
                  <p className="text-muted-foreground text-sm">No matches played yet.</p>
                )}
                {latest.map((m) => (
                  <button
                    key={m._id}
                    onClick={() => navigate(`/match/${m._id}`)}
                    className="w-full rounded-xl border border-border/70 bg-secondary/40 p-3 text-left transition-colors hover:border-primary/40"
                  >
                    <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-widest">
                      {STAGE_LABELS[m.stage]}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        <HouseCrest house={m.homeHouse} size={22} /> {m.homeHouse}
                      </span>
                      <span className="font-score rounded-md bg-primary/15 px-2 py-0.5 text-sm font-bold text-primary">
                        {m.homeGoals}–{m.awayGoals}
                      </span>
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        {m.awayHouse} <HouseCrest house={m.awayHouse} size={22} />
                      </span>
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Squad list */}
        {mySquad && (
          <Card className="border-border/80">
            <CardHeader>
              <CardTitle className="font-display text-lg font-bold uppercase tracking-wide">
                The seven
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {squadPlayers
                .slice()
                .sort((a, b) => a.position.localeCompare(b.position))
                .map((p) => (
                  <div
                    key={p._id}
                    className="flex items-center justify-between rounded-xl border border-border/70 bg-secondary/40 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                        {mySquad.captainId === p._id && (
                          <Badge className="bg-amber-400/20 text-amber-300 border-0 px-1.5">C</Badge>
                        )}
                        {p.name}
                      </p>
                      <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                        {p.house} <PositionChip position={p.position} /> {formatMoney(p.price)}
                      </p>
                    </div>
                  </div>
                ))}
            </CardContent>
          </Card>
        )}
      </div>
    </AppNav>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card className="card-sheen border-border/80">
      <CardContent className="flex items-center gap-3 p-4">
        <span className="bg-primary/15 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
          {icon}
        </span>
        <div>
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            {label}
          </p>
          <p className="font-score text-xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
