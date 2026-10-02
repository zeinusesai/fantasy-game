import { cn } from "@/lib/utils";
import { HouseDot, RatingBadge } from "./houses";
import { PlayerAvatar, type PhotoSource } from "./PlayerAvatar";
import { StatusBadge } from "./StatusBadge";
import {
  DEFAULT_FORMATION,
  formationSlots,
  formationSummary,
  resolveFormation,
} from "@/convex/formations";
import type { FormationSlot } from "@/convex/formations";
import type { House, Position } from "@/convex/schema";
import {
  normalizePitchTheme,
  pitchMarkingsClass,
  pitchThemeClass,
  type PitchTheme,
} from "@/lib/pitchTheme";

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
  /** Super Admin availability label; absent = treated as "Expected to Start". */
  statusLabel?: string | null;
};

/** Row order used everywhere: goalkeeper (bottom) up to forwards (top). */
const ROW_ORDER: Position[] = ["GK", "DEF", "MID", "FWD"];

/** Where an overflowing player is parked so they can never fall off the pitch. */
const OVERFLOW_Y = 97;

/**
 * Minimum tap target per Apple HIG / Material accessibility (44 × 44 px).
 * The visual disc stays at `NODE_SIZE`; the hit area is expanded by the
 * PlayerBadge padding layer so nothing grows or overlaps on the pitch.
 */
const NODE_SIZE = 52;

/**
 * Map the selected players onto the formation's 7 pitch slots.
 *
 * Two passes so nothing is ever dropped: players are first placed in a slot
 * that matches their own position, then any leftovers (e.g. three defenders
 * under a 2-3-1) fill whatever slots are still empty. A player who still has
 * nowhere to go gets a safe overflow row at the bottom — the pitch always
 * shows every player passed in.
 */
function assignToSlots(
  byPosition: Partial<Record<Position, PitchPlayer[]>>,
  formation: string,
): Array<{ slot: FormationSlot; player: PitchPlayer | null }> {
  const base = formationSlots(formation); // always exactly 7 slots
  const cells: Array<{ slot: FormationSlot; player: PitchPlayer | null }> = base.map((slot) => ({
    slot,
    player: null,
  }));

  const pools = new Map<Position, PitchPlayer[]>();
  for (const position of ROW_ORDER) {
    const list = Array.isArray(byPosition[position]) ? byPosition[position] : [];
    // Defensive: keep only entries that look like real players. The id must be
    // non-empty — a blank one would collide as a React key and render nothing.
    pools.set(
      position,
      list.filter(
        (p): p is PitchPlayer =>
          !!p &&
          typeof p.playerId === "string" &&
          p.playerId.trim().length > 0 &&
          typeof p.name === "string",
      ),
    );
  }

  // Pass 1 — position-accurate placement.
  for (const position of ROW_ORDER) {
    const pool = pools.get(position) ?? [];
    let taken = 0;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].slot.position === position && taken < pool.length) {
        cells[i].player = pool[taken];
        taken += 1;
      }
    }
    pools.set(position, pool.slice(taken));
  }

  // Pass 2 — leftovers fill any remaining slot.
  const leftovers: PitchPlayer[] = [];
  for (const position of ROW_ORDER) leftovers.push(...(pools.get(position) ?? []));
  let li = 0;
  for (let i = 0; i < cells.length && li < leftovers.length; i++) {
    if (!cells[i].player) {
      cells[i].player = leftovers[li];
      li += 1;
    }
  }

  // Pass 3 — still homeless players get a safe spot below the pitch line.
  for (; li < leftovers.length; li++) {
    cells.push({ slot: { position: leftovers[li].position, x: 50, y: OVERFLOW_Y }, player: leftovers[li] });
  }
  return cells;
}

/**
 * Circular player badge with optional custom photo. If the photo URL is
 * missing or fails to load, we fall back to the initials/kit-letter disc —
 * the component never renders a broken image.
 *
 * CIRCLE-CLIPPING FIX: this container is deliberately `overflow-visible`, NOT
 * `overflow-hidden`. The captain badge is anchored half outside the disc
 * (top-right corner), so an `overflow-hidden` circle cropped it in half. Only
 * the inner avatar keeps `overflow-hidden`, which is what actually needs to be
 * round. An extra padding wrapper guarantees the glow/shadow is never cut off
 * by a tight parent box either.
 *
 * `golden` swaps the disc for the metallic store jersey.
 */
