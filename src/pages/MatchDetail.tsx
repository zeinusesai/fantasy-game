import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppNav } from "@/components/AppNav";
import { PageLoading } from "@/components/PageLoading";
import { HouseBadge, HouseCrest, RatingBadge } from "@/components/houses";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STAGE_LABELS } from "@/lib/fantasy";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Award,
  BarChart3,
  CalendarDays,
  Goal,
  Hand,
  Hourglass,
  ShieldCheck,
  Square,
  Star,
  Users,
} from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PitchView, type PitchPlayer } from "@/components/PitchView";
import { StatusBadge } from "@/components/StatusBadge";
import { DEFAULT_FORMATION, inferFormation, resolveFormation } from "@/convex/formations";
import type { Position } from "@/convex/schema";
import type { Doc, Id } from "@/convex/_generated/dataModel";

type PlayerDoc = Doc<"players">;
type MatchDoc = Doc<"matches">;
type TimelineEvent = NonNullable<MatchDoc["timelineEvents"]>[number];
type RatingRow = NonNullable<MatchDoc["playerRatings"]>[number];

/** Safe array access helpers — the schema marks all match-center fields optional. */
const eventsOf = (m: MatchDoc): TimelineEvent[] =>
  [...(m.timelineEvents ?? [])].sort((a, b) => a.minute - b.minute);
const ratingsOf = (m: MatchDoc): RatingRow[] => m.playerRatings ?? [];
const homeLineupOf = (m: MatchDoc): Id<"players">[] => m.lineups?.homeStarters ?? [];
const awayLineupOf = (m: MatchDoc): Id<"players">[] => m.lineups?.awayStarters ?? [];
const expectedHomeOf = (m: MatchDoc): Id<"players">[] => m.expectedLineups?.homeStarters ?? [];
const expectedAwayOf = (m: MatchDoc): Id<"players">[] => m.expectedLineups?.awayStarters ?? [];

/**
 * The shape a lineup should be drawn in: the formation the Super Admin picked,
 * otherwise inferred from the actual positions of the named players, otherwise
 * the 2-3-1 default. `resolveFormation` guarantees a legal id in every branch,
 * so the pitch can never be laid out against a broken shape.
 */
function formationForLineup(
  docs: PlayerDoc[],
  stored?: string | null,
): string {
  if (typeof stored === "string" && stored.trim()) return resolveFormation(stored);
  const counts = docs.reduce(
    (acc, d) => {
      acc[d.position] = (acc[d.position] ?? 0) + 1;
      return acc;
    },
    {} as Partial<Record<Position, number>>,
  );
  return inferFormation(counts) ?? DEFAULT_FORMATION;
}

/** Player docs for a starter list, skipping any that no longer resolve. */
function docsFor(starters: Id<"players">[], byId: Map<string, PlayerDoc>): PlayerDoc[] {
  return (Array.isArray(starters) ? starters : [])
    .map((id) => byId.get(String(id)))
    .filter((d): d is PlayerDoc => Boolean(d));
}

/** Convert player docs into the shape `PitchView` renders. */
function toPitchPlayers(docs: PlayerDoc[]): PitchPlayer[] {
  return docs.map((d) => ({
    playerId: d._id as string,
    name: d.name,
    position: d.position,
    house: d.house,
    image: d.image ?? null,
    rating: null,
    isPotm: false,
    statusLabel: d.statusLabel ?? null,
  }));
}

/**
 * Small circular player photo. Falls back to initials when no custom photo
 * is set or the URL fails to load — never renders a broken image.
 * Thin wrapper over the shared `PlayerAvatar` so match lineups, the timeline
 * and the pitch all resolve photos the exact same way.
 */
function PlayerMiniPhoto({
  player,
  sizeClass = "size-7",
}: {
  player: { name: string; image?: string | null; photoUrl?: string | null };
  sizeClass?: string;
}) {
  return <PlayerAvatar player={player} className={sizeClass} />;
}

/** FotMob-style rating colour: high = green, mid = neutral, low = red. */
function RatingPill({ rating }: { rating: number }) {
  const color =
    rating >= 7
      ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/40"
      : rating >= 5.5
        ? "bg-secondary text-secondary-foreground border-border"
        : "bg-red-500/15 text-red-300 border-red-400/40";
  return (
    <span
      className={`font-score inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-bold ${color}`}
    >
      {rating.toFixed(1)}
    </span>
  );
}

