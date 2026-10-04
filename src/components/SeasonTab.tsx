import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CalendarRange,
  Check,
  Dices,
  Lock,
  Rocket,
  Save,
  Shuffle,
  Timer,
  Trash2,
  Trophy,
  Unlock,
} from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { TRANSITION_CONFIRM_PHRASE } from "@/convex/admin";
import { CREST_PRESETS, crestPreset, normalizeCrest } from "@/convex/crests";
import { cn } from "@/lib/utils";
import type { Doc, Id } from "@/convex/_generated/dataModel";

type PlayerRow = Doc<"players">;

const STATUS_TONE: Record<string, string> = {
  open: "border-emerald-400/40 bg-mint/10 text-emerald-300",
  locked: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  calculating: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  closed: "border-white/15 bg-white/5 text-slate-300",
};

const STATUS_ACTIONS: Array<{ status: string; label: string; icon: typeof Lock }> = [
  { status: "open", label: "Open", icon: Unlock },
  { status: "locked", label: "Lock", icon: Lock },
  { status: "calculating", label: "Calculate", icon: Timer },
  { status: "closed", label: "Close", icon: Check },
];

/**
 * Super-Admin "Season" tab.
 *
 * Added alongside the existing tabs — nothing in the original Admin panel is
 * removed or reordered. Three blocks:
 *   1. Season gameweek calendar (GW1 … GW30+) with open/lock/calculate/close.
 *   2. Weekly dynamic friendly generator (names, crests, rosters, randomize).
 *   3. The Y11 PE Hub season transition, behind a double-confirmation dialog.
 */
