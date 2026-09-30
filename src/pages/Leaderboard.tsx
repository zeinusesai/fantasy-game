import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppNav } from "@/components/AppNav";
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
import { BarChart3, Crown, Flame, Medal, Trophy } from "lucide-react";

export default function Leaderboard() {
  const { user } = useAuth();
  const leaderboard = useQuery(api.managers.getLeaderboard);

  const rows = leaderboard ?? [];
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
            {rows.length === 0 ? (
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
                        className={cn(isMe && "bg-primary/5 hover:bg-primary/10")}
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
                            <AvatarImage src={avatar ?? undefined} alt={row.username} />
                            <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">
                              {row.username.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2 font-semibold">
                            {row.teamName}
                            {row.rank === 1 && row.totalPoints > 0 && (
                              <Badge className="bg-primary/15 text-primary border-0 gap-1">
                                <Trophy className="size-3" /> Leader
                              </Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">@{row.username}</TableCell>
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
