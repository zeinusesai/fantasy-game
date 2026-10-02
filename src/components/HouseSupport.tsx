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
import { useMutation } from "convex/react";
import { Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { HOUSES, type House } from "@/convex/schema";
import { normalizeHouse, houseLabel } from "@/convex/defaults";
import { HouseDot } from "@/components/houses";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

/** Sentinel for "no house chosen" — never a real house name. */
const NONE = "__none__";

/**
 * Profile settings control for the supported house.
 *
 * Saves immediately on change (no separate Save button) and is fully
 * optimistic-free: the local state only advances after the mutation
 * resolves, so a rejected write leaves the control showing the true stored
 * value instead of drifting. Every failure path is a toast, never a throw.
 *
 * `?? []` on the option list is defensive so a bad HOUSES import can never
 * produce an empty, unselectable control.
 */
export function HouseSelector({
  value,
  teamName,
  onChange,
  disabled,
  className,
  id,
}: {
  value?: House | string | null;
  /**
   * The manager's current team name. `updateProfile` re-validates teamName on
   * every call, so it must be sent alongside the house change. When it is
   * missing or too short to be valid the control disables itself rather than
   * firing a mutation the server would reject.
   */
  teamName?: string | null;
  onChange?: (house: House | null) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const setProfile = useMutation(api.managers.updateProfile);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<House | null>(null);

  // `null` when nothing valid is stored.
  const stored = normalizeHouse(value);
  const shown = pending ?? stored;
  const houses = (HOUSES ?? []) as readonly House[];
  const usableName = typeof teamName === "string" ? teamName.trim() : "";
  const canSubmit = usableName.length >= 2 && usableName.length <= 40;

  const pick = async (next: string) => {
    if (!canSubmit) {
      toast.error("Set a team name (2–40 characters) before choosing a house.");
      return;
    }
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
      await setProfile({
        // Unchanged — the house write must not alter the team name.
        teamName: usableName,
        supportedHouse: resolved ?? "",
      });
      toast.success(
        resolved ? `House preference updated — ${resolved}.` : "House preference cleared.",
      );
      onChange?.(resolved);
    } catch (err) {
      // Roll back so the control never shows a value the server rejected.
      setPending(previous);
      toast.error(
        err instanceof Error ? err.message : "Could not update your house preference.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id} className="flex items-center gap-1.5">
        <ShieldCheck className="size-3.5 text-muted-foreground" />
        Supported house
      </Label>
      <Select
        value={shown ?? NONE}
        onValueChange={(v) => void pick(v)}
        disabled={disabled || busy || !canSubmit}
      >
        <SelectTrigger id={id} aria-label="Supported house">
          <span className="flex min-w-0 items-center gap-2">
            {busy ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : shown ? (
              <HouseDot house={shown} />
            ) : null}
            <span className="truncate">
              {shown ?? "No house selected"}
            </span>
          </span>
        </SelectTrigger>
        <SelectContent>
          {houses.map((h) => (
            <SelectItem key={h} value={h}>
              <span className="flex items-center gap-2">
                <HouseDot house={h} />
                {h}
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
        {canSubmit
          ? "Purely cosmetic — your house is chosen by you and never changes when you edit your squad."
          : "Set a team name (2–40 characters) to choose a house."}
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
