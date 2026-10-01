import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HOUSES, STAGE_LABELS, avatarPresetUrl } from "@/lib/fantasy";
import { useAdminConfig } from "@/hooks/use-admin-config";
import { useHouseName } from "@/components/houses";
import { cn } from "@/lib/utils";
import type { House, Stage } from "@/convex/schema";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { useState } from "react";
import {
  Activity,
  Award,
  Footprints,
  Crown,
  Gauge,
  Medal,
  Shield,
  Star,
  Target,
  Trophy,
} from "lucide-react";

// ── Community activity feed (sports-card style) ─────────────────────────

const FEED_STYLES: Record<string, { ring: string; chip: string }> = {
  transfer: { ring: "border-sky-400/30 bg-sky-400/5", chip: "bg-sky-400/15 text-sky-300" },
  badge: { ring: "border-amber-400/30 bg-amber-400/5", chip: "bg-amber-400/15 text-amber-300" },
  chip: { ring: "border-fuchsia-400/30 bg-fuchsia-400/5", chip: "bg-fuchsia-400/15 text-fuchsia-300" },
  rank: { ring: "border-emerald-400/30 bg-emerald-400/5", chip: "bg-emerald-400/15 text-emerald-300" },
  result: { ring: "border-orange-400/30 bg-orange-400/5", chip: "bg-orange-400/15 text-orange-300" },
  deadline: { ring: "border-red-400/30 bg-red-400/5", chip: "bg-red-400/15 text-red-300" },
  wager: { ring: "border-violet-400/30 bg-violet-400/5", chip: "bg-violet-400/15 text-violet-300" },
  settled: { ring: "border-yellow-400/30 bg-yellow-400/5", chip: "bg-yellow-400/15 text-yellow-300" },
  announcement: { ring: "border-primary/40 bg-primary/5", chip: "bg-primary/15 text-primary" },
  event: { ring: "border-border/60 bg-secondary/30", chip: "bg-secondary text-secondary-foreground" },
};

function timeAgo(ts: number): string {
  try {
    const diff = Date.now() - Number(ts);
    if (!Number.isFinite(diff)) return "just now";
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return "just now";
  }
}

const FEED_LABELS: Record<string, string> = {
  transfer: "TRANSFER",
  badge: "BADGE",
  chip: "CHIP",
  rank: "RANK SHIFT",
  result: "RESULT",
  deadline: "DEADLINE",
  wager: "WAGER",
  settled: "SETTLED",
  announcement: "ADMIN",
  event: "UPDATE",
};

