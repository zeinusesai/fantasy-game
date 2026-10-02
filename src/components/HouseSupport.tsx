// ── House support: manual preference UI ────────────────────────────────
//
// A manager's house is a MANUAL choice made in profile settings. It is
// deliberately NOT derived from their squad — that used to make a
// manager's identity silently change whenever they made a transfer.
//
// Both exports here are total: an unset or invalid house renders a clean
// neutral state rather than a fake house name, so a manager who has never
// chosen still sees a sensible, non-broken UI.

import { useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery } from "convex/react";
import { Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { HOUSES, type House } from "@/convex/schema";
import { normalizeHouse, houseLabel, DEFAULT_HOUSES } from "@/convex/defaults";
import { HouseDot } from "@/components/houses";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

/** Sentinel for "no house chosen" — never a real house name. */
const NONE = "__none__";

/** A selectable house, as rendered by the picker. */
export interface HouseOption {
  /**
   * Value submitted to the server. This is the STABLE house key
   * (`"Fire" | "Earth" | "Wind" | "Water"`) for database rows, and the
   * lowercase slug (`"fire"`) for the hardcoded fallback. `normalizeHouse`
   * accepts both, so either form is a valid mutation argument.
   */
  id: string;
  /** Display label, e.g. "Fire House". */
  name: string;
  /** Validated `#rrggbb` brand colour. */
  color: string;
  /** Resolved crest URL, or null for the themed default crest. */
  logoUrl: string | null;
  /**
   * The real house key this option maps to, or null when the row names a
   * house the app doesn't recognise (a stale/renamed config value). Used for
   * the dot/crest so a bad row degrades instead of throwing.
   */
  house: House | null;
}

/**
 * LAST-RESORT FALLBACK.
 *
 * The house dropdown used to render an empty, unselectable list whenever the
 * house query was still loading, errored, or returned nothing. These four
 * entries are the built-in houses, so the control ALWAYS has something to
 * offer — including "Wind" (the app's house for Air).
 *
 * The `id`s are lowercase slugs purely so they are readable in devtools; they
 * normalise to the same stored values as the database rows.
 */
export const defaultHouses: HouseOption[] = HOUSES.map((house) => ({
  id: house.toLowerCase(),
  name: `${house} House`,
  color: DEFAULT_HOUSES[house]?.color ?? "#888888",
  logoUrl: null,
  house,
}));

/**
 * The houses registered in the system, fetched dynamically from the database.
 *
 * Returns `{ houses, loading, fromDatabase }`:
 *   • `houses` is NEVER empty — an `undefined` (still loading) or empty
 *     response falls back to `defaultHouses`.
 *   • `loading` is true only while the first fetch is in flight, so the UI
 *     can show a subtle state without hiding the options.
 *   • `fromDatabase` tells the UI whether these are live rows or the fallback.
 *
 * This is the single source of truth for every house picker, so the profile
 * page and the profile modal can never disagree about the house list.
 */
export function toHouseOptions(rows: unknown): HouseOption[] {
  if (!Array.isArray(rows)) return [];
  const mapped: HouseOption[] = [];
  for (const row of rows) {
    // Defensive: a row the schema no longer recognises degrades to a plain
    // untyped option rather than rendering a broken entry or throwing.
    const raw = (row ?? {}) as Partial<HouseOption> & { id?: unknown };
    const house = normalizeHouse(raw.id);
    const color =
      typeof raw.color === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.color.trim())
        ? raw.color.trim()
        : (house ? DEFAULT_HOUSES[house]?.color : null) ?? "#888888";
    mapped.push({
      id: house ?? String(raw.id ?? "").trim().toLowerCase(),
      name:
        typeof raw.name === "string" && raw.name.trim().length > 0
          ? raw.name.trim().slice(0, 40)
          : (house ? `${house} House` : "Unknown house"),
      color,
      logoUrl: typeof raw.logoUrl === "string" ? raw.logoUrl : null,
      house,
    });
  }
  return mapped;
}

