import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Stage } from "@/convex/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GW_STAGES, STAGE_LABELS_FALLBACK } from "@/lib/wagerLabels";
import { Loader2, Swords, X } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useState } from "react";

/**
 * 1v1 H2H point wager dialog: pick a stake (1–50 pts) and the gameweek to
 * duel on. Also surfaces open challenges to accept/decline/cancel. All
 * mutation calls are try/catch'd with clean toasts (errors passed to the
 * parent handler for the challenge send).
 */
export function WagerDialog({
  target,
  onClose,
  onSend,
}: {
  target: { id: Id<"users">; username: string; teamName: string } | null;
  onClose: () => void;
  onSend: (stake: number, stage: Stage) => Promise<boolean>;
}) {
  const myWagers = useQuery(api.wagers.getMyWagers) ?? [];
  const respond = useMutation(api.wagers.respondToWager);
  const [stake, setStake] = useState("10");
  const [stage, setStage] = useState<Stage>("semifinal1");
  const [busy, setBusy] = useState(false);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (target) {
      setStake("10");
      setStage("semifinal1");
    }
  }, [target]);

  // Defensive numeric parse — nothing non-numeric reaches the backend.
  const parsedStake = Math.round(Number(String(stake).replace(/[^0-9.]/g, "")));
  const stakeValid = Number.isFinite(parsedStake) && parsedStake >= 1 && parsedStake <= 50;

  const handleRespond = async (
    wagerId: string,
    action: "accept" | "decline" | "cancel",
  ) => {
    setBusy(true);
    try {
      await respond({ wagerId: wagerId as Id<"wagers">, action });
      toast.success(
        action === "accept"
          ? "Challenge accepted — highest gameweek score takes the points!"
          : action === "decline"
            ? "Challenge declined."
            : "Challenge cancelled.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the wager.");
    } finally {
      setBusy(false);
    }
  };

  const openWagers = myWagers.filter((w) => w.status === "pending");
  const settled = myWagers.filter((w) => w.status === "settled").slice(0, 3);

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Swords className="text-violet-300 size-4" /> 1v1 Wager
          </DialogTitle>
          <DialogDescription>
            Challenge{' '}
            <span className="text-foreground font-semibold">
              {target?.teamName ?? "a manager"}
            </span>{' '}
            ({target ? `@${target.username}` : ""}) — the higher gameweek score
            takes the stake from the loser. A tie returns both sides' points.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="wager-stake">Stake (points)</Label>
              <Input
                id="wager-stake"
                value={stake}
                onChange={(e) => setStake(e.target.value)}
                inputMode="numeric"
                placeholder="1–50"
              />
              {stake.trim() !== "" && !stakeValid && (
                <p className="text-destructive text-xs">Enter 1–50 points.</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label>Gameweek</Label>
              <Select value={stage} onValueChange={(v) => setStage(v as Stage)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="semifinal1">{STAGE_LABELS_FALLBACK.semifinal1}</SelectItem>
                  <SelectItem value="third_place">{STAGE_LABELS_FALLBACK.third_place}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            className="w-full"
            disabled={!stakeValid || busy}
            onClick={async () => {
              setBusy(true);
              const ok = await onSend(parsedStake, stage);
              setBusy(false);
              if (ok) onClose();
            }}
          >
            {busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Swords className="mr-1.5 size-4" />}
            Send challenge
          </Button>

          {/* Open challenges — accept/decline/cancel */}
          {openWagers.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Open challenges
              </p>
              {openWagers.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-violet-400/30 bg-violet-400/5 px-3 py-2"
                >
                  <div className="min-w-0 text-xs">
                    <p className="truncate font-semibold">
                      {w.amChallenger
                        ? `You → @${w.opponentName}`
                        : `@${w.challengerName} → You`}
                    </p>
                    <p className="text-muted-foreground">
                      {w.stake} pts · GW{w.stage === "semifinal1" || w.stage === "semifinal2" ? "1" : "2"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {w.amChallenger ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => handleRespond(w.id, "cancel")}
                        title="Cancel challenge"
                      >
                        <X className="size-3.5" />
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => handleRespond(w.id, "accept")}>
                          Accept
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => handleRespond(w.id, "decline")}>
                          Decline
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recently settled */}
          {settled.map((w) => {
            // Win check: the recorded winner must match my side of the wager.
            const myId = w.amChallenger ? w.challengerId : w.opponentId;
            const iWon = w.winnerId !== null && w.winnerId === myId;
            return (
              <div key={w.id} className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-1.5 text-xs">
                <span className="text-muted-foreground">
                  vs @{w.amChallenger ? w.opponentName : w.challengerName} · {w.stake} pts
                </span>
                <Badge
                  variant="outline"
                  className={
                    w.winnerId === null
                      ? "border-slate-400/40 text-slate-300" // tie — stake returned
                      : iWon
                        ? "border-emerald-400/40 text-emerald-300"
                        : "border-red-400/40 text-red-300"
                  }
                >
                  {w.winnerId === null ? "TIE" : iWon ? "WON" : "LOST"}
                </Badge>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
