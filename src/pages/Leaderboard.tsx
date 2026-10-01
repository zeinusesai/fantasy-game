import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppNav } from "@/components/AppNav";
import { PageLoading } from "@/components/PageLoading";
import { PitchView, type PitchPlayer } from "@/components/PitchView";
import { PickedByDialog } from "@/components/PickedByDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/convex/configDefaults";
import { avatarPresetUrl } from "@/lib/fantasy";
import { UserBadges } from "@/components/UserBadge";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import {
  BarChart3,
  Crown,
  Eye,
  Flame,
  Loader2,
  Medal,
  Star,
  Trophy,
  Wallet,
} from "lucide-react";
import { useState } from "react";

export default function Leaderboard() {
  const { user } = useAuth();
  const leaderboardResult = useQuery(api.managers.getLeaderboard);

  const rows = leaderboardResult ?? [];
  const loading = leaderboardResult === undefined;
  const medalStyles = ["text-amber-300", "text-slate-300", "text-orange-300"];

  // Rival Squad Inspector — clicking a team opens the drawer for that manager.
  const [inspectUserId, setInspectUserId] = useState<Id<"users"> | null>(null);

  return (
    <AppNav>
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Global leaderboard</h1>
          <p className="text-muted-foreground text-sm">
            Every manager ranked by total fantasy points across the tournament. Click a team
            to inspect their squad.
          </p>
        </div>

        <Card className="card-sheen border-border/80">
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
              <BarChart3 className="text-primary size-4" /> Fantasy rankings
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
                <Loader2 className="size-4 animate-spin" /> Loading rankings…
              </p>
            ) : rows.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                No managers have picked a squad yet. Be the first!
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Rank</TableHead>
                    <TableHead className="w-20">Photo</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Manager</TableHead>
                    <TableHead>Fav. player</TableHead>
                    <TableHead className="text-right">Last match</TableHead>
                    <TableHead className="text-right">Total points</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const isMe = row.userId === user?._id;
                    const avatar =
                      row.avatar?.startsWith("data:") || row.avatar?.startsWith("http")
                        ? row.avatar
                        : avatarPresetUrl(row.avatar);
                    return (
                      <TableRow
                        key={row.userId}
                        className={cn(
                          // 1st place: gold highlight + subtle glow
                          row.rank === 1 &&
                            row.totalPoints > 0 &&
                            "border-b-amber-400/40 bg-gradient-to-r from-amber-400/15 via-amber-400/5 to-transparent shadow-[0_0_24px_rgba(251,191,36,0.12)]",
                          isMe && "bg-primary/5 hover:bg-primary/10",
                        )}
                      >
                        <TableCell>
                          <span className="flex items-center gap-1.5 font-bold">
                            {row.rank <= 3 ? (
                              row.rank === 1 ? (
                                <Crown className={cn("size-4", medalStyles[0])} />
                              ) : (
                                <Medal className={cn("size-4", medalStyles[row.rank - 1])} />
                              )
                            ) : null}
                            <span className={cn("font-score", row.rank <= 3 && medalStyles[row.rank - 1])}>
                              #{row.rank}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell>
                          <Avatar className="size-8">
                            <AvatarImage
                              src={avatar ?? undefined}
                              alt={row.username}
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.visibility = "hidden";
                              }}
                            />
                            <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">
                              {row.username.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        </TableCell>
                        <TableCell>
                          {/* Clickable team name → Rival Squad Inspector drawer */}
                          <button
                            onClick={() => setInspectUserId(row.userId)}
                            title={`Inspect ${row.teamName}'s squad`}
                            className="group flex flex-wrap items-center gap-1.5 text-left font-semibold transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-none"
                          >
                            <span className="flex items-center gap-1.5">
                              {row.teamName}
                              {/* Role checkmark + custom badge — fail-safe. */}
                              <UserBadges
                                sizeClass="size-3.5"
                                role={row.role}
                                customBadge={row.customBadge}
                              />
                            </span>
                            <Eye className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70" />
                            {row.rank === 1 && row.totalPoints > 0 && (
                              <Badge className="gap-1 whitespace-normal border border-amber-400/40 bg-amber-400/15 py-1 text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.25)]">
                                <Trophy className="size-3 shrink-0" />
                                CURRENTLY WINNING: 1x Premium Grade Plastic Medal (Priceless)
                              </Badge>
                            )}
                          </button>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            @{row.username}
                            <UserBadges
                              sizeClass="size-3.5"
                              role={row.role}
                              customBadge={row.customBadge}
                            />
                          </span>
                        </TableCell>
                        <TableCell>
                          {/* Strict fallback: unset favorite renders N/A, never blank/crash. */}
                          {row.favoritePlayerName ? (
                            <span className="flex items-center gap-1.5 text-sm font-medium">
                              <Star className="size-3.5 shrink-0 text-amber-300" />
                              {row.favoritePlayerName}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm">N/A</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-score inline-flex items-center gap-1 font-semibold">
                            <Flame className="size-3.5 text-primary" />
                            {row.lastMatchPoints}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-score text-lg font-extrabold text-primary">
                            {row.totalPoints}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Rival Squad Inspector — mounted only while a row is open so the
          underlying query stays skipped for closed rows. */}
      {inspectUserId && (
        <RivalInspector
          userId={inspectUserId}
          onClose={() => setInspectUserId(null)}
        />
      )}
    </AppNav>
  );
}

// ── Rival Squad Inspector drawer ─────────────────────────────────────────