export default function MatchDetail() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();

  // Guard the URL param: a malformed/nonexistent id must never reach Convex
  // as an invalid argument (that would throw an arg-validation error).
  const isValidId =
    typeof matchId === "string" && /^[a-z0-9]{20,40}$/.test(matchId);
  const details = useQuery(
    api.matches.getMatchDetails,
    isValidId
      ? ({ matchId } as { matchId: Id<"matches"> })
      : "skip",
  );

  if (!isValidId) {
    return (
      <AppNav>
        <MissingPanel
          text="Invalid match link."
          onBack={() => navigate("/tournament")}
        />
      </AppNav>
    );
  }
  if (details === undefined) {
    return (
      <AppNav>
        <PageLoading label="Loading match…" />
      </AppNav>
    );
  }
  if (details === null) {
    return (
      <AppNav>
        <MissingPanel
          text="Match not found — it may have been deleted."
          onBack={() => navigate("/tournament")}
        />
      </AppNav>
    );
  }

  const { match, players } = details;
  const byId = new Map<string, PlayerDoc>(players.map((p) => [p._id as string, p]));
  const events = eventsOf(match);
  const ratings = ratingsOf(match);
  const potm = match.potmPlayerId ? byId.get(String(match.potmPlayerId)) : null;

  return (
    <AppNav>
      <div className="space-y-6">
        <button
          onClick={() => navigate("/tournament")}
          className="text-muted-foreground flex items-center gap-1.5 text-sm hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to tournament
        </button>

        <MatchHeader match={match} potmName={potm?.name ?? null} />

        <Tabs defaultValue="overview">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="lineups">Lineups & Ratings</TabsTrigger>
            <TabsTrigger value="stats">Match Stats</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <OverviewTab match={match} byId={byId} />
          </TabsContent>

          <TabsContent value="timeline" className="mt-4">
            <TimelineTab match={match} events={events} />
          </TabsContent>

          <TabsContent value="lineups" className="mt-4">
            <LineupsTab match={match} byId={byId} />
          </TabsContent>

          <TabsContent value="stats" className="mt-4">
            <StatsTab match={match} ratings={ratings} events={events} />
          </TabsContent>
        </Tabs>
      </div>
    </AppNav>
  );
}

