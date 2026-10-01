import { useState } from "react";
import { cn } from "@/lib/utils";
import { avatarPresetUrl } from "@/lib/fantasy";
import type { Position } from "@/convex/schema";

/**
 * Every shape a player photo can arrive in. All fields optional and nullable
 * so callers can pass a player doc, a partial lineup card object, or nothing
 * at all without a render exception.
 */
export type PhotoSource = {
  name?: string | null;
  position?: Position | null;
  image?: string | null;
  /** Legacy alias accepted by older lineup payloads. */
  photoUrl?: string | null;
};

/**
 * Resolve the photo for a player, prioritising the custom uploaded photo
 * (`image`) over the legacy alias (`photoUrl`).
 *
 * Returns `null` — meaning "render the initials placeholder" — for missing,
 * blank, malformed or non-resolvable values, so a bad row can never produce a
 * broken-image icon or throw. Preset badge ids (e.g. "fb-messi") are resolved
 * to an inline SVG so older data still shows something.
 */
export function resolvePlayerPhoto(player?: PhotoSource | null): string | null {
  if (!player) return null;
  const raw = player.image || player.photoUrl || null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return trimmed; // bundled local asset
  return avatarPresetUrl(trimmed);
}

/** First two letters of a name, uppercased — never empty. */
export function playerInitials(name?: string | null): string {
  const trimmed = (name ?? "").trim();
  return trimmed ? trimmed.slice(0, 2).toUpperCase() : "?";
}

/**
 * Circular player photo with a clean initials/position placeholder fallback.
 *
 * Safeguards:
 * - custom photo first, `photoUrl` alias second, initials otherwise;
 * - `onError` catches missing/404/broken URLs and swaps in the placeholder
 *   instead of leaving the browser's broken-image glyph;
 * - the failed URL is remembered, so if the photo later changes (admin
 *   upload, live query update) the new URL is retried automatically.
 */
export function PlayerAvatar({
  player,
  size,
  className,
  showPosition = false,
}: {
  player?: PhotoSource | null;
  /** Pixel size; omit it to size via Tailwind classes in `className`. */
  size?: number;
  className?: string;
  showPosition?: boolean;
}) {
  const photo = resolvePlayerPhoto(player);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showPhoto = photo !== null && failedSrc !== photo;
  const name = player?.name ?? "Player";
  const position = player?.position ?? null;
  const px = size ?? 32;

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-800 text-white ring-1 ring-white/25",
        className,
      )}
      style={size != null ? { width: size, height: size } : undefined}
    >
      {showPhoto ? (
        <img
          src={photo}
          alt={name}
          className="size-full object-cover"
          loading="lazy"
          draggable={false}
          onError={() => setFailedSrc(photo)}
        />
      ) : (
        <span className="flex flex-col items-center leading-none">
          <span
            className="font-bold"
            style={{ fontSize: Math.max(9, Math.round(px * 0.3)) }}
          >
            {playerInitials(name)}
          </span>
          {showPosition && position ? (
            <span
              className="font-semibold uppercase tracking-wide opacity-70"
              style={{ fontSize: Math.max(7, Math.round(px * 0.18)) }}
            >
              {position}
            </span>
          ) : null}
        </span>
      )}
    </span>
  );
}