export function SeasonTab() {
  // ── Transition ──
  const preview = useQuery(api.admin.getTransitionPreview);
  const seasonStatus = useQuery(api.admin.getSeasonStatus);
  const transition = useMutation(api.admin.transitionToPEHub);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [typedPhrase, setTypedPhrase] = useState("");
  const [busy, setBusy] = useState(false);

  const phraseMatches =
    typedPhrase.trim().replace(/\s+/g, " ").toUpperCase() ===
    TRANSITION_CONFIRM_PHRASE.toUpperCase();
  const canConfirm = acknowledged && phraseMatches && !busy;

  const runTransition = async () => {
    if (!canConfirm) return;
    setBusy(true);
    try {
      await transition({ confirmText: typedPhrase });
      toast.success("Successfully transitioned to Y11 PE Hub!", {
        description: "Players, prices, photos and every unlocked cosmetic were preserved.",
      });
      setDialogOpen(false);
      setAcknowledged(false);
      setTypedPhrase("");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not transition to Y11 PE Hub.",
      );
    } finally {
      setBusy(false);
    }
  };

  // ── Season gameweeks ──
  const gameweeks = useQuery(api.matches.listSeasonGameweeks);
  const createGameweek = useMutation(api.matches.createSeasonGameweek);
  const ensureGameweeks = useMutation(api.matches.ensureSeasonGameweeks);
  const setGwStatus = useMutation(api.matches.setSeasonGameweekStatus);
  const deleteGw = useMutation(api.matches.deleteSeasonGameweek);

  const gwList = gameweeks ?? [];
  const [newGwNumber, setNewGwNumber] = useState(
    String((gameweeks ?? []).length + 1 || 1),
  );

  const nextGw = useMemo(() => {
    const open = gwList.find((g) => g.status === "open");
    if (open) return open.number;
    const locked = gwList.find((g) => g.status === "locked");
    if (locked) return locked.number;
    return gwList.length + 1;
  }, [gwList]);

  const [activeGw, setActiveGw] = useState(1);

  // ── Friendly generator ──
  const players = useQuery(api.players.listPlayers) ?? [];
  const existing = useQuery(api.matches.listGameweekMatches, { gameweek: activeGw });
  const createFriendly = useMutation(api.matches.createFriendlyMatch);
  const previewRandom = useMutation(api.matches.previewRandomFriendly);

  const [homeName, setHomeName] = useState("Team Alpha");
  const [awayName, setAwayName] = useState("Team Omega");
  const [homeCrest, setHomeCrest] = useState("struck");
  const [awayCrest, setAwayCrest] = useState("crown");
  const [homeSquad, setHomeSquad] = useState<Id<"players">[]>([]);
  const [awaySquad, setAwaySquad] = useState<Id<"players">[]>([]);
  const [search, setSearch] = useState("");
  const [friendlyBusy, setFriendlyBusy] = useState(false);

  const filteredPlayers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return players;
    return players.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.position.toLowerCase().includes(needle),
    );
  }, [players, search]);

  const toggleSide = (
    playerId: Id<"players">,
    side: "home" | "away",
  ) => {
    const other = side === "home" ? awaySquad : homeSquad;
    const mine = side === "home" ? homeSquad : awaySquad;
    if (mine.includes(playerId)) {
      const next = mine.filter((id) => id !== playerId);
      side === "home" ? setHomeSquad(next) : setAwaySquad(next);
      return;
    }
    if (other.includes(playerId)) {
      toast.error("That player is already named on the other side.");
      return;
    }
    if (mine.length >= 7) {
      toast.error("A friendly side is capped at 7 players.");
      return;
    }
    side === "home"
      ? setHomeSquad([...mine, playerId])
      : setAwaySquad([...mine, playerId]);
  };

  const randomize = async () => {
    setFriendlyBusy(true);
    try {
      const draw = await previewRandom({});
      setHomeName(draw.homeTeamName);
      setAwayName(draw.awayTeamName);
      setHomeSquad(draw.homeSquad as Id<"players">[]);
      setAwaySquad(draw.awaySquad as Id<"players">[]);
      toast.success("Teams randomized — hit Save fixture to lock it in.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not randomize teams.");
    } finally {
      setFriendlyBusy(false);
    }
  };

  const saveFriendly = async () => {
    if (homeName.trim() === "" || awayName.trim() === "") {
      toast.error("Both teams need a name.");
      return;
    }
    if (homeName.trim().toLowerCase() === awayName.trim().toLowerCase()) {
      toast.error("The two teams need different names.");
      return;
    }
    setFriendlyBusy(true);
    try {
      await createFriendlyMatchSafe();
      toast.success(`GW${activeGw} friendly created — ${homeName} vs ${awayName}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the friendly.");
    } finally {
      setFriendlyBusy(false);
    }
  };

  const createFriendlyMatchSafe = async () => {
    await createFriendly({
      gameweek: activeGw,
      homeTeamName: homeName,
      awayTeamName: awayName,
      homeCrest: normalizeCrest(homeCrest),
      awayCrest: normalizeCrest(awayCrest),
      homeSquad,
      awaySquad,
    });
  };

  const runEnsure = async () => {
    try {
      const result = await ensureGameweeks({ upTo: 30 });
      toast.success(
        result.created === 0
          ? "GW1–GW30 already exist."
          : `Created ${result.created} gameweek${result.created === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not seed gameweeks.");
    }
  };

  const runCreateGw = async () => {
    const n = Number(newGwNumber);
    if (!Number.isInteger(n) || n < 1) {
      toast.error("Enter a valid gameweek number.");
      return;
    }
    try {
      await createGameweek({ number: n });
      toast.success(`GW${n} created.`);
      setNewGwNumber(String(n + 1));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the gameweek.");
    }
  };

  const runStatus = async (number: number, status: string) => {
    try {
      await setGwStatus({ number, status });
      toast.success(`GW${number} is now ${status}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the gameweek.");
    }
  };

  const runDeleteGw = async (number: number) => {
    try {
      await deleteGw({ number });
      toast.success(`GW${number} removed.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the gameweek.");
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* ── Season gameweek calendar ─────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card className="border-border/70 bg-card">
          <CardHeader>
            <CardTitle className="tracking-tight font-bold flex items-center gap-2">
              <CalendarRange className="text-electric size-4" /> Season gameweeks
            </CardTitle>
            <CardDescription>
              Sequential gameweeks across the PE academic year — GW1 through GW30+.
              Open, lock, calculate or close each one individually.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={runEnsure}>
                Seed GW1–GW30
              </Button>
              <div className="flex items-center gap-2">
                <Input
                  value={newGwNumber}
                  onChange={(e) => setNewGwNumber(e.target.value)}
                  inputMode="numeric"
                  className="h-9 w-20"
                  aria-label="New gameweek number"
                />
                <Button size="sm" onClick={runCreateGw}>
                  Add gameweek
                </Button>
              </div>
            </div>

            {gwList.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No gameweeks yet — seed GW1–GW30 to start the PE season.
              </p>
            ) : (
              <ScrollArea className="max-h-72">
                <div className="space-y-2 pr-3">
                  {gwList.map((gw) => (
                    <div
                      key={gw.number}
                      className={cn(
                        "flex flex-col gap-3 rounded-lg border border-border/70 bg-secondary/40 p-3 sm:flex-row sm:items-center sm:justify-between",
                        gw.number === activeGw && "border-electric/60",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveGw(gw.number)}
                        className="flex min-w-0 items-center gap-3 text-left"
                      >
                        <span className="font-score bg-electric/15 text-electric flex size-9 shrink-0 items-center justify-center rounded-md text-sm font-bold">
                          {gw.number}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">
                            {gw.label}
                            {gw.title ? ` · ${gw.title}` : ""}
                          </span>
                          <span className="text-muted-foreground block text-xs">
                            {gw.status === "open"
                              ? "Transfers open"
                              : gw.status === "closed"
                                ? "Closed"
                                : gw.status}
                            {gw.deadlineAt
                              ? ` · deadline ${new Date(gw.deadlineAt).toLocaleDateString()}`
                              : ""}
                          </span>
                        </span>
                      </button>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[11px] uppercase",
                            STATUS_TONE[gw.status] ?? "border-border",
                          )}
                        >
                          {gw.status}
                        </Badge>
                        {STATUS_ACTIONS.map((a) => (
                          <Button
                            key={a.status}
                            size="sm"
                            variant={gw.status === a.status ? "secondary" : "ghost"}
                            className="h-7 px-2 text-xs"
                            onClick={() => runStatus(gw.number, a.status)}
                          >
                            <a.icon className="size-3" /> {a.label}
                          </Button>
                        ))}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive h-7 px-2"
                          onClick={() => runDeleteGw(gw.number)}
                          aria-label={`Delete GW${gw.number}`}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
            <p className="text-muted-foreground text-xs">
              Editing GW{activeGw} — the friendly generator below targets this gameweek.
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Weekly dynamic friendly generator ────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.06 }}
      >
        <Card className="border-border/70 bg-card">
          <CardHeader>
            <CardTitle className="tracking-tight font-bold flex items-center gap-2">
              <Dices className="text-electric size-4" /> Weekly friendly · GW{activeGw}
            </CardTitle>
            <CardDescription>
              Teams are never fixed. Name both sides, pick a crest, assign players from the
              preserved roster — or hit Randomize for a fresh draw.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <SideEditor
                title="Team A"
                name={homeName}
                onName={setHomeName}
                crest={homeCrest}
                onCrest={setHomeCrest}
                squad={homeSquad}
                players={players}
                onToggle={(id) => toggleSide(id, "home")}
              />
              <SideEditor
                title="Team B"
                name={awayName}
                onName={setAwayName}
                crest={awayCrest}
                onCrest={setAwayCrest}
                squad={awaySquad}
                players={players}
                onToggle={(id) => toggleSide(id, "away")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gw-player-search">Assign players</Label>
              <Input
                id="gw-player-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search the roster by name or position…"
              />
              <ScrollArea className="max-h-56 rounded-lg border border-border/70">
                <div className="grid gap-1 p-2 sm:grid-cols-2">
                  {filteredPlayers.length === 0 ? (
                    <p className="text-muted-foreground p-2 text-sm">
                      No players match that search.
                    </p>
                  ) : (
                    filteredPlayers.map((p) => {
                      const onHome = homeSquad.includes(p._id);
                      const onAway = awaySquad.includes(p._id);
                      return (
                        <button
                          key={p._id}
                          type="button"
                          onClick={() =>
                            toggleSide(p._id, onAway ? "away" : "home")
                          }
                          className={cn(
                            "flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors",
                            onHome &&
                              "border-electric/60 bg-electric/10 text-teal-200",
                            onAway &&
                              "border-gold/60 bg-gold/10 text-amber-200",
                            !onHome &&
                              !onAway &&
                              "border-transparent hover:border-border hover:bg-secondary/60",
                          )}
                        >
                          <span className="truncate">{p.name}</span>
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {onHome ? "A" : onAway ? "B" : p.position}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={randomize} disabled={friendlyBusy}>
                <Shuffle className="size-4" /> Randomize Teams
              </Button>
              <Button onClick={saveFriendly} disabled={friendlyBusy}>
                <Save className="size-4" /> Save fixture
              </Button>
            </div>

            {existing !== undefined && existing.length > 0 && (
              <div className="space-y-2 border-t border-border/70 pt-4">
                <p className="text-muted-foreground text-xs font-semibold uppercase tracking-widest">
                  Fixtures already scheduled for GW{activeGw}
                </p>
                {existing.map((m) => (
                  <div
                    key={m._id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-secondary/40 px-3 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <CrestDisc value={m.homeCrest ?? null} />
                      <span className="font-semibold">
                        {m.homeTeamName ?? "Home"}
                      </span>
                      <span className="text-muted-foreground">vs</span>
                      <span className="font-semibold">
                        {m.awayTeamName ?? "Away"}
                      </span>
                      <CrestDisc value={m.awayCrest ?? null} />
                    </span>
                    <Badge variant="outline" className="text-[11px]">
                      {m.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Season transition (double confirmation) ──────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.12 }}
      >
        <Card className="border-destructive/40 bg-card">
          <CardHeader>
            <CardTitle className="tracking-tight font-bold flex items-center gap-2">
              <Rocket className="text-destructive size-4" /> Transition to Y11 PE Hub
            </CardTitle>
            <CardDescription>
              Wipes every manager account, squad, prediction, chat message and point total
              for the new season — <strong>except Zein</strong>. The player database and the
              cosmetic store are never touched.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoBlock tone="border-destructive/40 bg-destructive/10 text-red-300">
                <p className="mb-1 font-semibold">Deleted</p>
                <ul className="text-muted-foreground space-y-0.5 text-xs">
                  <li>• {preview?.usersToDelete ?? "—"} manager accounts (Zein excluded)</li>
                  <li>• {preview?.squads ?? "—"} squads &amp; {preview?.predictions ?? "—"} predictions</li>
                  <li>• {preview?.messages ?? "—"} chat messages</li>
                  <li>• {preview?.scoreRows ?? "—"} point rows → everyone back to 0</li>
                </ul>
              </InfoBlock>
              <InfoBlock tone="border-emerald-400/40 bg-mint/10 text-emerald-300">
                <p className="mb-1 font-semibold">Preserved</p>
                <ul className="text-muted-foreground space-y-0.5 text-xs">
                  <li>• Zein's account, login, role &amp; unlocked cosmetics</li>
                  <li>• All {seasonStatus?.players ?? "—"} players, prices, stats &amp; photos</li>
                  <li>• Every store item / cosmetic unlock</li>
                  <li>• Match history, awards &amp; the audit log</li>
                </ul>
              </InfoBlock>
            </div>

            <Button
              variant="destructive"
              onClick={() => setDialogOpen(true)}
              className="w-full sm:w-auto"
            >
              <AlertTriangle className="size-4" /> Begin season transition…
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Double-confirmation modal ────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="tracking-tight font-bold">
              Double confirmation required
            </DialogTitle>
            <DialogDescription>
              This permanently deletes every manager account and all fantasy data except
              Zein's. It cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Confirmation 1 — explicit acknowledgement */}
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-secondary/40 p-3">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(v) => setAcknowledged(v === true)}
                className="mt-0.5"
              />
              <span className="text-sm">
                I understand that {preview?.usersToDelete ?? "all"} manager accounts, every
                squad, prediction, chat message and point total will be permanently deleted,
                and that <strong>only Zein survives</strong> with their cosmetics intact.
              </span>
            </label>

            {/* Confirmation 2 — explicit text */}
            <div className="space-y-2">
              <Label htmlFor="transition-phrase">
                Type <span className="text-destructive font-semibold">{TRANSITION_CONFIRM_PHRASE}</span>{" "}
                to confirm
              </Label>
              <Input
                id="transition-phrase"
                value={typedPhrase}
                onChange={(e) => setTypedPhrase(e.target.value)}
                placeholder={TRANSITION_CONFIRM_PHRASE}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-muted-foreground text-xs">
                {phraseMatches
                  ? "Phrase matches."
                  : "The phrase must match exactly, including spacing."}
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={runTransition}
              disabled={!canConfirm}
            >
              {busy ? "Transitioning…" : "Transition to Y11 PE Hub"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoBlock({
  tone,
  children,
}: {
  tone: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-lg border p-3", tone)}>
      <div className="[&_li]:text-muted-foreground [&_p]:text-current space-y-1 text-sm">
        {children}
      </div>
    </div>
  );
}

function CrestDisc({ value }: { value: string | null }) {
  const preset = crestPreset(normalizeCrest(value ?? ""));
  if (preset) {
    return (
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md border text-xs",
          preset.tone,
        )}
        title={preset.label}
      >
        {preset.glyph}
      </span>
    );
  }
  if (typeof value === "string" && value !== "") {
    return (
      <img
        src={value}
        alt=""
        className="size-6 shrink-0 rounded-md border border-border/70 object-cover"
      />
    );
  }
  return (
    <span className="text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-md border border-border/70 text-[10px]">
      <Trophy className="size-3" />
    </span>
  );
}

/** One editable side of the friendly: name + crest preset picker + roster count. */
function SideEditor({
  title,
  name,
  onName,
  crest,
  onCrest,
  squad,
  players,
  onToggle,
}: {
  title: string;
  name: string;
  onName: (v: string) => void;
  crest: string;
  onCrest: (v: string) => void;
  squad: Id<"players">[];
  players: PlayerRow[];
  onToggle: (id: Id<"players">) => void;
}) {
  const selected = squad
    .map((id) => players.find((p) => p._id === id) ?? null)
    .filter((p): p is PlayerRow => p !== null);

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-secondary/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs uppercase tracking-widest">{title}</Label>
        <Badge variant="outline" className="text-[11px]">
          {squad.length}/7
        </Badge>
      </div>
      <Input
        value={name}
        onChange={(e) => onName(e.target.value)}
        placeholder="Team name"
        maxLength={32}
        aria-label={`${title} name`}
      />
      <div className="flex flex-wrap gap-1.5">
        {CREST_PRESETS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onCrest(c.id)}
            title={c.label}
            aria-label={c.label}
            className={cn(
              "flex size-8 items-center justify-center rounded-md border text-sm transition-transform hover:scale-105",
              c.tone,
              crest === c.id && "ring-ring ring-2 ring-offset-1 ring-offset-background",
            )}
          >
            {c.glyph}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {selected.length === 0 ? (
          <span className="text-muted-foreground text-xs">No players assigned yet.</span>
        ) : (
          selected.map((p) => (
            <button
              key={p._id}
              type="button"
              onClick={() => onToggle(p._id)}
              className="border-border/70 hover:border-destructive/60 flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
              title="Remove"
            >
              {p.name}
              <span aria-hidden>✕</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
