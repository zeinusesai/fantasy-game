import type { PlayerAvailability } from "@/convex/schema";
import { cn } from "@/lib/utils";

/**
 * Y11 PE Hub — simple availability / injury badge.
 *
 * Replaces the old starter / sub / reserve labels: a player is simply
 * 🟢 available, 🔴 injured (out of the upcoming gameweek) or 🟡 doubtful
 * (unlikely to play). Absent = available, so legacy rows read correctly.
 */
const META: Record<
  PlayerAvailability,
  { label: string; icon: string; className: string; warning?: string }
> = {
  available: {
    label: "Available",
    icon: "🟢",
    className: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  },
  injured: {
    label: "Injured",
    icon: "🔴",
    warning: "🚑",
    className: "border-red-400/50 bg-red-400/10 text-red-200",
  },
  doubtful: {
    label: "Doubtful",
    icon: "🟡",
    warning: "⚠️",
    className: "border-amber-400/50 bg-amber-400/10 text-amber-200",
  },
};

/** Normalises a stored status (missing/invalid → "available"). */
export function normalizeAvailability(
  value: string | null | undefined,
): PlayerAvailability {
  return value === "injured" || value === "doubtful" || value === "available"
    ? value
    : "available";
}

/** True when the player is out or unlikely to play for the next gameweek. */
export function isAvailabilityWarning(value: string | null | undefined): boolean {
  const status = normalizeAvailability(value);
  return status === "injured" || status === "doubtful";
}

export function AvailabilityBadge({
  status,
  className,
}: {
  status?: string | null;
  className?: string;
}) {
  const meta = META[normalizeAvailability(status)];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        meta.className,
        className,
      )}
      title={meta.warning ? `${meta.warning} ${meta.label}` : meta.label}
    >
      <span aria-hidden>{meta.icon}</span>
      {meta.label}
    </span>
  );
}