function RivalInspector({
  userId,
  onClose,
}: {
  userId: Id<"users">;
  onClose: () => void;
}) {
  // Safe fallbacks: undefined = still loading, null = no squad (clean empty
  // state) — never crashes on a missing/deleted rival.
  const result = useQuery(api.squads.getSquadByUserId, { userId });
  const rival = result ?? null;
  const loading = result === undefined;

  const squadPlayers = rival?.players ?? [];
  const byPosition = squadPlayers.reduce(
    (acc, p) => {
      (acc[p.position] ??= []).push({
        playerId: p._id,
        name: p.name,
        position: p.position,
        house: p.house,
        image: p.image ?? null,
        isCaptain: rival?.captainId === p._id,
      });
      return acc;
    },
    {} as Record<string, PitchPlayer[]>,
  );

  const avatar =
    rival?.avatar && (rival.avatar.startsWith("http") || rival.avatar.startsWith("data:"))
      ? rival.avatar
      : avatarPresetUrl(rival?.avatar ?? null);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto border-l sm:max-w-md">
        <SheetHeader className="pb-0">
          <SheetTitle className="flex items-center gap-2.5">
            <Avatar className="size-9">
              <AvatarImage
                src={avatar ?? undefined}
                alt={rival?.username ?? "rival"}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.visibility = "hidden";
                }}
              />
              <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">
                {(rival?.username ?? "??").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 truncate">{rival?.teamName ?? "Rival squad"}</span>
            {/* Role checkmark + custom badge in the inspector header. */}
            <UserBadges
              sizeClass="size-4"
              role={rival?.role ?? null}
              customBadge={rival?.customBadge ?? null}
            />
          </SheetTitle>
          <SheetDescription>
            @{rival?.username ?? "unknown"}
            {rival?.rank != null && ` · Rank #${rival.rank} of ${rival.managerCount}`}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          {loading ? (
            <p className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
              <Loader2 className="size-4 animate-spin" /> Loading rival squad…
            </p>
          ) : rival === null ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Eye className="text-muted-foreground/50 size-8" />
              <p className="text-muted-foreground text-sm font-medium">
                No squad picked yet
              </p>
              <p className="text-muted-foreground/70 text-xs">
                This manager hasn't drafted their seven — nothing to inspect.
              </p>
            </div>
          ) : (
            <>
              {/* Points + budget breakdown */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-border/70 bg-secondary/40 p-3 text-center">
                  <p className="font-score text-2xl font-extrabold text-primary">
                    {rival.totalPoints}
                  </p>
                  <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wide">
                    Total points
                  </p>
                </div>
                <div className="rounded-xl border border-border/70 bg-secondary/40 p-3 text-center">
                  <p className="font-score flex items-center justify-center gap-1 text-2xl font-extrabold">
                    <Flame className="size-4 text-primary" />
                    {rival.lastMatchPoints}
                  </p>
                  <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wide">
                    Last match
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-secondary/40 p-3">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  <Wallet className="size-3.5" /> Budget
                </p>
                <div className="mt-1.5 flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">Spent {formatMoney(rival.totalSpent)}</span>
                  <span className="font-score text-lg font-bold text-emerald-400">
                    {formatMoney(rival.remainingBudget)} left
                  </span>
                </div>
                <p className="text-muted-foreground/70 mt-0.5 text-[11px]">
                  of {formatMoney(rival.effectiveBudget)} available
                </p>
              </div>

              {/* Captain */}
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-amber-300">
                  <Star className="size-3.5" /> Captain (2× points)
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {rival.captainName ?? "Not chosen"}
                </p>
              </div>

              {/* Who picked this rival's players — inspection list. */}
              <RivalPickedByList rival={rival} />

              {/* Lineup on a visual pitch */}
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  The seven
                </p>
                <PitchView byPosition={byPosition} emptyLabel="Empty" />
              </div>
            </>
          )}

          <Button variant="outline" className="w-full" onClick={onClose}>
            Close inspector
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * "Picked by" inspection rows for a rival's squad — resolves each of their
 * seven players to the managers owning it. Individual failures degrade to a
 * dash; the section never blocks the rest of the drawer.
 */
function RivalPickedByList({
  rival,
}: {
  rival: {
    players: Array<{ _id: Id<"players">; name: string }>;
  };
}) {
  const squadsResult = useQuery(api.squads.getPickCounts);
  const allSquads = squadsResult;
  const [openFor, setOpenFor] = useState<Id<"players"> | null>(null);

  return (
    <div>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Picked by
      </p>
      <div className="space-y-1">
        {rival.players.map((p) => {
          const count = allSquads?.counts[String(p._id)] ?? 0;
          return (
            <button
              key={String(p._id)}
              onClick={() => setOpenFor(p._id)}
              className="flex w-full items-center justify-between gap-2 rounded-lg bg-secondary/40 px-3 py-1.5 text-left transition-colors hover:bg-secondary/70"
            >
              <span className="truncate text-xs font-semibold">{p.name}</span>
              <span className="text-muted-foreground shrink-0 text-[10px]">
                {count > 0 ? `Picked by ${count} manager${count === 1 ? "" : "s"}` : "—"}
              </span>
            </button>
          );
        })}
      </div>
      <PickedByDialog
        player={
          openFor
            ? {
                _id: openFor,
                name: rival.players.find((p) => String(p._id) === String(openFor))?.name ?? "Player",
              }
            : null
        }
        open={openFor !== null}
        onOpenChange={(open) => {
          if (!open) setOpenFor(null);
        }}
      />
    </div>
  );
}
