import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Stage } from "@/convex/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { STAGE_LABELS } from "@/lib/fantasy";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, Lock, LockOpen, PartyPopper, Timer } from "lucide-react";
import { useState } from "react";

const STAGE_ROWS: Stage[] = ["semifinal1", "semifinal2", "third_place", "final"];

/**
 * Super Admin gameweek controls: set/extend/clear transfer deadlines, lock
 * or unlock stages, settle a gameweek (chips + wagers + predictions +
 * rank-shift feed) and finalize the tournament (Hall of Fame). All
 * mutations are try/catch'd with clean toasts; queries use safe fallbacks.
 */
export function GameweeksTab() {
  const gwStatus = useQuery(api.gameweeks.getGameweekStatus) ?? {
    byStage: {} as Record<string, { deadlineAt: number | null; locked: boolean; settled: boolean }>,
  };
  const awards = useQuery(api.gameweeks.getTournamentAwards) ?? {
    tacticalGenius: null,
    unluckyManager: null,
    differentialMaster: null,
    playerOfTheWeek: null,
  };
  const hof = useQuery(api.gameweeks.getHallOfFame) ?? {
    finalized: false,
    podium: [],
    championHouse: null,
    mvpPlayer: null,
  };

  const setDeadline = useMutation(api.gameweeks.setDeadline);
  const setStageLock = useMutation(api.gameweeks.setStageLock);
  const settleGameweek = useMutation(api.gameweeks.settleGameweek);
  const finalizeTournament = useMutation(api.gameweeks.finalizeTournament);

  // Local datetime input per stage (value shown when a deadline exists).
  const [stageInputs, setStageInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const toLocalInput = (ts: number | null): string => {
    try {
      if (typeof ts !== "number" || !Number.isFinite(ts)) return "";
      const d = new Date(ts);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return "";
    }
  };

  const handleSetDeadline = async (stage: Stage) => {
    setBusy(true);
    try {
      const raw = stageInputs[stage];
      if (!raw || raw.trim() === "") {
        await setDeadline({ stage, deadlineAt: undefined });
        toast.success(`${STAGE_LABELS[stage]}: deadline cleared.`);
      } else {
        const parsed = new Date(raw).getTime();
        if (!Number.isFinite(parsed)) {
          toast.error("Pick a valid date & time.");
          return;
        }
        await setDeadline({ stage, deadlineAt: parsed });
        toast.success(`${STAGE_LABELS[stage]}: deadline set.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set the deadline.");
    } finally {
      setBusy(false);
    }
  };

  const handleLock = async (stage: Stage, locked: boolean) => {
    setBusy(true);
    try {
      await setStageLock({ stage, locked });
      toast.success(`${STAGE_LABELS[stage]}: transfers ${locked ? "locked" : "unlocked"}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the lock.");
    } finally {
      setBusy(false);
    }
  };

  const handleSettle = async (stages: Stage[], label: string) => {
    setBusy(true);
    try {
      await settleGameweek({ stages });
      toast.success(`${label} settled — chips, wagers and predictions resolved.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not settle the gameweek.");
    } finally {
      setBusy(false);
    }
  };

  const handleFinalize = async (finalized: boolean) => {
    setBusy(true);
    try {
      await finalizeTournament({ finalized });
      toast.success(
        finalized
          ? "Tournament finalized — the Hall of Fame is live for everyone."
          : "Tournament unfinalized — the Hall of Fame is hidden again.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not finalize the tournament.");
    } finally {
      setBusy(false);
    }
  };

  const allSettled =
    STAGE_ROWS.every((s) => gwStatus.byStage[s]?.settled === true);

  return (
    <div className="space-y-6">
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <CalendarClock className="text-primary size-4" /> Gameweek deadlines & locks
          </CardTitle>
          <CardDescription>
            Set or extend transfer deadlines per fixture. When a deadline passes
            (or you lock the stage) squad edits are rejected server-side and the
            builder flips to read-only. Settling applies Double Down chips,
            resolves 1v1 wagers, scores predictions (+2 per correct) and logs
            rank shifts to the community feed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fixture</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Controls</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {STAGE_ROWS.map((stage) => {
                const state = gwStatus.byStage[stage] ?? {
                  deadlineAt: null,
                  locked: false,
                  settled: false,
                };
                const past =
                  typeof state.deadlineAt === "number" && Date.now() > state.deadlineAt;
                const minutesLeft =
                  typeof state.deadlineAt === "number" && !past
                    ? Math.floor((state.deadlineAt - Date.now()) / 60000)
                    : null;
                return (
                  <TableRow key={stage}>
                    <TableCell className="font-semibold">{STAGE_LABELS[stage]}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Input
                          type="datetime-local"
                          value={stageInputs[stage] ?? toLocalInput(state.deadlineAt)}
                          onChange={(e) =>
                            setStageInputs((prev) => ({ ...prev, [stage]: e.target.value }))
                          }
                          className="h-8 w-56"
                        />
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => handleSetDeadline(stage)}>
                            <Timer className="mr-1 size-3" /> Set
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => {
                              setStageInputs((prev) => ({ ...prev, [stage]: "" }));
                              void handleSetDeadline(stage);
                            }}
                          >
                            Clear
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {state.settled && (
                          <Badge variant="outline" className="border-emerald-400/40 text-emerald-300">
                            settled
                          </Badge>
                        )}
                        {state.locked && (
                          <Badge variant="outline" className="border-red-400/40 text-red-300">
                            locked
                          </Badge>
                        )}
                        {!state.locked && !state.settled && minutesLeft !== null && (
                          <Badge variant="outline" className="border-amber-400/40 text-amber-300">
                            {minutesLeft} min left
                          </Badge>
                        )}
                        {!state.locked && !state.settled && past && (
                          <Badge variant="outline" className="border-red-400/40 text-red-300">
                            expired
                          </Badge>
                        )}
                        {!state.locked && !state.settled && state.deadlineAt === null && (
                          <Badge variant="secondary">open</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant={state.locked ? "outline" : "ghost"}
                          disabled={busy || state.settled}
                          onClick={() => handleLock(stage, !state.locked)}
                        >
                          {state.locked ? (
                            <>
                              <LockOpen className="mr-1 size-3" /> Unlock
                            </>
                          ) : (
                            <>
                              <Lock className="mr-1 size-3" /> Lock
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || state.settled}
                          onClick={() =>
                            handleSettle(
                              stage === "semifinal1" || stage === "semifinal2"
                                ? ["semifinal1", "semifinal2"]
                                : ["third_place", "final"],
                              stage === "semifinal1" || stage === "semifinal2" ? "Gameweek 1" : "Gameweek 2",
                            )
                          }
                        >
                          <CheckCircle2 className="mr-1 size-3" /> Settle GW
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="text-muted-foreground mt-2 text-xs">
            Tip: settling either stage of a gameweek settles the whole gameweek
            (both semifinals together, then 3rd place + final together).
          </p>
        </CardContent>
      </Card>

      {/* Awards preview + finalize */}
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <PartyPopper className="text-primary size-4" /> Tournament close-out
          </CardTitle>
          <CardDescription>
            Finalizing unlocks the Hall of Fame podium for every manager:
            1st/2nd/3rd managers, the Winning House and the Tournament MVP.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <p className="text-sm">
              <span className="text-muted-foreground">Tactical Genius:</span>{" "}
              <span className="font-semibold">
                {awards.tacticalGenius ? `@${awards.tacticalGenius.username}` : "TBD"}
              </span>
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Differential Master:</span>{" "}
              <span className="font-semibold">
                {awards.differentialMaster ? `@${awards.differentialMaster.username}` : "TBD"}
              </span>
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Champion House:</span>{" "}
              <span className="font-semibold">{hof.championHouse?.house ?? "TBD"}</span>
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Tournament MVP:</span>{" "}
              <span className="font-semibold">{hof.mvpPlayer?.playerName ?? "TBD"}</span>
            </p>
          </div>
          {hof.finalized ? (
            <Button variant="outline" onClick={() => handleFinalize(false)} disabled={busy}>
              Un-finalize tournament
            </Button>
          ) : (
            <Button onClick={() => handleFinalize(true)} disabled={busy || !allSettled}>
              <PartyPopper className="mr-1.5 size-4" />
              {allSettled ? "Finalize tournament & unlock Hall of Fame" : "Settle both gameweeks first"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
