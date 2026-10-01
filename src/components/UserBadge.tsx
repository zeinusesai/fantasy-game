import { cn } from "@/lib/utils";

/**
 * Custom badge registry. Keys mirror the backend's VALID_BADGES set in
 * usersAdmin.assignUserBadge — unknown keys render nothing (fail-silent).
 */
export const BADGE_META: Record<
  string,
  { label: string; glyph: string; className: string }
> = {
  star: {
    label: "Star",
    glyph: "⭐",
    className: "border-amber-400/50 bg-amber-400/15",
  },
  gold_checkmark: {
    label: "Gold Checkmark",
    glyph: "✅",
    className: "border-amber-400/60 bg-amber-400/20",
  },
  fire: {
    label: "Fire",
    glyph: "🔥",
    className: "border-orange-500/50 bg-orange-500/15",
  },
  crown: {
    label: "Crown",
    glyph: "👑",
    className: "border-yellow-400/60 bg-yellow-400/15",
  },
  shield: {
    label: "Shield",
    glyph: "🛡️",
    className: "border-sky-400/50 bg-sky-400/15",
  },
  diamond: {
    label: "Diamond",
    glyph: "💎",
    className: "border-cyan-400/50 bg-cyan-400/15",
  },
  contributor: {
    label: "Idea Contributor",
    glyph: "💡",
    className: "border-sky-300/50 bg-sky-300/15",
  },
};

/** All assignable badge keys for the Super Admin picker. */
export const ASSIGNABLE_BADGE_KEYS = [
  "star",
  "gold_checkmark",
  "fire",
  "crown",
  "shield",
  "diamond",
  "contributor",
] as const;

/** Tooltip copy for custom badges — missing keys fall back to the label. */
export const BADGE_TOOLTIPS: Record<string, string> = {
  contributor: "Idea Contributor",
};

/**
 * Resolve a stored custom badge key → display metadata.
 * Fail-safe: "none"/empty/unknown keys return null so callers render nothing
 * instead of crashing on a missing registry entry.
 */
export function resolveCustomBadge(key: string | null | undefined) {
  if (!key || key === "none") return null;
  return BADGE_META[key] ?? null;
}

/**
 * Role checkmark: golden verified check + crown for super_admin, standard
 * blue/silver verified check for moderators/admins, nothing for managers.
 * Defensive: accepts null/undefined/legacy roles without throwing.
 */
export function RoleBadgeIcon({
  role,
  sizeClass = "size-3.5",
  className,
}: {
  role?: string | null;
  sizeClass?: string;
  className?: string;
}) {
  if (role === "super_admin") {
    return (
      <span
        title="Super Admin — verified"
        aria-label="Super Admin verified badge"
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500 shadow-[0_0_8px_rgba(251,191,36,0.55)] ring-1 ring-amber-200/60",
          sizeClass,
          className,
        )}
      >
        <svg viewBox="0 0 24 24" fill="none" className="size-[70%] p-[1.5px]">
          <path
            d="M5 13l4 4L19 7"
            stroke="#78350f"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (role === "superadmin" || role === "admin") {
    // Legacy "admin" role values still get the staff check — same as moderator.
    return (
      <span
        title="Admin — verified"
        aria-label="Admin verified badge"
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-300 to-blue-500 shadow-[0_0_8px_rgba(56,189,248,0.5)] ring-1 ring-sky-200/60",
          sizeClass,
          className,
        )}
      >
        <svg viewBox="0 0 24 24" fill="none" className="size-[70%] p-[1.5px]">
          <path
            d="M5 13l4 4L19 7"
            stroke="#0c4a6e"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (role === "moderator") {
    return (
      <span
        title="Moderator — verified"
        aria-label="Moderator verified badge"
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-200 to-slate-400 shadow-[0_0_8px_rgba(203,213,225,0.5)] ring-1 ring-slate-100/70",
          sizeClass,
          className,
        )}
      >
        <svg viewBox="0 0 24 24" fill="none" className="size-[70%] p-[1.5px]">
          <path
            d="M5 13l4 4L19 7"
            stroke="#1e293b"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  return null;
}

/**
 * Full badge stack: automatic role checkmark + optional custom badge,
 * rendered side by side. Both halves are individually fail-safe — a bad
 * customBadge key simply renders nothing and the layout never breaks.
 */
export function UserBadges({
  role,
  customBadge,
  sizeClass = "size-3.5",
  className,
}: {
  role?: string | null;
  customBadge?: string | null;
  sizeClass?: string;
  className?: string;
}) {
  const badge = resolveCustomBadge(customBadge);
  const roleIcon = <RoleBadgeIcon role={role} sizeClass={sizeClass} />;
  if (!roleIcon && !badge) return null;
  // Tooltip copy resolves per-key with a safe fallback to the badge label —
  // a missing registry entry can never throw during render.
  const tooltip =
    (typeof customBadge === "string" && BADGE_TOOLTIPS[customBadge]) ||
    (badge?.label ?? "");
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", className)}>
      {roleIcon}
      {badge && (
        <span
          title={tooltip || undefined}
          aria-label={`${tooltip || badge.label} badge`}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full border px-1 leading-none",
            sizeClass,
            badge.className,
          )}
        >
          <span className="text-[9px]">{badge.glyph}</span>
        </span>
      )}
    </span>
  );
}
