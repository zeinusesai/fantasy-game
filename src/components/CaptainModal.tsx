import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HouseBadge, PositionChip } from "@/components/houses";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import type { House, Position } from "@/convex/schema";
import { Crown, Flame, Loader2, Trophy, Users } from "lucide-react";

/** A squad member as the captain picker needs them. */
export type CaptainCandidate = {
  _id: Id<"players">;
  name: string;
  position: Position;
  house: House;
  image?: string | null;
};

/**
 * The all-zero fallback. Declared as a module constant so its identity is
 * stable — a new object literal every render would re-memo downstream.
 */
const EMPTY_CAPTAIN_DATA = {
  totalSquads: 0,
  totalCaptains: 0,
  percentages: {} as Record<string, number>,
  counts: {} as Record<string, number>,
  topCaptainId: null as string | null,
  topPercentage: 0,
  top: [] as Array<{
    playerId: string;
    count: number;
    percentage: number;
    name: string | null;
    house: string | null;
    position: string | null;
  }>,
};

/**
 * Captain picker with live "Most Captained" analytics.
 *
 * Shows, per candidate:
 *  - a "🔥 N% Captained" pill (0% when nobody has picked them yet), and
 *  - a distinct "Top Captain Choice" tag on the league's #1 captain.
 *
 * ZERO-ERROR CONTRACT:
 *  - The analytics query resolves to a fully-formed zero object, and every
 *    lookup is `?? 0`, so an empty league (no squad has set a captain) renders
 *    clean 0% badges — no NaN, no divide-by-zero.
 *  - The query is REACTIVE (`useQuery`) but runs entirely off the render path,
 *    so opening this modal never blocks the animations or the selection.
 *  - Selection is local state until "Confirm" — dismissing discards cleanly.
 */
export function CaptainModal({
  open,
  onOpenChange,
  candidates,
  captainId,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The manager's current seven. */
  candidates: CaptainCandidate[];
  /** The captain already saved (or null if none yet). */
  captainId: Id<"players"> | null;
  onConfirm: (playerId: Id<"players">) => void;
}) {
  // Local draft so the modal can be cancelled without touching the squad.
  const [draft, setDraft] = useState<Id<"players"> | null>(null);

  const data = useQuery(api.squads.getMostCaptainedPlayers) ?? EMPTY_CAPTAIN_DATA;

  // Defensive: the query's dictionaries can be anything on a cold/corrupt row.
  const percentages = data.percentages ?? EMPTY_CAPTAIN_DATA.percentages;
  const topCaptainId = typeof data.topCaptainId === "string" ? data.topCaptainId : null;
  const totalCaptains =
    Number.isFinite(data.totalCaptains) && data.totalCaptains > 0
      ? Math.floor(data.totalCaptains)
      : 0;

  const pctFor = useMemo(
    () => (playerId: string): number => {
      const raw = percentages[playerId];
      const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
      return Math.min(Math.max(n, 0), 100);
    },
    [percentages],
  );

  const safeCandidates = (Array.isArray(candidates) ? candidates : []).filter(
    (p): p is CaptainCandidate => !!p && typeof p?._id === "string" && !!p._id,
  );

  // Nothing chosen yet → default to the current captain, or the top pick.
  const selectedId = draft ?? captainId;

  const confirm = () => {
    if (!selectedId) return;
    onConfirm(selectedId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="text-primary size-4" /> Choose your captain
          </DialogTitle>
          <DialogDescription>
            Your captain earns <strong>2× points</strong> every match. The pills
            show how much of the league has made each player their skipper.
          </DialogDescription>
        </DialogHeader>

        {/* League summary — honest about an empty league. */}
        <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="secondary" className="text-[10px] uppercase">
            <Users className="mr-1 size-3" />
            {totalCaptains} captain{totalCaptains === 1 ? "" : "s"} set
          </Badge>
          {totalCaptains === 0 ? (
            <span>No captains chosen yet — be the first.</span>
          ) : topCaptainId ? (
            <span>
              League leader:{" "}
              <span className="text-foreground font-semibold">
                {data.top?.[0]?.name ?? "—"}
              </span>{" "}
              at {pctFor(topCaptainId)}%
            </span>
          ) : null}
        </div>

        {safeCandidates.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            Pick some players first — your seven will appear here.
          </p>
        ) : (
          <div className="max-h-[45vh] space-y-1.5 overflow-y-auto pr-1">
            {safeCandidates.map((p) => {
              const pct = pctFor(p._id as string);
              const isTop = topCaptainId !== null && topCaptainId === p._id;
              const isSelected = selectedId === p._id;
              return (
                <button
                  key={p._id}
                  type="button"
                  onClick={() => setDraft(p._id)}
                  aria-pressed={isSelected}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl border p-2 text-left transition-colors",
                    isSelected
                      ? "border-amber-400/60 bg-amber-400/10"
                      : "border-border/70 bg-secondary/30 hover:border-primary/40",
                  )}
                >
                  <PlayerAvatar player={p} size={34} className="ring-0" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-semibold">
                        {p.name}
                      </span>
                      <HouseBadge house={p.house} />
                      <PositionChip position={p.position} />
                    </span>
                    {/* Percentage pill. Always rendered (0% when unpicked) so
                        the row height never jumps as the league changes. */}
                    <span
                      className={cn(
                        "mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                        pct > 0
                          ? "bg-orange-400/15 text-orange-300"
                          : "bg-secondary text-muted-foreground",
                      )}
                    >
                      {pct > 0 && <Flame className="size-2.5" />}
                      {pct}% Captained
                    </span>
                  </span>
                  {isTop && (
                    <Badge className="shrink-0 border border-amber-300/60 bg-amber-400/15 text-[10px] text-amber-200 uppercase">
                      <Trophy className="mr-1 size-3" /> Top captain choice
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={!selectedId}>
            {selectedId ? "Confirm captain" : "Pick a captain"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Compact "Most Captained" summary for the Squad Builder's captain card.
 * Renders nothing at all when nobody has set a captain, so an empty league
 * doesn't add visual noise.
 */
export function MostCaptainedSummary({
  playerId,
  isCaptain,
}: {
  playerId: Id<"players"> | null;
  isCaptain: boolean;
}) {
  const data = useQuery(api.squads.getMostCaptainedPlayers) ?? EMPTY_CAPTAIN_DATA;
  if (!playerId) return null;

  const percentages = data.percentages ?? EMPTY_CAPTAIN_DATA.percentages;
  const raw = percentages[playerId as string];
  const pct =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.min(Math.max(raw, 0), 100)
      : 0;
  const topCaptainId =
    typeof data.topCaptainId === "string" ? data.topCaptainId : null;
  const isTop = topCaptainId !== null && topCaptainId === playerId;
  const hasData = pct > 0 || isTop;

  if (!hasData && !isCaptain) return null;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {isTop && (
        <Badge className="border border-amber-300/60 bg-amber-400/15 text-[10px] text-amber-200 uppercase">
          <Trophy className="mr-1 size-3" /> Top captain choice
        </Badge>
      )}
      {pct > 0 && (
        <Badge
          variant="secondary"
          className={cn(
            "text-[10px] uppercase",
            isCaptain && "border border-orange-400/40 bg-orange-400/15 text-orange-300",
          )}
        >
          {isCaptain && <Flame className="mr-1 size-3" />}
          {pct}% Captained
        </Badge>
      )}
      {isCaptain && !hasData && (
        <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
          <Loader2 className="size-3 animate-spin" /> No captain data yet
        </span>
      )}
    </span>
  );
}