export function useHouseOptions(): {
  houses: HouseOption[];
  loading: boolean;
  fromDatabase: boolean;
} {
  const houses = useQuery(api.houses.listHouses);
  if (!houses) {
    // Still loading (or the query errored and Convex left it undefined).
    return { houses: defaultHouses, loading: true, fromDatabase: false };
  }
  const mapped = toHouseOptions(houses);
  // An empty array from the server is treated the same as "not loaded yet":
  // an unselectable dropdown is never a useful state.
  if (mapped.length === 0) {
    return { houses: defaultHouses, loading: false, fromDatabase: false };
  }
  return { houses: mapped, loading: false, fromDatabase: true };
}

/**
 * Profile settings control for the supported house.
 *
 * The option list comes from `useHouseOptions()` (the database), so the
 * dropdown is populated even before the query resolves and even if it fails.
 *
 * Saves immediately on change via `users.updateSupportedHouse` — a
 * single-purpose mutation, so a rejected house can never clobber an unrelated
 * profile field. The local state only advances after the mutation resolves,
 * so a rejected write rolls back to the true stored value. Every failure path
 * is a toast, never a throw.
 */
/**
 * Shared save logic for every house control.
 *
 * Keeps ONE definition of "pick a house": resolve the choice, apply it
 * optimistically, call `users.updateSupportedHouse` inside a try/catch, toast
 * the outcome, and roll back on rejection. `busy` is true only while a write
 * is in flight so every control shows the same affordance.
 */
function useHousePick(onChange?: (house: House | null) => void) {
  const setHouse = useMutation(api.users.updateSupportedHouse);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<House | null>(null);

  const pick = async (next: string) => {
    // Show the choice immediately, but remember what was really stored so a
    // failed write can roll the control back.
    const previous = pending;
    const resolved = next === NONE ? null : normalizeHouse(next);
    if (next !== NONE && resolved === null) {
      toast.error("That is not a supported house.");
      return;
    }
    setPending(resolved);
    setBusy(true);
    try {
      await setHouse({
        // A blank value clears the preference server-side.
        supportedHouse: resolved ?? "",
        supportedHouseId: resolved ?? undefined,
      });
      toast.success(
        resolved
          ? `Supported House updated! You now support ${houseLabel(resolved)}.`
          : "Supported House cleared.",
      );
      onChange?.(resolved);
    } catch (err) {
      // Roll back so the control never shows a value the server rejected.
      setPending(previous);
      toast.error(
        err instanceof Error ? err.message : "Could not update your supported house.",
      );
    } finally {
      setBusy(false);
    }
  };

  return { pick, busy, pending };
}

/**
 * Interactive badge grid of every registered house.
 *
 * An alternative to the `<Select>` for surfaces that benefit from showing
 * every house at once (the profile modal). The current choice is ringed and
 * tinted with the house's brand colour, and a "None" tile clears the
 * preference. Like the select, it is driven entirely by the dynamic house
 * list, so it is never empty.
 */
export function HouseBadgeGrid({
  houses,
  value,
  onChange,
  disabled,
  className,
}: {
  /** Usually `useHouseOptions().houses` — never pass an empty array. */
  houses: HouseOption[];
  value?: House | string | null;
  onChange?: (house: House | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const stored = normalizeHouse(value);
  const { pick, busy, pending } = useHousePick(onChange);
  const shown = pending ?? stored;
  // Defensive: an empty list falls back so the grid always offers a choice.
  const options = houses.length > 0 ? houses : defaultHouses;

  return (
    <div
      className={cn("flex flex-wrap gap-1.5", className)}
      role="radiogroup"
      aria-label="Supported house"
    >
      {options.map((option) => {
        const house = option.house;
        const selected = house !== null && house === shown;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || busy || house === null}
            onClick={() => void pick(house ?? option.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-60",
              selected
                ? "border-transparent text-foreground"
                : "border-border/70 bg-secondary/40 text-muted-foreground hover:border-border hover:text-foreground",
            )}
            style={
              selected
                ? {
                    backgroundColor: `${option.color}26`,
                    boxShadow: `inset 0 0 0 1px ${option.color}80`,
                    color: option.color,
                  }
                : undefined
            }
          >
            {house ? (
              <HouseDot house={house} className="size-2" />
            ) : (
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: option.color }}
                aria-hidden
              />
            )}
            {option.name}
            {busy && selected ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : null}
          </button>
        );
      })}
      {/* Only offered once a house is actually chosen — a manager who has
          never picked one has nothing to clear. */}
      {shown ? (
        <button
          type="button"
          onClick={() => void pick(NONE)}
          disabled={disabled || busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border/70 px-2.5 py-1 text-xs font-semibold text-muted-foreground transition hover:border-border hover:text-foreground focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          No house
        </button>
      ) : null}
    </div>
  );
}

