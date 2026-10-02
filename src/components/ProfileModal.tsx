import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PitchView, type PitchPlayer } from "@/components/PitchView";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/convex/configDefaults";
import { avatarPresetUrl } from "@/lib/fantasy";
import { isPremiumPitch, normalizePitchTheme } from "@/lib/pitchTheme";
import { UserBadges } from "@/components/UserBadge";
import { Crown, Eye, Loader2, Sparkles } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Cosmetics a manager has active. Every field optional + nullable so a caller
 * can pass a partial projection (a stale query result, a legacy row) without
 * a render exception.
 */
export type ProfileCosmetics = {
  activePitchTheme?: string | null;
  hasGoldenJersey?: boolean | null;
  hasProfileBorder?: boolean | null;
  hasCustomTitle?: boolean | null;
};

/** What the modal needs about a manager. All fields optional by design. */
export type ProfileModalSubject = ProfileCosmetics & {
  userId?: Id<"users"> | null;
  username?: string | null;
  teamName?: string | null;
  avatar?: string | null;
  role?: string | null;
  customBadge?: string | null;
  customTitle?: string | null;
  formation?: string | null;
  totalSpent?: number | null;
  totalPoints?: number | null;
  rank?: number | null;
  managerCount?: number | null;
};

/**
 * Themed manager profile card.
 *
 * Opens from the Leaderboard (and anywhere else a manager is inspected) and
 * renders THEIR cosmetic settings:
 *  - `activePitchTheme: "premium"` → dark/gold pitch with metallic gold
 *    linework instead of the standard green pitch.
 *  - `hasGoldenJersey` → their seven starters wear the metallic gold jersey.
 *  - `hasProfileBorder` → animated glowing frame around the avatar.
 *
 * ZERO-ERROR CONTRACT:
 *  - The theme is resolved through `normalizePitchTheme`, so a missing, null or
 *    junk value always renders the clean default green pitch.
 *  - A manager with no squad, an incomplete squad (fewer than 7) or a deleted
 *    squad renders an explicit empty state — never a broken layout or a
 *    `.map` on undefined.
 *  - `userId` is optional: pass one to fetch live squad data, or omit it to
 *    render purely from the props you already have.
 */
