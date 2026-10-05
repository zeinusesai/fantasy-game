import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppNav } from "@/components/AppNav";
import { PitchView } from "@/components/PitchView";
import {
  ActivityFeedCard,
  AwardsCard,
  HallOfFameCard,
  HouseStandingsCard,
  PredictorCard,
  StatsRacesCard,
} from "@/components/DashboardWidgets";
import { HouseCrest, PositionChip } from "@/components/houses";
import { ScoringRulesCard } from "@/components/ScoringRulesCard";
import { ScoreLine, PenaltyBadge } from "@/components/ScoreLine";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMoney, safeBudget, toSafeAmount } from "@/convex/configDefaults";
import { STAGE_LABELS, STAGE_ORDER } from "@/lib/fantasy";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { isZeinSuperAdmin } from "@/lib/adminGuard";
import { crestPreset, normalizeCrest } from "@/convex/crests";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  ArrowRight,
  BarChart3,
  Clock,
  Crown,
  Flame,
  Loader2,
  Megaphone,
  Newspaper,
  Shield,
  Star,
  Trophy,
  Users,
} from "lucide-react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router";

type MatchDoc = Doc<"matches">;

/**
 * Y11 PE Hub — weekly friendlies carry dynamic team names; legacy house
 * fixtures fall straight back to the stored house label.
 */
const homeLabelOf = (m: MatchDoc): string => {
  const name = typeof m.homeTeamName === "string" ? m.homeTeamName.trim() : "";
  return name !== "" ? name : m.homeHouse;
};
const awayLabelOf = (m: MatchDoc): string => {
  const name = typeof m.awayTeamName === "string" ? m.awayTeamName.trim() : "";
  return name !== "" ? name : m.awayHouse;
};

