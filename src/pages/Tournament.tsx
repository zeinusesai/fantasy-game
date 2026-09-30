import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppNav } from "@/components/AppNav";
import { HouseCrest } from "@/components/houses";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  STAGE_LABELS,
  STAGE_ORDER,
} from "@/lib/fantasy";
import type { Stage } from "@/convex/schema";
import { Crown, Medal, Star, Trophy } from "lucide-react";
import { useNavigate } from "react-router";

export default function Tournament() {
  const navigate = useNavigate();
  const matches = useQuery(api.matches.listMatches);
  const leaders = useQuery(api.managers.getTournamentLeaders);
  const logos = useQuery(api.houses.listHouseLogos);

  const byStage = (stage: Stage) => (matches ?? []).filter((m) => m.stage === stage);
  const finalMatch = byStage("final")[0];
  const thirdPlace = byStage("third_place")[0];
  const semis = [...byStage("semifinal1"), ...byStage("semifinal2")];

  const completed = (matches ?? []).filter((m) => m.status === "completed");
  const champion =
    finalMatch?.status === "completed"
      ? finalMatch.homeGoals > finalMatch.awayGoals
        ? finalMatch.homeHouse
        : finalMatch.awayHouse
      : null;

  return (
    <AppNav>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">Tournament center</h1>
            <p className="text-muted-foreground text-sm">
              Knockout bracket, results and statistical leaders.
            </p>
          </div>
          {champion && (
            <Badge className="bg-primary text-primary-foreground gap-1.5 px-3 py-1.5 text-sm">
              <Crown className="size-4" /> {champion} wins the cup
            </Badge>
          )}
        </div>

        {/* Bracket */}
        <div className="grid items-start gap-4 lg:grid-cols-3">
          {/* Semis column */}
          <div className="space-y-4">
            <p className="text-muted-foreground text-xs font-bold uppercase tracking-widest">
              Semifinals
            </p>
            {semis.length === 0 && <EmptyCard text="Semifinals not drawn yet." />}
            {semis.map((m) => (
              <MatchCard key={m._id} match={m} onClick={() => navigate(`/match/${m._id}`)} />
            ))}
          </div>

          {/* Final column */}
          <div className="space-y-4">
            <p className="text-muted-foreground text-xs font-bold uppercase tracking-widest">
              Final
            </p>
            {finalMatch ? (
              <MatchCard match={finalMatch} highlight onClick={() => navigate(`/match/${finalMatch._id}`)} />
            ) : (
              <EmptyCard text="Winners of the semifinals meet here." />
            )}
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-center text-xs text-primary">
              Semifinal winners advance automatically
            </div>
          </div>

          {/* 3rd place column */}
          <div className="space-y-4">
            <p className="text-muted-foreground text-xs font-bold uppercase tracking-widest">
              3rd place
            </p>
            {thirdPlace ? (
              <MatchCard match={thirdPlace} onClick={() => navigate(`/match/${thirdPlace._id}`)} />
            ) : (
              <EmptyCard text="Semifinal losers drop into this match." />
            )}
            <div className="rounded-xl border border-border/70 bg-secondary/30 p-3 text-center text-xs text-muted-foreground">
              <Medal className="mr-1 inline size-3.5" />
              Bronze medal match
            </div>
          </div>
        </div>

        {/* Leaders */}
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
              <Star className="text-primary size-4" /> Statistical leaders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="goals">
              <TabsList>
                <TabsTrigger value="goals">Golden Boot — goals</TabsTrigger>
                <TabsTrigger value="assists">Playmaker — assists</TabsTrigger>
              </TabsList>
              <TabsContent value="goals" className="mt-4">
                <LeaderList
                  rows={(leaders?.topScorers ?? []).map((r) => ({
                    playerId: r.playerId,
                    name: r.player?.name ?? "?",
                    house: r.player?.house ?? "Fire",
                    value: r.goals,
                    assists: r.assists,
                  }))}
                  unit="goals"
                />
              </TabsContent>
              <TabsContent value="assists" className="mt-4">
                <LeaderList
                  rows={(leaders?.topAssisters ?? []).map((r) => ({
                    playerId: r.playerId,
                    name: r.player?.name ?? "?",
                    house: r.player?.house ?? "Fire",
                    value: r.assists,
                    assists: r.goals,
                  }))}
                  unit="assists"
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* All matches list */}
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="font-display text-lg font-bold uppercase tracking-wide">
              All fixtures & results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(matches ?? []).length === 0 && (
              <p className="text-muted-foreground text-sm">
                The Super Admin hasn't entered any fixtures yet.
              </p>
            )}
            {[...(matches ?? [])]
              .sort(
                (a, b) =>
                  STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) ||
                  a.createdAt - b.createdAt,
              )
              .map((m) => (
                <button
                  key={m._id}
                  onClick={() => navigate(`/match/${m._id}`)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-border/70 bg-secondary/40 px-4 py-3 text-left transition-colors hover:border-primary/40"
                >
                  <span className="text-muted-foreground w-32 shrink-0 text-xs font-semibold uppercase tracking-wide">
                    {STAGE_LABELS[m.stage]}
                  </span>
                  <span className="flex flex-1 items-center justify-center gap-3">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <HouseCrest house={m.homeHouse} size={24} /> {m.homeHouse}
                    </span>
                    {m.status === "completed" ? (
                      <span className="font-score rounded-md bg-primary/15 px-2.5 py-0.5 text-base font-bold text-primary">
                        {m.homeGoals}–{m.awayGoals}
                      </span>
                    ) : (
                      <Badge variant={m.status === "live" ? "destructive" : "secondary"}>
                        {m.status === "live" ? "● LIVE" : "Scheduled"}
                      </Badge>
                    )}
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {m.awayHouse} <HouseCrest house={m.awayHouse} size={24} />
                    </span>
                  </span>
                  <span className="text-muted-foreground w-32 shrink-0 text-right text-xs">
                    {m.status === "completed" ? "Full time" : m.kickoffLabel ?? "TBD"}
                  </span>
                </button>
              ))}
          </CardContent>
        </Card>
      </div>
    </AppNav>
  );
}

