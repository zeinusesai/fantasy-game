import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PitchView } from "@/components/PitchView";
import { HouseBadge, HouseCrest, PositionChip } from "@/components/houses";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney, parseMoneyInput, safeBudget } from "@/convex/configDefaults";
import { HOUSES, POSITION_LABELS } from "@/lib/fantasy";
import { toast } from "sonner";
import { AppNav } from "@/components/AppNav";
import { PageLoading } from "@/components/PageLoading";
import { AlertTriangle, Check, Coins, Info, Loader2, RotateCcw, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import type { Id } from "@/convex/_generated/dataModel";
import type { House, Position } from "@/convex/schema";

const FORMATION: Record<Position, number> = { GK: 1, DEF: 2, MID: 2, FWD: 2 };

type PlayerRow = {
  _id: Id<"players">;
  name: string;
  price: number;
  house: House;
  position: Position;
  image?: string | null;
};

/** Small circular player photo with a graceful initials fallback. */
function MarketPhoto({
  player,
  sizeClass = "size-9",
}: {
  player: { name: string; position: Position; image?: string | null };
  sizeClass?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = player.image ?? null;
  if (!src || failed) {
    return (
      <span
        className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full bg-slate-900/85 text-[10px] font-bold text-white ring-1 ring-white/30`}
      >
        {player.name.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={player.name}
      className={`${sizeClass} shrink-0 rounded-full object-cover ring-1 ring-white/30`}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}

export default function SquadBuilder() {
  const { user } = useAuth();
  const playersResult = useQuery(api.players.listPlayers);
  const mySquadResult = useQuery(api.squads.getMySquad);
  const config = useQuery(api.config.getConfig);
  const mostPickedResult = useQuery(api.squads.getMostPickedPlayer);
  const saveSquad = useMutation(api.squads.saveSquad);

  // Ownership aggregation — defaults while loading / at 0 squads: every
  // player shows "Picked by 0 managers (0%)" instead of NaN or undefined.
  const pickData = useQuery(api.squads.getPickCounts);
  const ownershipFor = (id: Id<"players">) => {
    const count = pickData?.counts[String(id)] ?? 0;
    const totalSquads = pickData?.totalSquads ?? 0;
    const pct = totalSquads > 0 ? Math.round((count / totalSquads) * 100) : 0;
    return { count, totalSquads, pct };
  };

  // Popularity badge data — null-safe: no squads yet → no badge rendered.
  const mostPicked = mostPickedResult ?? null;

  const players = playersResult ?? [];
  const mySquad = mySquadResult ?? null;
  const loading = playersResult === undefined || mySquadResult === undefined;

  // $70m platform baseline. A Super-Admin customBudget override (or legacy
  // stored budget) wins; safeBudget guards NaN/Infinity/missing values so
  // budget math can never produce NaN — unconfigured users get $70m.
  const budget = safeBudget(
    user?.customBudget ?? user?.budget ?? config?.budget,
  );
  const houseLimit = config?.houseLimit ?? 3;

  const [selected, setSelected] = useState<Id<"players">[]>([]);
  const [captainId, setCaptainId] = useState<Id<"players"> | null>(null);
  const [houseFilter, setHouseFilter] = useState<string>("all");
  const [positionFilter, setPositionFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // ── Price change request modal state ──
  const submitPriceRequest = useMutation(api.requests.submitPriceRequest);
  const myRequestsResult = useQuery(api.requests.getMyPriceRequests);
  const myRequests = myRequestsResult ?? [];
  const pendingByPlayer = new Map(
    myRequests
      .filter((r) => r.status === "pending")
      .map((r) => [r.playerId as string, r]),
  );
  const [requestFor, setRequestFor] = useState<PlayerRow | null>(null);
  const [reqPrice, setReqPrice] = useState("");
  const [reqReason, setReqReason] = useState("");
  const [reqBusy, setReqBusy] = useState(false);

  // ── Player details modal state ──
  const [detailFor, setDetailFor] = useState<PlayerRow | null>(null);

  const parsedReqPrice = parseMoneyInput(reqPrice);
  const reqValid =
    requestFor !== null &&
    parsedReqPrice !== null &&
    parsedReqPrice > 0 &&
    parsedReqPrice !== requestFor.price &&
    reqReason.trim().length >= 5;

  const openRequest = (p: PlayerRow) => {
    setRequestFor(p);
    setReqPrice("");
    setReqReason("");
  };

  const handleSubmitRequest = async () => {
    if (!requestFor || !parsedReqPrice) return;
    setReqBusy(true);
    try {
      await submitPriceRequest({
        playerId: requestFor._id,
        requestedPrice: parsedReqPrice,
      reason: reqReason.trim(),
      });
      toast.success(
        `Price change request for ${requestFor.name} sent to the admins.`,
      );
      setRequestFor(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit the request.");
    } finally {
      setReqBusy(false);
    }
  };

  // Hydrate local state from the saved squad once it loads (effect, not
  // render-phase setState).
  useEffect(() => {
    if (mySquad && !initialized) {
      setInitialized(true);
      setSelected(mySquad.players.map((p) => p._id));
      setCaptainId(mySquad.captainId);
    }
  }, [mySquad, initialized]);

  const playerMap = useMemo(
    () => new Map(players.map((p) => [p._id, p])),
    [players],
  );

  const selectedPlayers = selected
    .map((id) => playerMap.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  const totalSpentRaw = selectedPlayers.reduce((sum, p) => sum + (p.price ?? 0), 0);
  const totalSpent = Number.isFinite(totalSpentRaw) ? totalSpentRaw : 0;
  const remaining = budget - totalSpent;

  const positionCounts = selectedPlayers.reduce(
    (acc, p) => {
      acc[p.position] += 1;
      return acc;
    },
    { GK: 0, DEF: 0, MID: 0, FWD: 0 } as Record<Position, number>,
  );

  const houseCounts = selectedPlayers.reduce(
    (acc, p) => {
      acc[p.house] = (acc[p.house] ?? 0) + 1;
      return acc;
    },
    {} as Record<House, number>,
  );

  const filtered = players.filter((p) => {
    if (houseFilter !== "all" && p.house !== houseFilter) return false;
    if (positionFilter !== "all" && p.position !== positionFilter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const formationComplete = FORMATION.GK === positionCounts.GK &&
    FORMATION.DEF === positionCounts.DEF &&
    FORMATION.MID === positionCounts.MID &&
    FORMATION.FWD === positionCounts.FWD;

  const houseLimitBroken = Object.entries(houseCounts).some(
    ([, count]) => count > houseLimit,
  );

  const problems: string[] = [];
  if (selected.length < 7) {
    problems.push(`Pick ${7 - selected.length} more player${7 - selected.length === 1 ? "" : "s"} (7 total).`);
  }
  if (selected.length > 7) problems.push("You have more than 7 players — remove some.");
  if (!formationComplete && selected.length === 7) {
    problems.push(
      `Formation must be 1 GK / 2 DEF / 2 MID / 2 FWD (you have ${positionCounts.GK} GK, ${positionCounts.DEF} DEF, ${positionCounts.MID} MID, ${positionCounts.FWD} FWD).`,
    );
  }
  if (houseLimitBroken) {
    problems.push(
      `House limit exceeded: max ${houseLimit} players from one house.`,
    );
  }
  if (remaining < 0) problems.push(`Over budget by ${formatMoney(-remaining)}.`);
  if (!captainId && selected.length === 7) problems.push("Choose a captain.");

  const toggle = (id: Id<"players">) => {
    if (selected.includes(id)) {
      setSelected((s) => s.filter((x) => x !== id));
      if (captainId === id) setCaptainId(null);
    } else if (selected.length < 7) {
      setSelected((s) => [...s, id]);
    } else {
      toast.error("Squad is full — remove a player first.");
    }
  };

  const handleSave = async () => {
    if (!captainId) {
      toast.error("Choose a captain before saving.");
      return;
    }
    setSaving(true);
    try {
      await saveSquad({ playerIds: selected, captainId });
      toast.success("Squad saved! Good luck, manager.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save squad.");
    } finally {
      setSaving(false);
    }
  };

  const byPosition = selectedPlayers.reduce(
    (acc, p) => {
      (acc[p.position] ??= []).push({
        playerId: p._id,
        name: p.name,
        position: p.position,
        house: p.house,
        isCaptain: captainId === p._id,
      });
      return acc;
    },
    {} as Record<string, Array<{
      playerId: Id<"players">;
      name: string;
      position: Position;
      house: House;
      isCaptain: boolean;
    }>>,
  );

  return (
    <AppNav>
      {loading ? (
        <PageLoading label="Loading squad builder…" />
      ) : players.length === 0 ? (
        <Card className="border-border/80">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Users className="text-muted-foreground size-10" />
            <h2 className="font-display text-2xl font-bold">No players registered yet</h2>
            <p className="text-muted-foreground max-w-sm text-sm">
              The admins haven't added any school players to the database yet. Check back
              soon — once players are entered you'll be able to draft your seven.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="font-display text-3xl font-bold tracking-tight">Squad builder</h1>
              <p className="text-muted-foreground text-sm">
                7 starters · 1 GK / 2 DEF / 2 MID / 2 FWD · max {houseLimit} per house · within budget
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setSelected(mySquad?.players.map((p) => p._id) ?? []);
                  setCaptainId(mySquad?.captainId ?? null);
                }}
              >
                <RotateCcw className="mr-1.5 size-4" /> Reset
              </Button>
              <Button onClick={handleSave} disabled={saving || problems.length > 0}>
                {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Check className="mr-1.5 size-4" />}
                Save squad
              </Button>
            </div>
          </div>

          {/* Budget + formation status */}
          <div className="grid gap-4 lg:grid-cols-4">
            <Card className="border-border/80">
              <CardContent className="p-4">
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  Remaining budget
                </p>
                <p
                  className={`font-score text-2xl font-bold ${
                    remaining < 0 ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {formatMoney(Math.max(remaining, 0))}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  of {formatMoney(budget)} · spent {formatMoney(totalSpent)}
                </p>
              </CardContent>
            </Card>
            <Card className="border-border/80">
              <CardContent className="p-4">
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  Formation
                </p>
                <p className="font-score text-2xl font-bold">
                  {positionCounts.GK}-{positionCounts.DEF}-{positionCounts.MID}-{positionCounts.FWD}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">needs 1-2-2-2</p>
              </CardContent>
            </Card>
            <Card className="border-border/80">
              <CardContent className="p-4">
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  Players picked
                </p>
                <p className="font-score text-2xl font-bold">
                  {selected.length}
                  <span className="text-muted-foreground text-base">/7</span>
                </p>
                <p className="text-muted-foreground mt-1 text-xs">exactly seven starters</p>
              </CardContent>
            </Card>
            <Card className="border-border/80">
              <CardContent className="p-4">
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  Houses used
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {HOUSES.map((house) => {
                    const count = houseCounts[house] ?? 0;
                    return (
                      <Badge
                        key={house}
                        variant={count > houseLimit ? "destructive" : "secondary"}
                        className="gap-1 text-[10px]"
                      >
                        {house} {count}/{houseLimit}
                      </Badge>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {problems.length > 0 && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-300">
                <AlertTriangle className="size-4" />
                {selected.length === 7 && !captainId
                  ? "Choose a captain to finish your squad"
                  : "Finish your squad"}
              </p>
              <ul className="mt-1.5 list-inside list-disc text-sm text-amber-200/80">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-5">
            {/* Pitch */}
            <div className="space-y-4 lg:col-span-2">
              <Card className="card-sheen border-border/80">
                <CardHeader className="pb-2">
                  <CardTitle className="font-display text-lg font-bold uppercase tracking-wide">
                    Your pitch
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <PitchView byPosition={byPosition} onSlotClick={() => {}} />
                </CardContent>
              </Card>
              <Card className="border-border/80">
                <CardHeader className="pb-2">
                  <CardTitle className="font-display text-sm font-bold uppercase tracking-wide">
                    Captain (2× points)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {selectedPlayers.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Pick players first.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {selectedPlayers.map((p) => (
                        <button
                          key={p._id}
                          onClick={() => setCaptainId(p._id)}
                          className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition-all ${
                            captainId === p._id
                              ? "bg-amber-400/20 text-amber-300 ring-amber-400/50"
                              : "bg-secondary text-secondary-foreground ring-border hover:border-primary/40"
                          }`}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Player market */}
            <div className="lg:col-span-3">
              <Card className="border-border/80">
                <CardHeader className="gap-3">
                  <CardTitle className="font-display text-lg font-bold uppercase tracking-wide">
                    Player market
                  </CardTitle>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      placeholder="Search players…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="sm:max-w-56"
                    />
                    <Select value={houseFilter} onValueChange={setHouseFilter}>
                      <SelectTrigger className="sm:w-40">
                        <SelectValue placeholder="House" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All houses</SelectItem>
                        {HOUSES.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={positionFilter} onValueChange={setPositionFilter}>
                      <SelectTrigger className="sm:w-40">
                        <SelectValue placeholder="Position" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All positions</SelectItem>
                        {(Object.keys(FORMATION) as Position[]).map((pos) => (
                          <SelectItem key={pos} value={pos}>
                            {POSITION_LABELS[pos]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent className="grid max-h-[560px] gap-2 overflow-y-auto sm:grid-cols-2">
                  {filtered.length === 0 && (
                    <p className="text-muted-foreground col-span-2 py-6 text-center text-sm">
                      No players match those filters.
                    </p>
                  )}
                  {filtered.map((p) => {
                    const isSelected = selected.includes(p._id);
                    const houseCount = houseCounts[p.house] ?? 0;
                    const wouldBreakHouse = !isSelected && houseCount >= houseLimit;
                    const canAfford = p.price <= remaining;
                    const affordable = isSelected || canAfford;
                    const pendingReq = pendingByPlayer.get(p._id);
                    const ownership = ownershipFor(p._id);

                    return (
                      <div key={p._id} className="flex h-full items-stretch gap-2">
                        <button
                          onClick={() => {
                            if (wouldBreakHouse && !isSelected) {
                              toast.error(`House limit: max ${houseLimit} players from ${p.house}.`);
                              return;
                            }
                            if (!affordable && !isSelected) {
                              toast.error("Not enough budget left for this player.");
                              return;
                            }
                            toggle(p._id);
                          }}
                          disabled={!affordable && !isSelected}
                          className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl border p-3 text-left transition-all ${
                            isSelected
                              ? "border-primary bg-primary/10"
                              : affordable
                                ? "border-border/70 bg-secondary/40 hover:border-primary/40"
                                : "border-border/40 bg-secondary/20 opacity-50"
                          }`}
                        >
                          <div className="flex min-w-0 items-start gap-2">
                            <MarketPhoto player={p} />
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                                {isSelected && <Check className="text-primary size-3.5 shrink-0" />}
                                {p.name}
                              </p>
                              <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
                                {p.house} <PositionChip position={p.position} />
                              </p>
                              {/* Ownership: exact pick count + % — safe at 0 squads. */}
                              <p className="text-muted-foreground/80 mt-1 text-[11px]">
                                Picked by {ownership.count} manager{ownership.count === 1 ? "" : "s"} ({ownership.pct}%)
                              </p>
                              {pendingReq && (
                                <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200">
                                  <Coins className="size-3" /> price review pending
                                </span>
                              )}
                              {mostPicked && String(mostPicked.playerId) === String(p._id) && (
                                <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-orange-400/50 bg-orange-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-200">
                                  🔥 MOST SELECTED · {mostPicked.percentage}%
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="font-score shrink-0 text-sm font-bold">
                            {formatMoney(p.price)}
                          </span>
                        </button>
                        <div className="flex shrink-0 flex-col items-center justify-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-9 px-0"
                            title="Player details"
                            onClick={() => setDetailFor(p)}
                          >
                            <Info className="size-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-9 px-0"
                            title="Request price change"
                            onClick={() => openRequest(p)}
                          >
                            <Coins className="size-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
              <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs">
                <Info className="size-3.5" />
                Squads can be edited any time before the next match is recorded.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Price change request modal */}
      <Dialog
        open={requestFor !== null}
        onOpenChange={(open) => {
          if (!open) setRequestFor(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request price change</DialogTitle>
            <DialogDescription>
              Ask the admins to revalue <span className="text-foreground font-semibold">
                {requestFor?.name ?? "this player"}
              </span>{" "}
              (currently {requestFor ? formatMoney(requestFor.price) : "—"}). They'll review
              your request and set the final market price.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="req-player">Player</Label>
              <Input id="req-player" value={requestFor?.name ?? ""} readOnly disabled />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="req-price">Requested price</Label>
              <Input
                id="req-price"
                value={reqPrice}
                onChange={(e) => setReqPrice(e.target.value)}
                placeholder="e.g. 9.5m, 850k or 9500000"
                autoFocus
              />
              {reqPrice.trim() !== "" &&
                (parsedReqPrice === null ? (
                  <p className="text-destructive text-xs">
                    Invalid amount — use 12m, 9.5m, 850k or a plain number.
                  </p>
                ) : parsedReqPrice <= 0 ? (
                  <p className="text-destructive text-xs">Price must be greater than zero.</p>
                ) : requestFor && parsedReqPrice === requestFor.price ? (
                  <p className="text-destructive text-xs">
                    That's the same as the current price.
                  </p>
                ) : null)}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="req-reason">Reason / justification</Label>
              <Textarea
                id="req-reason"
                value={reqReason}
                onChange={(e) => setReqReason(e.target.value)}
                placeholder="Why should this player be revalued? (min 5 characters)"
                rows={3}
                maxLength={400}
              />
              <p className="text-muted-foreground text-xs">
                {reqReason.trim().length}/400 characters
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRequestFor(null)}>
              Cancel
            </Button>
            <Button onClick={handleSubmitRequest} disabled={reqBusy || !reqValid}>
              {reqBusy ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Coins className="mr-1.5 size-4" />
              )}
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Player details modal — ownership, price, photo, quick pick/remove */}
      <Dialog
        open={detailFor !== null}
        onOpenChange={(open) => {
          if (!open) setDetailFor(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {detailFor && <MarketPhoto player={detailFor} sizeClass="size-10" />}
              <span className="truncate">{detailFor?.name ?? "Player"}</span>
            </DialogTitle>
            <DialogDescription>
              {detailFor && (
                <span className="flex flex-wrap items-center gap-1.5">
                  <HouseBadge house={detailFor.house} />
                  <PositionChip position={detailFor.position} />
                  <span className="font-score text-sm font-bold text-foreground">
                    {formatMoney(detailFor.price)}
                  </span>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {detailFor && (() => {
            const ownership = ownershipFor(detailFor._id);
            const isMine = selected.includes(detailFor._id);
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl border border-border/70 bg-secondary/40 p-2.5">
                    <p className="font-score text-xl font-bold">{ownership.count}</p>
                    <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wide">
                      managers picked
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-secondary/40 p-2.5">
                    <p className="font-score text-xl font-bold">{ownership.pct}%</p>
                    <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wide">
                      ownership
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-secondary/40 p-2.5">
                    <p className="font-score text-xl font-bold">{ownership.totalSquads}</p>
                    <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wide">
                      total squads
                    </p>
                  </div>
                </div>
                <p className="text-muted-foreground text-xs">
                  {ownership.totalSquads === 0
                    ? "No squads have been drafted yet — you'd be the first."
                    : ownership.count === 0
                      ? "Unpicked so far — a differential no rival owns."
                      : `${ownership.count} of ${ownership.totalSquads} managers have ${detailFor.name} in their seven.`}
                </p>
                <Button
                  className="w-full"
                  variant={isMine ? "outline" : "default"}
                  onClick={() => {
                    toggle(detailFor._id);
                    setDetailFor(null);
                  }}
                >
                  {isMine ? "Remove from my squad" : "Add to my squad"}
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </AppNav>
  );
}
