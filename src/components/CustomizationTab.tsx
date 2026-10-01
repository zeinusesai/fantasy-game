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
import { formatMoney, parseMoneyInput, safeBudget, toSafeAmount } from "@/convex/configDefaults";
import { HOUSES } from "@/lib/fantasy";
import { useAdminConfig } from "@/hooks/use-admin-config";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { AlertTriangle, BadgeCheck, Loader2, PartyPopper, Save, Sparkles, Trash2, Wallet } from "lucide-react";
import { useState } from "react";

// ── Super Admin customization engine UI ──────────────────────────────────
//
// Everything Zein can customise in one tab: house names, award titles &
// descriptions, custom badge variants, per-manager budget overrides, and the
// "End Entire Tournament" control.
//
// Every mutation is try/catch'd with a clean toast, every numeric input goes
// through strict parsing, and every query has a `?? default` fallback so the
// tab renders correctly on a fresh database.

const AWARD_ROWS = [
  { key: "tacticalGenius", label: "Tactical Genius", hint: "Highest total points" },
  { key: "unluckyManager", label: "Unlucky Manager", hint: "Lowest total points" },
  { key: "differentialMaster", label: "Differential Master", hint: "Most points from <15% owned" },
  { key: "playerOfTheWeek", label: "Player of the Week", hint: "Top scorer of latest gameweek" },
] as const;

