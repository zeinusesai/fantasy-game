import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PitchView, type PitchPlayer } from "@/components/PitchView";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/convex/configDefaults";
import { SOCIAL_HOSTS } from "@/convex/defaults";
import { avatarPresetUrl } from "@/lib/fantasy";
import { isPremiumPitch, normalizePitchTheme } from "@/lib/pitchTheme";
import { UserBadges } from "@/components/UserBadge";
import {
  HouseBadgeGrid,
  HouseSupportDot,
  HouseSupportLabel,
  defaultHouses,
  useHouseOptions,
} from "@/components/HouseSupport";
import { DirectMessageDialog } from "@/components/DirectMessages";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { useAuth } from "@/hooks/use-auth";
import { Crown, Eye, Flame, Instagram, Loader2, MessageSquare, ShieldCheck, Sparkles, Star } from "lucide-react";
import { useState } from "react";
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
  /** Manual house preference; null/undefined = not chosen yet. */
  supportedHouse?: string | null;
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
  // Expanded public profile: socials, cosmetics, achievements, pinned MVP.
  // `undefined` while loading, `null` for a deleted/signed-out manager.
  const profileResult = useQuery(
    api.users.getPublicProfile,
    canQuery ? { userId: userId as Id<"users"> } : "skip",
  );
  const profile = profileResult ?? null;
  const [dmOpen, setDmOpen] = useState(false);

  // ── Defensive resolution: every field gets a safe fallback ──
  const theme = normalizePitchTheme(subject?.activePitchTheme);
  const premium = isPremiumPitch(theme);
  const golden = subject?.hasGoldenJersey === true;

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

  // ── Social + showcase, with `?? {}` guards everywhere ──
  // Unlinked handles are `null` (never ""), so the row simply doesn't render.
  const instagram = profile?.instagram ?? null;
  const tiktok = profile?.tiktok ?? null;
  const cosmetics = profile?.cosmetics ?? null;
  const stats = profile?.stats ?? null;
  const mvp = profile?.favouritePlayer ?? null;
  // The manual house preference. Falls back through the props so a profile
  // that hasn't loaded yet still shows the value the caller already knows.
  const supportedHouse =
    profile?.supportedHouse ?? subject?.supportedHouse ?? null;

  // ── Houses are fetched DYNAMICALLY, never hardcoded at the call site ──
  // `useHouseOptions()` reads `api.houses.listHouses` and already layers the
  // built-in fallback under an undefined (loading) or empty response, so the
  // picker below can never render an empty, unselectable list. The explicit
  // `houses && houses.length > 0` check is kept as a second line of defence
  // for a caller that passes its own list.
  const { houses, loading: housesLoading } = useHouseOptions();
  const houseList = houses && houses.length > 0 ? houses : defaultHouses;
  const unlockedItems = cosmetics?.unlockedItems ?? [];
  const previewTitle = cosmetics?.customTitle ?? customTitle;
  const badgeMeta = profile?.badgeMeta ?? null;
  // The live profile query wins; the prop is only a fallback.
  const border = cosmetics?.hasProfileBorder ?? subject?.hasProfileBorder === true;

  // The viewer, for the self-DM guard.
  const { user: viewer } = useAuth();
  const viewerId = viewer?._id ?? null;
  const canMessage =
    userId !== null && viewerId !== null && userId !== viewerId;
  const isOpen = open && profile !== null;

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
                {/* Subtle house indicator beside the name. Renders nothing
                    when unset, so it never competes with the team name. */}
                <HouseSupportDot house={supportedHouse} />
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

        {/* Self-only: the manual house picker, rendered as an interactive
            badge grid so every registered house is visible at once. Rivals
            get the indicator in the header but never a control to change
            someone else's house. */}
        {isSelf && (
          <div className="grid gap-2 rounded-xl border border-border/70 bg-secondary/30 p-3">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-muted-foreground" />
              <span className="text-sm font-medium">Supported house</span>
              {housesLoading ? (
                <Loader2 className="size-3 animate-spin text-muted-foreground" />
              ) : null}
            </div>
            <HouseBadgeGrid
              houses={houseList}
              value={supportedHouse}
            />
            <p className="text-muted-foreground text-[11px]">
              {housesLoading
                ? "Loading houses…"
                : "Purely cosmetic — your house is chosen by you and never changes when you edit your squad."}
            </p>
          </div>
        )}

        {/* Cosmetic status chips + custom title & badge showcase. */}
        {(premium || golden || previewTitle || badgeMeta || unlockedItems.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {previewTitle ? (
              <Badge className="border border-violet-400/40 bg-violet-400/10 text-[10px] text-violet-200 uppercase">
                <Crown className="mr-1 size-3" /> {previewTitle}
              </Badge>
            ) : null}
            {badgeMeta ? (
              <Badge className="border border-amber-400/40 bg-amber-400/10 text-[10px] text-amber-200 uppercase">
                {badgeMeta.emoji} {badgeMeta.label}
              </Badge>
            ) : null}
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
            {border ? (
              <Badge className="border border-orange-400/40 bg-orange-400/10 text-[10px] text-orange-200 uppercase">
                <Flame className="mr-1 size-3" /> Fire border
              </Badge>
            ) : null}
            {/* Micro-transaction cosmetics unlocked. */}
            {unlockedItems.length > 0 && (
              <Badge
                variant="secondary"
                className="text-[10px] uppercase"
                title={unlockedItems.map((i) => i.itemId).join(", ")}
              >
                {unlockedItems.length} store item
                {unlockedItems.length === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
        )}

        {/* ── Achievements: points, rank, supported house ──
            The house is the manager's MANUAL preference, never a squad
            tally — so it cannot change when they edit their team. */}
        {stats && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <MiniStat label="Points" value={String(stats.totalPoints ?? 0)} />
            <MiniStat
              label="Rank"
              value={stats.rank != null && stats.managerCount > 0 ? `#${stats.rank}` : "—"}
            />
            <MiniStat
              label="House"
              value={<HouseSupportLabel house={supportedHouse} />}
            />
          </div>
        )}

        {/* ── Pinned MVP player ── */}
        {mvp && (
          <div className="flex items-center gap-2.5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-2.5">
            <PlayerAvatar
              player={{
                name: mvp.name,
                position: mvp.position as never,
                image: mvp.image,
              }}
              size={36}
              className="ring-1 ring-amber-300/60"
            />
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-300">
                <Star className="mr-1 inline size-3" />
                MVP pick
              </p>
              <p className="truncate text-sm font-semibold">{mvp.name}</p>
            </div>
          </div>
        )}

        {/* ── Social links. Unlinked handles render nothing (null, not ""). The
            URL is built from a FIXED host + a handle the server sanitised to
            [a-z0-9._], so this can never become an arbitrary link. ── */}
        {(instagram || tiktok) && (
          <div className="flex flex-wrap gap-2">
            {instagram ? (
              <SocialLink
                href={`${SOCIAL_HOSTS.instagram}${encodeURIComponent(instagram)}`}
                icon={<Instagram className="size-3.5" />}
                handle={`@${instagram}`}
                label="Instagram"
              />
            ) : null}
            {tiktok ? (
              <SocialLink
                href={`${SOCIAL_HOSTS.tiktok}${encodeURIComponent(tiktok)}`}
                icon={<span className="text-[13px] leading-none">♪</span>}
                handle={`@${tiktok}`}
                label="TikTok"
              />
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

        {/* ── Direct message action. Disabled on your own profile (and while
            the profile hasn't resolved an id yet), with an explicit reason in
            the tooltip rather than a mysteriously dead button. ── */}
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setDmOpen(true)}
          disabled={!canMessage || !isOpen}
          title={
            isSelf
              ? "You can't message yourself."
              : !isOpen
                ? "This manager isn't available to message."
                : `Message @${username}`
          }
        >
          <MessageSquare className="mr-1.5 size-4" /> Send message
        </Button>
      </DialogContent>

      {/* The chat lives outside the profile dialog so it isn't unmounted (and
          doesn't lose scroll/draft state) every time the card closes. */}
      {userId !== null && (
        <DirectMessageDialog
          open={dmOpen && canMessage}
          onOpenChange={setDmOpen}
          peerId={userId}
          peerName={username}
        />
      )}
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

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-secondary/30 px-2 py-1.5">
      <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wide">
        {label}
      </p>
      <p className="font-score truncate text-sm font-bold">{value}</p>
    </div>
  );
}

/**
 * External social link. `rel="noopener noreferrer"` is mandatory for
 * `target="_blank"`, and the href is composed from a fixed host + a server-
 * sanitised handle, so this is never an attacker-controlled URL.
 */
function SocialLink({
  href,
  icon,
  handle,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  handle: string;
  label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`${label} — ${handle}`}
      className="border-border/70 bg-secondary/40 hover:border-primary/40 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors"
    >
      {icon}
      {handle}
    </a>
  );
}