export function PlayerBadge({
  player,
  size = 64,
  golden = false,
}: {
  player: PhotoSource & {
    name: string;
    position: Position;
    isCaptain?: boolean;
  };
  size?: number;
  /** Store cosmetic: render the golden jersey disc. */
  golden?: boolean;
}) {
  return (
    // Padding layer: gives the captain badge + glow room to render outside the
    // circle without being clipped by this box.
    <span className="relative inline-flex shrink-0 overflow-visible p-1.5">
      <span
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-visible rounded-full",
          golden
            ? cn("jersey-gold", "ring-2 ring-amber-200/90 shadow-[0_0_20px_rgba(251,191,36,0.55)]")
            : "bg-slate-900/85 ring-2 ring-white/40 shadow-lg",
          player.isCaptain &&
            "ring-2 ring-amber-300 shadow-[0_0_18px_rgba(251,191,36,0.65)]",
        )}
        style={{ width: size, height: size }}
      >
        {/* Shared avatar: custom photo (`image` → `photoUrl`) with an initials +
            position placeholder on error, so a broken URL never shows up. The
            clip lives HERE (the avatar is a circle) rather than on the outer
            container, which must stay `overflow-visible` for the captain badge. */}
        <PlayerAvatar
          player={player}
          size={size}
          showPosition
          className="absolute inset-0 size-full overflow-hidden rounded-full ring-0 ring-offset-0"
        />
        {/* Golden captain armband frame — INSIDE the circle (inset-0) so it is
            never clipped, and at z-10 so it sits above the photo. */}
        {player.isCaptain && (
          <span
            aria-label="Captain"
            title="Captain"
            className="pointer-events-none absolute inset-0 z-10 rounded-full border-2 border-amber-300 shadow-[0_0_14px_rgba(251,191,36,0.7)]"
          />
        )}
      </span>

      {/* GOLDEN CAPTAIN BADGE — a sibling of the circle, NOT a child, so no
          ancestor's `overflow: hidden` can crop it. Anchored to the top-right
          corner at a fixed 20px (size-5), pulled half-outwards so it reads as
          an overlay rather than an inset dot, and layered with z-20 so it sits
          above both the disc and the player name below. Scales cleanly because
          every offset is a percentage/rem rather than a hard pixel value. */}
      {player.isCaptain && (
        <span
          aria-label="Captain"
          title="Captain — 2× points"
          className="pointer-events-none absolute right-0 top-0 z-20 flex size-5 -translate-y-1/4 translate-x-1/4 items-center justify-center rounded-full bg-gradient-to-br from-amber-200 via-yellow-400 to-amber-600 font-black leading-none text-amber-950 shadow-[0_0_10px_rgba(251,191,36,0.85)] ring-1 ring-amber-200/90 [font-size:10px] sm:size-[22px] sm:[font-size:11px]"
        >
          C
        </span>
      )}
    </span>
  );
}

/** Empty slot placeholder used while building a squad. */
export function EmptySlot({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      {/* Shrinks on mobile so an empty slot never crowds its neighbours. */}
      <div className="flex size-12 items-center justify-center rounded-full border-2 border-dashed border-white/40 bg-white/5 text-white/60 sm:size-16">
        <span className="text-lg font-bold sm:text-xl">+</span>
      </div>
      <span className="max-w-[70px] truncate text-[10px] font-medium text-white/60 sm:max-w-24">
        {label ?? "Empty"}
      </span>
    </div>
  );
}

/**
 * Vertical pitch: goalkeeper at the bottom, forwards at the top, laid out on
 * the selected 7-a-side formation's positional grid.
 *
 * `formation` is resolved through `resolveFormation`, so a missing, legacy or
 * corrupted value silently falls back to the 2-3-1 balanced default instead of
 * breaking the layout.
 */