export function ActivityFeedCard() {
  // Safe fallback per spec: `?? []`.
  const events = useQuery(api.activity.getRecentActivity, { limit: 10 }) ?? [];

  return (
    <Card className="card-sheen border-border/80">
      <CardHeader className="pb-2">
        <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
          <Activity className="text-primary size-4" /> Community feed
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {events.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No community action yet — transfers, badges and results will land here.
          </p>
        ) : (
          events.map((ev) => {
            const style = FEED_STYLES[ev.type] ?? FEED_STYLES.event;
            return (
              <div
                key={String(ev._id)}
                className={cn("rounded-xl border px-3 py-2", style.ring)}
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className={cn("border-0 px-1.5 text-[9px] font-black tracking-widest", style.chip)}>
                    {FEED_LABELS[ev.type] ?? "UPDATE"}
                  </Badge>
                  <span className="text-muted-foreground/60 text-[10px]">{timeAgo(ev.ts)}</span>
                </div>
                {/* Baked text: deleted users/players degrade to the stored string. */}
                <p className="mt-1 text-sm font-medium">{ev.text}</p>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

// ── Match result predictor (+2 per correct pick) ─────────────────────────

const PREDICT_STAGES: Stage[] = ["semifinal1", "semifinal2", "third_place", "final"];

export function PredictorCard() {
  const myPredictions = useQuery(api.predictions.getMyPredictions) ?? [];
  const savePrediction = useMutation(api.predictions.savePrediction);
  const [busy, setBusy] = useState<string | null>(null);

  const handlePick = async (stage: Stage, pick: House) => {
    setBusy(stage);
    try {
      await savePrediction({ stage, pick });
      toast.success("Prediction saved — +2 points if correct!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the prediction.");
    } finally {
      setBusy(null);
    }
  };

  const score = myPredictions.reduce((sum, p) => sum + (p.awarded ?? 0), 0);

  return (
    <Card className="card-sheen border-border/80">
      <CardHeader className="pb-2">
        <CardTitle className="font-display flex items-center justify-between text-lg font-bold uppercase tracking-wide">
          <span className="flex items-center gap-2">
            <Target className="text-primary size-4" /> Match predictor
          </span>
          <Badge variant="outline" className="border-emerald-400/40 bg-emerald-400/10 text-emerald-300">
            +{score} bonus pts
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {myPredictions.length === 0 ? (
          <p className="text-muted-foreground mb-1 text-xs">
            Predict all four fixtures — +2 fantasy points for every correct call.
          </p>
        ) : (
          <p className="text-muted-foreground mb-1 text-xs">
            Change any pick before its deadline. Correct picks pay +2 points at settle.
          </p>
        )}
        {PREDICT_STAGES.map((stage) => {
          const mine = myPredictions.find((p) => p.stage === stage);
          const fixture = mine?.fixture ?? null;
          return (
            <div
              key={stage}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-secondary/30 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {STAGE_LABELS[stage]}
                </p>
                <p className="text-sm font-semibold">
                  {fixture ? `${fixture.home} vs ${fixture.away}` : "Fixture TBC"}
                  {fixture?.status === "completed" && (
                    <span className="text-muted-foreground ml-2 text-xs">
                      FT {fixture.homeGoals}–{fixture.awayGoals}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {mine?.correct === true && (
                  <Badge className="border-0 bg-emerald-400/20 text-emerald-300">+2 ✓</Badge>
                )}
                {mine?.correct === false && (
                  <Badge variant="outline" className="text-muted-foreground">✗</Badge>
                )}
                <Select
                  value={mine?.pick ?? ""}
                  onValueChange={(v) => handlePick(stage, v as House)}
                  disabled={busy === stage || fixture?.status === "completed"}
                >
                  <SelectTrigger className="h-8 w-28">
                    <SelectValue placeholder="Pick" />
                  </SelectTrigger>
                  <SelectContent>
                    {HOUSES.map((h) => (
                      <SelectItem key={h} value={h}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── House standings widget ───────────────────────────────────────────────

const HOUSE_ACCENT: Record<string, string> = {
  Fire: "text-red-300",
  Earth: "text-emerald-300",
  Wind: "text-amber-300",
  Water: "text-blue-300",
};

export function HouseStandingsCard() {
  // Safe fallback: loading/empty DB → the four houses at zero.
  const standings = useQuery(api.gameweeks.getHouseStandings) ?? [];
  const houseName = useHouseName();
  const rows = standings.length === 0
    ? HOUSES.map((house) => ({ house, totalPoints: 0, managerCount: 0, avgPoints: 0 }))
    : standings;

  return (
    <Card className="border-border/80">
      <CardHeader className="pb-2">
        <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
          <Gauge className="text-primary size-4" /> House standings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.house}
            className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-secondary/30 px-3 py-2"
          >
            <span className={cn("text-sm font-bold", HOUSE_ACCENT[row.house] ?? "")}>
              {houseName(row.house)}
            </span>
            <div className="text-right">
              <p className="font-score text-sm font-bold">
                {row.totalPoints} pts
              </p>
              <p className="text-muted-foreground text-[10px]">
                avg {row.avgPoints} · {row.managerCount} manager{row.managerCount === 1 ? "" : "s"}
              </p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Golden Footprints / Golden Glove widget ────────────────────────────────────

export function StatsRacesCard() {        const stats = useQuery(api.gameweeks.getTournamentStats) ?? {
    goldenBoot: null,
    goldenGlove: null,
    matchesPlayed: 0,
  };

  return (
    <Card className="border-border/80">
      <CardHeader className="pb-2">
        <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
          <Footprints className="text-primary size-4" /> Tournament stats
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-secondary/30 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Footprints className="size-4 shrink-0 text-amber-300" />
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Golden Footprints</p>
              <p className="truncate text-sm font-semibold">
                {stats.goldenBoot ? stats.goldenBoot.playerName : "—"}
              </p>
            </div>
          </div>
          <span className="font-score text-sm font-bold">
            {stats.goldenBoot ? `${stats.goldenBoot.goals} goals` : "0 goals"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-secondary/30 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Shield className="size-4 shrink-0 text-sky-300" />
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Golden Glove</p>
              <p className="truncate text-sm font-semibold">
                {stats.goldenGlove ? stats.goldenGlove.playerName : "—"}
              </p>
            </div>
          </div>
          <span className="font-score text-sm font-bold">
            {stats.goldenGlove ? `${stats.goldenGlove.cleanSheets} CS` : "0 CS"}
          </span>
        </div>
        <p className="text-muted-foreground text-center text-[10px]">
          {stats.matchesPlayed} match{stats.matchesPlayed === 1 ? "" : "es"} played
        </p>
      </CardContent>
    </Card>
  );
}

// ── Awards (Tactical Genius / Unlucky / Differential / PotW) ─────────────

export function AwardsCard() {
  // Live awards engine snapshot — rewritten after every match update, so
  // this card, the leaderboard chips and the draft list all update together.
  // Safe fallback per spec: every award is independently nullable.
  const awards = useQuery(api.awards.getAwards) ?? {
    tacticalGenius: null as { userId: string; username: string; teamName: string; points: number } | null,
    unluckyManager: null as { userId: string; username: string; teamName: string; points: number } | null,
    differentialMaster: null as { userId: string; username: string; teamName: string; points: number } | null,
    playerOfTheWeek: null as { playerId: string; playerName: string; house: string; points: number } | null,
    updatedAt: null as number | null,
  };
  // Titles + descriptions are Super-Admin editable via useAdminConfig.
  const { awardFor } = useAdminConfig();

  const genius = awardFor("tacticalGenius");
  const unlucky = awardFor("unluckyManager");
  const diff = awardFor("differentialMaster");
  const potw = awardFor("playerOfTheWeek");

  return (
    <Card className="card-sheen border-primary/30 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="font-display flex items-center justify-between gap-2 text-lg font-bold uppercase tracking-wide">
          <span className="flex items-center gap-2">
            <Award className="text-primary size-4" /> Tournament awards
          </span>
          {awards.updatedAt !== null && (
            <span
              className="text-muted-foreground text-[10px] font-normal normal-case"
              title="Automatically recalculated after every match update"
            >
              live
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        <AwardRow
          icon={<Crown className="size-3.5" />}
          label={genius.title}
          value={awards.tacticalGenius ? awards.tacticalGenius.teamName : null}
          sub={
            awards.tacticalGenius
              ? `@${awards.tacticalGenius.username} · ${awards.tacticalGenius.points} pts`
              : genius.description
          }
          tone="border-amber-400/40 bg-amber-400/10 text-amber-300"
        />
        <AwardRow
          icon={<Medal className="size-3.5" />}
          label={unlucky.title}
          value={awards.unluckyManager ? awards.unluckyManager.teamName : null}
          sub={
            awards.unluckyManager
              ? `@${awards.unluckyManager.username} · ${awards.unluckyManager.points} pts`
              : unlucky.description
          }
          tone="border-slate-400/40 bg-slate-400/10 text-slate-300"
        />
        <AwardRow
          icon={<Target className="size-3.5" />}
          label={`🎯 ${diff.title}`}
          value={awards.differentialMaster ? awards.differentialMaster.teamName : null}
          sub={
            awards.differentialMaster
              ? `@${awards.differentialMaster.username} · ~${awards.differentialMaster.points} pts from <15% picks`
              : diff.description
          }
          tone="border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-300"
        />
        <AwardRow
          icon={<Star className="size-3.5" />}
          label={potw.title}
          value={awards.playerOfTheWeek ? awards.playerOfTheWeek.playerName : null}
          sub={
            awards.playerOfTheWeek
              ? `${awards.playerOfTheWeek.house} · ${awards.playerOfTheWeek.points} pts`
              : potw.description
          }
          tone="border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
        />
      </CardContent>
    </Card>
  );
}

function AwardRow({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  sub: string;
  tone: string;
}) {
  return (
    <div className={cn("rounded-xl border p-3", tone)}>
      <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest">
        {icon} {label}
      </p>
      <p className="mt-1 truncate text-sm font-bold">{value ?? "TBD"}</p>
      <p className="text-muted-foreground truncate text-[11px]">{sub}</p>
    </div>
  );
}

// ── Hall of Fame podium ──────────────────────────────────────────────────

export function HallOfFameCard() {
  const hof = useQuery(api.gameweeks.getHallOfFame) ?? {
    finalized: false,
    podium: [],
    championHouse: null,
    mvpPlayer: null,
  };
  if (!hof.finalized) return null;

  const podiumColors = ["text-amber-300", "text-slate-300", "text-orange-300"];

  return (
    <Card className="card-sheen border-amber-400/40 bg-gradient-to-b from-amber-400/10 to-transparent">
      <CardHeader className="pb-2">
        <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
          <Trophy className="text-amber-300 size-5" /> Hall of Fame
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 items-end gap-2">
          {[2, 1, 0].map((idx) => {
            const entry = hof.podium[idx];
            const heights = ["h-20", "h-28", "h-24"];
            return (
              <div key={idx} className="flex flex-col items-center gap-1.5">
                <Avatar className="size-9">
                  <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">
                    {(entry?.username ?? "?").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <p className={cn("max-w-24 truncate text-xs font-bold", podiumColors[entry?.rank ? entry.rank - 1 : 0])}>
                  {entry ? entry.teamName : "TBD"}
                </p>
                <div
                  className={cn(
                    "flex w-full items-start justify-center rounded-t-xl border border-amber-400/30 bg-amber-400/10 pt-2",
                    heights[idx],
                  )}
                >
                  <span className="font-score text-xl font-black">#{entry?.rank ?? idx + 1}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-border/60 bg-secondary/40 p-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Winning House</p>
            <p className={cn("text-lg font-black", HOUSE_ACCENT[hof.championHouse?.house ?? ""])}>
              {hof.championHouse?.house ?? "TBD"}
            </p>
            {hof.championHouse && (
              <p className="text-muted-foreground text-[11px]">
                avg {hof.championHouse.avgPoints} pts/manager
              </p>
            )}
          </div>
          <div className="rounded-xl border border-border/60 bg-secondary/40 p-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Tournament MVP</p>
            <p className="text-lg font-black">{hof.mvpPlayer?.playerName ?? "TBD"}</p>
            {hof.mvpPlayer && (
              <p className="text-muted-foreground text-[11px]">
                {hof.mvpPlayer.house} · {hof.mvpPlayer.totalPoints} pts
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