export function HouseSelector({
  value,
  onChange,
  disabled,
  className,
  id,
}: {
  value?: House | string | null;
  onChange?: (house: House | null) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const { houses, loading, fromDatabase } = useHouseOptions();
  const { pick, busy, pending } = useHousePick(onChange);

  // `null` when nothing valid is stored.
  const stored = normalizeHouse(value);
  const shown = pending ?? stored;
  // The display name for the currently-shown house, preferring the live row.
  const shownOption = shown ? houses.find((h) => h.house === shown) : undefined;
  const shownLabel = shownOption?.name ?? houseLabel(shown);

  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id} className="flex items-center gap-1.5">
        <ShieldCheck className="size-3.5 text-muted-foreground" />
        Supported house
      </Label>
      <Select
        value={shown ?? NONE}
        onValueChange={(v) => void pick(v)}
        disabled={disabled || busy}
      >
        <SelectTrigger id={id} aria-label="Supported house">
          <span className="flex min-w-0 items-center gap-2">
            {busy ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : shown ? (
              <HouseDot house={shown} />
            ) : null}
            <span className="truncate">
              {shown ? shownLabel : "No house selected"}
            </span>
          </span>
        </SelectTrigger>
        <SelectContent>
          {houses.map((option) => (
            <SelectItem key={option.id} value={option.house ?? option.id}>
              <span className="flex items-center gap-2">
                {option.house ? (
                  <HouseDot house={option.house} />
                ) : (
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: option.color }}
                    aria-hidden
                  />
                )}
                {option.name}
              </span>
            </SelectItem>
          ))}
          {/* Only offered once a house is actually chosen — a manager who
              has never picked one has nothing to clear. */}
          {shown && (
            <SelectItem value={NONE}>No house selected</SelectItem>
          )}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-[11px]">
        {loading
          ? "Loading houses…"
          : fromDatabase
            ? "Purely cosmetic — your house is chosen by you and never changes when you edit your squad."
            : "Showing the built-in houses — reconnect to load the full list."}
      </p>
    </div>
  );
}

/**
 * The subtle indicator shown next to a manager's name on the leaderboard
 * and in the profile header.
 *
 * Deliberately small: a dot, not a full crest, so it never competes with
 * the team name or the points figure. Renders nothing at all when no house
 * is set, rather than a grey placeholder that would imply a choice.
 */
export function HouseSupportDot({
  house,
  className,
  withLabel = false,
}: {
  house?: House | string | null;
  className?: string;
  withLabel?: boolean;
}) {
  const resolved = normalizeHouse(house);
  if (!resolved) return null;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1", className)}
      title={`Supports ${resolved}`}
    >
      <HouseDot house={resolved} className="size-2" />
      {withLabel && (
        <span className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">
          {resolved}
        </span>
      )}
    </span>
  );
}

/** Text-only label, for stat rows. "No house" when unset. */
export function HouseSupportLabel({
  house,
  className,
}: {
  house?: House | string | null;
  className?: string;
}) {
  return <span className={className}>{houseLabel(house)}</span>;
}