export function PitchView({
  byPosition,
  emptyLabel,
  onSlotClick,
  formation,
  showStatus = false,
  showFormationLabel = false,
  className,
  theme,
  goldenJersey = false,
}: {
  byPosition: Partial<Record<Position, PitchPlayer[]>>;
  emptyLabel?: string;
  onSlotClick?: (position: Position) => void;
  /** Formation id, e.g. "3-2-1". Unknown/missing → 2-3-1. */
  formation?: string | null;
  /** Render the colour-coded availability dot under each player. */
  showStatus?: boolean;
  /** Show a "2-3-1 · Balanced" pill in the corner. */
  showFormationLabel?: boolean;
  className?: string;
  /**
   * Store cosmetic: pitch aesthetic. Any value is safe — null/undefined/junk
   * all resolve to the standard green pitch via `normalizePitchTheme`.
   */
  theme?: PitchTheme | string | null;
  /** Store cosmetic: render the starters' golden jerseys. */
  goldenJersey?: boolean;
}) {
  // Single safe resolution point — everything downstream uses these values.
  const currentFormation = resolveFormation(formation ?? DEFAULT_FORMATION);
  const currentTheme = normalizePitchTheme(theme);
  const premium = currentTheme === "premium";
  const gold = goldenJersey === true;
  const cells = assignToSlots(byPosition, currentFormation);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border p-3 shadow-inner sm:p-4",
        pitchThemeClass(currentTheme),
        className,
      )}
    >
      {/* markings */}
      <div
        className={cn(
          "pointer-events-none absolute inset-3 rounded-xl border border-white/25",
          pitchMarkingsClass(currentTheme),
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-x-3 top-1/2 h-px bg-white/25",
          pitchMarkingsClass(currentTheme),
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute left-1/2 top-1/2 size-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/25",
          pitchMarkingsClass(currentTheme),
        )}
      />

      {showFormationLabel && (
        <span className="absolute right-4 top-4 z-10 rounded-full border border-white/20 bg-slate-900/70 px-2 py-0.5 text-[10px] font-bold tracking-wide text-emerald-100 backdrop-blur">
          {formationSummary(currentFormation)}
        </span>
      )}

      {/* Premium-pitch watermark — purely decorative, pointer-events-none. */}
      {premium && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-3 left-1/2 z-0 -translate-x-1/2 text-[10px] font-black uppercase tracking-[0.25em] text-amber-200/40"
        >
          Premium Pitch
        </span>
      )}

      {/* Aspect-locked pitch: it scales with the VIEWPORT WIDTH instead of a
          fixed pixel height, so all seven slots (plus the bench strip callers
          render below it) fit on an iPhone SE through Pro Max with no
          horizontal cut-off. `max-h-[62dvh]` keeps a very tall screen from
          pushing the fold too far down. */}
      <div className="relative z-[1] mx-auto aspect-[3/4] max-h-[62dvh] w-full max-w-[360px] sm:max-w-none">
        {cells.map((cell, i) => {
          const { slot, player } = cell;
          const p = player;
          return (
            <div
              key={p ? p.playerId : `empty-${slot.position}-${i}`}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
              style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
            >
              {!p ? (
                <button
                  onClick={() => onSlotClick?.(slot.position)}
                  className={
                    onSlotClick
                      ? "cursor-pointer transition-transform hover:scale-105"
                      : "cursor-default"
                  }
                  aria-label={`Empty ${slot.position} slot`}
                >
                  <EmptySlot label={emptyLabel} />
                </button>
              ) : (
                <>
                  <div className="relative flex justify-center">
                    {/* `NODE_SIZE` (52px) is the visual disc; the PlayerBadge
                        padding layer expands the HIT area to 44px+ without
                        growing the node, so adjacent slots never collide. */}
                    <PlayerBadge player={p} size={NODE_SIZE} golden={gold} />
                    {p.isPotm && (
                      // Top-LEFT: the top-right corner belongs to the captain
                      // badge, so the two never overlap.
                      <span
                        className="absolute -left-1 -top-1 z-20 rounded-full bg-amber-400 px-1 text-[9px] font-black text-amber-950 shadow"
                        title="Player of the Match"
                      >
                        ★
                      </span>
                    )}
                  </div>
                  {/* Compact label: truncates on one line and is capped so a
                      long name can never widen the card or hide the captain
                      badge. `text-fit` also breaks very long unbroken words. */}
                  <span
                    className={cn(
                      "block max-w-[70px] truncate text-[10px] font-semibold text-white drop-shadow sm:max-w-24 sm:text-xs",
                      gold && "text-amber-100",
                    )}
                  >
                    {p.name}
                  </span>
                  <div className="flex items-center gap-1">
                    <HouseDot house={p.house} />
                    {p.rating != null && <RatingBadge rating={p.rating} />}
                    {showStatus && <StatusBadge status={p.statusLabel} dot short />}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
