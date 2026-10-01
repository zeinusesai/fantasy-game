import { cn } from "@/lib/utils";
import { HouseDot, RatingBadge } from "./houses";
import { PlayerAvatar, type PhotoSource } from "./PlayerAvatar";
import type { House, Position } from "@/convex/schema";

export type PitchPlayer = {
  playerId: string;
  name: string;
  position: Position;
  house: House;
  price?: number;
  /** Custom player photo (URL or data URL) — the whole card is null-safe. */
  image?: string | null;
  /** Legacy alias so older lineup payloads still render their photo. */
  photoUrl?: string | null;
  rating?: number | null;
  isCaptain?: boolean;
  isPotm?: boolean;
};

const ROWS: { position: Position; slots: number; label: string }[] = [
  { position: "GK", slots: 1, label: "Goalkeeper" },
  { position: "DEF", slots: 2, label: "Defenders" },
  { position: "MID", slots: 2, label: "Midfielders" },
  { position: "FWD", slots: 2, label: "Forwards" },
];

/**
 * Circular player badge with optional custom photo. If the photo URL is
 * missing or fails to load, we fall back to the initials/kit-letter disc —
 * the component never renders a broken image.
 */
export function PlayerBadge({
  player,
  size = 64,
}: {
  player: PhotoSource & {
    name: string;
    position: Position;
    isCaptain?: boolean;
  };
  size?: number;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center overflow-hidden rounded-full ring-2 shadow-lg",
        player.isCaptain
          ? "bg-slate-900/90 ring-2 ring-amber-300 shadow-[0_0_18px_rgba(251,191,36,0.65)]"
          : "bg-slate-900/85 ring-white/40",
      )}
      style={{ width: size, height: size }}
    >
      {/* Shared avatar: custom photo (`image` → `photoUrl`) with an initials +
          position placeholder on error, so a broken URL never shows up. */}
      <PlayerAvatar
        player={player}
        size={size}
        showPosition
        className="absolute inset-0 size-full ring-0 ring-offset-0"
      />
      {/* Golden captain armband frame */}
      {player.isCaptain && (
        <span
          aria-label="Captain"
          title="Captain"
          className="pointer-events-none absolute inset-0 rounded-full border-2 border-amber-300 shadow-[0_0_14px_rgba(251,191,36,0.7)]"
        >
          <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-amber-300 to-yellow-500 px-1.5 text-[8px] font-black tracking-wide text-amber-950 shadow">
            (C)
          </span>
        </span>
      )}
    </div>
  );
}

/** Empty slot placeholder used while building a squad. */
export function EmptySlot({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex size-16 items-center justify-center rounded-full border-2 border-dashed border-white/40 bg-white/5 text-white/60">
        <span className="text-xl font-bold">+</span>
      </div>
      <span className="text-[10px] font-medium text-white/60">{label ?? "Empty"}</span>
    </div>
  );
}

/**
 * Vertical pitch: rows from goalkeeper (bottom) to forwards (top).
 * `byPosition` supplies the players for each row; missing slots render empty.
 */
export function PitchView({
  byPosition,
  emptyLabel,
  onSlotClick,
}: {
  byPosition: Partial<Record<Position, PitchPlayer[]>>;
  emptyLabel?: string;
  onSlotClick?: (position: Position) => void;
}) {
  return (
    <div className="pitch-bg relative overflow-hidden rounded-2xl border border-emerald-900/50 p-4 shadow-inner">
      {/* markings */}
      <div className="pointer-events-none absolute inset-3 rounded-xl border border-white/25" />
      <div className="pointer-events-none absolute inset-x-3 top-1/2 h-px bg-white/25" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 size-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/25" />

      <div className="relative flex flex-col-reverse gap-4 py-2">
        {ROWS.map(({ position, slots }) => {
          const players = byPosition[position] ?? [];
          return (
            <div key={position} className="flex flex-col items-center gap-1.5">
              <div className="flex items-center justify-center gap-4 sm:gap-8">
                {Array.from({ length: slots }).map((_, i) => {
                  const p = players[i];
                  if (!p) {
                    return (
                      <button
                        key={i}
                        onClick={() => onSlotClick?.(position)}
                        className={onSlotClick ? "cursor-pointer transition-transform hover:scale-105" : "cursor-default"}
                        aria-label={`Empty ${position} slot`}
                      >
                        <EmptySlot label={emptyLabel} />
                      </button>
                    );
                  }
                  return (
                    <div key={p.playerId} className="flex flex-col items-center gap-1">
                      <div className="relative">
                        <PlayerBadge player={p} size={64} />
                        {p.isPotm && (
                          <span
                            className="absolute -right-1 -top-1 rounded-full bg-amber-400 px-1 text-[9px] font-black text-amber-950 shadow"
                            title="Player of the Match"
                          >
                            ★
                          </span>
                        )}
                      </div>
                      <span className="max-w-24 truncate text-xs font-semibold text-white drop-shadow">
                        {p.name}
                      </span>
                      <div className="flex items-center gap-1">
                        <HouseDot house={p.house} />
                        {p.rating != null && <RatingBadge rating={p.rating} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
