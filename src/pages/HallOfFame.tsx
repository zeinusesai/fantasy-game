// ── Hall of Fame & Cosmetics Showcase ────────────────────────────────────
//
// This page REPLACED the cash store. There is no price, no currency and no
// "buy" button anywhere in the app any more: every cosmetic here is earned,
// either by finishing on a Gameweek podium or by hitting an in-game feat.
//
// Three things live here:
//   1. the full inventory — locked and unlocked, with the feat that unlocks
//      each one written on the card;
//   2. live progress toward every feat not yet unlocked, so a manager can see
//      exactly how close they are instead of guessing;
//   3. equip controls for whatever they've earned.

import { useQuery, useMutation } from "convex/react";
import {
  Check,
  Crown,
  Frame,
  Loader2,
  Lock,
  Palette,
  Shield,
  Shirt,
  Sparkles,
  Trophy,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import {
  COSMETIC_IDS,
  PODIUM_SIZE,
  cosmeticById,
  featById,
  type CosmeticSlot,
  type RewardTier,
} from "@/convex/rewards";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/** Lucide icon per cosmetic slot, so the card matches what it unlocks. */
const SLOT_ICON: Record<CosmeticSlot, typeof Trophy> = {
  border: Frame,
  kit: Shirt,
  pitch: Palette,
  badge: Trophy,
  title: Crown,
  glow: Zap,
};

const SLOT_LABEL: Record<CosmeticSlot, string> = {
  border: "Profile border",
  kit: "Team kit",
  pitch: "Pitch theme",
  badge: "Badge",
  title: "Title",
  glow: "Name glow",
};

const TIER_LABEL: Record<RewardTier, string> = {
  podium: "Podium",
  feat: "Feat",
  legacy: "Earned",
};

export default function HallOfFame() {
  const showcase = useQuery(api.rewardsEngine.getShowcase);
  const setEquipped = useMutation(api.rewardsEngine.setCosmeticEquipped);

  // `items` is null while the first query is in flight. The catalogue is a
  // pure import, so the header renders immediately rather than a blank page.
  const items = showcase?.items ?? null;
  const equippedCount = showcase?.equipped.length ?? 0;
  const unlockedCount = showcase?.unlocked.length ?? 0;
  // `podium` is null only for a signed-out visitor; the branch below already
  // gates on `showcase`, so hoist it to keep the narrowing non-optional.
  const podium = showcase?.podium ?? null;

  const toggle = async (cosmeticId: string, next: boolean) => {
    try {
      await setEquipped({ cosmeticId, equipped: next });
      const def = cosmeticById(cosmeticId);
      toast.success(
        next
          ? `${def?.name ?? "Cosmetic"} equipped.`
          : `${def?.name ?? "Cosmetic"} unequipped.`,
      );
    } catch (err) {
      // Rollback is implicit: the query is the source of truth, so a failed
      // write simply leaves the button in its previous state.
      toast.error(
        err instanceof Error ? err.message : "Could not change your cosmetic.",
      );
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-24">
      {/* ── Header ── */}
      <header className="space-y-1.5">
        <h1 className="font-display flex items-center gap-2 text-2xl font-bold uppercase tracking-wide">
          <Sparkles className="text-primary size-6" /> Hall of Fame
        </h1>
        <p className="text-muted-foreground text-sm">
          Every cosmetic here is <strong className="text-foreground">earned</strong>,
          never bought. Win a Gameweek podium or hit an in-game feat to unlock
          one, then equip it below. No currency, no store, no pay-to-win — your
          budget and your one Double Down chip are the same as everyone
          else&apos;s.
        </p>
      </header>

      {/* ── GW1 podium status ── */}
      <Card className="border-primary/30 bg-gradient-to-br from-amber-500/10 via-transparent to-transparent">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-base font-bold uppercase tracking-wide">
            <Trophy className="text-amber-400 size-4" /> Gameweek 1 podium
          </CardTitle>
          <CardDescription>
            The top {PODIUM_SIZE} on the GW1 leaderboard receive the podium
            animated border and the Pacesetter badge.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {!showcase ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-3.5 animate-spin" /> Loading podium…
            </p>
          ) : !podium || podium.awards.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Gameweek 1 hasn&apos;t been scored yet — no podium has been
              allocated.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {podium.awards.map((a) => (
                  <Badge
                    key={a.userId}
                    variant="secondary"
                    className={cn(
                      "px-2.5 py-1 text-xs",
                      a.isSuperAdmin && "border-violet-400/40 text-violet-200",
                    )}
                  >
                    #{a.rank}
                    {a.rolledIn ? " · rolled in" : ""}
                    {a.isSuperAdmin ? " · Super Admin" : ""}
                    <span className="text-muted-foreground font-score ml-1.5">
                      {a.points} pts
                    </span>
                  </Badge>
                ))}
              </div>
              {podium.rollDownApplied && (
                <p className="text-muted-foreground text-[11px]">
                  The Super Admin finished inside the top {PODIUM_SIZE}, so the
                  allocation rolled down and 4th place was included too.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Progress toward active feats ── */}
      {showcase && showcase.progress.length > 0 && (
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="font-display text-sm font-bold uppercase tracking-widest">
              Feats in progress
            </CardTitle>
            <CardDescription>
              Your closest attempt in each gameweek. Hit the target and the
              cosmetic unlocks automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {showcase.progress.map((p) => {
              const def = featById(p.featId);
              const pct = Math.round(Math.min(1, Math.max(0, p.progress)) * 100);
              return (
                <div key={p.featId} className="space-y-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {def?.name ?? p.featId}
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      {def?.target ?? ""}
                    </span>
                  </div>
                  <Progress value={pct} className="h-1.5" />
                  <p className="text-muted-foreground text-[11px]">{p.detail}</p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── The inventory ── */}
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display text-sm font-bold uppercase tracking-widest">
            Inventory
          </CardTitle>
          <CardDescription>
            {showcase
              ? `${unlockedCount} of ${COSMETIC_IDS.length} unlocked · ${equippedCount} equipped. Equip one per slot — wearing a new one removes the old.`
              : "Loading your inventory…"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!items ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-32 animate-pulse rounded-xl border border-border/60 bg-secondary/30"
                />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => {
                const def = cosmeticById(item.id);
                const Icon = SLOT_ICON[item.slot];
                const feat = featById(item.featId ?? def?.unlockKey ?? null);
                const locked = !item.unlocked;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "relative flex flex-col gap-3 rounded-xl border p-4 transition",
                      locked
                        ? "border-border/50 bg-secondary/20"
                        : "border-border/80 bg-gradient-to-br",
                      !locked && item.accent,
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className={cn(
                            "flex size-9 shrink-0 items-center justify-center rounded-lg",
                            locked
                              ? "bg-secondary text-muted-foreground"
                              : "bg-background/60 text-foreground",
                          )}
                        >
                          {locked ? (
                            <Lock className="size-4" />
                          ) : (
                            <Icon className="size-4" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {item.name}
                          </p>
                          <p className="text-muted-foreground text-[11px]">
                            {SLOT_LABEL[item.slot]}
                          </p>
                        </div>
                      </div>
                      <Badge
                        variant="secondary"
                        className="shrink-0 text-[10px] uppercase"
                      >
                        {TIER_LABEL[item.tier]}
                      </Badge>
                    </div>

                    <p className="text-muted-foreground flex-1 text-xs leading-relaxed">
                      {item.blurb}
                    </p>

                    {/* How to earn it — always shown, so a locked card reads as
                        a goal rather than a mystery. */}
                    <p className="text-muted-foreground flex items-start gap-1.5 text-[11px]">
                      <Shield className="mt-px size-3 shrink-0" />
                      <span>
                        {locked
                          ? `Unlock: ${feat?.name ?? "earn it in-game"}${
                              feat?.target ? ` (${feat.target})` : ""
                            }`
                          : `Unlocked${
                              item.gameweek ? ` in GW${item.gameweek}` : ""
                            }${
                              item.unlockedVia === "admin_grant"
                                ? " · admin override"
                                : ""
                            }`}
                      </span>
                    </p>

                    {item.unlocked && (
                      <Button
                        size="sm"
                        variant={item.equipped ? "default" : "outline"}
                        onClick={() => void toggle(item.id, !item.equipped)}
                      >
                        {item.equipped ? (
                          <>
                            <Check className="mr-1.5 size-3.5" /> Equipped
                          </>
                        ) : (
                          "Equip"
                        )}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-center text-[11px]">
        Fair play: every manager starts with the same budget and exactly one
        Double Down chip for the whole tournament. Nothing here changes that.
      </p>
    </div>
  );
}