function MissingPanel({ text, onBack }: { text: string; onBack: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-muted-foreground text-lg font-semibold">{text}</p>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-1.5 size-4" /> Back to tournament
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Header banner ────────────────────────────────────────────────────────

function MatchHeader({
  match,
  potmName,
}: {
  match: MatchDoc;
  potmName: string | null;
}) {
  const statusLabel =
    match.status === "completed"
      ? "Full time"
      : match.status === "live"
        ? "● LIVE"
        : (match.matchDate ?? match.kickoffLabel ?? "Scheduled");
  return (
    <Card className="card-sheen border-border/80">
      <CardContent className="p-8">
        <div className="mb-6 flex flex-wrap items-center justify-center gap-2 text-center">
          <p className="text-muted-foreground text-xs font-bold uppercase tracking-widest">
            {STAGE_LABELS[match.stage]}
          </p>
          <Badge variant={match.status === "completed" ? "secondary" : "destructive"}>
            {statusLabel}
          </Badge>
          {match.matchDate && match.status === "scheduled" && (
            <span className="text-muted-foreground flex items-center gap-1 text-xs">
              <CalendarDays className="size-3" /> {match.matchDate}
            </span>
          )}
        </div>
        <div className="flex items-center justify-center gap-6 sm:gap-12">
          <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-4">
            <HouseCrest house={match.homeHouse} size={72} />
            <span className="font-display text-2xl font-bold">{match.homeHouse}</span>
          </div>
          <div className="text-center">
            <p className="font-score text-5xl font-extrabold tracking-tight sm:text-6xl">
              {match.homeGoals}–{match.awayGoals}
            </p>
            {potmName && (
              <Badge className="mt-3 gap-1 border-amber-400/40 bg-amber-400/15 py-1 text-amber-200">
                <Award className="size-3" /> PotM: {potmName}
              </Badge>
            )}
          </div>
          <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-4">
            <span className="font-display order-2 text-2xl font-bold sm:order-1">
              {match.awayHouse}
            </span>
            <HouseCrest house={match.awayHouse} size={72} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Overview / Preview ───────────────────────────────────────────────────

function OverviewTab({
  match,
  byId,
}: {
  match: MatchDoc;
  byId: Map<string, PlayerDoc>;
}) {
  const h2hResult = useQuery(api.matches.listMatches);
  const all = h2hResult ?? [];
  // Pre-kickoff we show the Super Admin's expected seven; once the match is
  // over the confirmed team sheet takes over. If only one exists we use it.
  const hasExpected =
    expectedHomeOf(match).length > 0 || expectedAwayOf(match).length > 0;
  const hasConfirmed = homeLineupOf(match).length > 0 || awayLineupOf(match).length > 0;
  const showExpected = match.status !== "completed" && hasExpected && !hasConfirmed;
  const previous = all.filter(
    (m) =>
      m.status === "completed" &&
      m._id !== match._id &&
      ((m.homeHouse === match.homeHouse && m.awayHouse === match.awayHouse) ||
        (m.homeHouse === match.awayHouse && m.awayHouse === match.homeHouse)),
  );
  let aWins = 0;
  let bWins = 0;
  let draws = 0;
  for (const m of previous) {
    const aIsHome = m.homeHouse === match.homeHouse;
    const aGoals = aIsHome ? m.homeGoals : m.awayGoals;
    const bGoals = aIsHome ? m.awayGoals : m.homeGoals;
    if (aGoals > bGoals) aWins++;
    else if (bGoals > aGoals) bWins++;
    else draws++;
  }

  return (
    <div className="space-y-6">
      {/* Head-to-head */}
      <Card className="border-border/80">
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-sm font-bold uppercase tracking-widest">
            Head-to-head
          </CardTitle>
        </CardHeader>
        <CardContent>
          {previous.length === 0 ? (
            <p className="text-muted-foreground py-2 text-center text-sm">
              First meeting between these houses — history starts tonight.
            </p>
          ) : (
            <div className="flex items-center justify-center gap-8">
              <H2HStat value={aWins} label={`${match.homeHouse} wins`} />
              <H2HStat value={draws} label="Draws" />
              <H2HStat value={bWins} label={`${match.awayHouse} wins`} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lineups on a formation-aware pitch: the Super Admin's expected 7 until
          the real team sheet is confirmed, then the confirmed starters. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <LineupPitch
          house={match.homeHouse}
          starters={showExpected ? expectedHomeOf(match) : homeLineupOf(match)}
          formation={showExpected ? match.expectedLineups?.homeFormation : null}
          expected={showExpected}
          emptyText={
            showExpected
              ? "Expected lineup not set yet — the Super Admin publishes it before kickoff."
              : "Lineups will be announced before kickoff"
          }
          byId={byId}
        />
        <LineupPitch
          house={match.awayHouse}
          starters={showExpected ? expectedAwayOf(match) : awayLineupOf(match)}
          formation={showExpected ? match.expectedLineups?.awayFormation : null}
          expected={showExpected}
          emptyText={
            showExpected
              ? "Expected lineup not set yet — the Super Admin publishes it before kickoff."
              : "Lineups will be announced before kickoff"
          }
          byId={byId}
        />
      </div>
    </div>
  );
}

function H2HStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <p className="font-score text-3xl font-extrabold text-primary">{value}</p>
      <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
        {label}
      </p>
    </div>
  );
}

/**
 * Mini vertical pitch for one house, laid out on that house's formation.
 *
 * Zero-error: the formation falls back to the shape inferred from the named
 * players and then to the 2-3-1 default, and a player who no longer resolves
 * is simply skipped rather than crashing the tab.
 */
function LineupPitch({
  house,
  starters,
  byId,
  formation,
  expected = false,
  emptyText = "Lineups will be announced before kickoff",
}: {
  house: string;
  starters: Id<"players">[];
  byId: Map<string, PlayerDoc>;
  /** Super Admin's chosen shape; omitted → inferred from the players. */
  formation?: string | null;
  expected?: boolean;
  emptyText?: string;
}) {
  const docs = docsFor(starters, byId);
  const byPosition = toPitchPlayers(docs).reduce(
    (acc, p) => {
      (acc[p.position] ??= []).push(p);
      return acc;
    },
    {} as Partial<Record<Position, PitchPlayer[]>>,
  );

  return (
    <Card className="card-sheen border-border/80">
      <CardHeader className="pb-2">
        <CardTitle className="font-display flex flex-wrap items-center gap-2 text-base font-bold uppercase tracking-wide">
          <HouseBadge house={house as never} /> {house} lineup
          {expected && (
            <Badge
              variant="outline"
              className="border-sky-400/50 bg-sky-500/15 text-[10px] font-bold uppercase tracking-wide text-sky-200"
            >
              Expected XI
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {docs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Hourglass className="text-muted-foreground/50 size-8 animate-pulse" />
            <p className="text-muted-foreground text-sm">{emptyText}</p>
          </div>
        ) : (
          <PitchView
            byPosition={byPosition}
            formation={formationForLineup(docs, formation)}
            showFormationLabel
            showStatus
            emptyLabel="—"
          />
        )}
      </CardContent>
    </Card>
  );
}

// ── Timeline ─────────────────────────────────────────────────────────────

function TimelineTab({
  match,
  events,
}: {
  match: MatchDoc;
  events: TimelineEvent[];
}) {
  return (
    <Card className="border-border/80">
      <CardHeader className="pb-2">
        <CardTitle className="font-display text-sm font-bold uppercase tracking-widest">
          Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Hourglass className="text-muted-foreground/50 size-8 animate-pulse" />
            <p className="text-muted-foreground text-sm">
              {match.status === "scheduled"
                ? "No events yet — the feed goes live at kickoff."
                : "No events logged yet."}
            </p>
          </div>
        ) : (
          <ol className="space-y-1">
            {events.map((ev) => (
              <li
                key={ev.id}
                className={`flex items-center gap-3 rounded-lg px-2 py-1.5 ${
                  ev.house === match.homeHouse ? "" : "flex-row-reverse"
                }`}
              >
                <span className="font-score w-9 shrink-0 text-center text-xs font-bold text-muted-foreground">
                  {ev.minute}′
                </span>
                <EventGlyph type={ev.type} />
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-semibold">{ev.playerName}</span>
                  <span className="text-muted-foreground">
                    {ev.type === "goal"
                      ? " scores"
                      : ev.type === "own_goal"
                        ? " — own goal"
                        : ev.type === "yellow_card"
                          ? " — yellow card"
                          : ev.type === "red_card"
                            ? " — red card"
                            : " — substitution"}
                  </span>
                  {ev.assistPlayerName && (
                    <span className="text-muted-foreground">
                      {" "}
                      (Assist: {ev.assistPlayerName})
                    </span>
                  )}
                </span>
                <HouseBadge house={ev.house} className="hidden sm:inline-flex" />
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function EventGlyph({ type }: { type: string }) {
  if (type === "goal")
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
        <Goal className="size-3.5" />
      </span>
    );
  if (type === "yellow_card")
    return <span className="h-5 w-3.5 shrink-0 rounded-[2px] bg-amber-400" aria-label="yellow card" />;
  if (type === "red_card")
    return <span className="h-5 w-3.5 shrink-0 rounded-[2px] bg-red-500" aria-label="red card" />;
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-sky-300">
      ⇄
    </span>
  );
}

// ── Lineups & Ratings ────────────────────────────────────────────────────

function LineupsTab({
  match,
  byId,
}: {
  match: MatchDoc;
  byId: Map<string, PlayerDoc>;
}) {
  const ratings = ratingsOf(match);
  const ratingById = new Map(ratings.map((r) => [String(r.playerId), r]));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SquadRatings
        title={match.homeHouse}
        starters={homeLineupOf(match)}
        byId={byId}
        ratingById={ratingById}
        potmId={match.potmPlayerId ? String(match.potmPlayerId) : null}
      />
      <SquadRatings
        title={match.awayHouse}
        starters={awayLineupOf(match)}
        byId={byId}
        ratingById={ratingById}
        potmId={match.potmPlayerId ? String(match.potmPlayerId) : null}
      />
    </div>
  );
}

function SquadRatings({
  title,
  starters,
  byId,
  ratingById,
  potmId,
}: {
  title: string;
  starters: Id<"players">[];
  byId: Map<string, PlayerDoc>;
  ratingById: Map<string, RatingRow>;
  potmId: string | null;
}) {
  const docs = starters.map((id) => byId.get(String(id))).filter(Boolean) as PlayerDoc[];
  const rows = docs
    .map((p) => ({ player: p, rating: ratingById.get(String(p._id)) ?? null }))
    .sort((a, b) => (b.rating?.rating ?? 0) - (a.rating?.rating ?? 0));

  return (
    <Card className="border-border/80">
      <CardHeader className="pb-2">
        <CardTitle className="font-display flex items-center gap-2 text-base font-bold uppercase tracking-wide">
          <Users className="size-4" /> {title} — lineup & ratings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {starters.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <Hourglass className="text-muted-foreground/50 size-8 animate-pulse" />
            <p className="text-muted-foreground text-sm">
              Lineups will be announced before kickoff
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="space-y-1.5">
            {docs.map((p) => (
              <div
                key={p._id}
                className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-3 py-2"
              >
                <span className="truncate text-sm font-semibold">{p.name}</span>
                <span className="text-muted-foreground text-[10px] font-bold uppercase">
                  {p.position}
                </span>
                <StatusBadge status={p.statusLabel} short />
              </div>
            ))}
            <p className="text-muted-foreground pt-1 text-center text-xs">
              Ratings will appear after the full-time whistle.
            </p>
          </div>
        ) : (
          rows.map(({ player, rating }) => (
            <div
              key={player._id}
              className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <PlayerMiniPhoto player={player} sizeClass="size-7" />
                {potmId === String(player._id) && (
                  <Star className="size-3.5 shrink-0 text-amber-400" />
                )}
                <span className="truncate text-sm font-semibold">{player.name}</span>
                <span className="text-muted-foreground shrink-0 text-[10px] font-bold uppercase">
                  {player.position}
                </span>
                <StatusBadge status={player.statusLabel} short />
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                {rating && rating.goals > 0 && (
                  <span className="font-score flex items-center gap-0.5 font-bold text-emerald-300">
                    <Goal className="size-3" />×{rating.goals}
                  </span>
                )}
                {rating && rating.assists > 0 && (
                  <span className="font-score flex items-center gap-0.5 font-bold text-blue-300">
                    <Hand className="size-3" />×{rating.assists}
                  </span>
                )}
                {rating && rating.yellowCards > 0 && <Square className="size-3 text-amber-400" />}
                {rating && rating.redCards > 0 && <Square className="size-3 text-red-500" />}
                {rating ? (
                  <RatingPill rating={rating.rating} />
                ) : (
                  <span className="text-muted-foreground text-[10px]">—</span>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ── Match stats ──────────────────────────────────────────────────────────

function StatsTab({
  match,
  ratings,
  events,
}: {
  match: MatchDoc;
  ratings: RatingRow[];
  events: TimelineEvent[];
}) {
  const home = {
    house: match.homeHouse,
    goals: 0,
    assists: 0,
    saves: 0,
    yellow: 0,
    red: 0,
  };
  const away = { ...home, house: match.awayHouse };

  if (ratings.length > 0) {
    for (const r of ratings) {
      const bucket = r.house === match.homeHouse ? home : away;
      bucket.goals += r.goals;
      bucket.assists += r.assists;
      bucket.saves += r.saves;
      bucket.yellow += r.yellowCards;
      bucket.red += r.redCards;
    }
  } else {
    // Ratings not set yet — derive goal/card counts from the event feed so
    // the stats tab still works for live matches.
    for (const ev of events) {
      const bucket = ev.house === match.homeHouse ? home : away;
      if (ev.type === "goal") bucket.goals += 1;
      else if (ev.type === "yellow_card") bucket.yellow += 1;
      else if (ev.type === "red_card") bucket.red += 1;
    }
  }

  const rows: { label: string; icon: React.ReactNode; home: number; away: number }[] = [
    { label: "Goals", icon: <Goal className="size-3.5 text-emerald-300" />, home: home.goals, away: away.goals },
    { label: "Assists", icon: <Hand className="size-3.5 text-blue-300" />, home: home.assists, away: away.assists },
    { label: "Saves", icon: <ShieldCheck className="size-3.5 text-sky-300" />, home: home.saves, away: away.saves },
    { label: "Yellow cards", icon: <Square className="size-3 text-amber-400" />, home: home.yellow, away: away.yellow },
    { label: "Red cards", icon: <Square className="size-3 text-red-500" />, home: home.red, away: away.red },
  ];

  return (
    <Card className="border-border/80">
      <CardHeader className="pb-2">
        <CardTitle className="font-display flex items-center gap-2 text-sm font-bold uppercase tracking-widest">
          <BarChart3 className="text-primary size-4" /> Match stats
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-muted-foreground flex items-center justify-between text-xs font-bold uppercase tracking-wide">
          <span className="flex items-center gap-1.5">
            <HouseCrest house={match.homeHouse} size={20} /> {match.homeHouse}
          </span>
          <span className="flex items-center gap-1.5">
            {match.awayHouse} <HouseCrest house={match.awayHouse} size={20} />
          </span>
        </div>
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center gap-3 rounded-lg bg-secondary/40 px-3 py-2"
          >
            <span className="font-score w-8 text-right text-sm font-bold">{row.home}</span>
            <div className="flex flex-1 items-center justify-center gap-2">
              {row.icon}
              <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                {row.label}
              </span>
            </div>
            <span className="font-score w-8 text-sm font-bold">{row.away}</span>
          </div>
        ))}
        {ratings.length === 0 && events.length === 0 && (
          <p className="text-muted-foreground pt-1 text-center text-xs">
            Stats appear once the action starts.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