export function ProfileModal({
  open,
  onOpenChange,
  subject,
  isSelf = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: ProfileModalSubject | null;
  /** Renders "Your profile" copy instead of the rival framing. */
  isSelf?: boolean;
}) {
  // Only subscribe when there's a real user AND the modal is open, so a
  // null/garbage id can never produce a rejected query subscription.
  const userId = subject?.userId ?? null;
  const canQuery = open && userId !== null && typeof userId === "string";
  const squadResult = useQuery(
    api.squads.getSquadByUserId,
    canQuery ? { userId: userId as Id<"users"> } : "skip",
  );

  // ── Defensive resolution: every field gets a safe fallback ──
  const theme = normalizePitchTheme(subject?.activePitchTheme);
  const premium = isPremiumPitch(theme);
  const golden = subject?.hasGoldenJersey === true;
  const border = subject?.hasProfileBorder === true;

  // Props win; the live squad query fills the gaps. `??` everywhere so a
  // partial projection never yields `undefined`.
  const username = subject?.username ?? squadResult?.username ?? "unknown";
  const teamName = subject?.teamName ?? squadResult?.teamName ?? "Unnamed team";
  const avatar = subject?.avatar ?? squadResult?.avatar ?? null;
  const role = subject?.role ?? squadResult?.role ?? null;
  const customBadge = subject?.customBadge ?? squadResult?.customBadge ?? null;
  const formation = subject?.formation ?? squadResult?.formation ?? "2-3-1";
  const totalSpent = subject?.totalSpent ?? squadResult?.totalSpent ?? 0;
  const totalPoints = subject?.totalPoints ?? squadResult?.totalPoints ?? 0;
  const rank = subject?.rank ?? squadResult?.rank ?? null;
  const managerCount = subject?.managerCount ?? squadResult?.managerCount ?? 0;
  const customTitle = subject?.customTitle ?? null;

  // The live squad wins when present; otherwise whatever we were handed.
  const players = squadResult?.players ?? [];
  const captainId = squadResult?.captainId ?? null;
  const loading = canQuery && squadResult === undefined;

  // Bucket the seven by position for the pitch. Every field is defensive:
  // an id-less or non-object entry is skipped so React never gets a bad key.
  const byPosition = players.reduce(
    (acc, p) => {
      if (!p || typeof p._id !== "string" || !p._id) return acc;
      const key = p.position as PitchPlayer["position"];
      (acc[key] ??= []).push({
        playerId: p._id,
        name: p.name,
        position: key,
        house: p.house,
        image: p.image ?? null,
        isCaptain: captainId === p._id,
        statusLabel: p.statusLabel ?? null,
      });
      return acc;
    },
    {} as Record<string, PitchPlayer[]>,
  );

  const picked = players.length;
  const avatarSrc =
    avatar && (avatar.startsWith("http") || avatar.startsWith("data:"))
      ? avatar
      : avatarPresetUrl(avatar);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {/* Store cosmetic: "Custom Profile Border" — glowing fire frame.
                The padding layer gives the glow room so it is never cropped. */}
            <span
              className={
                border
                  ? "inline-flex shrink-0 animate-pulse rounded-full ring-2 ring-orange-400/80 shadow-[0_0_18px_rgba(249,115,22,0.55)]"
                  : "inline-flex shrink-0 rounded-full"
              }
            >
              <Avatar className="size-12">
                <AvatarImage
                  src={avatarSrc ?? undefined}
                  alt={username}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.visibility = "hidden";
                  }}
                />
                <AvatarFallback className="bg-primary/20 text-primary text-sm font-bold">
                  {(username ?? "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="truncate">{teamName}</span>
                <UserBadges sizeClass="size-4" role={role} customBadge={customBadge} />
              </span>
              <span className="text-muted-foreground mt-0.5 block truncate text-xs font-normal">
                @{username}
              </span>
            </span>
          </DialogTitle>
          <DialogDescription>
            {isSelf
              ? "Your squad, with your store cosmetics applied."
              : `Manager profile${rank != null && managerCount > 0 ? ` · rank #${rank} of ${managerCount}` : ""}.`}
          </DialogDescription>
        </DialogHeader>

        {/* Cosmetic status chips — tell the viewer what they're looking at. */}
        {(premium || golden || customTitle) && (
          <div className="flex flex-wrap gap-1.5">
            {premium ? (
              <Badge className="border border-amber-400/40 bg-amber-400/10 text-[10px] text-amber-200 uppercase">
                <Sparkles className="mr-1 size-3" /> Premium pitch
              </Badge>
            ) : null}
            {golden ? (
              <Badge className="border border-amber-400/40 bg-amber-400/10 text-[10px] text-amber-200 uppercase">
                <Crown className="mr-1 size-3" /> Golden jersey
              </Badge>
            ) : null}
            {customTitle ? (
              <Badge className="border border-violet-400/40 bg-violet-400/10 text-[10px] text-violet-200 uppercase">
                {customTitle}
              </Badge>
            ) : null}
          </div>
        )}

        {/* The themed pitch. An incomplete / missing squad gets a clean empty
            state instead of an empty pitch with dangling slots. */}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading squad…
          </div>
        ) : picked === 0 ? (
          <div
            className={
              premium
                ? "pitch-bg-premium flex flex-col items-center gap-2 rounded-2xl border border-amber-300/45 py-12 text-center"
                : "pitch-bg flex flex-col items-center gap-2 rounded-2xl border border-emerald-900/50 py-12 text-center"
            }
          >
            <Eye className="text-muted-foreground/50 size-7" />
            <p className="text-muted-foreground text-sm">
              {isSelf
                ? "You haven't drafted a squad yet."
                : `@${username} hasn't drafted a squad yet.`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <PitchView
              byPosition={byPosition}
              emptyLabel="Empty"
              formation={formation}
              showStatus
              showFormationLabel
              theme={theme}
              goldenJersey={golden}
            />
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Picked" value={`${picked}/7`} />
              <Stat label="Spent" value={formatMoney(totalSpent)} />
              <Stat label="Points" value={String(totalPoints ?? 0)} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-secondary/30 px-2 py-1.5">
      <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wide">
        {label}
      </p>
      <p className="font-score text-sm font-bold">{value}</p>
    </div>
  );
}