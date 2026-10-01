import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertTriangle,
  Gift,
  Loader2,
  RefreshCcw,
  ScrollText,
  Swords,
  Trophy,
  Wrench,
  XCircle,
} from "lucide-react";

// ── Bulk operations + wager/predictor audit (Super Admin only) ──────────
//
// One-click tournament-wide actions that have no single-user home:
//   Reset All Points, Lock/Unlock All Transfers, Trigger Auto-Subs, Distribute
//   a GW bonus — plus the wager dispute queue and one-click predictor
//   resolution.
//
// Destructive actions (Reset All Points) require typing a confirmation word,
// because a stray click here would wipe every manager's season.

const STAGES = ["semifinal1", "semifinal2", "third_place", "final"] as const;

/** Strict numeric parse that rejects blanks, NaN and Infinity. */
function strictNum(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

const WAGER_STATUS_STYLES: Record<string, string> = {
  pending: "border-amber-400/40 bg-amber-400/15 text-amber-200",
  active: "border-sky-400/40 bg-sky-400/15 text-sky-200",
  won: "border-emerald-400/40 bg-emerald-400/15 text-emerald-200",
  lost: "border-red-400/40 bg-red-400/15 text-red-200",
  settled: "border-emerald-400/40 bg-emerald-400/15 text-emerald-200",
  cancelled: "border-muted-foreground/40 bg-muted-foreground/15 text-muted-foreground",
  void: "border-muted-foreground/40 bg-muted-foreground/15 text-muted-foreground",
};

export function BulkOpsTab() {
  const resetAllPoints = useMutation(api.adminControl.resetAllPoints);
  const lockAllTransfers = useMutation(api.adminControl.lockAllTransfers);
  const distributeGwBonus = useMutation(api.adminControl.distributeGwBonus);
  const triggerAutoSubs = useMutation(api.adminControl.triggerAutoSubs);
  const listAllWagers = useQuery(api.adminControl.listAllWagers);
  const cancelWager = useMutation(api.adminControl.cancelWager);
  const listAllPredictions = useQuery(api.adminControl.listAllPredictions);
  const resolvePredictions = useMutation(api.adminControl.resolvePredictions);

  const [busy, setBusy] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");
  const [bonusPoints, setBonusPoints] = useState("");
  const [bonusReason, setBonusReason] = useState("");

  // Safe fallbacks: `undefined` while loading and `[]` for non-admins.
  const wagers = (listAllWagers ?? []) as Array<{
    _id: string;
    challengerName: string;
    challengerTeam: string;
    opponentName: string;
    opponentTeam: string;
    stake: number;
    stage: string;
    status: string;
    winnerName: string | null;
  }>;
  const predictions = (listAllPredictions ?? []) as Array<{
    _id: string;
    username: string;
    stage: string;
    pick: string;
    correct: boolean | null;
    awarded: number;
  }>;

  const doReset = async () => {
    setBusy("reset");
    try {
      const res = await resetAllPoints({ confirm: true });
      toast.success(
        `Reset complete — cleared ${res?.cleared ?? 0} score rows and ${res?.adjustments ?? 0} adjustments.`,
      );
      setResetOpen(false);
      setResetConfirm("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reset the points.");
    } finally {
      setBusy(null);
    }
  };

  const setLocks = async (locked: boolean) => {
    setBusy("locks");
    try {
      const res = await lockAllTransfers({ locked });
      toast.success(
        `${locked ? "Locked" : "Unlocked"} ${res?.updated ?? 0} stage(s) — transfers are ${
          locked ? "closed platform-wide" : "open again"
        }.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the transfer locks.");
    } finally {
      setBusy(null);
    }
  };

  const runAutoSubs = async () => {
    setBusy("subs");
    try {
      const res = await triggerAutoSubs({});
      toast.success(
        res?.changed
          ? `Auto-subs repaired ${res.changed} squad(s).`
          : "Auto-subs ran — every squad is already healthy.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not run auto-subs.");
    } finally {
      setBusy(null);
    }
  };

  const runBonus = async () => {
    const parsed = strictNum(bonusPoints);
    if (parsed === null || Math.round(parsed) === 0) {
      toast.error("Enter a non-zero bonus (negative for a penalty round).");
      return;
    }
    const value = Math.round(parsed);
    if (Math.abs(value) > 1000) {
      toast.error("The per-manager bonus is capped at 1,000 points.");
      return;
    }
    setBusy("bonus");
    try {
      const res = await distributeGwBonus({
        pointsPerManager: value,
        reason: bonusReason.trim() || "Gameweek bonus",
      });
      toast.success(`${value > 0 ? "Paid" : "Charged"} ${res?.paid ?? 0} manager(s).`);
      setBonusPoints("");
      setBonusReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not distribute the bonus.");
    } finally {
      setBusy(null);
    }
  };

  const doCancelWager = async (wagerId: string) => {
    setBusy(`wager-${wagerId}`);
    try {
      await cancelWager({ wagerId: wagerId as never });
      toast.success("Wager cancelled and refunded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel the wager.");
    } finally {
      setBusy(null);
    }
  };

  const doResolve = async (stage: string) => {
    setBusy(`resolve-${stage}`);
    try {
      const res = await resolvePredictions({ stage: stage as never });
      toast.success(
        `Resolved ${res?.resolved ?? 0} pick(s) — ${res?.paid ?? 0} correct, +2 points each.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resolve the predictions.");
    } finally {
      setBusy(null);
    }
  };

  const pendingByStage = STAGES.map((stage) => ({
    stage,
    total: predictions.filter((p) => p.stage === stage).length,
    pending: predictions.filter((p) => p.stage === stage && p.correct === null).length,
  })).filter((s) => s.total > 0);

  return (
    <div className="space-y-6">
      {/* ── Bulk operations ── */}
      <Card className="border-2 border-red-400/40 bg-red-500/5">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <Wrench className="text-red-300 size-4" /> Bulk operations
          </CardTitle>
          <CardDescription>
            Tournament-wide actions. Everything here writes an audit entry, and the destructive
            ones ask for confirmation first.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2 rounded-xl border border-border/60 bg-background/50 p-3">
            <p className="text-sm font-semibold">Reset all points</p>
            <p className="text-muted-foreground text-xs">
              Wipes every score row and point adjustment, then recalculates awards. This cannot be
              undone — re-save each match to score it again.
            </p>
            <Button
              variant="destructive"
              onClick={() => setResetOpen(true)}
              disabled={busy === "reset"}
            >
              {busy === "reset" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCcw className="size-4" />
              )}
              Reset All Points
            </Button>
          </div>

          <div className="grid gap-2 rounded-xl border border-border/60 bg-background/50 p-3">
            <p className="text-sm font-semibold">Lock / unlock all transfers</p>
            <p className="text-muted-foreground text-xs">
              The emergency switch — closes every gameweek deadline at once, or opens them all.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => setLocks(true)} disabled={busy === "locks"}>
                Lock all
              </Button>
              <Button variant="outline" onClick={() => setLocks(false)} disabled={busy === "locks"}>
                Unlock all
              </Button>
            </div>
          </div>

          <div className="grid gap-2 rounded-xl border border-border/60 bg-background/50 p-3">
            <p className="text-sm font-semibold">Trigger auto-subs</p>
            <p className="text-muted-foreground text-xs">
              Sweeps every squad and replaces any deleted or deactivated player with the priciest
              available player at the same position.
            </p>
            <Button variant="outline" onClick={runAutoSubs} disabled={busy === "subs"}>
              {busy === "subs" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wrench className="size-4" />
              )}
              Run auto-subs
            </Button>
          </div>

          <div className="grid gap-2 rounded-xl border border-border/60 bg-background/50 p-3">
            <p className="text-sm font-semibold">Distribute GW bonus</p>
            <p className="text-muted-foreground text-xs">
              A flat award to every manager with a squad. Negative values run a penalty round.
              Capped at 1,000 points each.
            </p>
            <div className="flex gap-2">
              <Input
                value={bonusPoints}
                onChange={(e) => setBonusPoints(e.target.value)}
                placeholder="e.g. 5"
                inputMode="numeric"
                aria-label="Bonus points per manager"
              />
              <Button onClick={runBonus} disabled={busy === "bonus"}>
                {busy === "bonus" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Gift className="size-4" />
                )}
                Give
              </Button>
            </div>
            <Input
              value={bonusReason}
              onChange={(e) => setBonusReason(e.target.value)}
              placeholder="Reason (optional, goes in the audit log)"
              maxLength={200}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Wager audit ── */}
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <Swords className="text-primary size-4" /> Wager audit
          </CardTitle>
          <CardDescription>
            Every 1v1 wager with its stake and status. Settled wagers are final; anything else can
            be cancelled if a manager disputes it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {listAllWagers === undefined ? (
            <p className="text-muted-foreground py-6 text-center text-sm">Loading wagers…</p>
          ) : wagers.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No wagers yet — or your account doesn't have access to this list.
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-xl border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Challenger</TableHead>
                    <TableHead>Opponent</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Stake</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wagers.map((w) => (
                    <TableRow key={w._id}>
                      <TableCell>
                        <p className="font-semibold">@{w.challengerName}</p>
                        <p className="text-muted-foreground text-xs">{w.challengerTeam}</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-semibold">@{w.opponentName}</p>
                        <p className="text-muted-foreground text-xs">{w.opponentTeam}</p>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {STAGE_LABELS[w.stage as never] ?? w.stage}
                      </TableCell>
                      <TableCell className="font-score text-right font-bold">
                        {Number(w.stake) || 0}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            WAGER_STATUS_STYLES[w.status] ?? WAGER_STATUS_STYLES.pending,
                          )}
                        >
                          {w.status}
                        </Badge>
                        {w.winnerName && (
                          <span className="text-muted-foreground ml-1.5 text-xs">
                            → @{w.winnerName}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {w.status !== "settled" && w.status !== "cancelled" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => doCancelWager(w._id)}
                            disabled={busy === `wager-${w._id}`}
                          >
                            {busy === `wager-${w._id}` ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <XCircle className="size-3.5" />
                            )}
                            Cancel
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Predictor resolution ── */}
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <ScrollText className="text-primary size-4" /> Predictor resolution
          </CardTitle>
          <CardDescription>
            Resolve every pick for a stage in one click — +2 points per correct prediction.
            Safe to re-run: already-resolved picks are skipped.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {STAGES.map((stage) => {
            const rows = predictions.filter((p) => p.stage === stage);
            const pending = rows.filter((p) => p.correct === null);
            return (
              <div
                key={stage}
                className="grid gap-2 rounded-xl border border-border/60 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div>
                  <p className="text-sm font-semibold">
                    {STAGE_LABELS[stage]}
                    <span className="text-muted-foreground ml-2 text-xs">
                      {rows.length} pick{rows.length === 1 ? "" : "s"}
                      {rows.length > 0 && ` · ${pending.length} unresolved`}
                    </span>
                  </p>
                  {rows.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {rows.map((p) => (
                        <span
                          key={p._id}
                          title={`@${p.username} picked ${p.pick}`}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px]",
                            p.correct === true
                              ? WAGER_STATUS_STYLES.settled
                              : p.correct === false
                                ? WAGER_STATUS_STYLES.lost
                                : WAGER_STATUS_STYLES.pending,
                          )}
                        >
                          @{p.username} → {p.pick}
                          {p.correct !== null && (p.correct ? " ✓" : " ✗")}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs">No predictions for this stage.</p>
                  )}
                </div>
                <Button
                  variant="outline"
                  onClick={() => doResolve(stage)}
                  disabled={busy === `resolve-${stage}` || rows.length === 0 || pending.length === 0}
                >
                  {busy === `resolve-${stage}` ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trophy className="size-3.5" />
                  )}
                  Resolve {STAGE_LABELS[stage]}
                </Button>
              </div>
            );
          })}
          {pendingByStage.length === 0 && predictions.length === 0 && (
            <p className="text-muted-foreground text-center text-sm">
              No predictions recorded yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Reset confirmation ── */}
      <Dialog open={resetOpen} onOpenChange={(open) => !open && setResetOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" /> Reset all points?
            </DialogTitle>
            <DialogDescription>
              This deletes every match score row and every point adjustment for every manager, then
              recalculates the awards. To score the season again you re-save each match.
              <p className="mt-3 font-semibold">
                Type <span className="text-destructive">RESET</span> to confirm.
              </p>
            </DialogDescription>
          </DialogHeader>
          <Input
            value={resetConfirm}
            onChange={(e) => setResetConfirm(e.target.value)}
            placeholder="RESET"
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={doReset}
              disabled={busy === "reset" || resetConfirm.trim().toUpperCase() !== "RESET"}
            >
              {busy === "reset" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCcw className="size-4" />
              )}
              Reset everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
