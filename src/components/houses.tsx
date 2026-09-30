import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { HOUSE_META } from "@/convex/configDefaults";
import type { House, Position } from "@/convex/schema";

/** Resolve the house color (custom logos override the default palette). */
export function useHouseLogos(): Record<House, string | null> {
  const logos = useQuery(api.houses.listHouseLogos) ?? null;
  return (logos ?? {
    Fire: null,
    Earth: null,
    Wind: null,
    Water: null,
  }) as Record<House, string | null>;
}

const TEXT_COLORS: Record<House, string> = {
  Fire: "text-red-400",
  Earth: "text-emerald-400",
  Wind: "text-amber-300",
  Water: "text-blue-400",
};

const DOT_COLORS: Record<House, string> = {
  Fire: "bg-red-500",
  Earth: "bg-emerald-500",
  Wind: "bg-amber-400",
  Water: "bg-blue-500",
};

const RING_COLORS: Record<House, string> = {
  Fire: "ring-red-500/40",
  Earth: "ring-emerald-500/40",
  Wind: "ring-amber-400/40",
  Water: "ring-blue-500/40",
};

export function HouseDot({ house, className }: { house: House; className?: string }) {
  return (
    <span
      className={cn("inline-block size-2.5 rounded-full shrink-0", DOT_COLORS[house], className)}
      aria-hidden
    />
  );
}

export function HouseCrest({
  house,
  size = 40,
  className,
}: {
  house: House;
  size?: number;
  className?: string;
}) {
  const logos = useHouseLogos();
  const custom = logos[house];
  if (custom) {
    return (
      <img
        src={custom}
        alt={`${house} crest`}
        width={size}
        height={size}
        className={cn("rounded-lg object-cover ring-1", RING_COLORS[house], className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={cn(
        "font-display inline-flex items-center justify-center rounded-lg font-bold uppercase ring-1",
        RING_COLORS[house],
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        color: HOUSE_META[house].color,
        background: `${HOUSE_META[house].color}1a`,
      }}
      aria-label={`${house} crest`}
    >
      {house.slice(0, 2)}
    </span>
  );
}

export function HouseBadge({ house, className }: { house: House; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        "bg-secondary text-secondary-foreground",
        TEXT_COLORS[house],
        className,
      )}
    >
      <HouseDot house={house} />
      {house}
    </span>
  );
}

const POSITION_STYLES: Record<Position, string> = {
  GK: "bg-amber-400/15 text-amber-300 ring-amber-400/30",
  DEF: "bg-blue-500/15 text-blue-300 ring-blue-500/30",
  MID: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  FWD: "bg-red-500/15 text-red-300 ring-red-500/30",
};

export function PositionChip({
  position,
  className,
}: {
  position: Position;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide ring-1",
        POSITION_STYLES[position],
        className,
      )}
    >
      {position}
    </span>
  );
}

export function RatingBadge({ rating, className }: { rating: number; className?: string }) {
  const high = rating >= 8;
  const low = rating < 6;
  return (
    <span
      className={cn(
        "font-score inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-bold ring-1",
        high
          ? "bg-emerald-500/15 text-emerald-300 ring-emerald-400/40"
          : low
            ? "bg-red-500/10 text-red-300 ring-red-400/30"
            : "bg-secondary text-secondary-foreground ring-border",
        className,
      )}
    >
      {rating.toFixed(1)}
    </span>
  );
}
