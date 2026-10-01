import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserBadges } from "@/components/UserBadge";
import { useAdminConfig } from "@/hooks/use-admin-config";
import { avatarPresetUrl } from "@/lib/fantasy";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AlertTriangle,
  Crown,
  Medal,
  Sparkles,
  Trophy,
} from "lucide-react";

// ── "See you in Year 12!" post-tournament celebration ────────────────────
//
// Renders nothing until the Super Admin ends the tournament, so the normal
// dashboard is completely unaffected while the season is live.
//
// Every field is treated as possibly-missing: the podium may be empty, a
// manager may have been deleted, and an exact tie at the bottom forfeits for
// everyone tied. None of those cases can throw inside this render.

type PodiumEntry = {
  userId: Id<"users"> | null;
  username: string;
  teamName: string;
  totalPoints: number;
  rank: number;
  avatar: string | null;
  customBadge: string | null;
  role: string | null;
};

function safeResults() {
  return {
    tournamentEnded: false,
    tournamentEndedAt: null as number | null,
    year12Message: "That's a wrap on Year 11 — see you all in Year 12!",
    podium: [] as PodiumEntry[],
    champion: null as PodiumEntry | null,
    forfeits: [] as PodiumEntry[],
    managerCount: 0,
    hasResults: false,
  };
}

function ManagerAvatar({ entry }: { entry: PodiumEntry }) {
  const src = avatarPresetUrl(entry.avatar);
  return (
    <Avatar className="size-11">
      <AvatarImage
        src={src ?? undefined}
        alt={entry.username}
        className={cn(
          entry.rank === 1 && "ring-2 ring-amber-300",
          entry.rank === 2 && "ring-2 ring-slate-300",
          entry.rank === 3 && "ring-2 ring-orange-300",
        )}
        onError={(e) => {
          // Broken image URL → hide it so the initials fallback renders.
          (e.target as HTMLImageElement).style.visibility = "hidden";
        }}
      />
      <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">
        {(entry.username ?? "?").slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

const PODIUM_STYLES: Record<number, { text: string; ring: string; height: string }> = {
  1: { text: "text-amber-300", ring: "border-amber-300/60", height: "h-28" },
  2: { text: "text-slate-200", ring: "border-slate-300/40", height: "h-20" },
  3: { text: "text-orange-300", ring: "border-orange-300/40", height: "h-24" },
};

export function Year12Celebration() {
  // Safe fallback per spec: `?? defaultObject` on every query.
  const results = useQuery(api.tournament.getTournamentResults) ?? safeResults();
  const { year12Message } = useAdminConfig();

  // Not ended (or still loading) → render nothing at all.
  if (!results.tournamentEnded) return null;

  const podium = results.podium ?? [];
  const champion = results.champion ?? podium[0] ?? null;
  const forfeits = results.forfeits ?? [];

  return (
    <Card className="card-sheen overflow-hidden border-amber-400/50 bg-gradient-to-b from-amber-500/15 via-primary/5 to-transparent">
      <CardHeader className="pb-2 text-center">
        <CardTitle className="font-display flex flex-wrap items-center justify-center gap-2 text-2xl font-black uppercase tracking-tight sm:text-3xl">
          <Sparkles className="size-6 text-amber-300" />
          See you in Year 12!
        </CardTitle>
        <p className="text-muted-foreground mx-auto max-w-lg text-sm">
          {year12Message || results.year12Message}
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ── Podium: 2nd / 1st / 3rd ── */}
        <div className="mx-auto max-w-md">
          <p className="text-muted-foreground mb-3 text-center text-[11px] font-bold uppercase tracking-widest">
            Official Hall of Fame
          </p>
          {podium.length === 0 ? (
            <p className="text-muted-foreground rounded-xl border border-border/60 bg-secondary/30 p-6 text-center text-sm">
              No managers recorded a squad this year — the podium is still open.
            </p>
          ) : (
            <div className="grid grid-cols-3 items-end gap-2">
              {[podium[1], podium[0], podium[2]].map((entry, i) => {
                // Safe: podium entries may be undefined when only 1-2 managers.
                const rank = entry?.rank ?? i + 1;
                const style = PODIUM_STYLES[rank] ?? PODIUM_STYLES[3];
                return (
                  <div key={rank} className="flex flex-col items-center gap-1.5">
                    {rank === 1 && (
                      <Crown className="size-5 animate-pulse text-amber-300" />
                    )}
                    <ManagerAvatar
                      entry={
                        entry ?? {
                          userId: null,
                          username: "TBD",
                          teamName: "TBD",
                          totalPoints: 0,
                          rank,
                          avatar: null,
                          customBadge: null,
                          role: null,
                        }
                      }
                    />
                    <p
                      className={cn(
                        "max-w-24 truncate text-center text-xs font-bold",
                        style.text,
                      )}
                      title={entry?.teamName ?? "TBD"}
                    >
                      {entry?.teamName ?? "TBD"}
                    </p>
                    <div
                      className={cn(
                        "flex w-full items-start justify-center rounded-t-xl border bg-amber-400/10 pt-2",
                        style.ring,
                        style.height,
                      )}
                    >
                      <span className="font-score text-xl font-black">#{rank}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── 1st place champion highlight ── */}
        {champion && (
          <div className="rounded-2xl border-2 border-amber-300/70 bg-gradient-to-r from-amber-400/20 via-amber-300/10 to-transparent p-4 text-center">
            <p className="font-display text-lg font-black tracking-tight text-amber-200 sm:text-xl">
              🥇 1st Place Winner — Receives a Plastic Golden Medal!
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <span className="text-sm font-bold text-foreground">
                {champion.teamName}
              </span>
              <span className="text-muted-foreground text-sm">
                @{champion.username}
              </span>
              <UserBadges
                role={champion.role}
                customBadge={champion.customBadge}
                sizeClass="size-4"
              />
              <Badge className="border-0 bg-amber-400/25 text-amber-200">
                <Medal className="size-3" />
                {champion.totalPoints} pts
              </Badge>
            </div>
          </div>
        )}

        {/* ── Bottom-place forfeit ── */}
        {forfeits.length > 0 && (
          <div className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4">
            <p className="flex items-center justify-center gap-2 text-center text-sm font-bold text-red-200">
              <AlertTriangle className="size-4" />
              Bottom-Place Forfeit
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              {forfeits.map((m) => (
                <span
                  key={String(m.userId ?? m.username)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-red-400/40 bg-red-500/10 px-3 py-1 text-xs"
                >
                  <span className="font-semibold">{m.teamName}</span>
                  <span className="text-muted-foreground">@{m.username}</span>
                  <Badge
                    variant="outline"
                    className="border-red-400/50 px-1.5 py-0 text-[9px] font-black uppercase tracking-wider text-red-300"
                  >
                    ⚠️ Forfeit Assigned
                  </Badge>
                </span>
              ))}
            </div>
            <p className="text-muted-foreground mt-2 text-center text-[11px]">
              {forfeits.length > 1
                ? `${forfeits.length} managers tied on the lowest score — the forfeit is shared.`
                : "Last on the table this year. There's always next year."}
            </p>
          </div>
        )}

        <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-center text-xs">
          <Trophy className="size-3.5" />
          {results.managerCount} manager{results.managerCount === 1 ? "" : "s"} took part · final
          standings are sealed
        </p>
      </CardContent>
    </Card>
  );
}
