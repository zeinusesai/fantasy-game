import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import type { House, MatchStatus } from "@/convex/schema";
import { HOUSES, STAGE_LABELS } from "@/lib/fantasy";
import { HouseBadge, PositionChip, RatingBadge } from "@/components/houses";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  CalendarDays,
  ClipboardList,
  Loader2,
  Save,
  Star,
  Trash2,
  Users,
} from "lucide-react";

type PlayerDoc = Doc<"players">;
type MatchDoc = Doc<"matches">;

const EMPTY_RATING = {
  rating: "",
  goals: "0",
  assists: "0",
  saves: "0",
  yellowCards: "0",
  redCards: "0",
};

/**
 * Super Admin Match Control Center — lineups, event logger, FotMob ratings
 * and PotM for one selected fixture. Every mutation is invoked with explicit,
 * validated values and errors surface as clean toasts.
 */
export function MatchControlCenter() {
  const matchesResult = useQuery(api.matches.listMatches);
  const matches = matchesResult ?? [];
  const playersResult = useQuery(api.players.listPlayers);
  const players = playersResult ?? [];

  const setMatchStatus = useMutation(api.matches.setMatchStatus);
  const setMatchDate = useMutation(api.matches.setMatchDate);
  const setLineups = useMutation(api.matches.setLineups);
  const logTimelineEvent = useMutation(api.matches.logTimelineEvent);
  const removeTimelineEvent = useMutation(api.matches.removeTimelineEvent);
  const setPlayerRatings = useMutation(api.matches.setPlayerRatings);
  const setPotmPlayer = useMutation(api.matches.setPotmPlayer);

  const [matchId, setMatchId] = useState<string>("");
  const activeId = /^[a-z0-9]{20,40}$/.test(matchId) ? matchId : null;
  const detailsResult = useQuery(
    api.matches.getMatchDetails,
    activeId ? ({ matchId: activeId as Id<"matches"> } as { matchId: Id<"matches"> }) : "skip",
  );
  const match: MatchDoc | null = detailsResult?.match ?? null;
  const playersById = useMemo(
    () => new Map<string, PlayerDoc>((detailsResult?.players ?? []).map((p) => [p._id as string, p])),
    [detailsResult],
  );

  // ── Local editor state (hydrated from the selected match) ──
  const [status, setStatus] = useState<MatchStatus>("scheduled");
  const [dateInput, setDateInput] = useState("");
  const [home, setHome] = useState<string[]>([]);
  const [away, setAway] = useState<string[]>([]);
  const [ratings, setRatings] = useState<Record<string, typeof EMPTY_RATING>>({});
  const [potm, setPotm] = useState<string>("");
  const [eventType, setEventType] = useState<"goal" | "yellow_card" | "red_card" | "sub">("goal");
  const [minute, setMinute] = useState("");
  const [scorerId, setScorerId] = useState<string>("");
  const [assistId, setAssistId] = useState<string>("none");
  const [busy, setBusy] = useState(false);

  // Hydrate the editor whenever a different match is selected.
  useEffect(() => {
    if (!match) return;
    setStatus(match.status);
    setDateInput(match.matchDate ?? match.kickoffLabel ?? "");
    setHome((match.lineups?.homeStarters ?? []).map(String));
    setAway((match.lineups?.awayStarters ?? []).map(String));
    setPotm(match.potmPlayerId ? String(match.potmPlayerId) : "");
    const seeded: Record<string, typeof EMPTY_RATING> = {};
    for (const r of match.playerRatings ?? []) {
      seeded[String(r.playerId)] = {
        rating: String(r.rating),
        goals: String(r.goals),
        assists: String(r.assists),
        saves: String(r.saves),
        yellowCards: String(r.yellowCards),
        redCards: String(r.redCards),
      };
    }
    setRatings(seeded);
  }, [match?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const homeRoster = match ? players.filter((p) => p.house === match.homeHouse) : [];
  const awayRoster = match ? players.filter((p) => p.house === match.awayHouse) : [];

  const toggleStarter = (list: string[], setList: (v: string[]) => void, id: string) => {
    if (list.includes(id)) {
      setList(list.filter((x) => x !== id));
      if (potm === id) setPotm("");
    } else if (list.length < 7) {
      setList([...list, id]);
    } else {
      toast.error("That team already has 7 starters — remove one first.");
    }
  };

  const saveStatus = async () => {
    if (!activeId) return;
    setBusy(true);
    try {
      await setMatchStatus({ matchId: activeId as Id<"matches">, status });
      toast.success(`Match status set to ${status}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set the status.");
    } finally {
      setBusy(false);
    }
  };

  const saveDate = async () => {
    if (!activeId) return;
    setBusy(true);
    try {
      await setMatchDate({ matchId: activeId as Id<"matches">, matchDate: dateInput });
      toast.success(dateInput ? "Match date saved." : "Match date cleared.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set the date.");
    } finally {
      setBusy(false);
    }
  };

  const saveLineups = async () => {
    if (!activeId || !match) return;
    setBusy(true);
    try {
      await setLineups({
        matchId: activeId as Id<"matches">,
        homeStarters: home as Id<"players">[],
        awayStarters: away as Id<"players">[],
      });
      toast.success("Lineups saved — preview is now live for fans.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the lineups.");
    } finally {
      setBusy(false);
    }
  };

  const addEvent = async () => {
    if (!activeId || !match) return;
    const minuteNum = Number(minute);
    if (!Number.isFinite(minuteNum) || minuteNum < 0 || minuteNum > 130) {
      toast.error("Enter a valid minute (0–130).");
      return;
    }
    if (!scorerId) {
      toast.error("Pick the player involved.");
      return;
    }
    setBusy(true);
    try {
      await logTimelineEvent({
        matchId: activeId as Id<"matches">,
        type: eventType,
        minute: minuteNum,
        playerId: scorerId as Id<"players">,
        ...(eventType === "goal" && assistId !== "none"
          ? { assistPlayerId: assistId as Id<"players"> }
          : {}),
      });
      toast.success("Event logged.");
      setMinute("");
      setScorerId("");
      setAssistId("none");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not log the event.");
    } finally {
      setBusy(false);
    }
  };

  const removeEvent = async (eventId: string) => {
    if (!activeId) return;
    try {
      await removeTimelineEvent({ matchId: activeId as Id<"matches">, eventId });
      toast.success("Event removed — the score was adjusted if it was a goal.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the event.");
    }
  };

  const saveRatings = async () => {
    if (!activeId) return;
    const rows: {
      playerId: Id<"players">;
      rating: number;
      goals: number;
      assists: number;
      saves: number;
      yellowCards: number;
      redCards: number;
    }[] = [];
    for (const [pid, r] of Object.entries(ratings)) {
      if (r.rating.trim() === "") continue; // unrated players are skipped
      const rating = parseFloat(r.rating);
      if (!Number.isFinite(rating) || rating < 1 || rating > 10) {
        toast.error(`Rating for ${playersById.get(pid)?.name ?? "a player"} must be 1.0–10.0.`);
        return;
      }
      rows.push({
        playerId: pid as Id<"players">,
        rating: Math.round(rating * 10) / 10,
        goals: parseInt(r.goals) || 0,
        assists: parseInt(r.assists) || 0,
        saves: parseInt(r.saves) || 0,
        yellowCards: parseInt(r.yellowCards) || 0,
        redCards: parseInt(r.redCards) || 0,
      });
    }
    if (rows.length === 0) {
      toast.error("Enter at least one player rating.");
      return;
    }
    setBusy(true);
    try {
      await setPlayerRatings({ matchId: activeId as Id<"matches">, ratings: rows });
      toast.success(`${rows.length} player rating${rows.length === 1 ? "" : "s"} saved.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the ratings.");
    } finally {
      setBusy(false);
    }
  };

  const savePotm = async () => {
    if (!activeId) return;
    setBusy(true);
    try {
      await setPotmPlayer({
        matchId: activeId as Id<"matches">,
        playerId: potm ? (potm as Id<"players">) : undefined,
      });
      toast.success(potm ? "Player of the Match assigned." : "PotM cleared.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not assign PotM.");
    } finally {
      setBusy(false);
    }
  };

  const events = [...(match?.timelineEvents ?? [])].sort((a, b) => a.minute - b.minute);
  const lineupIds = new Set([...home, ...away]);
  const ratedIds = new Set(Object.keys(ratings).filter((k) => ratings[k].rating.trim() !== ""));
  const potmOptions = players.filter((p) => lineupIds.has(String(p._id)) || ratedIds.has(String(p._id)));

  return (
    <Card className="card-sheen border-border/80">
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
          <ClipboardList className="text-primary size-4" /> Match Center control
        </CardTitle>
        <CardDescription>
          Build the preview, log events live, hand out FotMob ratings and pick a
          Player of the Match — fans see it all instantly on the match page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Fixture selector */}
        <div className="grid gap-1.5">
          <Label>Fixture</Label>
          <Select value={matchId} onValueChange={setMatchId}>
            <SelectTrigger>
              <SelectValue placeholder={matches.length === 0 ? "No fixtures yet — schedule one above" : "Pick a fixture to manage"} />
            </SelectTrigger>
            <SelectContent>
              {matches.map((m) => (
                <SelectItem key={m._id} value={m._id}>
                  {STAGE_LABELS[m.stage]} · {m.homeHouse} vs {m.awayHouse}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {matchesResult === undefined ? (
          <p className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading fixtures…
          </p>
        ) : !match ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            Select a fixture above to manage its match center.
          </p>
        ) : (
          <>
            {/* Status + date */}
            <div className="grid gap-3 rounded-xl border border-border/70 bg-secondary/30 p-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Status</Label>
                <div className="flex gap-2">
                  <Select value={status} onValueChange={(v) => setStatus(v as MatchStatus)}>
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="live">Live</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={saveStatus} disabled={busy}>
                    <Save className="size-3.5" />
                  </Button>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label className="flex items-center gap-1.5">
                  <CalendarDays className="size-3.5" /> Match date
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={dateInput}
                    onChange={(e) => setDateInput(e.target.value)}
                    placeholder="Fri 14 Nov, 6 PM"
                  />
                  <Button variant="outline" onClick={saveDate} disabled={busy}>
                    <Save className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Lineup manager */}
            <div className="rounded-xl border border-border/70 bg-secondary/30 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide">
                  <Users className="size-3.5" /> Starting lineups (max 7 per team)
                </p>
                <Button size="sm" variant="outline" onClick={saveLineups} disabled={busy}>
                  <Save className="mr-1.5 size-3.5" /> Save lineups
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {([
                  { label: match.homeHouse, roster: homeRoster, list: home, setList: setHome },
                  { label: match.awayHouse, roster: awayRoster, list: away, setList: setAway },
                ] as const).map((side) => (
                  <div key={side.label}>
                    <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
                      <HouseBadge house={side.label as House} /> {side.label}
                      <Badge variant="secondary" className="text-[10px]">{side.list.length}/7</Badge>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {side.roster.map((p) => (
                        <button
                          key={p._id}
                          onClick={() => toggleStarter(side.list, side.setList, String(p._id))}
                          className={`flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-xs font-medium ring-1 transition-all ${
                            side.list.includes(String(p._id))
                              ? "bg-primary/20 text-primary ring-primary/50"
                              : "bg-secondary text-secondary-foreground ring-border hover:ring-primary/40"
                          }`}
                        >
                          {/* Custom photo with initials fallback — never a broken image. */}
                          <PlayerAvatar player={p} size={20} className="ring-0" />
                          {p.name}
                        </button>
                      ))}
                      {side.roster.length === 0 && (
                        <p className="text-muted-foreground text-xs">No players registered for this house yet.</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Event logger */}
            <div className="rounded-xl border border-border/70 bg-secondary/30 p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide">Live event logger</p>
              <div className="grid gap-2 sm:grid-cols-5">
                <div className="grid gap-1">
                  <Label className="text-[10px] uppercase text-muted-foreground">Type</Label>
                  <Select value={eventType} onValueChange={(v) => setEventType(v as typeof eventType)}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="goal">⚽ Goal</SelectItem>
                      <SelectItem value="yellow_card">Yellow card</SelectItem>
                      <SelectItem value="red_card">Red card</SelectItem>
                      <SelectItem value="sub">Substitution</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1">
                  <Label className="text-[10px] uppercase text-muted-foreground">Minute</Label>
                  <Input value={minute} onChange={(e) => setMinute(e.target.value)} placeholder="34" className="h-8" />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[10px] uppercase text-muted-foreground">Player</Label>
                  <Select value={scorerId} onValueChange={setScorerId}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="Pick player" /></SelectTrigger>
                    <SelectContent>
                      {[...homeRoster, ...awayRoster].map((p) => (
                        <SelectItem key={p._id} value={String(p._id)}>
                          {p.name} ({p.house})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1">
                  <Label className="text-[10px] uppercase text-muted-foreground">Assist (goals)</Label>
                  <Select value={assistId} onValueChange={setAssistId} disabled={eventType !== "goal"}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No assist</SelectItem>
                      {[...homeRoster, ...awayRoster]
                        .filter((p) => String(p._id) !== scorerId)
                        .map((p) => (
                          <SelectItem key={p._id} value={String(p._id)}>{p.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button className="w-full" size="sm" onClick={addEvent} disabled={busy}>
                    Log event
                  </Button>
                </div>
              </div>

              {/* Logged events */}
              <div className="mt-3 space-y-1.5">
                {events.length === 0 ? (
                  <p className="text-muted-foreground text-xs">No events logged yet.</p>
                ) : (
                  events.map((ev) => (
                    <div
                      key={ev.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5"
                    >
                      <p className="text-xs">
                        <span className="font-score mr-1.5 font-bold">{ev.minute}′</span>
                        {ev.type === "goal" ? "⚽" : ev.type === "yellow_card" ? "🟨" : ev.type === "red_card" ? "🟥" : "🔄"}{" "}
                        <span className="font-semibold">{ev.playerName}</span>
                        {ev.assistPlayerName && (
                          <span className="text-muted-foreground"> (Assist: {ev.assistPlayerName})</span>
                        )}
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="size-6 p-0 text-destructive"
                        onClick={() => removeEvent(ev.id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Ratings editor */}
            <div className="rounded-xl border border-border/70 bg-secondary/30 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wide">FotMob ratings (1.0–10.0)</p>
                <Button size="sm" variant="outline" onClick={saveRatings} disabled={busy}>
                  <Save className="mr-1.5 size-3.5" /> Save ratings
                </Button>
              </div>
              {lineupIds.size === 0 ? (
                <p className="text-muted-foreground text-xs">
                  Save lineups first — rated players come from the starting lineups.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {[...lineupIds].map((pid) => {
                    const p = playersById.get(pid);
                    const r = ratings[pid] ?? EMPTY_RATING;
                    const patch = (v: Partial<typeof EMPTY_RATING>) =>
                      setRatings((prev) => ({ ...prev, [pid]: { ...r, ...v } }));
                    return (
                      <div key={pid} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-background/40 p-2">
                        <PlayerAvatar player={p} size={22} className="ring-0" />
                        <span className="min-w-28 flex-1 truncate text-xs font-semibold">
                          {p?.name ?? "Player"}
                          {p && <PositionChip position={p.position} />}
                        </span>
                        <Input
                          value={r.rating}
                          onChange={(e) => patch({ rating: e.target.value })}
                          placeholder="8.4"
                          className="h-7 w-16 text-center text-xs"
                        />
                        {(["goals", "assists", "saves", "yellowCards", "redCards"] as const).map((k) => (
                          <Input
                            key={k}
                            value={r[k]}
                            onChange={(e) => patch({ [k]: e.target.value })}
                            placeholder={k === "yellowCards" ? "YC" : k === "redCards" ? "RC" : k.slice(0, 3)}
                            className="h-7 w-12 text-center text-xs"
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* PotM */}
            <div className="grid gap-1.5 rounded-xl border border-border/70 bg-secondary/30 p-3">
              <Label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide">
                <Star className="size-3.5 text-amber-300" /> Player of the Match
              </Label>
              <div className="flex gap-2">
                <Select value={potm} onValueChange={setPotm}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Assign PotM" />
                  </SelectTrigger>
                  <SelectContent>
                    {potmOptions.map((p) => (
                      <SelectItem key={p._id} value={String(p._id)}>
                        {p.name} ({p.house})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={savePotm} disabled={busy}>Assign</Button>
              </div>
              {potmOptions.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  PotM can be picked from lineup or rated players.
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Small helper re-exported for rating display consistency in admin lists. */
export function AdminRatingBadge({ rating }: { rating: number }) {
  return <RatingBadge rating={rating} />;
}