/** Compact crest for a fixture row: preset glyph → custom logo → house crest. */
function FixtureCrest({
  match,
  side,
  size = 22,
}: {
  match: MatchDoc;
  side: "home" | "away";
  size?: number;
}) {
  const raw = side === "home" ? match.homeCrest : match.awayCrest;
  const preset = crestPreset(normalizeCrest(raw ?? ""));
  if (preset) {
    return (
      <span
        className="flex items-center justify-center"
        style={{ width: size, height: size, fontSize: size * 0.8, lineHeight: 1 }}
        title={preset.label}
      >
        {preset.glyph}
      </span>
    );
  }
  if (typeof raw === "string" && raw !== "") {
    return (
      <img
        src={raw}
        alt=""
        className="rounded-md border border-border/70 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <HouseCrest house={side === "home" ? match.homeHouse : match.awayHouse} size={size} />
  );
}

export default function Dashboard() {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();

  // `undefined` = query still resolving; `null` = resolved, no squad yet.
  const mySquad = useQuery(api.squads.getMySquad);
  const myStats = useQuery(api.managers.getMyStats);
  // EARNED cosmetics: an equipped premium pitch/golden jersey (either the
  // legacy golden_theme or the feat-earned Tactical Mastermind skin) renders
  // the gold pitch. Resolved from the Hall of Fame showcase; falls back to
  // the plain green default.
  const showcase = useQuery(api.rewardsEngine.getShowcase);
  const goldTheme =
    (showcase?.equipped ?? []).some(
      (id) => id === "golden_theme" || id === "tactical_mastermind_pitch",
    ) === true;
  const matches = useQuery(api.matches.listMatches);
  const config = useQuery(api.config.getConfig);
  // Y11 PE Hub — auto-generated gameweek recap + weekly banter badges.
  // `null` while loading / with no settled gameweek, which hides the card.
  const recap = useQuery(api.matches.getGameweekRecap);

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
  // Single Super-Admin restriction — admin-only dashboard copy is shown only
  // to Zein (see src/lib/adminGuard.ts for the identity check).
  const isAdmin = isZeinSuperAdmin(user);

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
        image: p.image ?? null,
        isCaptain: mySquad?.captainId === p._id,
        statusLabel: p.statusLabel ?? null,
      });
      return acc;
    },
    {} as Record<string, Array<{
      playerId: string;
      name: string;
      position: string;
      house: string;
      image: string | null;
      isCaptain: boolean;
      statusLabel: string | null;
    }>>,
  );

  return (
    <AppNav>
      <div className="mx-auto w-full max-w-md space-y-6 p-6 sm:max-w-7xl">
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
                "Y11 PE Hub · Manager dashboard"
              )}
            </p>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              {user?.teamName ?? `Welcome, ${user?.username}`}
            </h1>
          </div>
          {/* flex-wrap + min-w-0 so the three CTAs wrap on a phone instead of
              being clipped past the right edge of the viewport. */}
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <Button variant="outline" onClick={() => navigate("/admin")}>
                <Shield className="mr-1.5 size-4" /> Admin panel
              </Button>
            )}
            <Button onClick={() => navigate("/squad")}>
              <Users className="mr-1.5 size-4" />
              {mySquad ? "Edit squad" : "Create squad"}
            </Button>
            <Button variant="outline" onClick={() => navigate("/leaderboard")}>
              <Trophy className="mr-1.5 size-4" /> Leaderboard
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

        {/* ── Gameweek recap + Banter & Blunder badges ──────────────── */}
        {recap && (
          <Card className="card-sheen border-border/80">
            <CardHeader className="pb-3">
              <CardTitle className="tracking-tight font-bold flex items-center gap-2">
                <Newspaper className="text-primary size-4" /> Gameweek recap
              </CardTitle>
              <CardDescription>
                Auto-generated the moment a gameweek closes · {recap.managerCount} managers
                scored
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="font-display text-xl font-bold tracking-tight">
                  {recap.headline}
                </h3>
                <div className="text-muted-foreground mt-2 space-y-2 text-sm leading-relaxed">
                  {recap.paragraphs.map((para, i) => (
                    <motion.p
                      key={i}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: i * 0.08 }}
                    >
                      {para}
                    </motion.p>
                  ))}
                </div>
              </div>
              {recap.badges.length > 0 && (
                <div className="flex flex-wrap gap-2 border-t border-border/70 pt-3">
                  {recap.badges.map((b) => (
                    <span
                      key={b.label}
                      title={b.note}
                      className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 text-xs font-semibold text-amber-200"
                    >
                      {b.emoji} {b.label}
                      <span className="text-muted-foreground font-normal">· {b.team}</span>
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
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
                ? formatMoney(toSafeAmount(mySquad.totalSpent))
                : formatMoney(safeBudget(config?.budget))
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
              <div
                className={cn(
                  "mx-auto max-w-md transition-all",
                  goldTheme &&
                    "rounded-2xl ring-2 ring-amber-300/70 shadow-[0_0_28px_rgba(251,191,36,0.35)]",
                )}
              >
                <PitchView
                  byPosition={byPosition}
                  emptyLabel="Pick"
                  formation={mySquad?.formation ?? "2-3-1"}
                  showStatus
                  showFormationLabel
                  // Store cosmetics — `?? "default"` keeps the green pitch for
                  // a manager who hasn't unlocked (or has toggled off) them.
                  theme={user?.activePitchTheme ?? (goldTheme ? "premium" : "default")}
                  goldenJersey={user?.hasGoldenJersey === true || goldTheme}
                  goldenBootKit={user?.hasEquippedKit === true}
                />
                {goldTheme && (
                  <p className="mt-2 text-center text-[10px] font-bold uppercase tracking-widest text-amber-300">
                    ✨ Golden pitch theme active
                  </p>
                )}
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
                        <FixtureCrest match={m} side="home" size={22} /> {homeLabelOf(m)}
                      </span>
                      <span className="font-score text-muted-foreground text-xs font-bold">vs</span>
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        {awayLabelOf(m)} <FixtureCrest match={m} side="away" size={22} />
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
                        <FixtureCrest match={m} side="home" size={22} /> {homeLabelOf(m)}
                      </span>
                      <span className="flex flex-col items-center gap-0.5">
                        <span className="font-score rounded-md bg-primary/15 px-2 py-0.5 text-sm font-bold text-primary">
                          <ScoreLine match={m} />
                        </span>
                        <PenaltyBadge match={m} />
                      </span>
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        {awayLabelOf(m)} <FixtureCrest match={m} side="away" size={22} />
                      </span>
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Live scoring rules — synced to systemConfig, updates instantly when
            the Super Admin retunes the matrix. */}
        <ScoringRulesCard />

        

        {/* Hall of Fame — renders only after the Super Admin finalizes. */}
        <HallOfFameCard />

        {/* Awards: Tactical Genius, Unlucky Manager, Differential, PotW */}
        <AwardsCard />

        {/* Community + prediction + standings grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          <ActivityFeedCard />
          <PredictorCard />
          <div className="space-y-6">
            <HouseStandingsCard />
            <StatsRacesCard />
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
