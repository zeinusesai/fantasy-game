import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney, parseMoneyInput, toSafeAmount } from "@/convex/configDefaults";
import { HOUSES, POSITION_LABELS } from "@/lib/fantasy";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  AlertTriangle,
  BadgePlus,
  Coins,
  Loader2,
  Pencil,
  Search,
  ShieldAlert,
  UserCog,
  Users2,
} from "lucide-react";

/**
 * User inspector + squad force-editor (Super Admin only).
 *
 * Search any manager, then fix the things a manager can't fix themselves:
 * their username, their budget, their points, their chips, and — if their
 * submission is broken — their actual starting seven and captain.
 *
 * Every mutation below is try/catch'd with a clean toast, every numeric input
 * is strictly parsed, and every query falls back to `[]` / `null` so the tab
 * renders safely on an empty database.
 */

const ROLE_OPTIONS = ["manager", "moderator", "super_admin"] as const;
const FORMATION = { GK: 1, DEF: 2, MID: 2, FWD: 2 } as const;

type InspectorRow = {
  _id: Id<"users">;
  username: string | null;
  teamName: string | null;
  role: string;
  totalPoints: number;
  squadSize: number;
  budget: number;
  hasBudgetOverride: boolean;
  activeChip: string | null;
  chipUsed: boolean;
};

