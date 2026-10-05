import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { useAdminConfig } from "@/hooks/use-admin-config";
import type { House, Position } from "@/convex/schema";

/**
 * Display name for a house, honouring the Super Admin's custom rename.
 * The colours/crests stay keyed to the internal house id, so renaming a
 * house never breaks its theming — only the text changes.
 */
export function useHouseName(): (house: House | string | null | undefined) => string {
  const { houseName } = useAdminConfig();
  return (house) => houseName(house);
}

/**
 * The Super-Admin editable brand colour for a house. `useAdminConfig` layers
 * the built-in palette under the server response, so this always resolves to
 * a valid hex string — a missing or malformed config can never yield
 * `undefined` and break an inline style.
 */
export function useHouseColor(): (house: House | string | null | undefined) => string {
  const { houseBrand } = useAdminConfig();
  return (house) => houseBrand(house).color;
}

/** The Super-Admin editable motto for a house (blank when unset). */
export function useHouseMotto(): (house: House | string | null | undefined) => string {
  const { houseBrand } = useAdminConfig();
  return (house) => houseBrand(house).motto;
}

/** WCAG relative luminance of a hex colour (unknown input → 1 = "already light"). */
function hexLuminance(hex: string): number {
  const body = hex.trim().replace(/^#/, "");
  const full =
    body.length === 3
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  if (!/^[0-9a-f]{6}$/i.test(full)) return 1;
  const lin = (v: number) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Keep a brand colour usable as *text*.
 *
 * The Super Admin can set any hex per house, and deep brand colours (the
 * default Water blue / Fire red) measure 4.38:1 on the dark glass chip — just
 * under the 4.5:1 WCAG AA floor for 12px text. This mixes the colour toward
 * white (hue preserved) only until it clears the floor, so rebrands stay
 * recognisable while the label stays readable.
 */
function readableTextColor(hex: string, minLuminance = 0.26): string {
  if (hexLuminance(hex) >= minLuminance) return hex;
  const body = hex.trim().replace(/^#/, "");
  const full =
    body.length === 3
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  if (!/^[0-9a-f]{6}$/i.test(full)) return hex;
  const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  for (let t = 0.05; t <= 1; t += 0.05) {
    const candidate =
      "#" +
      rgb
        .map((v) => Math.round(v + (255 - v) * t).toString(16).padStart(2, "0"))
        .join("");
    if (hexLuminance(candidate) >= minLuminance) return candidate;
  }
  return "#ffffff";
}

/**
 * Foreground colour (near-black or white) that reads best on `background`.
 *
 * Brand swatches sit on Super-Admin-editable hex values, and a fixed
 * `text-white` falls to 2:1 on the amber Wind default. This picks whichever of
 * the app's base dark / white scores the higher contrast ratio.
 */
export function readableTextOn(background: string): string {
  const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const lb = hexLuminance(background);
  const ink = contrast(lb, hexLuminance("#0b1220"));
  const white = contrast(lb, hexLuminance("#ffffff"));
  return ink >= white ? "#0b1220" : "#ffffff";
}

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
  const color = useHouseColor();
  return (
    <span
      className={cn("inline-block size-2.5 rounded-full shrink-0", DOT_COLORS[house], className)}
      style={{ backgroundColor: color(house) }}
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
  const houseName = useHouseName();
  const color = useHouseColor();
  const brandColor = color(house);
  const label = houseName(house);
  // ── FALLBACK LOGO RESOLUTION ──
  // A custom crest is used only when it is a non-empty string. Anything else —
  // missing key, null, undefined, whitespace-only, a stale storage URL — falls
  // through to the themed initials crest rendered below.
  //
  // NOTE: there is deliberately NO `"/default-house-crest.png"` src. That asset
  // does not exist in `public/`, so pointing an <img> at it would render a
  // broken-image glyph — the exact failure this fallback exists to prevent.
  // The themed initials crest is the default, needs no binary asset, and is
  // guaranteed to render.
  const customRaw = logos?.[house];
  const custom =
    typeof customRaw === "string" && customRaw.trim() !== ""
      ? customRaw.trim()
      : null;
  // Admin-supplied crest URLs can 404 or be deleted at any time. Remembering the
  // failed URL (rather than a boolean) means a *new* logo is retried as soon as
  // it is saved, and a broken one swaps cleanly to the themed placeholder
  // without a browser broken-image glyph or a layout jump.
  const [failedCrest, setFailedCrest] = useState<string | null>(null);
  if (custom && failedCrest !== custom) {
    return (
      <img
        src={custom}
        alt={`${label} crest`}
        width={size}
        height={size}
        className={cn("rounded-lg object-cover ring-1", RING_COLORS[house], className)}
        style={{ width: size, height: size }}
        loading="lazy"
        onError={() => setFailedCrest(custom)}
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
        color: brandColor,
        background: `${brandColor}1a`,
      }}
      aria-label={`${label} crest`}
      title={label}
    >
      {label.slice(0, 2)}
    </span>
  );
}

export function HouseBadge({ house, className }: { house: House; className?: string }) {
  const houseName = useHouseName();
  const color = useHouseColor();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        "bg-secondary text-secondary-foreground",
        TEXT_COLORS[house],
        className,
      )}
      // The configured brand colour wins over the built-in palette class so a
      // rebrand takes effect everywhere a house badge appears — but it is
      // lightened first when it would be unreadable as text on the dark chip.
      style={{ color: readableTextColor(color(house)) }}
      title={houseName(house)}
    >
      <HouseDot house={house} />
      {houseName(house)}
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