export function CustomizationTab() {
  const { houseNames, awardTitles, badgeRegistry, tournamentEnded, year12Message } =
    useAdminConfig();

  const setHouseNames = useMutation(api.adminConfig.setHouseNames);
  const setAwardTitles = useMutation(api.adminConfig.setAwardTitles);
  const upsertCustomBadge = useMutation(api.adminConfig.upsertCustomBadge);
  const setBudgetOverride = useMutation(api.adminConfig.setBudgetOverride);
  const setYear12Message = useMutation(api.adminConfig.setYear12Message);
  const endTournament = useMutation(api.tournament.endTournament);
  const usersResult = useQuery(api.usersAdmin.listUsers);

  // Safe fallback: undefined (loading) and null both render as an empty list.
  const users = (usersResult ?? []) as Array<{
    _id: Id<"users">;
    username: string | null;
    teamName: string | null;
  }>;

  const [busy, setBusy] = useState<string | null>(null);

  // ── House names ──
  const [houseInputs, setHouseInputs] = useState<Record<string, string> | null>(null);
  const houseValue = (house: string) =>
    (houseInputs ?? houseNames)[house] ?? houseNames[house] ?? house;

  const saveHouseNames = async () => {
    setBusy("houses");
    try {
      const payload = HOUSES.map((house) => ({
        house,
        name: houseValue(house).trim() || house,
      }));
      // Strict parse/validation happens server-side too; this is the first gate.
      for (const entry of payload) {
        if (entry.name.length > 24) throw new Error("House names must be 1-24 characters.");
      }
      await setHouseNames({ houseNames: payload });
      toast.success("House names updated across the whole platform.");
      setHouseInputs(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the house names.");
    } finally {
      setBusy(null);
    }
  };

  // ── Award copy ──
  const [awardInputs, setAwardInputs] = useState<Record<string, { title: string; description: string }> | null>(null);
  const awardValue = (key: string) =>
    (awardInputs ?? awardTitles)[key] ?? { title: key, description: "" };

  const saveAwards = async () => {
    setBusy("awards");
    try {
      const titles = AWARD_ROWS.map((row) => ({
        key: row.key,
        title: awardValue(row.key).title.trim(),
        description: awardValue(row.key).description.trim(),
      }));
      for (const t of titles) {
        if (t.title.length < 1 || t.title.length > 40) {
          throw new Error("Award titles must be 1-40 characters.");
        }
        if (t.description.length < 1 || t.description.length > 160) {
          throw new Error("Award descriptions must be 1-160 characters.");
        }
      }
      await setAwardTitles({ titles });
      toast.success("Award titles updated.");
      setAwardInputs(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the award titles.");
    } finally {
      setBusy(null);
    }
  };

  // ── Custom badge ──
  const [badgeId, setBadgeId] = useState("");
  const [badgeEmoji, setBadgeEmoji] = useState("");
  const [badgeLabel, setBadgeLabel] = useState("");

  const saveBadge = async () => {
    setBusy("badge");
    try {
      const id = badgeId.trim().toLowerCase();
      if (!/^[a-z0-9_]{2,24}$/.test(id)) {
        toast.error("Badge ID must be 2-24 characters: a-z, 0-9 or _");
        return;
      }
      if (badgeLabel.trim().length > 24) {
        toast.error("Badge label must be 24 characters or fewer.");
        return;
      }
      await upsertCustomBadge({ badgeId: id, emoji: badgeEmoji, label: badgeLabel });
      toast.success(`Badge "${id}" saved — assign it from the Roles tab.`);
      setBadgeId("");
      setBadgeEmoji("");
      setBadgeLabel("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the badge.");
    } finally {
      setBusy(null);
    }
  };

  const deleteBadge = async (id: string) => {
    setBusy(`del-${id}`);
    try {
      await upsertCustomBadge({ badgeId: id });
      toast.success(`Badge "${id}" removed.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the badge.");
    } finally {
      setBusy(null);
    }
  };

  const customBadges = Object.entries(badgeRegistry).filter(
    ([id]) => !["star", "gold_checkmark", "fire", "crown", "shield", "diamond", "contributor"].includes(id),
  );

  // ── Budget overrides ──
  const [budgetFor, setBudgetFor] = useState<Id<"users"> | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [budgetBusy, setBudgetBusy] = useState(false);

  const saveBudgetOverride = async () => {
    if (!budgetFor) return;
    // Empty input clears the override; otherwise strict-parse the amount.
    const trimmed = budgetInput.trim();
    let parsed: number | undefined;
    if (trimmed !== "") {
      parsed = parseMoneyInput(trimmed) ?? undefined;
      if (parsed === undefined) {
        toast.error('Invalid budget — use e.g. "60m" or "60000000".');
        return;
      }
    }
    setBudgetBusy(true);
    try {
      const res = await setBudgetOverride({ userId: budgetFor, budget: parsed });
      toast.success(
        res?.hasOverride
          ? `Override set to ${formatMoney(res.budget)} (platform default ${formatMoney(safeBudget())}).`
          : "Override cleared — back to the fixed platform budget.",
      );
      setBudgetFor(null);
      setBudgetInput("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set the budget override.");
    } finally {
      setBudgetBusy(false);
    }
  };

  // ── Year 12 message ──
  const [messageInput, setMessageInput] = useState<string | null>(null);
  const saveMessage = async () => {
    setBusy("message");
    try {
      const text = (messageInput ?? "").trim();
      if (text.length > 240) {
        toast.error("Message must be 240 characters or fewer.");
        return;
      }
      await setYear12Message({ message: text });
      toast.success("Year 12 message saved.");
      setMessageInput(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the message.");
    } finally {
      setBusy(null);
    }
  };

  // ── End tournament ──
  const [endOpen, setEndOpen] = useState(false);
  const [endConfirm, setEndConfirm] = useState("");
  const [endBusy, setEndBusy] = useState(false);

  const confirmEnd = async () => {
    setEndBusy(true);
    try {
      await endTournament({ ended: true });
      toast.success("Tournament ended — every manager now sees the Year 12 podium.");
      setEndOpen(false);
      setEndConfirm("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not end the tournament.");
    } finally {
      setEndBusy(false);
    }
  };

  const reopenTournament = async () => {
    setEndBusy(true);
    try {
      await endTournament({ ended: false });
      toast.success("Tournament reopened.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reopen the tournament.");
    } finally {
      setEndBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── End tournament ── */}
      <Card
        className={cn(
          "border-2",
          tournamentEnded
            ? "border-emerald-400/50 bg-emerald-500/5"
            : "border-red-400/50 bg-red-500/5",
        )}
      >
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <PartyPopper
              className={cn("size-4", tournamentEnded ? "text-emerald-300" : "text-red-300")}
            />
            Tournament lifecycle
          </CardTitle>
          <CardDescription>
            Ending the tournament locks every gameweek and switches every manager's
            dashboard to the "See you in Year 12!" celebration with the final podium.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Badge
              variant="outline"
              className={cn(
                tournamentEnded
                  ? "border-emerald-400/50 text-emerald-300"
                  : "border-amber-400/50 text-amber-300",
              )}
            >
              {tournamentEnded ? "🏁 ENDED — Year 12 mode live" : "🟢 IN PROGRESS"}
            </Badge>
            {tournamentEnded ? (
              <Button variant="outline" onClick={reopenTournament} disabled={endBusy}>
                {endBusy ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <AlertTriangle className="mr-1.5 size-4" />
                )}
                Reopen tournament
              </Button>
            ) : (
              <Button variant="destructive" onClick={() => setEndOpen(true)} disabled={endBusy}>
                <PartyPopper className="mr-1.5 size-4" />
                End Entire Tournament
              </Button>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="year12-msg">Year 12 celebration message</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="year12-msg"
                value={messageInput ?? year12Message}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder="See you all in Year 12!"
                maxLength={240}
              />
              <Button variant="outline" onClick={saveMessage} disabled={busy === "message"}>
                <Save className="mr-1.5 size-4" /> Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── House names ── */}
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display text-lg font-bold uppercase tracking-wide">
            House names
          </CardTitle>
          <CardDescription>
            Rename the four houses anywhere in the app. Colours and crests stay tied to
            the original house, so only the text changes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {HOUSES.map((house) => (
              <div key={house} className="grid gap-1.5">
                <Label htmlFor={`house-${house}`}>{house}</Label>
                <Input
                  id={`house-${house}`}
                  value={houseValue(house)}
                  onChange={(e) =>
                    setHouseInputs((prev) => ({ ...(prev ?? houseNames), [house]: e.target.value }))
                  }
                  maxLength={24}
                />
              </div>
            ))}
          </div>
          <Button onClick={saveHouseNames} disabled={busy === "houses"}>
            {busy === "houses" ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 size-4" />
            )}
            Save house names
          </Button>
        </CardContent>
      </Card>

      {/* ── Award titles ── */}
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display text-lg font-bold uppercase tracking-wide">
            Award titles &amp; descriptions
          </CardTitle>
          <CardDescription>
            These names appear on the dashboard awards card, the leaderboard chips and the
            Player of the Week highlight in the draft market.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {AWARD_ROWS.map((row) => (
            <div key={row.key} className="grid gap-1.5 rounded-xl border border-border/60 p-3">
              <Label htmlFor={`award-${row.key}`}>{row.label}</Label>
              <Input
                id={`award-${row.key}`}
                value={awardValue(row.key).title}
                onChange={(e) =>
                  setAwardInputs((prev) => ({
                    ...(prev ?? awardTitles),
                    [row.key]: { ...awardValue(row.key), title: e.target.value },
                  }))
                }
                maxLength={40}
                placeholder={row.hint}
              />
              <Input
                value={awardValue(row.key).description}
                onChange={(e) =>
                  setAwardInputs((prev) => ({
                    ...(prev ?? awardTitles),
                    [row.key]: { ...awardValue(row.key), description: e.target.value },
                  }))
                }
                maxLength={160}
                placeholder="Shown when no one has earned it yet"
              />
            </div>
          ))}
          <Button onClick={saveAwards} disabled={busy === "awards"}>
            {busy === "awards" ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 size-4" />
            )}
            Save award copy
          </Button>
        </CardContent>
      </Card>

      {/* ── Custom badges ── */}
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <BadgeCheck className="text-primary size-4" /> Custom badges
          </CardTitle>
          <CardDescription>
            Create your own badge variants, then assign them to any manager from the Roles tab.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_5rem_1fr_auto]">
            <Input
              value={badgeId}
              onChange={(e) => setBadgeId(e.target.value)}
              placeholder="badge id (e.g. legend)"
              maxLength={24}
            />
            <Input
              value={badgeEmoji}
              onChange={(e) => setBadgeEmoji(e.target.value)}
              placeholder="🏅"
              maxLength={8}
            />
            <Input
              value={badgeLabel}
              onChange={(e) => setBadgeLabel(e.target.value)}
              placeholder="Label (e.g. Legend)"
              maxLength={24}
            />
            <Button onClick={saveBadge} disabled={busy === "badge"}>
              {busy === "badge" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
            </Button>
          </div>
          {customBadges.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {customBadges.map(([id, meta]) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-secondary/40 px-2.5 py-1 text-xs"
                >
                  <span>{meta.emoji}</span>
                  <span className="font-semibold">{meta.label}</span>
                  <code className="text-muted-foreground text-[10px]">{id}</code>
                  <button
                    onClick={() => deleteBadge(id)}
                    disabled={busy === `del-${id}`}
                    title="Delete badge"
                    className="text-destructive transition-colors hover:text-destructive/80"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Budget overrides ── */}
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <Wallet className="text-primary size-4" /> Budget overrides
          </CardTitle>
          <CardDescription>
            Every manager starts with the fixed platform budget of{" "}
            <strong>{formatMoney(safeBudget())}</strong>. An override can lower one
            manager's budget but is always capped at that same figure.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              No users found — or your account doesn't have access to this list.
            </p>
          ) : (
            <div className="grid gap-2">
              {users.map((u) => {
                return (
                  <div
                    key={u._id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-secondary/30 px-3 py-2"
                  >
                    <span className="text-sm font-semibold">
                      @{u.username ?? "unknown"}
                      <span className="text-muted-foreground ml-2 text-xs">
                        {u.teamName ?? "Unnamed team"}
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      <UserBudgetOverride userId={u._id} />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setBudgetFor(u._id);
                          setBudgetInput("");
                        }}
                      >
                        Override
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Budget override dialog ── */}
      <Dialog
        open={budgetFor !== null}
        onOpenChange={(open) => {
          if (!open) setBudgetFor(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="text-primary size-4" /> Budget override
            </DialogTitle>
            <DialogDescription>
              Lower this manager's budget below the fixed platform default of{" "}
              <span className="text-foreground font-semibold">{formatMoney(safeBudget())}</span>.
              Leave the field blank to clear the override and restore the default. Overrides are
              always capped at the platform budget — they can never raise it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="override-budget">New budget</Label>
            <Input
              id="override-budget"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              placeholder='e.g. "60m" — or blank to clear'
              autoFocus
            />
            {budgetInput.trim() !== "" && parseMoneyInput(budgetInput) === null && (
              <p className="text-destructive text-xs">
                Invalid amount — use 60m, 60.5m or 60000000.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBudgetFor(null)}>
              Cancel
            </Button>
            <Button onClick={saveBudgetOverride} disabled={budgetBusy}>
              {budgetBusy ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Wallet className="mr-1.5 size-4" />
              )}
              Save override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── End tournament confirmation ── */}
      <Dialog open={endOpen} onOpenChange={(open) => !open && setEndOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" /> End the entire tournament?
            </DialogTitle>
            <DialogDescription>
              This is the final call. Ending the tournament:
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
                <li>Locks every gameweek — no more transfers or match edits.</li>
                <li>Freezes the final standings and the Hall of Fame podium.</li>
                <li>
                  Switches every manager's dashboard to the{" "}
                  <strong>"See you in Year 12!"</strong> celebration screen.
                </li>
                <li>Assigns the ⚠️ Forfeit badge to the bottom-place manager(s).</li>
              </ul>
              <p className="mt-3 font-semibold">
                Type <span className="text-destructive">END</span> to confirm.
              </p>
            </DialogDescription>
          </DialogHeader>
          <Input
            value={endConfirm}
            onChange={(e) => setEndConfirm(e.target.value)}
            placeholder="END"
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEndOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmEnd}
              disabled={endBusy || endConfirm.trim().toUpperCase() !== "END"}
            >
              {endBusy ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <PartyPopper className="mr-1.5 size-4" />
              )}
              End tournament
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Shows a manager's effective budget + whether an override is active. */
function UserBudgetOverride({ userId }: { userId: Id<"users"> }) {
  const { budgetOverrides } = useAdminConfig();
  const override = budgetOverrides[String(userId)];
  const hasOverride = typeof override === "number" && override > 0;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-score text-sm font-bold">
        {formatMoney(hasOverride ? toSafeAmount(override) : safeBudget())}
      </span>
      {hasOverride && (
        <Badge variant="outline" className="px-1.5 py-0 text-[9px] uppercase">
          override
        </Badge>
      )}
    </span>
  );
}
