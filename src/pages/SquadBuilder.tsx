import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PitchView } from "@/components/PitchView";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { StatusBadge } from "@/components/StatusBadge";
import { HouseBadge, HouseCrest, PositionChip, useHouseName } from "@/components/houses";
import { useAdminConfig } from "@/hooks/use-admin-config";
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
import { formatMoney, parseMoneyInput, safeBudget, toSafeAmount } from "@/convex/configDefaults";
import {
  DEFAULT_FORMATION,
  FORMATION_PRESETS,
  formationBlurb,
  formationFullLabel,
  formationShape,
  formationShapeSummary,
  inferFormation,
  resolveFormation,
} from "@/convex/formations";
import { CHIP_GW1, CHIP_GW2 } from "@/convex/configDefaults";
import { HOUSES, POSITION_LABELS } from "@/lib/fantasy";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AppNav } from "@/components/AppNav";
import { PageLoading } from "@/components/PageLoading";
import { PickedByDialog } from "@/components/PickedByDialog";
import { CaptainModal, MostCaptainedSummary } from "@/components/CaptainModal";
import { downloadShareCard } from "@/lib/shareCard";
import { Share2, Zap, Lock, LayoutGrid, ImageOff, Crown } from "lucide-react";
import { AlertTriangle, Check, Coins, Eye, Info, Loader2, RotateCcw, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import type { Id } from "@/convex/_generated/dataModel";
import type { House, Position } from "@/convex/schema";

// Row order for the position filter + the shape the platform used before
// custom formations existed. The live shape always comes from
// `formationShape(formation)` below, so this is only a filter-key list.
const POSITION_ORDER: Position[] = ["GK", "DEF", "MID", "FWD"];

type PlayerRow = {
  _id: Id<"players">;
  name: string;
  price: number;
  house: House;
  position: Position;
  image?: string | null;
  statusLabel?: string | null;
};

/** Small circular player photo with a graceful initials fallback. */
function MarketPhoto({
  player,
  sizeClass = "size-9",
}: {
  player: { name: string; position: Position; image?: string | null };
  sizeClass?: string;
}) {
  return (
    <PlayerAvatar
      player={player}
      className={`${sizeClass} bg-slate-900/85 ring-white/30`}
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
  // Over-budget auto-repair: clears an illegal (>$70m) stored squad after the
  // server re-verifies it — see clearMyOverBudgetSquad.
  const clearOverBudgetSquad = useMutation(api.squads.clearMyOverBudgetSquad);

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

  // Every manager's budget is the fixed $70m platform default unless the
  // Super Admin set a per-manager override (always capped at $70m).
  // safeBudget re-asserts the result is finite and non-negative, so this can
  // never be NaN, Infinity or undefined — even before auth loads.
  const { budgetOverrides, awardFor } = useAdminConfig();
  const override = user?._id ? budgetOverrides[String(user._id)] : undefined;
  const budget = safeBudget(
    typeof override === "number" && override > 0 ? override : undefined,
  );
  const houseLimit = config?.houseLimit ?? 3;
  // Super-Admin customizations: house display names + award copy.
  const houseName = useHouseName();

  const [selected, setSelected] = useState<Id<"players">[]>([]);
  const [captainId, setCaptainId] = useState<Id<"players"> | null>(null);
  const [houseFilter, setHouseFilter] = useState<string>("all");
  // Chosen 7-a-side shape. Always resolved through resolveFormation, so an
  // unexpected value can never produce a broken pitch layout.
  const [formation, setFormation] = useState<string>(DEFAULT_FORMATION);
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

  // ── Photo removal report modal state (managers → Super Admin queue) ──
  const submitPhotoRequest = useMutation(api.requests.submitPhotoRequest);
  const myPhotoRequestsResult = useQuery(api.requests.getMyPhotoRequests);
  const pendingPhotoByPlayer = useMemo(
    () =>
      new Set(
        (myPhotoRequestsResult ?? [])
          .filter((r) => r.status === "pending")
          .map((r) => r.playerId as string),
      ),
    [myPhotoRequestsResult],
  );
  const [photoReportFor, setPhotoReportFor] = useState<PlayerRow | null>(null);

  // ── Captain selection modal (with "Most Captained" analytics) ──
  const [captainOpen, setCaptainOpen] = useState(false);
  const [photoReason, setPhotoReason] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  // Budget-reset state: sticky for the session so the guidance banner and the
  // repair path survive the auto-clear (which empties the stored squad).
  const [budgetResetMode, setBudgetResetMode] = useState(false);
  const [clearAttempted, setClearAttempted] = useState(false);
  const [reqPrice, setReqPrice] = useState("");
  const [reqReason, setReqReason] = useState("");
  const [reqBusy, setReqBusy] = useState(false);

  // ── Player details modal state ──
  const [detailFor, setDetailFor] = useState<PlayerRow | null>(null);

  // ── Player of the Week highlight (top scorer from the awards engine) ──
  // Snapshot is rewritten after every match update, so the golden ring on the
  // market card follows the latest result automatically.
  const awards = useQuery(api.awards.getAwards);
  const potwId: string | null = awards?.playerOfTheWeek?.playerId ?? null;

  // ── Manager pick inspection ("Picked by …") state ──
  const [pickedByFor, setPickedByFor] = useState<PlayerRow | null>(null);

  // ── Deadline read-only mode + one-time Double Down chip ──
  const gwStatus = useQuery(api.gameweeks.getGameweekStatus);
  const chipStatus = useQuery(api.squads.getMyChip) ?? {
    chip: null,
    used: false,
    available: false,
    extraChips: 0,
    extraChipsLeft: 0,
  };
  const activateChip = useMutation(api.gameweeks.activateChip);
  const deactivateChip = useMutation(api.gameweeks.deactivateChip);
  const chipBusy = useState(false);
  const setChipBusy = chipBusy[1];

  // Read-only when the server says transfers are closed, OR when the Super
  // Admin has flipped the platform-wide master switch. The server is the
  // single authority for the deadline half (same helper it uses in
  // saveSquad); `editableSquads` mirrors the same config flag the backend
  // checks, so the UI can never disagree with what will actually be accepted.
  const { editableSquads } = useAdminConfig();
  const readOnly = (() => {
    try {
      // Repair mode: a manager whose squad was reset for exceeding the $70m
      // budget MUST be able to rebuild even while transfers are locked. The
      // server allows exactly this path (an over-budget stored squad bypasses
      // the deadline gate, and once cleared the next save is a fresh draft).
      if (budgetResetMode) return false;
      return gwStatus?.lockReason != null || editableSquads === false;
    } catch {
      return false; // fail-open: never soft-lock the builder on a query error
    }
  })();

  // Flag + auto-clear an over-budget squad exactly once per session. The
  // mutation re-verifies server-side before deleting, so this can never wipe
  // a legal squad, and a failed call is non-fatal (admin sweep / next save
  // still recover the account).
  useEffect(() => {
    if (mySquad?.overBudgetReset === true) {
      setBudgetResetMode(true);
      if (!clearAttempted) {
        setClearAttempted(true);
        clearOverBudgetSquad({}).catch(() => {
          // non-fatal — sanitized reads keep the UI correct meanwhile
        });
      }
    }
  }, [mySquad?.overBudgetReset, clearAttempted, clearOverBudgetSquad]);

  const handleToggleChip = async () => {
    setChipBusy(true);
    try {
      if (chipStatus.chip) {
        await deactivateChip({});
        toast.success("Double Down chip removed.");
      } else {
        // Arm GW1 while its stages are still open; otherwise GW2. The server
        // re-validates the deadline/settle state for the chosen gameweek.
        const gw1Settled = gwStatus?.byStage?.semifinal1?.settled === true;
        const gw1Expired =
          typeof gwStatus?.byStage?.semifinal1?.deadlineAt === "number" &&
          Date.now() > (gwStatus.byStage.semifinal1.deadlineAt as number);
        const target = gw1Settled || gw1Expired ? CHIP_GW2 : CHIP_GW1;
        await activateChip({ chip: target });
        toast.success(
          `Double Down activated for Gameweek ${target === CHIP_GW1 ? "1" : "2"} — those points count double!`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the chip.");
    } finally {
      setChipBusy(false);
    }
  };

  const handleShareTeam = () => {
    try {
      const ok = downloadShareCard({
        teamName: user?.teamName ?? "My Squad",
        username: user?.username ?? "manager",
        players: selectedPlayers.map((p) => ({
          name: p.name,
          position: p.position,
          house: p.house,
          isCaptain: captainId === p._id,
        })),
        captainId,
        totalPoints: undefined,
      });
      if (ok) {
        toast.success("Squad card downloaded — ready to share!");
      } else {
        toast.error("Sharing is not supported on this device.");
      }
    } catch {
      toast.error("Could not generate the squad card.");
    }
  };

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

  const openPhotoReport = (p: PlayerRow) => {
    setPhotoReportFor(p);
    setPhotoReason("");
  };

  const handleSubmitPhotoReport = async () => {
    if (!photoReportFor) return;
    setPhotoBusy(true);
    try {
      await submitPhotoRequest({
        playerId: photoReportFor._id,
        // Reason is optional server-side; blank is stored as "".
        reason: photoReason.trim(),
      });
      toast.success(
        `Photo report for ${photoReportFor.name} sent to the admins.`,
      );
      setPhotoReportFor(null);
      setPhotoReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the report.");
    } finally {
      setPhotoBusy(false);
    }
  };

  // Hydrate local state from the saved squad once it loads (effect, not
  // render-phase setState).
  useEffect(() => {
    if (mySquad && !initialized) {
      setInitialized(true);
      setSelected(mySquad.players.map((p) => p._id));
      setCaptainId(mySquad.captainId);
      // Saved squads always carry a server-resolved formation; the ?? keeps
      // this safe if the field is ever absent.
      setFormation(resolveFormation(mySquad.formation ?? DEFAULT_FORMATION));
    }
  }, [mySquad, initialized]);

  const playerMap = useMemo(
    () => new Map(players.map((p) => [p._id, p])),
    [players],
  );

  const selectedPlayers = selected
    .map((id) => playerMap.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  // Strict numeric parsing per price (Number()) so a malformed/NaN price can
  // never concatenate or poison the sum — remaining = 70m - sum(prices).
  const totalSpent = selectedPlayers.reduce(
    (sum, p) => sum + toSafeAmount(p.price),
    0,
  );
  const remaining = Math.max(budget - totalSpent, 0);
  const overBudgetBy = Math.max(totalSpent - budget, 0);

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

  // The shape the manager is currently building against, and whether the
  // selected 7 already satisfy it. `positionCounts` is total, so this is false
  // until all seven are picked.
  const currentShape = formationShape(formation);
  const formationComplete =
    positionCounts.GK === currentShape.GK &&
    positionCounts.DEF === currentShape.DEF &&
    positionCounts.MID === currentShape.MID &&
    positionCounts.FWD === currentShape.FWD;

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
      `Your squad does not match the chosen ${formationFullLabel(formation)} formation — needs ${formationShapeSummary(formation)} (you have ${positionCounts.GK} GK / ${positionCounts.DEF} DEF / ${positionCounts.MID} MID / ${positionCounts.FWD} FWD).`,
    );
  }
  if (houseLimitBroken) {
    problems.push(
      `House limit exceeded: max ${houseLimit} players from one house.`,
    );
  }
  if (overBudgetBy > 0) problems.push(`Over budget by ${formatMoney(overBudgetBy)}.`);
  if (!captainId && selected.length === 7) problems.push("Choose a captain.");

  const toggle = (id: Id<"players">) => {
    if (readOnly) {
      toast.error(gwStatus?.lockReason ?? "Transfers are locked.");
      return;
    }
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
      // The server returns `{ ok, error }` instead of throwing, so an invalid
      // squad is toasted here without any server exception being raised.
      const result = await saveSquad({
        playerIds: selected,
        captainId,
        formation: resolveFormation(formation),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setFormation(resolveFormation(result.formation));
      toast.success(
        `Squad saved as a ${formationFullLabel(result.formation)}! Good luck, manager.`,
      );
      // Legal squad saved — the budget-reset guidance has done its job.
      setBudgetResetMode(false);
    } catch (err) {
      // Only a genuinely unexpected failure reaches here (e.g. offline).
      toast.error(
        err instanceof Error && err.message.length > 0
          ? err.message
          : "Could not save squad — please try again.",
      );
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
        // Pass the custom photo through to the pitch card (null-safe).
        image: p.image ?? null,
        isCaptain: captainId === p._id,
        statusLabel: p.statusLabel ?? null,
      });
      return acc;
    },
    {} as Record<string, Array<{
      playerId: Id<"players">;
      name: string;
      position: Position;
      house: House;
      image: string | null;
      isCaptain: boolean;
      statusLabel: string | null;
    }>>,
  );

  /**
   * Change shape. When the current 7 already matches a legal preset, follow
   * the manager to it automatically; otherwise keep the picks and let them
   * finish the new shape.
   */
  const changeFormation = (next: string) => {
    const safe = resolveFormation(next);
    setFormation(safe);
    const autoFit = inferFormation(positionCounts);
    if (selectedPlayers.length === 7 && autoFit && autoFit !== safe) {
      toast.message(`Switched to ${safe} · ${formationBlurb(safe)}`);
    }
  };

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
        <div className="mx-auto w-full max-w-md space-y-6 sm:max-w-7xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="font-display flex flex-wrap items-center gap-2 text-3xl font-bold tracking-tight">
                Squad builder
                {readOnly && (
                  <Badge variant="outline" className="gap-1 border-red-400/50 bg-red-500/10 text-red-300">
                    <Lock className="size-3" /> READ-ONLY · {editableSquads === false ? "locked by admin" : (gwStatus?.lockReason ?? "transfers closed")}
                  </Badge>
                )}
              </h1>
              <p className="text-muted-foreground text-sm">
                {/* Dynamic — always reflects the active formation, never a
                    hardcoded 2/2/2 shape. */}
                7 starters · {formationShapeSummary(formation)} · max {houseLimit} per house
                · within budget
              </p>
              {readOnly && editableSquads === false && (
                <p className="text-destructive mt-1.5 text-xs">
                  The Super Admin has locked the Squad Builder platform-wide. Your current squad is
                  still saved and viewable.
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Double Down chip: one free per tournament, plus any store-bought
                  extra chips. The button stays visible while extras remain. */}
              {(!chipStatus.used || chipStatus.extraChipsLeft > 0) && (
                <Button
                  variant={chipStatus.chip ? "default" : "outline"}
                  onClick={handleToggleChip}
                  disabled={chipBusy[0] || readOnly || (!chipStatus.available && !chipStatus.chip)}
                  title={
                    chipStatus.extraChipsLeft > 0
                      ? `${chipStatus.extraChipsLeft} store chip${chipStatus.extraChipsLeft === 1 ? "" : "s"} left — each doubles one gameweek's points`
                      : "Once per tournament: doubles one gameweek's points"
                  }
                >
                  <Zap className={cn("mr-1.5 size-4", chipStatus.chip && "animate-pulse text-amber-300")} />
                  {chipStatus.chip
                    ? `Double Down ON (${chipStatus.chip === CHIP_GW1 ? "GW1" : "GW2"})`
                    : "Play Double Down"}
                </Button>
              )}
              {chipStatus.extraChipsLeft > 0 && (
                <Badge className="border border-amber-400/40 bg-amber-400/15 text-[10px] text-amber-300 uppercase">
                  <Zap className="mr-1 size-3" />
                  {chipStatus.extraChipsLeft} extra chip
                  {chipStatus.extraChipsLeft === 1 ? "" : "s"}
                </Badge>
              )}
              <Button variant="outline" onClick={handleShareTeam} title="Download a shareable squad card">
                <Share2 className="mr-1.5 size-4" /> Share Team
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSelected(mySquad?.players.map((p) => p._id) ?? []);
                  setCaptainId(mySquad?.captainId ?? null);
                }}
                disabled={readOnly}
              >
                <RotateCcw className="mr-1.5 size-4" /> Reset
              </Button>
              <Button onClick={handleSave} disabled={saving || problems.length > 0 || readOnly}>
                {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Check className="mr-1.5 size-4" />}
                Save squad
              </Button>
            </div>
          </div>

          {/* Budget-reset guidance: shown when the stored squad was reset for
              exceeding the $70m cap (flag from the server, sticky for the
              session until a legal squad is saved again). */}
          {budgetResetMode && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-amber-400/50 bg-amber-400/10 p-4 text-amber-100"
            >
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-300" />
              <div>
                <p className="text-sm font-bold">
                  Your team exceeded the {formatMoney(budget)} budget limit and has been reset.
                </p>
                <p className="mt-0.5 text-xs text-amber-200/85">
                  Please re-select your 7 players within {formatMoney(budget)}.
                </p>
              </div>
            </div>
          )}

          {/* Budget + formation status */}
          <div className="grid gap-4 lg:grid-cols-4">
            <Card className="border-border/80">
              <CardContent className="p-4">
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  Remaining budget
                </p>
                <p
                  className={`font-score text-2xl font-bold ${
                    overBudgetBy > 0 ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {formatMoney(remaining)}
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
                <p className="text-muted-foreground mt-1 text-xs">
                  needs {formationFullLabel(formation)}
                </p>
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
                  <PitchView
                    byPosition={byPosition}
                    onSlotClick={() => {}}
                    formation={formation}
                    showStatus
                    showFormationLabel
                    // Store cosmetics — `?? "default"` so a manager who never
                    // unlocked anything gets the standard green pitch.
                    theme={user?.activePitchTheme ?? "default"}
                    goldenJersey={user?.hasGoldenJersey === true}
                  />
                </CardContent>
              </Card>

              {/* Formation selector — the same 5 shapes the server enforces. */}
              <Card className="border-border/80">
                <CardHeader className="pb-2">
                  <CardTitle className="font-display flex items-center gap-2 text-sm font-bold uppercase tracking-wide">
                    <LayoutGrid className="text-primary size-4" />
                    Formation
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {FORMATION_PRESETS.map((preset) => {
                      const active = preset.id === formation;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => changeFormation(preset.id)}
                          aria-pressed={active}
                          title={`${preset.label} · ${preset.blurb}`}
                          className={cn(
                            "rounded-lg border px-2 py-1.5 text-left transition-all",
                            active
                              ? "border-primary bg-primary/15 ring-primary/40 ring-1"
                              : "border-border/70 bg-secondary/40 hover:border-primary/40",
                          )}
                        >
                          <span className="font-score block text-sm font-bold">{preset.label}</span>
                          <span className="text-muted-foreground block text-[10px] font-medium">
                            {preset.blurb}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-muted-foreground mt-2 text-[11px] leading-snug">
                    {formationFullLabel(formation)} · {formationBlurb(formation)} — needs{" "}
                    {formationShapeSummary(formation)}.
                  </p>
                </CardContent>
              </Card>
              <Card className="border-border/80">
                <CardHeader className="pb-2">
                  <CardTitle className="font-display text-sm font-bold uppercase tracking-wide">
                    Captain (2× points)
                  </CardTitle>
                  {selectedPlayers.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-1.5"
                      onClick={() => setCaptainOpen(true)}
                    >
                      <Crown className="mr-1.5 size-3.5" />
                      {captainId ? "Change captain" : "Choose captain"}
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-2">
                  {selectedPlayers.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Pick players first.</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {selectedPlayers.map((p) => (
                          <button
                            key={p._id}
                            onClick={() => setCaptainId(p._id)}
                            className={`flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-xs font-semibold ring-1 transition-all ${
                              captainId === p._id
                                ? "bg-amber-400/20 text-amber-300 ring-amber-400/50"
                                : "bg-secondary text-secondary-foreground ring-border hover:ring-primary/40"
                            }`}
                          >
                            <PlayerAvatar player={p} size={22} className="ring-0" />
                            {p.name}
                          </button>
                        ))}
                      </div>
                      {/* Live "Most Captained" analytics for the chosen skipper. */}
                      <MostCaptainedSummary
                        playerId={captainId}
                        isCaptain={captainId !== null}
                      />
                    </>
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
                        {POSITION_ORDER.map((pos) => (
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
                    const canAfford = toSafeAmount(p.price) <= remaining;
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
                          } ${
                            // Player of the Week: distinct golden frame.
                            potwId !== null && String(p._id) === String(potwId)
                              ? "ring-2 ring-amber-400/80 shadow-[0_0_16px_rgba(251,191,36,0.35)]"
                              : ""
                          }`}
                        >
                          <div className="flex min-w-0 items-start gap-2">
                            <MarketPhoto player={p} />
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                                {isSelected && <Check className="text-primary size-3.5 shrink-0" />}
                                {p.name}
                              </p>
                              <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                                {houseName(p.house)} <PositionChip position={p.position} />
                                {/* Availability set by the Super Admin; defaults to
                                    "Expected to Start" when unassigned. */}
                                <StatusBadge status={p.statusLabel} short />
                              </p>
                              {/* Ownership: exact pick count + % — safe at 0 squads.
                                  The count is a button: opens the pick-inspection
                                  dialog listing every manager who owns the player. */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation(); // don't toggle the player
                                  setPickedByFor(p);
                                }}
                                title="View managers who picked this player"
                                className="mt-1 inline-flex items-center gap-1 rounded text-[11px] font-medium text-sky-300 underline-offset-2 transition-colors hover:text-sky-200 hover:underline"
                              >
                                Picked by {ownership.count} manager{ownership.count === 1 ? "" : "s"} ({ownership.pct}%)
                                <Eye className="size-3" />
                              </button>
                              {pendingReq && (
                                <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200">
                                  <Coins className="size-3" /> price review pending
                                </span>
                              )}
                              {/* Player of the Week crown badge */}
                              {potwId !== null && String(p._id) === String(potwId) && (
                                <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-400/60 bg-gradient-to-r from-amber-400/25 to-yellow-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-200">
                                  👑 {awardFor("playerOfTheWeek").title}
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

      {/* Captain selection with live "Most Captained" league analytics. */}
      <CaptainModal
        open={captainOpen}
        onOpenChange={setCaptainOpen}
        candidates={selectedPlayers}
        captainId={captainId}
        onConfirm={(id) => setCaptainId(id)}
      />

      {/* Photo removal report modal */}
      <Dialog
        open={photoReportFor !== null}
        onOpenChange={(open) => {
          if (!open) setPhotoReportFor(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report this photo</DialogTitle>
            <DialogDescription>
              Think{" "}
              <span className="text-foreground font-semibold">
                {photoReportFor?.name ?? "this player"}
              </span>
              's photo is wrong, low quality or inappropriate? Send it to the
              Super Admin. If it's approved, the photo is cleared and everyone
              sees the default avatar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-secondary/30 p-3">
              {photoReportFor && (
                <MarketPhoto player={photoReportFor} sizeClass="size-10" />
              )}
              <div className="min-w-0 text-sm">
                <p className="truncate font-semibold">
                  {photoReportFor?.name ?? "Player"}
                </p>
                <p className="text-muted-foreground text-xs">
                  Reason is optional but helps the admin decide.
                </p>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="photo-reason">Reason (optional)</Label>
              <Textarea
                id="photo-reason"
                value={photoReason}
                onChange={(e) => setPhotoReason(e.target.value)}
                placeholder="e.g. This is the wrong player, or the image is a link to another site."
                rows={3}
                maxLength={400}
              />
              <p className="text-muted-foreground text-xs">
                {photoReason.trim().length}/400 characters
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPhotoReportFor(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleSubmitPhotoReport}
              disabled={photoBusy || photoReportFor === null}
            >
              {photoBusy ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <ImageOff className="mr-1.5 size-4" />
              )}
              Send report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manager pick inspection — who owns this player? */}
      <PickedByDialog
        player={pickedByFor ? { _id: pickedByFor._id, name: pickedByFor.name } : null}
        open={pickedByFor !== null}
        onOpenChange={(open) => {
          if (!open) setPickedByFor(null);
        }}
      />

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
                {/* Photo moderation — subtle, manager-facing. A player with no
                    photo can't be reported (the mutation rejects it anyway),
                    and a duplicate pending report is disabled, not errored. */}
                <button
                  type="button"
                  disabled={photoBusy}
                  onClick={() => {
                    openPhotoReport(detailFor);
                    setDetailFor(null);
                  }}
                  className="text-muted-foreground hover:text-foreground flex w-full items-center justify-center gap-1.5 text-[11px] transition-colors disabled:opacity-50"
                >
                  <ImageOff className="size-3" />
                  {pendingPhotoByPlayer.has(detailFor._id as string)
                    ? "Photo report pending review"
                    : "Report / request photo removal"}
                </button>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setPickedByFor(detailFor);
                      setDetailFor(null);
                    }}
                    className="rounded-xl border border-border/70 bg-secondary/40 p-2.5 transition-colors hover:border-primary/40"
                    title="View managers who picked this player"
                  >
                    <p className="font-score text-xl font-bold">{ownership.count}</p>
                    <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wide">
                      managers picked
                    </p>
                  </button>
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
