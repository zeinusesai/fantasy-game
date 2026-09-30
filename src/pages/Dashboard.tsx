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
  Flame,
  Star,
  Trophy,
  Users,
} from "lucide-react";
import { useNavigate } from "react-router";

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const mySquad = useQuery(api.squads.getMySquad);
  const myStats = useQuery(api.managers.getMyStats);
  const matches = useQuery(api.matches.listMatches);
  const config = useQuery(api.config.getConfig);

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
            <p className="text-muted-foreground text-sm font-medium">
              {user?.role === "super_admin"
                ? "Super Admin console"
                : user?.role === "moderator"
                  ? "Moderator console"
                  : "Manager dashboard"}
            </p>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              {user?.teamName ?? `Welcome, ${user?.username}`}
            </h1>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => navigate("/squad")}>
              <Users className="mr-1.5 size-4" />
              {mySquad ? "Edit squad" : "Pick your squad"}
            </Button>
            <Button variant="outline" onClick={() => navigate("/tournament")}>
              <Trophy className="mr-1.5 size-4" /> Tournament
            </Button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<Star className="size-4" />}
            label="Total points"
            value={String(myStats?.totalPoints ?? 0)}
          />
          <StatCard
            icon={<Flame className="size-4" />}
            label="Last match"
            value={String(myStats?.lastMatchPoints ?? 0)}
          />
          <StatCard
            icon={<BarChart3 className="size-4" />}
            label="Global rank"
            value={
              myStats?.rank
                ? `#${myStats.rank} of ${myStats.managerCount}`
                : `of ${myStats?.managerCount ?? 0} managers`
            }
          />
          <StatCard
            icon={<Users className="size-4" />}
            label="Squad value"
            value={
              mySquad
                ? formatMoney(mySquad.totalSpent)
                : `Budget ${formatMoney(config?.budget ?? 100_000_000)}`
            }
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Squad pitch */}
          <Card className="card-sheen border-border/80 lg:col-span-2">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="font-display text-lg font-bold uppercase tracking-wide">
                  My squad
                </CardTitle>
                <CardDescription>
                  {mySquad
                    ? `${squadPlayers.length}/7 picked · Captain starred`
                    : "You haven't picked a squad yet"}
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
