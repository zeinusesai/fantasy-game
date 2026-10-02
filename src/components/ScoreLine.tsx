// ── ScoreLine ────────────────────────────────────────────────────────────
//
// One scoreboard renderer for every surface (Dashboard, Match Centre,
// Tournament bracket, admin list) so a penalty shootout can never be shown
// one way in the bracket and another way on the dashboard.
//
// All formatting comes from the shared pure rules in @/convex/penalties,
// which the server also uses — the UI cannot invent a different result.
//
// Defensive by construction: every field is read through the null-safe
// helpers, so a match row written before penalties existed (all fields
// undefined), or a partially-corrupt row, renders a clean score.

import { Trophy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatScoreLine,
  formatShootoutSummary,
  hasDecidedShootout,
  goesToPenalties,
  resolveMatchWinner,
  type PenaltyMatchLike,
} from "@/convex/penalties";

/**
 * Regulation score with the shootout appended, e.g. "2 – 2 (4 – 3 PEN)".
 * `className` lets callers keep their existing score typography.
 */
export function ScoreLine({
  match,
  className,
  sep = "–",
}: {
  match: PenaltyMatchLike | null | undefined;
  className?: string;
  sep?: string;
}) {
  return (
    <span className={cn("font-score tabular-nums", className)}>
      {formatScoreLine(match, { sep })}
    </span>
  );
}

/**
 * The shootout badge: "won on penalties" with a trophy, or a neutral
 * "shootout pending" pill. Renders NOTHING for a match that was decided in
 * normal time, so it is safe to drop into any existing card without
 * changing the layout of non-knockout fixtures.
 */
export function PenaltyBadge({
  match,
  className,
  showPending = true,
}: {
  match: PenaltyMatchLike | null | undefined;
  className?: string;
  showPending?: boolean;
}) {
  const decided = hasDecidedShootout(match);
  if (!decided && !(showPending && goesToPenalties(match))) return null;

  if (decided) {
    const winner = resolveMatchWinner(match);
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/15 px-2 py-0.5 text-[11px] font-semibold text-amber-200",
          className,
        )}
      >
        <Trophy className="size-3 shrink-0" />
        <span className="truncate">
          {winner ? `${winner} win on pens` : "Won on pens"}
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-slate-500/40 bg-slate-500/15 px-2 py-0.5 text-[11px] font-semibold text-slate-300",
        className,
      )}
    >
      Shootout pending
    </span>
  );
}

/**
 * A checkmark next to the house that advanced, so tournament progression is
 * readable at a glance. Returns null for a non-won / undecided match.
 */
export function WinnerTick({
  match,
  house,
  className,
}: {
  match: PenaltyMatchLike | null | undefined;
  house: string | null | undefined;
  className?: string;
}) {
  if (!house) return null;
  if (resolveMatchWinner(match) !== house) return null;
  return (
    <span
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300",
        className,
      )}
      title="Advanced"
      aria-label="Advanced"
    >
      <Check className="size-3" strokeWidth={3} />
    </span>
  );
}

/**
 * One-line sentence for a decided shootout:
 * "Fire wins 4–3 on penalties after a 2–2 draw." Null otherwise.
 */
export function ShootoutSummary({
  match,
  className,
}: {
  match: PenaltyMatchLike | null | undefined;
  className?: string;
}) {
  const summary = formatShootoutSummary(match);
  if (!summary) return null;
  return (
    <p className={cn("text-muted-foreground text-xs", className)}>{summary}</p>
  );
}

/**
 * Trophy variant for the champion: only renders when this fixture produced a
 * penalty-decided winner.
 */
export function ShootoutTrophy({
  match,
  className,
}: {
  match: PenaltyMatchLike | null | undefined;
  className?: string;
}) {
  if (!hasDecidedShootout(match)) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-amber-300",
        className,
      )}
    >
      <Trophy className="size-4" />
    </span>
  );
}
