import { cn } from "@/lib/utils";

/**
 * Loading skeletons.
 *
 * Used instead of a blank (often white) screen while a Convex query resolves.
 * These are pure presentational components — no data, no effects — so they can
 * never throw and never interact with the socket.
 */

/** A block that pulses. `className` controls the size. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("skeleton block", className)} />;
}

/**
 * N stacked card placeholders. Renders `count` rows so a list arriving from
 * `undefined` → `[]` → populated does not visibly jump in size.
 */
export function SkeletonList({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  const rows = Math.max(1, Math.min(count, 12));
  return (
    <div className={cn("space-y-2", className)} role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex min-h-[56px] items-center gap-3 rounded-xl border border-border/70 bg-secondary/30 p-3"
        >
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="skeleton-text max-w-[60%]" />
            <Skeleton className="skeleton-text max-w-[35%]" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A single wide placeholder for a hero/header block. */
export function SkeletonCard({ className }: { className?: string }) {
  return <Skeleton className={cn("h-24 w-full rounded-2xl", className)} />;
}
