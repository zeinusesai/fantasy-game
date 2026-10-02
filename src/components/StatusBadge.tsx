import { cn } from "@/lib/utils";
import { PLAYER_STATUS_LABELS, type PlayerStatusLabel } from "@/convex/schema";

/**
 * Shared availability chip for a player ("Expected to Start" / "Sub" /
 * "Not Play"), set by the Super Admin.
 *
 * Zero-error by design: any missing, unknown or malformed value falls back to
 * "Expected to Start", so a bad status string can never render a broken chip
 * or an undefined class. The compact `dot` mode is used on the pitch, where
 * space is tight.
 */

export const DEFAULT_STATUS_LABEL: PlayerStatusLabel = "Expected to Start";

/** Tailwind classes per status — all three are always defined. */
const STYLES: Record<PlayerStatusLabel, string> = {
  "Expected to Start":
    "border-emerald-400/50 bg-emerald-500/15 text-emerald-200",
  Sub: "border-amber-400/50 bg-amber-500/15 text-amber-200",
  "Not Play": "border-rose-500/50 bg-rose-500/15 text-rose-200",
};

const DOT_STYLES: Record<PlayerStatusLabel, string> = {
  "Expected to Start": "bg-emerald-400",
  Sub: "bg-amber-400",
  "Not Play": "bg-rose-500",
};

/** Short form used on tight chips and pitch markers. */
const SHORT: Record<PlayerStatusLabel, string> = {
  "Expected to Start": "Starts",
  Sub: "Sub",
  "Not Play": "Out",
};

/**
 * Normalise any raw status value to a valid label. Unknown strings, null and
 * undefined all resolve to "Expected to Start" (never undefined, never throws).
 */
export function normalizeStatus(value?: string | null): PlayerStatusLabel {
  if (typeof value !== "string") return DEFAULT_STATUS_LABEL;
  const trimmed = value.trim();
  const match = PLAYER_STATUS_LABELS.find((s) => s === trimmed);
  return match ?? DEFAULT_STATUS_LABEL;
}

/** True when the value is a recognised status label. */
export function isKnownStatus(value?: string | null): value is PlayerStatusLabel {
  return typeof value === "string" && (PLAYER_STATUS_LABELS as readonly string[]).includes(value.trim());
}

/** All statuses, re-exported for pickers. */
export const STATUS_OPTIONS = PLAYER_STATUS_LABELS;

/**
 * Colour-coded status pill. `dot` renders a compact marker instead of the full
 * chip; `short` truncates the label to "Starts" / "Sub" / "Out".
 */
export function StatusBadge({
  status,
  dot = false,
  short = false,
  className,
  title,
}: {
  status?: string | null;
  dot?: boolean;
  short?: boolean;
  className?: string;
  title?: string;
}) {
  // normalizeStatus already collapses unknown/missing values to the default,
  // so there is no branch here that can produce an undefined label.
  const label = normalizeStatus(status);

  if (dot) {
    return (
      <span
        title={title ?? label}
        aria-label={label}
        className={cn(
          "inline-block size-2 shrink-0 rounded-full ring-1 ring-black/40",
          DOT_STYLES[label],
          className,
        )}
      />
    );
  }

  return (
    <span
      title={title ?? label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
        STYLES[label],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT_STYLES[label])} />
      {short ? SHORT[label] : label}
    </span>
  );
}
