import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppNav } from "@/components/AppNav";
import { PageLoading } from "@/components/PageLoading";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { avatarPresetUrl } from "@/lib/fantasy";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { BarChart3, Crown, Flame, Loader2, Medal, Star, Trophy } from "lucide-react";

export default function Leaderboard() {
  const { user } = useAuth();
  const leaderboardResult = useQuery(api.managers.getLeaderboard);

  const rows = leaderboardResult ?? [];
  const loading = leaderboardResult === undefined;
  const medalStyles = ["text-amber-300", "text-slate-300", "text-orange-300"];

  return (
    <AppNav>
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Global leaderboard</h1>
          <p className="text-muted-foreground text-sm">
            Every manager ranked by total fantasy points across the tournament.
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
                          <span className="flex flex-wrap items-center gap-2 font-semibold">
                            {row.teamName}
                            {row.rank === 1 && row.totalPoints > 0 && (
                              <Badge className="gap-1 whitespace-normal border border-amber-400/40 bg-amber-400/15 py-1 text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.25)]">
                                <Trophy className="size-3 shrink-0" />
                                CURRENTLY WINNING: 1x Premium Grade Plastic Medal (Priceless)
                              </Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">@{row.username}</TableCell>
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
    </AppNav>
  );
}