function MatchCard({
  match,
  onClick,
  highlight,
}: {
  match: {
    _id: string;
    stage: Stage;
    homeHouse: Stage extends never ? never : any;
    awayHouse: any;
    homeGoals: number;
    awayGoals: number;
    status: string;
  };
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-left transition-all hover:scale-[1.01] ${
        highlight
          ? "border-primary/50 bg-primary/10 shadow-lg shadow-primary/10"
          : "border-border/70 bg-secondary/40 hover:border-primary/40"
      }`}
    >
      <p className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-widest">
        {STAGE_LABELS[match.stage]}
      </p>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold">
          <HouseCrest house={match.homeHouse} size={30} /> {match.homeHouse}
        </span>
        {match.status === "completed" ? (
          <span className="font-score rounded-lg bg-primary/20 px-3 py-1 text-xl font-extrabold text-primary">
            {match.homeGoals}–{match.awayGoals}
          </span>
        ) : (
          <Badge variant={match.status === "live" ? "destructive" : "secondary"}>
            {match.status === "live" ? "● LIVE" : "vs"}
          </Badge>
        )}
        <span className="flex items-center gap-2 font-semibold">
          {match.awayHouse} <HouseCrest house={match.awayHouse} size={30} />
        </span>
      </div>
    </button>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-secondary/20 p-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function LeaderList({
  rows,
  unit,
}: {
  rows: { playerId: string; name: string; house: string; value: number; assists: number }[];
  unit: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground py-4 text-center text-sm">
        No goals recorded yet — the race starts with the semifinals.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div
          key={r.playerId}
          className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-secondary/40 px-4 py-2.5"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`font-score flex size-7 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
                i === 0 ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
              }`}
            >
              {i + 1}
            </span>
            <span className="truncate text-sm font-semibold">{r.name}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-muted-foreground text-xs">{r.assists} assists</span>
            <span className="font-score rounded-md bg-primary/15 px-2 py-0.5 text-sm font-bold text-primary">
              {r.value} {unit}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
