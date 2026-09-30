import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppNav } from "@/components/AppNav";
import { PageLoading } from "@/components/PageLoading";
import { HouseBadge, HouseCrest, RatingBadge } from "@/components/houses";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STAGE_LABELS } from "@/lib/fantasy";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Award,
  Clock,
  Goal,
  Hand,
  ShieldCheck,
  Square,
  Star,
} from "lucide-react";
import { useNavigate, useParams } from "react-router";
import type { Doc, Id } from "@/convex/_generated/dataModel";

type MatchPlayerLine = Doc<"matchPlayers"> & { player: Doc<"players"> | null };

export default function MatchDetail() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();

  // Guard the URL param: a malformed/nonexistent id must never reach Convex
  // as an invalid argument (that would throw an arg-validation error).
  const isValidId =
    typeof matchId === "string" && /^[a-z0-9]{20,40}$/.test(matchId);
  const data = useQuery(
    api.matches.getMatch,
    isValidId ? ({ matchId } as { matchId: Id<"matches"> }) : "skip",
  );

  if (!isValidId || !data) {
    return (
      <AppNav>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            {!isValidId ? (
              <>
                <p className="text-muted-foreground text-lg font-semibold">
                  Invalid match link
                </p>
                <Button variant="outline" onClick={() => navigate("/tournament")}>
                  <ArrowLeft className="mr-1.5 size-4" /> Back to tournament
                </Button>
              </>
            ) : data === undefined ? (
              <PageLoading label="Loading match…" />
            ) : (
              <>
                <p className="text-muted-foreground text-lg font-semibold">
                  Match not found — it may have been deleted.
                </p>
                <Button variant="outline" onClick={() => navigate("/tournament")}>
                  <ArrowLeft className="mr-1.5 size-4" /> Back to tournament
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </AppNav>
    );
  }

  const { match, lines } = data;
  const homeLines = lines.filter((l) => l.house === match.homeHouse);
  const awayLines = lines.filter((l) => l.house === match.awayHouse);
  const potm = lines.find((l) => l.potm);

  // Build the event timeline (goals, own goals, cards) sorted by minute.
  type Ev = { minute: number; kind: string; player: string; house: string; assist?: string };
  const events: Ev[] = [];
  for (const l of lines) {
    const name = l.player?.name ?? "Unknown";
    (l.goalMinutes ?? []).forEach((minute, i) => {
      if (i < l.goals) {
        events.push({ minute, kind: "goal", player: name, house: l.house });
      }
    });
    (l.ownGoalMinutes ?? []).forEach((minute, i) => {
      if (i < l.ownGoals) {
        events.push({ minute, kind: "own_goal", player: name, house: l.house });
      }
    });
    for (let i = 0; i < l.yellowCards; i++) {
      events.push({ minute: 0, kind: "yellow", player: name, house: l.house });
    }
    for (let i = 0; i < l.redCards; i++) {
      events.push({ minute: 0, kind: "red", player: name, house: l.house });
    }
  }
  events.sort((a, b) => a.minute - b.minute);

  return (
    <AppNav>
      <div className="space-y-6">
        <button
          onClick={() => navigate("/tournament")}
          className="text-muted-foreground flex items-center gap-1.5 text-sm hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to tournament
        </button>

        {/* Score header */}
        <Card className="card-sheen border-border/80">
          <CardContent className="p-8">
            <p className="text-muted-foreground mb-6 text-center text-xs font-bold uppercase tracking-widest">
              {STAGE_LABELS[match.stage]} ·{" "}
              {match.status === "completed"
                ? "Full time"
                : match.status === "live"
                  ? "Live now"
                  : match.kickoffLabel ?? "Scheduled"}
            </p>
            <div className="flex items-center justify-center gap-6 sm:gap-12">
              <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-4">
                <HouseCrest house={match.homeHouse} size={72} />
                <span className="font-display text-2xl font-bold">{match.homeHouse}</span>
              </div>
              <div className="text-center">
                <p className="font-score text-5xl font-extrabold tracking-tight sm:text-6xl">
                  {match.homeGoals}–{match.awayGoals}
                </p>
                <Badge
                  variant={match.status === "completed" ? "secondary" : "destructive"}
                  className="mt-2"
                >
                  {match.status === "completed"
                    ? "FT"
                    : match.status === "live"
                      ? "● LIVE"
                      : "vs"}
                </Badge>
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

        <div className="grid gap-6 lg:grid-cols-2">
          {/* PotM + timeline */}
          <div className="space-y-6">
            {potm && (
              <Card className="border-amber-400/40 bg-amber-400/5">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-amber-300">
                    <Award className="size-4" /> Player of the Match
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-14 items-center justify-center rounded-full bg-amber-400/20 text-2xl">
                      ★
                    </div>
                    <div>
                      <p className="font-display text-xl font-bold">
                        {potm.player?.name ?? "Unknown"}
                      </p>
                      <p className="text-muted-foreground flex items-center gap-2 text-sm">
                        {potm.player?.house} · {potm.player?.position}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    {potm.rating != null && <RatingBadge rating={potm.rating} className="mb-1" />}
                    <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                      {potm.goals}G · {potm.assists}A
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="border-border/80">
              <CardHeader className="pb-2">
                <CardTitle className="font-display text-sm font-bold uppercase tracking-widest">
                  Timeline
                </CardTitle>
              </CardHeader>
              <CardContent>
                {events.length === 0 ? (
                  <p className="text-muted-foreground py-4 text-center text-sm">
                    No key events recorded for this match.
                  </p>
                ) : (
                  <ol className="space-y-1">
                    {events.map((ev, i) => (
                      <li
                        key={i}
                        className={`flex items-center gap-3 rounded-lg px-2 py-1.5 ${
                          ev.house === match.homeHouse ? "" : "flex-row-reverse"
                        }`}
                      >
                        <span className="font-score w-9 shrink-0 text-center text-xs font-bold text-muted-foreground">
                          {ev.kind === "yellow" || ev.kind === "red"
                            ? ""
                            : `${Math.round(ev.minute)}'`}
                        </span>
                        <EventIcon kind={ev.kind} />
                        <span className="truncate text-sm">
                          <span className="font-semibold">{ev.player}</span>
                          <span className="text-muted-foreground">
                            {ev.kind === "goal"
                              ? " scores"
                              : ev.kind === "own_goal"
                                ? " — own goal"
                                : ev.kind === "yellow"
                                  ? " — yellow card"
                                  : " — red card"}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Ratings / lineups */}
          <div className="space-y-6">
            <LineupTable title={match.homeHouse} lines={homeLines} />
            <LineupTable title={match.awayHouse} lines={awayLines} />
          </div>
        </div>
      </div>
    </AppNav>
  );
}

function EventIcon({ kind }: { kind: string }) {
  if (kind === "goal")
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
        <Goal className="size-3.5" />
      </span>
    );
  if (kind === "own_goal")
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-300">
        <Goal className="size-3.5" />
      </span>
    );
  if (kind === "yellow")
    return <span className="h-5 w-3.5 shrink-0 rounded-[2px] bg-amber-400" aria-label="yellow card" />;
  return <span className="h-5 w-3.5 shrink-0 rounded-[2px] bg-red-500" aria-label="red card" />;
}

function LineupTable({
  title,
  lines,
}: {
  title: string;
  lines: MatchPlayerLine[];
}) {
  return (
    <Card className="border-border/80">
      <CardHeader className="pb-2">
        <CardTitle className="font-display flex items-center gap-2 text-base font-bold uppercase tracking-wide">
          <HouseBadge house={title as never} /> lineup & ratings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {lines.length === 0 && (
          <p className="text-muted-foreground text-sm">No player data recorded.</p>
        )}
        {lines
          .slice()
          .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
          .map((l) => (
            <div
              key={l._id}
              className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                {l.potm && <Star className="size-3.5 shrink-0 text-amber-400" />}
                <span className="truncate text-sm font-semibold">{l.player?.name ?? "?"}</span>
                <span className="text-muted-foreground shrink-0 text-[10px] font-bold uppercase">
                  {l.player?.position}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                {l.cleanSheet && (
                  <span title="Clean sheet">
                    <ShieldCheck className="size-3.5 text-emerald-400" />
                  </span>
                )}
                {l.goals > 0 && (
                  <span className="font-score flex items-center gap-0.5 font-bold text-emerald-300">
                    <Goal className="size-3" />×{l.goals}
                  </span>
                )}
                {l.assists > 0 && (
                  <span className="font-score flex items-center gap-0.5 font-bold text-blue-300">
                    <Hand className="size-3" />×{l.assists}
                  </span>
                )}
                {l.yellowCards > 0 && <Square className="size-3 text-amber-400" />}
                {l.redCards > 0 && <Square className="size-3 text-red-500" />}
                {l.rating != null && <RatingBadge rating={l.rating} />}
                <span className="font-score w-9 text-right text-xs font-bold text-primary">
                  +{l.fantasyPoints}
                </span>
              </div>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
