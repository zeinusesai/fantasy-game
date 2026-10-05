import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SkeletonList } from "@/components/Skeletons";
import { avatarPresetUrl } from "@/lib/fantasy";
import { cn } from "@/lib/utils";
import { Crown, Flame, GraduationCap, Trophy, Users } from "lucide-react";

/**
 * The Section Leaderboard tab: Section A–H ranked by the aggregate fantasy
 * points of every manager in them.
 *
 * The "Section Champions" glow is the temporary weekly cosmetic. It is purely
 * derived from the server (`isChampion`), which re-evaluates it automatically
 * every time a gameweek is closed — so it appears the week a section wins and
 * disappears the week the next one does, with nothing to clean up client-side.
 */
export function SectionLeaderboardPanel() {
  const result = useQuery(api.leaderboard.getSectionLeaderboard, { membersPerSection: 4 });
  const loading = result === undefined;
  const standings = result?.standings ?? [];
  const champion = result?.champion ?? null;

  return (
    <div className="space-y-4">
      {/* Banner explaining the temporary award, so the glow is never mistaken
          for a permanent title. */}
      <div
        className={cn(
          "glass-glint flex flex-wrap items-center justify-between gap-3 rounded-xl p-3",
          champion ? "section-champion-glow" : "border-white/10",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <Trophy
            className={cn(
              "size-5 shrink-0",
              champion ? "text-amber-300" : "text-muted-foreground",
            )}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {champion
                ? `${champion.section} are the Section Champions`
                : "No Section Champions yet"}
            </p>
            <p className="text-muted-foreground text-xs">
              {champion
                ? `${champion.managerCount} ${
                    champion.managerCount === 1 ? "manager" : "managers"
                  } · ${champion.totalPoints} pts in GW${champion.gameweek}. The glow carries into GW${
                    champion.gameweek + 1
                  } and is replaced when that gameweek closes.`
                : "Close a gameweek in the Admin panel to crown the top-scoring section for that week."}
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <SkeletonList count={4} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {standings.map((s) => (
            <Card
              key={s.section}
              className={cn(
                "glass-glint border-white/10",
                s.isChampion && "section-champion-glow",
              )}
            >
              <CardHeader className="pb-3">
                <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="font-score text-muted-foreground w-6 text-sm">
                      #{s.rank}
                    </span>
                    <GraduationCap className="text-primary size-4 shrink-0" />
                    <span
                      className={cn(
                        "text-base",
                        s.isChampion && "section-champion-name text-amber-100",
                      )}
                    >
                      {s.section}
                    </span>
                  </span>
                  {s.isChampion ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-400/60 bg-amber-400/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-100">
                      <Trophy className="size-3" /> Champions
                    </span>
                  ) : s.rank === 1 ? (
                    <Crown className="size-4 shrink-0 text-amber-300/80" />
                  ) : null}
                </CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="font-score text-foreground text-base font-bold">
                    {s.totalPoints} pts
                  </span>
                  <span className="text-muted-foreground inline-flex items-center gap-1">
                    <Flame className="size-3" /> {s.weeklyPoints} last GW
                  </span>
                  <span className="text-muted-foreground inline-flex items-center gap-1">
                    <Users className="size-3" /> {s.managerCount}{" "}
                    {s.managerCount === 1 ? "manager" : "managers"}
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                {s.members.length === 0 ? (
                  <p className="text-muted-foreground py-2 text-xs">
                    No managers in this section yet.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {s.members.map((m) => (
                      <li
                        key={String(m.userId)}
                        className="glass-subtle hover:bg-white/10 flex items-center gap-2 rounded-lg px-2 py-1.5 transition-all duration-300"
                      >
                        <Avatar className="size-6 shrink-0">
                          <AvatarImage
                            src={
                              m.avatar?.startsWith("http") || m.avatar?.startsWith("data:")
                                ? m.avatar
                                : (avatarPresetUrl(m.avatar) ?? undefined)
                            }
                            alt={m.username}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.visibility = "hidden";
                            }}
                          />
                          <AvatarFallback className="bg-primary/20 text-primary text-[9px] font-bold">
                            {m.username.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold">
                            {m.teamName}
                          </span>
                          <span className="text-muted-foreground block truncate text-[10px]">
                            @{m.username}
                          </span>
                        </span>
                        <span className="font-score shrink-0 text-xs font-bold text-primary">
                          {m.totalPoints}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}