/** Strict numeric parse that rejects blanks, NaN and Infinity. */
function strictNum(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function UserInspectorTab() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Id<"users"> | null>(null);

  const searchUsers = useQuery(api.adminControl.searchUsers, {
    limit: 200,
    ...(search.trim().length > 0 ? { search: search.trim() } : {}),
    ...(roleFilter !== "all" ? { role: roleFilter } : {}),
  });

  const rows = useMemo<InspectorRow[]>(
    () =>
      ((searchUsers ?? []) as unknown as InspectorRow[]).map((u) => ({
        _id: u._id,
        username: typeof u.username === "string" ? u.username : null,
        teamName: typeof u.teamName === "string" ? u.teamName : null,
        role: typeof u.role === "string" && u.role.length > 0 ? u.role : "manager",
        totalPoints: toSafeAmount(u.totalPoints),
        squadSize: Number(u.squadSize) || 0,
        budget: toSafeAmount(u.budget),
        hasBudgetOverride: u.hasBudgetOverride === true,
        activeChip: typeof u.activeChip === "string" ? u.activeChip : null,
        chipUsed: u.chipUsed === true,
      })),
    [searchUsers],
  );

  return (
    <div className="space-y-6">
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <Users2 className="text-primary size-4" /> User inspector
          </CardTitle>
          <CardDescription>
            Search every account, then open one to edit its username, budget, points, chips and
            starting seven. Role and badge assignment live in the Roles tab.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
            <div className="grid gap-1.5">
              <Label htmlFor="inspector-search">Search</Label>
              <div className="relative">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input
                  id="inspector-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="username or team name…"
                  className="pl-8"
                  maxLength={40}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="inspector-role">Role</Label>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger id="inspector-role">
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {searchUsers === undefined ? (
            <p className="text-muted-foreground py-6 text-center text-sm">Loading users…</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No users match — or your account doesn't have access to this list.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-xl border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Manager</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Points</TableHead>
                    <TableHead className="text-right">Squad</TableHead>
                    <TableHead className="text-right">Budget</TableHead>
                    <TableHead>Chip</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((u) => (
                    <TableRow key={u._id}>
                      <TableCell>
                        <p className="font-semibold">@{u.username ?? "unknown"}</p>
                        <p className="text-muted-foreground text-xs">
                          {u.teamName ?? "Unnamed team"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {u.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-score text-right font-bold">
                        {u.totalPoints}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right text-xs">
                        {u.squadSize}/7
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatMoney(u.budget)}
                        {u.hasBudgetOverride && (
                          <Badge
                            variant="outline"
                            className="ml-1.5 px-1.5 py-0 text-[9px] uppercase"
                          >
                            ovr
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {u.activeChip ? (u.chipUsed ? `${u.activeChip} (used)` : u.activeChip) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelected(u._id)}
                        >
                          <UserCog className="size-3.5" /> Open
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <UserInspectorDialog userId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

/** Full control panel for one manager. Mounted only while a user is open. */
function UserInspectorDialog({
  userId,
  onClose,
}: {
  userId: Id<"users"> | null;
  onClose: () => void;
}) {
  const detail = useQuery(
    api.adminControl.getUserSquadForAdmin,
    userId ? { userId } : "skip",
  );
  const updateUsername = useMutation(api.adminControl.updateUsername);
  const adjustPoints = useMutation(api.adminControl.adjustPoints);
  const grantChip = useMutation(api.adminControl.grantChip);
  const setBudgetOverride = useMutation(api.adminConfig.setBudgetOverride);

  const [nameInput, setNameInput] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [pointsInput, setPointsInput] = useState("");
  const [reasonInput, setReasonInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);

  const username = typeof detail?.username === "string" ? detail.username : null;
  const teamName = typeof detail?.teamName === "string" ? detail.teamName : null;
  const budget = toSafeAmount(detail?.budget);

  // Reset local drafts whenever a different manager is opened.
  const openId = userId ?? null;
  const [lastOpenId, setLastOpenId] = useState<Id<"users"> | null>(null);
  if (openId !== lastOpenId) {
    setLastOpenId(openId);
    setNameInput(null);
    setBudgetInput("");
    setPointsInput("");
    setReasonInput("");
    setEditorOpen(false);
  }

  const saveUsername = async () => {
    if (!userId) return;
    const next = (nameInput ?? username ?? "").trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(next)) {
      toast.error("Usernames must be 3-24 characters: letters, numbers or _");
      return;
    }
    setBusy("username");
    try {
      await updateUsername({ userId, username: next });
      toast.success(`Username changed to @${next}.`);
      setNameInput(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the username.");
    } finally {
      setBusy(null);
    }
  };

  const saveBudget = async () => {
    if (!userId) return;
    const trimmed = budgetInput.trim();
    let parsed: number | undefined;
    if (trimmed !== "") {
      const money = parseMoneyInput(trimmed);
      if (money === null || !Number.isFinite(money) || money <= 0) {
        toast.error('Invalid budget — use e.g. "60m" or "60000000".');
        return;
      }
      parsed = money;
    }
    setBusy("budget");
    try {
      await setBudgetOverride({ userId, budget: parsed });
      toast.success(
        parsed === undefined
          ? "Override cleared — back to the platform default."
          : `Budget set to ${formatMoney(parsed)}.`,
      );
      setBudgetInput("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set the budget.");
    } finally {
      setBusy(null);
    }
  };

  const applyPoints = async (sign: 1 | -1) => {
    if (!userId) return;
    const parsed = strictNum(pointsInput);
    if (parsed === null || parsed === 0) {
      toast.error("Enter a non-zero number of points.");
      return;
    }
    const value = Math.round(sign * Math.abs(parsed));
    if (Math.abs(value) > 10_000) {
      toast.error("Adjustments are capped at 10,000 points.");
      return;
    }
    const why = reasonInput.trim();
    if (why.length < 3) {
      toast.error("Give a short reason — it is written to the audit log.");
      return;
    }
    setBusy("points");
    try {
      await adjustPoints({ userId, points: value, reason: why });
      toast.success(`${value > 0 ? "Granted" : "Deducted"} ${Math.abs(value)} points.`);
      setPointsInput("");
      setReasonInput("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not adjust the points.");
    } finally {
      setBusy(null);
    }
  };

  const toggleChip = async (chip: "double_down_gw1" | "double_down_gw2" | null) => {
    if (!userId) return;
    setBusy("chip");
    try {
      await grantChip({ userId, ...(chip ? { chip } : {}) });
      toast.success(
        chip === null
          ? "Chip cleared."
          : chip === "double_down_gw1"
            ? "Double Down chip granted for Gameweek 1."
            : "Double Down chip granted for Gameweek 2.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the chip.");
    } finally {
      setBusy(null);
    }
  };

  const currentChip =
    typeof detail?.activeChip === "string"
      ? detail.activeChip
      : detail?.activeChip === null
        ? null
        : null;
  const chipUsed = detail?.chipUsed === true;

  return (
    <Dialog open={userId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="text-primary size-4" /> @{username ?? "unknown"}
          </DialogTitle>
          <DialogDescription>
            {teamName ?? "Unnamed team"} ·{" "}
            {toSafeAmount((detail?.totalSpent ?? 0))} of {formatMoney(budget)} spent
            {typeof detail?.totalSpent === "number" &&
            toSafeAmount(detail.totalSpent) > budget && (
              <span className="text-destructive font-semibold"> · over budget</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Username */}
          <section className="grid gap-2 rounded-xl border border-border/60 p-3">
            <Label htmlFor="inspector-username">Username</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="inspector-username"
                value={nameInput ?? username ?? ""}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="new_username"
                maxLength={24}
              />
              <Button variant="outline" onClick={saveUsername} disabled={busy === "username"}>
                {busy === "username" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Pencil className="size-4" />
                )}
                Save
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              The login username is rewritten too, so this account keeps working.
            </p>
          </section>

          {/* Budget */}
          <section className="grid gap-2 rounded-xl border border-border/60 p-3">
            <Label htmlFor="inspector-budget">Budget override</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="inspector-budget"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                placeholder='e.g. "60m" — or blank to clear'
              />
              <Button variant="outline" onClick={saveBudget} disabled={busy === "budget"}>
                {busy === "budget" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Coins className="size-4" />
                )}
                Save
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Current effective budget: {formatMoney(budget)}. Blank clears the override.
            </p>
          </section>

          {/* Points */}
          <section className="grid gap-2 rounded-xl border border-border/60 p-3">
            <Label htmlFor="inspector-points">Adjust points</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="inspector-points"
                value={pointsInput}
                onChange={(e) => setPointsInput(e.target.value)}
                placeholder="e.g. 5"
                inputMode="numeric"
              />
              <Textarea
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                placeholder="Reason (required, goes in the audit log)"
                rows={1}
                maxLength={200}
                className="sm:max-w-[16rem]"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => applyPoints(1)}
                disabled={busy === "points"}
              >
                {busy === "points" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <BadgePlus className="size-3.5" />
                )}
                Grant
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => applyPoints(-1)}
                disabled={busy === "points"}
              >
                Deduct
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Capped at 10,000 points either way. Recorded in the audit log and the manager's
              activity feed.
            </p>
          </section>

          {/* Chips */}
          <section className="grid gap-2 rounded-xl border border-border/60 p-3">
            <Label>Double Down chip</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={currentChip === "double_down_gw1" ? "default" : "outline"}
                onClick={() =>
                  toggleChip(
                    currentChip === "double_down_gw1" ? null : "double_down_gw1",
                  )
                }
                disabled={busy === "chip"}
              >
                Gameweek 1
              </Button>
              <Button
                size="sm"
                variant={currentChip === "double_down_gw2" ? "default" : "outline"}
                onClick={() =>
                  toggleChip(
                    currentChip === "double_down_gw2" ? null : "double_down_gw2",
                  )
                }
                disabled={busy === "chip"}
              >
                Gameweek 2
              </Button>
              {currentChip !== null && (
                <Badge variant="outline" className="self-center">
                  {currentChip}
                  {chipUsed ? " · already used" : " · armed"}
                </Badge>
              )}
            </div>
          </section>

          {/* Force editor */}
          <section className="grid gap-2 rounded-xl border border-border/60 p-3">
            <Label>Starting seven</Label>
            <Button variant="outline" onClick={() => setEditorOpen(true)}>
              <ShieldAlert className="size-4" /> Force-edit this squad
            </Button>
            <p className="text-muted-foreground text-xs">
              Bypasses the transfer deadline and the squad-builder read-only switch. The
              formation is still validated: 1 GK, 2 DEF, 2 MID, 2 FWD.
            </p>
          </section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>

        <SquadForceEditor
          userId={userId}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          currentPlayers={detail?.players ?? []}
          currentCaptainId={detail?.captainId ?? null}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Force-save a manager's starting seven and captain. This is the emergency
 * escape hatch for a broken submission: it ignores deadlines and over-budget
 * status, but still enforces a legal 1-2-2-2 formation and a captain drawn
 * from the seven.
 */
function SquadForceEditor({
  userId,
  open,
  onOpenChange,
  currentPlayers,
  currentCaptainId,
}: {
  userId: Id<"users"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlayers: Array<{
    _id: Id<"players">;
    name: string;
    house: string;
    position: string;
    price: number;
  }>;
  currentCaptainId: Id<"players"> | null;
}) {
  const playersResult = useQuery(api.players.listPlayers, open ? {} : "skip");
  const forceSaveSquad = useMutation(api.adminControl.forceSaveSquad);
  const [busy, setBusy] = useState(false);

  // Seven slots, each a player id or null. Seeded from the manager's current
  // squad the first time the editor opens.
  const [picks, setPicks] = useState<(Id<"players"> | null)[]>([
    null, null, null, null, null, null, null,
  ]);
  const [captain, setCaptain] = useState<Id<"players"> | null>(null);
  const [seededFor, setSeededFor] = useState<string | null>(null);

  const seedKey = `${userId ?? ""}:${open}`;
  if (open && seedKey !== seededFor) {
    setSeededFor(seedKey);
    const seeded: (Id<"players"> | null)[] = [null, null, null, null, null, null, null];
    let slot = 0;
    for (const p of currentPlayers) {
      if (slot < 7) {
        seeded[slot] = p._id;
        slot += 1;
      }
    }
    setPicks(seeded);
    setCaptain(currentCaptainId ?? seeded[0] ?? null);
  }

  const allPlayers = useMemo(
    () =>
      ((playersResult ?? []) as unknown as Array<{
        _id: Id<"players">;
        name: string;
        house: string;
        position: string;
        price: number;
      }>).map((p) => ({
        ...p,
        price: toSafeAmount(p.price),
      })),
    [playersResult],
  );

  const chosenIds = picks.filter((p): p is Id<"players"> => p !== null);
  const totalSpent = chosenIds.reduce((sum, id) => {
    const found = allPlayers.find((p) => String(p._id) === String(id));
    return sum + (found?.price ?? 0);
  }, 0);

  /** Live formation check so the admin sees the problem before submitting. */
  const formation = useMemo(() => {
    const counts: Record<string, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const id of chosenIds) {
      const found = allPlayers.find((p) => String(p._id) === String(id));
      if (found) counts[found.position] = (counts[found.position] ?? 0) + 1;
    }
    return counts;
  }, [chosenIds, allPlayers]);

  const problems: string[] = [];
  if (chosenIds.length !== 7) problems.push(`Pick 7 players (${chosenIds.length} selected)`);
  if (new Set(chosenIds.map(String)).size !== chosenIds.length) {
    problems.push("The same player cannot be picked twice");
  }
  for (const [pos, need] of Object.entries(FORMATION)) {
    if ((formation[pos] ?? 0) !== need) {
      problems.push(`Needs exactly ${need} × ${pos} (has ${formation[pos] ?? 0})`);
    }
  }
  if (captain !== null && !chosenIds.some((id) => String(id) === String(captain))) {
    problems.push("The captain must be one of the seven");
  }

  const submit = async () => {
    if (!userId) return;
    if (problems.length > 0) {
      toast.error(problems[0]);
      return;
    }
    setBusy(true);
    try {
      const res = await forceSaveSquad({
        userId,
        playerIds: chosenIds,
        ...(captain !== null ? { captainId: captain } : {}),
      });
      toast.success(
        `Squad force-saved — ${formatMoney(res?.totalSpent ?? totalSpent)}${
          res?.overBudget ? " (over budget, allowed by admin)" : ""
        }.`,
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the squad.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-amber-400" /> Force-edit starting seven
          </DialogTitle>
          <DialogDescription>
            Emergency override — deadlines and the over-budget rule are bypassed, the 1-2-2-2
            formation is not. Pick each slot and choose the captain.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {picks.map((picked, index) => {
              const chosen = picked
                ? allPlayers.find((p) => String(p._id) === String(picked))
                : undefined;
              return (
                <div
                  key={index}
                  className={cn(
                    "grid gap-1.5 rounded-xl border p-2",
                    picked ? "border-border/70 bg-secondary/30" : "border-dashed border-border/60",
                  )}
                >
                  <Label htmlFor={`slot-${index}`} className="text-xs">
                    Slot {index + 1}
                  </Label>
                  <Select
                    value={picked ?? undefined}
                    onValueChange={(value) => {
                      const next = [...picks];
                      next[index] = value as Id<"players">;
                      setPicks(next);
                      if (captain === null) setCaptain(next.find((x) => x !== null) ?? null);
                    }}
                  >
                    <SelectTrigger id={`slot-${index}`}>
                      <SelectValue
                        placeholder={
                          chosen
                            ? `${chosen.name} · ${POSITION_LABELS[chosen.position as never] ?? chosen.position}`
                            : "Empty slot"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {allPlayers.length === 0 ? (
                        <SelectItem value="none" disabled>
                          No players yet
                        </SelectItem>
                      ) : (
                        allPlayers.map((p) => (
                          <SelectItem key={p._id} value={p._id}>
                            {POSITION_LABELS[p.position as never] ?? p.position} · {p.name} ·{" "}
                            {formatMoney(p.price)}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {picked !== null && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = [...picks];
                        next[index] = null;
                        setPicks(next);
                        if (captain !== null && String(captain) === String(picked)) {
                          setCaptain(next.find((x) => x !== null) ?? null);
                        }
                      }}
                      className="text-muted-foreground hover:text-destructive self-end text-[10px] underline underline-offset-2"
                    >
                      clear
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Captain */}
          <div className="grid gap-1.5">
            <Label htmlFor="captain">Captain (points multiplier)</Label>
            <Select
              value={captain ?? undefined}
              onValueChange={(value) => setCaptain(value as Id<"players">)}
              disabled={chosenIds.length === 0}
            >
              <SelectTrigger id="captain">
                <SelectValue placeholder="Choose a captain from the seven" />
              </SelectTrigger>
              <SelectContent>
                {chosenIds.map((id) => {
                  const found = allPlayers.find((p) => String(p._id) === String(id));
                  return (
                    <SelectItem key={id} value={id}>
                      {found?.name ?? "Player"}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Live validation */}
          <div className="grid gap-1.5 rounded-xl border border-border/60 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs">
                Formation {Object.entries(formation).map(([p, n]) => `${n}${p}`).join(" · ")}
              </span>
              <span className="font-score font-bold">{formatMoney(totalSpent)}</span>
            </div>
            {problems.length > 0 ? (
              <ul className="text-destructive space-y-0.5 text-xs">
                {problems.map((p) => (
                  <li key={p}>• {p}</li>
                ))}
              </ul>
            ) : (
              <p className="text-emerald-400 text-xs">✓ Legal formation, captain inside the seven.</p>
            )}
            <p className="text-muted-foreground text-xs">
              Houses available: {HOUSES.join(", ")} — the house-limit rule is intentionally not
              enforced here.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={busy || problems.length > 0}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
            Force-save squad
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
