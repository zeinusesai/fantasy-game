import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppNav } from "@/components/AppNav";
import { HouseBadge, HouseCrest, PositionChip } from "@/components/houses";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { formatMoney, parseMoneyInput } from "@/convex/configDefaults";
import { avatarPresetUrl } from "@/lib/fantasy";
import { UserBadges, BADGE_META, ASSIGNABLE_BADGE_KEYS } from "@/components/UserBadge";
import { HOUSES, POSITION_LABELS, STAGE_LABELS, STAGE_ORDER } from "@/lib/fantasy";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { House, Position, RequestStatus, Stage } from "@/convex/schema";
import type { Doc, Id } from "@/convex/_generated/dataModel";

type PriceRequest = Doc<"priceRequests"> & { avatar: string | null };

// ── Shared safe-avatar + player-photo helpers ───────────────────────────

/**
 * Manager avatar with layered fallbacks: custom upload URL → preset SVG →
 * initials. Broken URLs are hidden via onError so the initials disc always
 * renders — an image can never crash the table.
 */
function AdminAvatar({
  username,
  image,
  profilePic,
  sizeClass = "size-7",
}: {
  username: string | null;
  image?: string | null;
  profilePic?: string | null;
  sizeClass?: string;
}) {
  const stored = image || profilePic || null;
  const src =
    stored && (stored.startsWith("http") || stored.startsWith("data:"))
      ? stored
      : avatarPresetUrl(stored);
  return (
    <Avatar className={sizeClass}>
      <AvatarImage
        src={src ?? undefined}
        alt={username ?? "avatar"}
        onError={(e) => {
          (e.target as HTMLImageElement).style.visibility = "hidden";
        }}
      />
      <AvatarFallback className="bg-primary/20 text-primary text-[10px] font-bold">
        {(username ?? "?").slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

/** Small player photo with initials fallback (used in the roster table). */
function PlayerCellPhoto({
  name,
  image,
}: {
  name: string;
  image?: string | null;
}) {
  const src = typeof image === "string" && image.length > 0 ? image : null;
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[9px] font-bold text-muted-foreground ring-1 ring-border">
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      className="size-7 shrink-0 rounded-full object-cover ring-1 ring-border"
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Crown,
  ImagePlus,
  Inbox,
  KeyRound,
  Loader2,
  Lock,
  Megaphone,
  Pencil,
  Plus,
  Save,
  Shield,
  SlidersHorizontal,
  Trash2,
  UserCog,
  Users2,
  Wallet,
  Wrench,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { PageLoading } from "@/components/PageLoading";
import { MatchControlCenter } from "@/components/MatchControlCenter";

export default function Admin() {
  const { user, isLoading: authLoading } = useAuth();
  const role = user?.role ?? "manager";
  const isSuper = role === "super_admin";
  const isModerator = role === "moderator";

  // ── Price requests — live subscription, null-safe ([] while loading or
  //    for viewers without access). Owned here so the header badge and the
  //    Requests tab share one list. ──
  const requestsResult = useQuery(api.requests.listPriceRequests);
  const reviewPriceRequest = useMutation(api.requests.reviewPriceRequest);
  const requests = requestsResult ?? [];
  const requestsLoading = requestsResult === undefined;
  const pendingCount = requests.filter((r) => r.status === "pending").length;

  const [adjustFor, setAdjustFor] = useState<PriceRequest | null>(null);
  const [adjustPrice, setAdjustPrice] = useState("");

  const handleReview = async (
    requestId: Id<"priceRequests">,
    decision: "approve" | "deny" | "adjust",
    customPrice?: number,
  ) => {
    try {
      await reviewPriceRequest({ requestId, decision, customPrice });
      toast.success(
        decision === "deny"
          ? "Request denied."
          : decision === "adjust"
            ? "Price adjusted — request approved with adjustment."
            : "Price updated — request approved.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record the decision.");
    }
  };

  // Wait for auth to resolve before judging access — otherwise a signed-in
  // admin briefly renders the "no permission" screen on first paint.
  if (authLoading || user === undefined) {
    return (
      <AppNav>
        <PageLoading label="Checking access…" />
      </AppNav>
    );
  }

  if (!isSuper && !isModerator) {
    return (
      <AppNav>
        <Card className="border-border/80">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Lock className="text-muted-foreground size-10" />
            <h2 className="font-display text-2xl font-bold">Admin access only</h2>
            <p className="text-muted-foreground max-w-sm text-sm">
              You don't have permission to view this page.
            </p>
          </CardContent>
        </Card>
      </AppNav>
    );
  }

  const [tab, setTab] = useState("players");

  return (
    <AppNav>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">Admin panel</h1>
            <p className="text-muted-foreground text-sm">
              {isSuper
                ? "Full system control — users, budget, players, matches and logos."
                : "Player registry — you can add players and set values & houses only."}
            </p>
          </div>
          {isSuper ? (
            <Badge className="bg-primary text-primary-foreground gap-1.5 px-3 py-1.5">
              <Crown className="size-4" /> Super Admin
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1.5 px-3 py-1.5">
              <Shield className="size-4" /> Moderator — limited scope
            </Badge>
          )}
        </div>

        <Tabs value={tab} onValueChange={setTab} defaultValue="players">
          <TabsList>
            <TabsTrigger value="players">Players</TabsTrigger>
            <TabsTrigger value="requests" className="gap-1.5">
              <Inbox className="size-3.5" /> Requests
              {pendingCount > 0 && (
                <Badge className="bg-amber-400/20 text-amber-300 border border-amber-400/40 px-1.5">
                  {pendingCount}
                </Badge>
              )}
            </TabsTrigger>
            {isSuper && (
              <TabsTrigger value="roles" className="gap-1.5">
                <UserCog className="size-3.5" /> Roles
              </TabsTrigger>
            )}
            {isSuper && <TabsTrigger value="matches">Matches</TabsTrigger>}
            {isSuper && <TabsTrigger value="users">Users</TabsTrigger>}
            {isSuper && <TabsTrigger value="settings">Settings</TabsTrigger>}
          </TabsList>

          <TabsContent value="players" className="mt-4">
            <PlayersTab canDelete={isSuper} />
          </TabsContent>
          <TabsContent value="requests" className="mt-4">
            <RequestsTab
              requests={requests}
              loading={requestsLoading}
              onReview={handleReview}
              adjustFor={adjustFor}
              setAdjustFor={setAdjustFor}
              adjustPrice={adjustPrice}
              setAdjustPrice={setAdjustPrice}
            />
          </TabsContent>
          {isSuper && (
            <>
              <TabsContent value="roles" className="mt-4">
                <RolesTab />
              </TabsContent>
              <TabsContent value="matches" className="mt-4">
                <MatchesTab />
              </TabsContent>
              <TabsContent value="users" className="mt-4">
                <UsersTab />
              </TabsContent>
              <TabsContent value="settings" className="mt-4">
                <SettingsTab onOpenMaintenance={() => setTab("maintenance")} />
              </TabsContent>
              <TabsContent value="maintenance" className="mt-4">
                <MaintenanceCard />
              </TabsContent>
            </>
          )}
        </Tabs>
      </div>
    </AppNav>
  );
}

// ── Players tab (super admin + moderator) ────────────────────────────────

function PlayersTab({ canDelete }: { canDelete: boolean }) {
  const playersResult = useQuery(api.players.listPlayers);
  const players = playersResult ?? [];
  const addPlayer = useMutation(api.players.addPlayer);
  const updatePlayer = useMutation(api.players.updatePlayer);
  const deletePlayer = useMutation(api.players.deletePlayer);
  const setPlayerImage = useMutation(api.players.setPlayerImage);

  const [name, setName] = useState("");
  const [house, setHouse] = useState<House>("Fire");
  const [position, setPosition] = useState<Position>("MID");
  const [price, setPrice] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Id<"players"> | null>(null);
  const [editName, setEditName] = useState("");
  const [editHouse, setEditHouse] = useState<House>("Fire");
  const [editPosition, setEditPosition] = useState<Position>("MID");
  const [editPrice, setEditPrice] = useState("");

  // ── Player photo management (Super Admin) ──
  const [imgFor, setImgFor] = useState<Doc<"players"> | null>(null);
  const [imgUrl, setImgUrl] = useState("");
  const [imgBusy, setImgBusy] = useState(false);

  const startImageEdit = (p: Doc<"players">) => {
    setImgFor(p);
    setImgUrl(p.image ?? "");
  };

  const handleSaveImage = async () => {
    if (!imgFor) return;
    setImgBusy(true);
    try {
      await setPlayerImage({ playerId: imgFor._id, image: imgUrl.trim() });
      toast.success(
        imgUrl.trim()
          ? `Photo updated for ${imgFor.name}.`
          : `Photo cleared for ${imgFor.name}.`,
      );
      setImgFor(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the player photo.");
    } finally {
      setImgBusy(false);
    }
  };

  const handleRemoveImage = async () => {
    if (!imgFor) return;
    setImgBusy(true);
    try {
      await setPlayerImage({ playerId: imgFor._id, image: "" });
      toast.success(`Photo removed for ${imgFor.name}.`);
      setImgFor(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the photo.");
    } finally {
      setImgBusy(false);
    }
  };

  const handleAdd = async () => {
    const parsed = parseMoneyInput(price);
    if (!name.trim() || !parsed) {
      toast.error("Enter a name and a price (e.g. 12m or 8,500,000).");
      return;
    }
    setAdding(true);
    try {
      await addPlayer({ name: name.trim(), house, position, price: parsed });
      toast.success(`${name.trim()} added to the ${house} house roster.`);
      setName("");
      setPrice("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add player.");
    } finally {
      setAdding(false);
    }
  };

  // House/position come from constrained Selects with defaults, so validity
  // reduces to a non-empty name and a parseable price. Disable submit until
  // both are valid — no empty/NaN mutations can ever be fired.
  const addReady = name.trim().length >= 2 && parseMoneyInput(price) !== null;
  const priceInvalid = price.trim() !== "" && parseMoneyInput(price) === null;

  const startEdit = (p: { _id: Id<"players">; name: string; house: House; position: Position; price: number }) => {
    setEditing(p._id);
    setEditName(p.name);
    setEditHouse(p.house);
    setEditPosition(p.position);
    setEditPrice(formatMoney(p.price));
  };

  const handleUpdate = async () => {
    if (!editing) return;
    const parsed = parseMoneyInput(editPrice);
    if (!editName.trim() || parsed === null) {
      toast.error("Enter a valid name and price.");
      return;
    }
    try {
      await updatePlayer({
        playerId: editing,
        name: editName.trim(),
        house: editHouse,
        position: editPosition,
        price: parsed,
      });
      toast.success("Player updated.");
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update player.");
    }
  };

  const handleDelete = async (id: Id<"players">, playerName: string) => {
    try {
      await deletePlayer({ playerId: id });
      toast.success(`${playerName} removed from the market.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove player.");
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="card-sheen border-border/80 lg:col-span-1">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <Plus className="text-primary size-4" /> Add player
          </CardTitle>
          <CardDescription>
            The database starts empty — populate the school's rosters here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="player-name">Name</Label>
            <Input
              id="player-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Player name"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>House</Label>
              <Select value={house} onValueChange={(v) => setHouse(v as House)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HOUSES.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Position</Label>
              <Select value={position} onValueChange={(v) => setPosition(v as Position)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["GK", "DEF", "MID", "FWD"] as Position[]).map((pos) => (
                    <SelectItem key={pos} value={pos}>
                      {pos} — {POSITION_LABELS[pos]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="player-price">Price / value</Label>
            <Input
              id="player-price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="e.g. 12m, 9.5m or 8500000"
              aria-invalid={priceInvalid}
            />
            <p className={`text-xs ${priceInvalid ? "text-destructive" : "text-muted-foreground"}`}>
              {priceInvalid
                ? "Invalid amount — use 12m, 9.5m, 850k or a plain number."
                : "Supports 12m, 9.5m, 850k or raw numbers."}
            </p>
          </div>
          <Button onClick={handleAdd} disabled={adding || !addReady} className="w-full">
            {adding ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Plus className="mr-1.5 size-4" />}
            {addReady ? "Add player" : "Enter name and price to add"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/80 lg:col-span-2">
        <CardHeader>
          <CardTitle className="font-display text-lg font-bold uppercase tracking-wide">
            Player database
          </CardTitle>
          <CardDescription>
            {players.length} active player{players.length === 1 ? "" : "s"} in the market.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {playersResult === undefined ? (
            <p className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
              <Loader2 className="size-4 animate-spin" /> Loading players…
            </p>
          ) : players.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No players yet — add the first one on the left.
            </p>
          ) : (
            <div className="max-h-[520px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>House</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="w-24 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {players.map((p) =>
                    editing === p._id ? (
                      <TableRow key={p._id}>
                        <TableCell>
                          <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8" />
                        </TableCell>
                        <TableCell>
                          <Select value={editHouse} onValueChange={(v) => setEditHouse(v as House)}>
                            <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {HOUSES.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select value={editPosition} onValueChange={(v) => setEditPosition(v as Position)}>
                            <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {(["GK", "DEF", "MID", "FWD"] as Position[]).map((pos) => (
                                <SelectItem key={pos} value={pos}>{pos}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={editPrice}
                            onChange={(e) => setEditPrice(e.target.value)}
                            className="h-8 w-24 text-right"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleUpdate}
                              disabled={!editName.trim() || parseMoneyInput(editPrice) === null}
                              title={
                                !editName.trim() || parseMoneyInput(editPrice) === null
                                  ? "Enter a valid name and price first"
                                  : "Save changes"
                              }
                            >
                              <Save className="size-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                              ✕
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      <TableRow key={p._id}>
                        <TableCell className="font-semibold">
                          <span className="flex items-center gap-2">
                            <PlayerCellPhoto name={p.name} image={p.image} />
                            {p.name}
                          </span>
                        </TableCell>
                        <TableCell><HouseBadge house={p.house} /></TableCell>
                        <TableCell><PositionChip position={p.position} /></TableCell>
                        <TableCell className="text-right font-score font-bold">
                          {formatMoney(p.price)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => startImageEdit(p)}
                              title={p.image ? "Change player photo" : "Set player photo"}
                            >
                              <ImagePlus className="size-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => startEdit(p)}>
                              <Pencil className="size-3.5" />
                            </Button>
                            {canDelete && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => handleDelete(p._id, p.name)}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ),
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Player photo dialog — set or clear a custom image URL */}
      <Dialog
        open={imgFor !== null}
        onOpenChange={(open) => {
          if (!open) setImgFor(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ImagePlus className="text-primary size-4" /> Player photo
            </DialogTitle>
            <DialogDescription>
              Set a custom photo for{' '}
              <span className="text-foreground font-semibold">{imgFor?.name ?? "this player"}</span>.
              It appears on pitch cards, the draft market and match lineups.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {(() => {
                const trimmed = imgUrl.trim();
                if (!trimmed) {
                  return (
                    <span className="flex size-14 items-center justify-center rounded-full bg-secondary text-sm font-bold text-muted-foreground ring-1 ring-border">
                      {(imgFor?.name ?? "?").slice(0, 2).toUpperCase()}
                    </span>
                  );
                }
                return (
                  <img
                    src={trimmed}
                    alt="Preview"
                    className="size-14 rounded-full object-cover ring-1 ring-border"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.visibility = "hidden";
                    }}
                  />
                );
              })()}
              <div className="grid flex-1 gap-1.5">
                <Label htmlFor="player-image">Image URL</Label>
                <Input
                  id="player-image"
                  value={imgUrl}
                  onChange={(e) => setImgUrl(e.target.value)}
                  placeholder="https://… or data:image/…"
                />
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              Paste a direct image link (http/https) or a data URL. Leave empty and
              press Save to clear the photo.
            </p>
          </div>
          <DialogFooter>
            {imgFor?.image ? (
              <Button variant="outline" onClick={handleRemoveImage} disabled={imgBusy}>
                <Trash2 className="mr-1.5 size-3.5" /> Remove
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setImgFor(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveImage} disabled={imgBusy}>
              {imgBusy ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 size-4" />
              )}
              Save photo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Matches tab (super admin only) ─────────────────────────────────────────

type LineDraft = {
  playerId: Id<"players">;
  rating: string;
  goals: string;
  goalMinutes: string;
  assists: string;
  yellowCards: string;
  redCards: string;
  ownGoals: string;
  saves: string;
  cleanSheet: boolean;
};

const emptyLine = (playerId: Id<"players">): LineDraft => ({
  playerId,
  rating: "",
  goals: "0",
  goalMinutes: "",
  assists: "0",
  yellowCards: "0",
  redCards: "0",
  ownGoals: "0",
  saves: "0",
  cleanSheet: false,
});

function MatchesTab() {
  const playersResult = useQuery(api.players.listPlayers);
  const matchesResult = useQuery(api.matches.listMatches);
  const players = playersResult ?? [];
  const matches = matchesResult ?? [];
  const saveMatch = useMutation(api.matches.saveMatch);
  const scheduleMatch = useMutation(api.matches.scheduleMatch);
  const deleteMatch = useMutation(api.matches.deleteMatch);
  const setMatchStatus = useMutation(api.matches.setMatchStatus);

  const [stage, setStage] = useState<Stage>("semifinal1");
  const [homeHouse, setHomeHouse] = useState<House>("Fire");
  const [awayHouse, setAwayHouse] = useState<House>("Earth");
  const [homeGoals, setHomeGoals] = useState("0");
  const [awayGoals, setAwayGoals] = useState("0");
  const [status, setStatus] = useState<"scheduled" | "live" | "completed">("completed");
  const [kickoffLabel, setKickoffLabel] = useState("");
  const [potmPlayerId, setPotmPlayerId] = useState<string>("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [saving, setSaving] = useState(false);

  const playerMap = useMemo(
    () => new Map(players.map((p) => [p._id, p])),
    [players],
  );
  const homePlayers = players.filter((p) => p.house === homeHouse);
  const awayPlayers = players.filter((p) => p.house === awayHouse);

  const addLine = (playerId: Id<"players">) => {
    if (lines.some((l) => l.playerId === playerId)) return;
    setLines((ls) => [...ls, emptyLine(playerId)]);
  };

  const patchLine = (playerId: Id<"players">, patch: Partial<LineDraft>) => {
    setLines((ls) => ls.map((l) => (l.playerId === playerId ? { ...l, ...patch } : l)));
  };

  const handleSave = async () => {
    if (homeHouse === awayHouse) {
      toast.error("Pick two different houses.");
      return;
    }
    if (status === "completed" && lines.length === 0) {
      toast.error("Add at least one player line for a completed match.");
      return;
    }
    setSaving(true);
    try {
      await saveMatch({
        stage,
        homeHouse,
        awayHouse,
        homeGoals: parseInt(homeGoals) || 0,
        awayGoals: parseInt(awayGoals) || 0,
        status,
        kickoffLabel: kickoffLabel.trim() || undefined,
        potmPlayerId: potmPlayerId ? (potmPlayerId as Id<"players">) : undefined,
        lines: lines.map((l) => ({
          playerId: l.playerId,
          rating: l.rating === "" ? undefined : Math.max(1, Math.min(10, parseFloat(l.rating))),
          goals: parseInt(l.goals) || 0,
          goalMinutes: l.goalMinutes
            ? l.goalMinutes.split(",").map((s) => parseFloat(s.trim())).filter((n) => !Number.isNaN(n))
            : undefined,
          assists: parseInt(l.assists) || 0,
          yellowCards: parseInt(l.yellowCards) || 0,
          redCards: parseInt(l.redCards) || 0,
          ownGoals: parseInt(l.ownGoals) || 0,
          saves: parseInt(l.saves) || 0,
          cleanSheet: l.cleanSheet,
        })),
      });
      toast.success("Match saved — fantasy points have been distributed.");
      setLines([]);
      setPotmPlayerId("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save match.");
    } finally {
      setSaving(false);
    }
  };

  const handleSchedule = async () => {
    if (homeHouse === awayHouse) {
      toast.error("Pick two different houses.");
      return;
    }
    try {
      await scheduleMatch({
        stage,
        homeHouse,
        awayHouse,
        kickoffLabel: kickoffLabel.trim() || undefined,
      });
      toast.success("Fixture added to the bracket.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not schedule match.");
    }
  };

  const handleDelete = async (id: Id<"matches">) => {
    try {
      await deleteMatch({ matchId: id });
      toast.success("Match deleted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete match.");
    }
  };

  const numInput = (value: string, onChange: (v: string) => void, label: string, max?: number) => (
    <div className="grid gap-1">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8"
      />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* FotMob-style match center control (lineups, events, ratings, PotM) */}
      <MatchControlCenter />

      <div className="grid gap-6 xl:grid-cols-5">
        {/* Report form */}
      <div className="space-y-6 xl:col-span-3">
        <Card className="card-sheen border-border/80">
          <CardHeader>
            <CardTitle className="font-display text-lg font-bold uppercase tracking-wide">
              Match report
            </CardTitle>
            <CardDescription>
              Record a finished fixture — save distributes fantasy points to every squad involved.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label>Stage</Label>
                <Select value={stage} onValueChange={(v) => setStage(v as Stage)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STAGE_ORDER.map((s) => (
                      <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Home house</Label>
                <Select value={homeHouse} onValueChange={(v) => setHomeHouse(v as House)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HOUSES.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Away house</Label>
                <Select value={awayHouse} onValueChange={(v) => setAwayHouse(v as House)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HOUSES.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {numInput(homeGoals, setHomeGoals, "Home goals")}
              {numInput(awayGoals, setAwayGoals, "Away goals")}
              <div className="grid gap-1.5">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Kick-off</Label>
                <Input
                  value={kickoffLabel}
                  onChange={(e) => setKickoffLabel(e.target.value)}
                  placeholder="Fri 6 PM"
                  className="h-9"
                />
              </div>
            </div>

            {/* Player lines */}
            <div className="rounded-xl border border-border/70 p-3">
              <div className="mb-2 flex flex-col gap-2 sm:flex-row">
                <Select value={homeHouse} onValueChange={(v) => setHomeHouse(v as House)}>
                  <SelectTrigger className="h-8 w-full text-xs sm:w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HOUSES.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground flex items-center text-xs">
                  Pick players above to add stat lines — home roster loads on the left select,
                  away roster below.
                </p>
              </div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {homePlayers.map((p) => (
                  <button
                    key={p._id}
                    onClick={() => addLine(p._id)}
                    className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium hover:bg-primary/20"
                  >
                    + {p.name}
                  </button>
                ))}
                {awayPlayers.map((p) => (
                  <button
                    key={p._id}
                    onClick={() => addLine(p._id)}
                    className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium hover:bg-primary/20"
                  >
                    + {p.name}
                  </button>
                ))}
                {playersResult === undefined ? (
                  <p className="text-muted-foreground flex items-center gap-2 text-xs">
                    <Loader2 className="size-3.5 animate-spin" /> Loading players…
                  </p>
                ) : players.length === 0 && (
                  <p className="text-muted-foreground text-xs">
                    Add players in the Players tab first.
                  </p>
                )}
              </div>

              {lines.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wide">Stat lines</p>
                    <p className="text-muted-foreground text-[11px]">
                      Rating 1–10 · minutes comma-separated
                    </p>
                  </div>
                  {lines.map((l) => {
                    const player = playerMap.get(l.playerId);
                    return (
                      <div key={l.playerId} className="rounded-lg border border-border/60 bg-secondary/30 p-2.5">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="flex items-center gap-1.5 text-sm font-semibold">
                            <HouseBadge house={player!.house} />
                            {player?.name}
                            <PositionChip position={player!.position} />
                          </p>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 text-[11px] font-medium">
                              <input
                                type="radio"
                                name="potm"
                                checked={potmPlayerId === l.playerId}
                                onChange={() => setPotmPlayerId(l.playerId)}
                              />
                              PotM
                            </label>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="size-6 p-0 text-destructive"
                              onClick={() => setLines((ls) => ls.filter((x) => x.playerId !== l.playerId))}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
                          {numInput(l.rating, (v) => patchLine(l.playerId, { rating: v }), "Rating")}
                          {numInput(l.goals, (v) => patchLine(l.playerId, { goals: v }), "Goals")}
                          <div className="grid gap-1">
                            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              Minutes
                            </Label>
                            <Input
                              value={l.goalMinutes}
                              onChange={(e) => patchLine(l.playerId, { goalMinutes: e.target.value })}
                              placeholder="12, 55"
                              className="h-8"
                            />
                          </div>
                          {numInput(l.assists, (v) => patchLine(l.playerId, { assists: v }), "Assists")}
                          {numInput(l.yellowCards, (v) => patchLine(l.playerId, { yellowCards: v }), "Yellows")}
                          {numInput(l.redCards, (v) => patchLine(l.playerId, { redCards: v }), "Reds")}
                          {numInput(l.saves, (v) => patchLine(l.playerId, { saves: v }), "Saves")}
                        </div>
                        <div className="mt-2 flex items-center gap-4">
                          <label className="flex items-center gap-1.5 text-xs font-medium">
                            <Switch
                              checked={l.cleanSheet}
                              onCheckedChange={(v) => patchLine(l.playerId, { cleanSheet: v })}
                            />
                            Clean sheet
                          </label>
                          {numInput(l.ownGoals, (v) => patchLine(l.playerId, { ownGoals: v }), "Own goals")}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Save className="mr-1.5 size-4" />}
              Save match & award points
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Existing matches */}
      <div className="space-y-4 xl:col-span-2">
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="font-display text-lg font-bold uppercase tracking-wide">
              Recorded matches
            </CardTitle>
            <CardDescription>Editing an existing fixture isn't supported in v1 — delete and re-enter it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {matchesResult === undefined ? (
              <p className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
                <Loader2 className="size-4 animate-spin" /> Loading matches…
              </p>
            ) : matches.length === 0 && (
              <p className="text-muted-foreground text-sm">No matches recorded yet.</p>
            )}
            {matches.map((m) => (
              <div
                key={m._id}
                className="flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-secondary/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">
                    {STAGE_LABELS[m.stage]} · {m.status}
                  </p>
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <HouseCrest house={m.homeHouse} size={20} /> {m.homeHouse}{" "}
                    <span className="font-score text-primary">{m.homeGoals}–{m.awayGoals}</span>{" "}
                    {m.awayHouse} <HouseCrest house={m.awayHouse} size={20} />
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {m.status !== "completed" && (
                    <Button size="sm" variant="ghost" onClick={() => setMatchStatus({ matchId: m._id, status: "completed" })}>
                      FT
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDelete(m._id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}

// ── Users tab (super admin only) ─────────────────────────────────────────

function UsersTab() {
  // `?? []`: undefined (still loading) and null-safe results both render as an
  // empty list instead of crashing on `.map`.
  const usersResult = useQuery(api.usersAdmin.listUsers);
  const users = (usersResult ?? []) as Array<{
    _id: Id<"users">;
    username: string | null;
    teamName: string | null;
    image: string | null;
    profilePic: string | null;
    role: string | null;
    budget: number | null;
    customBudget: number | null;
  }>;
  const usersLoading = usersResult === undefined;
  const updateUser = useMutation(api.usersAdmin.updateUser);
  const requestPasswordReset = useMutation(api.usersAdmin.requestPasswordReset);
  const setUserBudget = useMutation(api.usersAdmin.setUserBudget);
  const deleteUser = useMutation(api.usersAdmin.deleteUserWithCascade);
  const { user: me } = useAuth();

  const [editingId, setEditingId] = useState<Id<"users"> | null>(null);
  const [editTeam, setEditTeam] = useState("");
  const [editBudget, setEditBudget] = useState("");
  const [resetFor, setResetFor] = useState<{ id: Id<"users">; username: string | null } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // ── Budget override (Super Admin) ──
  const [budgetFor, setBudgetFor] = useState<{ id: Id<"users">; username: string | null } | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [budgetBusy, setBudgetBusy] = useState(false);

  // ── Delete user with cascade (Super Admin) ──
  const [deleteFor, setDeleteFor] = useState<{ id: Id<"users">; username: string | null } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const openBudget = (u: { _id: Id<"users">; username: string | null; budget: number | null; customBudget: number | null }) => {
    setBudgetFor({ id: u._id, username: u.username });
    const current = u.customBudget ?? u.budget;
    setBudgetInput(current != null ? formatMoney(current) : "");
  };

  const handleSetBudget = async () => {
    if (!budgetFor) return;
    // Defensive numeric parse — nothing non-numeric ever reaches the backend.
    const parsed = parseMoneyInput(budgetInput);
    if (parsed === null || parsed < 0) {
      toast.error('Invalid budget — use e.g. "60m", "75m" or "75000000".');
      return;
    }
    setBudgetBusy(true);
    try {
      await setUserBudget({ userId: budgetFor.id, budget: parsed });
      toast.success(`Budget for @${budgetFor.username ?? "user"} set to ${formatMoney(parsed)}.`);
      setBudgetFor(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set the budget.");
    } finally {
      setBudgetBusy(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteFor) return;
    setDeleteBusy(true);
    try {
      const res = await deleteUser({ userId: deleteFor.id });
      toast.success(
        `@${deleteFor.username ?? "user"} deleted${res?.squadDeleted ? " along with their squad" : ""}.`,
      );
      setDeleteFor(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the user.");
    } finally {
      setDeleteBusy(false);
    }
  };

  const startEdit = (u: { _id: Id<"users">; teamName: string | null; budget: number | null }) => {
    setEditingId(u._id);
    setEditTeam(u.teamName ?? "");
    setEditBudget(u.budget != null ? formatMoney(u.budget) : "");
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    try {
      const parsed = editBudget.trim() ? parseMoneyInput(editBudget) : null;
      if (editBudget.trim() && parsed === null) throw new Error("Invalid budget amount.");
      await updateUser({
        userId: editingId,
        teamName: editTeam.trim(),
        budget: parsed ?? undefined,
      });
      toast.success("User updated.");
      setEditingId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update user.");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (!resetFor) return;
    if (newPassword.length < 4) {
      toast.error("New password must be at least 4 characters.");
      return;
    }
    setBusy(true);
    try {
      await requestPasswordReset({ userId: resetFor.id, newPassword });
      toast.success(`Password reset for @${resetFor.username}. Their sessions were signed out.`);
      setResetFor(null);
      setNewPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reset password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-border/80">
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
          <Users2 className="text-primary size-4" /> User management
        </CardTitle>
        <CardDescription>
          Edit team names, adjust individual budgets and reset passwords for any manager.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {usersLoading ? (
          <p className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading users…
          </p>
        ) : users.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No users found — or your account doesn't have access to this list.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Manager</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) =>
                editingId === u._id ? (
                  <TableRow key={u._id}>
                    <TableCell className="font-semibold">
                      <span className="flex items-center gap-2">
                        <AdminAvatar username={u.username} image={u.image} profilePic={u.profilePic} />
                        @{u.username}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Input value={editTeam} onChange={(e) => setEditTeam(e.target.value)} className="h-8" />
                    </TableCell>
                    <TableCell className="text-xs">{u.role}</TableCell>
                    <TableCell>
                      <Input
                        value={editBudget}
                        onChange={(e) => setEditBudget(e.target.value)}
                        className="h-8 w-24 text-right"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={saveEdit} disabled={busy}>
                          <Save className="size-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          ✕
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={u._id}>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <AdminAvatar username={u.username} image={u.image} profilePic={u.profilePic} />
                        <span className="font-semibold">@{u.username}</span>
                      </span>
                    </TableCell>
                    <TableCell>{u.teamName ?? "—"}</TableCell>
                    <TableCell>
                      {u.role === "super_admin" ? (
                        <Badge className="bg-primary text-primary-foreground gap-1">
                          <Crown className="size-3" /> Super Admin
                        </Badge>
                      ) : u.role === "moderator" ? (
                        <Badge variant="outline" className="gap-1">
                          <Shield className="size-3" /> Moderator
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Manager</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-score font-bold">
                      {u.budget != null ? (
                        <span className="inline-flex items-center gap-1">
                          {formatMoney(u.budget)}
                          {u.customBudget != null && (
                            <Badge variant="outline" className="px-1 py-0 text-[9px] uppercase">
                              custom
                            </Badge>
                          )}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => startEdit(u)} title="Edit">
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Budget override"
                          onClick={() => openBudget(u)}
                        >
                          <Wallet className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Reset password"
                          onClick={() => setResetFor({ id: u._id, username: u.username })}
                        >
                          <KeyRound className="size-3.5" />
                        </Button>
                        {u._id !== me?._id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            title="Delete user"
                            onClick={() => setDeleteFor({ id: u._id, username: u.username })}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        )}

        {/* Password reset inline panel */}
        {resetFor && (
          <div className="mt-4 rounded-xl border border-primary/40 bg-primary/5 p-4">
            <p className="text-sm font-semibold">
              Set a new password for <span className="text-primary">@{resetFor.username}</span>
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Input
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 4 characters)"
                type="text"
                className="sm:max-w-xs"
              />
              <Button onClick={handleReset} disabled={busy}>
                <KeyRound className="mr-1.5 size-4" /> Reset password
              </Button>
              <Button variant="ghost" onClick={() => setResetFor(null)}>
                Cancel
              </Button>
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              The user will be signed out everywhere and will sign in with the new password.
            </p>
          </div>
        )}

        {/* Budget override dialog */}
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
                Independently set{' '}
                <span className="text-foreground font-semibold">@{budgetFor?.username ?? "user"}</span>'s
                budget (e.g. $60m or $75m) while the global default stays unchanged. Squad
                validation uses this value immediately.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="override-budget">New budget</Label>
              <Input
                id="override-budget"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                placeholder='e.g. "60m", "75m" or "75000000"'
                autoFocus
              />
              {budgetInput.trim() !== "" && parseMoneyInput(budgetInput) === null && (
                <p className="text-destructive text-xs">
                  Invalid amount — use 60m, 75m, 850k or a plain number.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setBudgetFor(null)}>
                Cancel
              </Button>
              <Button onClick={handleSetBudget} disabled={budgetBusy || parseMoneyInput(budgetInput) === null}>
                {budgetBusy ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Wallet className="mr-1.5 size-4" />
                )}
                Set budget
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete-user confirmation (cascade warning) */}
        <Dialog
          open={deleteFor !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteFor(null);
          }}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="size-4" /> Delete user?
              </DialogTitle>
              <DialogDescription>
                This permanently deletes{' '}
                <span className="text-foreground font-semibold">@{deleteFor?.username ?? "user"}</span>{' '}
                and everything tied to them: sign-in credentials, their fantasy squad,
                per-match score rows and price requests. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteFor(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDeleteUser} disabled={deleteBusy}>
                {deleteBusy ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-1.5 size-4" />
                )}
                Delete permanently
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ── Settings tab (super admin only) ──────────────────────────────────────

function SettingsTab({ onOpenMaintenance }: { onOpenMaintenance: () => void }) {
  const config = useQuery(api.config.getConfig);
  const setBudget = useMutation(api.config.setBudget);
  const setHouseLimit = useMutation(api.config.setHouseLimit);
  const setHouseLogo = useMutation(api.houses.setHouseLogo);

  const [budgetInput, setBudgetInput] = useState<string | null>(null);
  const [houseLimit, setHouseLimitLocal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const budgetValue = budgetInput ?? (config ? formatMoney(config.budget) : "");

  const handleBudget = async () => {
    const parsed = parseMoneyInput(budgetInput ?? "");
    if (parsed === null) {
      toast.error('Enter a valid budget, e.g. "70m" or "70000000".');
      return;
    }
    setBusy(true);
    try {
      await setBudget({ budget: parsed });
      toast.success(`Global starting budget set to ${formatMoney(parsed)}.`);
      setBudgetInput(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set budget.");
    } finally {
      setBusy(false);
    }
  };

  const handleHouseLimit = async (limit: number) => {
    setBusy(true);
    try {
      await setHouseLimit({ houseLimit: limit });
      toast.success(`House limit set to ${limit} players per squad.`);
      setHouseLimitLocal(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set house limit.");
    } finally {
      setBusy(false);
    }
  };

  const uploadLogo = (house: House) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 1_400_000) {
        toast.error("Image too large — please use an image under ~1.4MB.");
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          await setHouseLogo({ house, logoUrl: String(reader.result) });
          toast.success(`${house} logo updated.`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not save logo.");
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <AnnouncementCard />
      </div>
      <Card className="card-sheen border-border/80">
        <CardHeader>
          <CardTitle className="font-display text-lg font-bold uppercase tracking-wide">
            Global budget
          </CardTitle>
          <CardDescription>
            The starting budget every manager builds their 7-a-side squad within.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="global-budget">Starting budget</Label>
              <Input
                id="global-budget"
                value={budgetValue}
                onChange={(e) => setBudgetInput(e.target.value)}
                placeholder='e.g. "70m" or "70000000"'
              />
            </div>
            <Button onClick={handleBudget} disabled={busy || !config}>
              <Save className="mr-1.5 size-4" /> Save
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Current: {config ? formatMoney(config.budget) : "…"}
          </p>

          <div className="grid gap-1.5 pt-2">
            <Label>Max players from one house per squad</Label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={(houseLimit ?? String(config?.houseLimit ?? 3)) === String(n) ? "default" : "outline"}
                  onClick={() => handleHouseLimit(n)}
                  disabled={busy}
                >
                  {n}
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              Default is 3 — forces balanced picks across the four houses.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* System controls — maintenance mode lives in its own tab */}
      <Card className="border-border/80 lg:col-span-2">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <Wrench className="text-primary size-4" /> System controls
          </CardTitle>
          <CardDescription>
            Lock the platform for everyone except staff while you make changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={onOpenMaintenance}>
            <Wrench className="mr-1.5 size-4" /> Open maintenance mode controls
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display text-lg font-bold uppercase tracking-wide">
            House logos
          </CardTitle>
          <CardDescription>
            Upload custom crests — shown across the bracket, match center and leaderboards.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          {HOUSES.map((house) => (
            <HouseLogoSlot key={house} house={house} onUpload={() => uploadLogo(house)} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Price requests tab (super admin + moderator) ─────────────────────────

const REQUEST_STATUS_STYLES: Record<RequestStatus, string> = {
  pending: "border-amber-400/40 bg-amber-400/15 text-amber-200",
  approved: "border-emerald-400/40 bg-emerald-400/15 text-emerald-200",
  adjusted: "border-sky-400/40 bg-sky-400/15 text-sky-200",
  denied: "border-red-400/40 bg-red-400/15 text-red-200",
};

function RequestsTab({
  requests,
  loading,
  onReview,
  adjustFor,
  setAdjustFor,
  adjustPrice,
  setAdjustPrice,
}: {
  requests: PriceRequest[];
  loading: boolean;
  onReview: (
    requestId: Id<"priceRequests">,
    decision: "approve" | "deny" | "adjust",
    customPrice?: number,
  ) => void;
  adjustFor: PriceRequest | null;
  setAdjustFor: (r: PriceRequest | null) => void;
  adjustPrice: string;
  setAdjustPrice: (v: string) => void;
}) {
  const parsedAdjust = parseMoneyInput(adjustPrice);
  const adjustValid = parsedAdjust !== null && parsedAdjust >= 0;

  const pending = requests.filter((r) => r.status === "pending");
  const reviewed = requests.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-4">
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <Inbox className="text-primary size-4" /> Price change requests
          </CardTitle>
          <CardDescription>
            Managers can request a price change on any player. Approving sets the
            official market price; Custom Adjust lets you counter-offer a different
            price instead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
              <Loader2 className="size-4 animate-spin" /> Loading requests…
            </p>
          ) : pending.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No pending requests right now.
            </p>
          ) : (
            <div className="space-y-3">
              {pending.map((r) => (
                <div
                  key={r._id}
                  className="rounded-xl border border-border/70 bg-secondary/40 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        <Avatar className="size-6">
                          <AvatarImage
                            src={
                              avatarPresetUrl(r.avatar) ??
                              (r.avatar?.startsWith("http") || r.avatar?.startsWith("data:")
                                ? r.avatar
                                : undefined)
                            }
                            alt={r.username ?? "avatar"}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.visibility = "hidden";
                            }}
                          />
                          <AvatarFallback className="bg-primary/20 text-primary text-[9px] font-bold">
                            {(r.username ?? "?").slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        @{r.username || "unknown"}
                        <span className="text-muted-foreground font-normal">
                          requests a price change for
                        </span>
                        <span className="text-primary">{r.playerName}</span>
                      </p>
                      <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="font-score line-through opacity-70">
                          {formatMoney(r.currentPrice)}
                        </span>
                        <span>→</span>
                        <span className="font-score text-base font-bold text-primary">
                          {formatMoney(r.requestedPrice)}
                        </span>
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-[10px] uppercase">
                      pending
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-2 rounded-lg border border-border/60 bg-background/40 p-2.5 text-sm italic">
                    “{r.reason}”
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => onReview(r._id, "approve")}>
                      <CheckCircle2 className="mr-1.5 size-3.5" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAdjustFor(r);
                        setAdjustPrice("");
                      }}
                    >
                      <SlidersHorizontal className="mr-1.5 size-3.5" /> Custom adjust
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => onReview(r._id, "deny")}
                    >
                      <XCircle className="mr-1.5 size-3.5" /> Deny
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {reviewed.length > 0 && (
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="font-display text-sm font-bold uppercase tracking-widest">
              Recently reviewed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {reviewed.map((r) => (
              <div
                key={r._id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-secondary/30 px-3 py-2"
              >
                <p className="text-sm">
                  <span className="font-semibold">{r.playerName}</span>
                  <span className="text-muted-foreground"> for @{r.username || "unknown"}</span>
                </p>
                <div className="flex items-center gap-2">
                  {r.finalPrice != null && (
                    <span className="font-score text-xs font-bold">
                      final {formatMoney(r.finalPrice)}
                    </span>
                  )}
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] uppercase", REQUEST_STATUS_STYLES[r.status])}
                  >
                    {r.status}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Custom counter-price dialog */}
      <Dialog
        open={adjustFor !== null}
        onOpenChange={(open) => {
          if (!open) setAdjustFor(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Custom price adjustment</DialogTitle>
            <DialogDescription>
              Set a counter-price for {adjustFor?.playerName ?? "this player"} instead of
              the requested {adjustFor ? formatMoney(adjustFor.requestedPrice) : "amount"}.
              The player's official price will update to your value and the request will
              be marked approved with adjustment.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="adjust-price">New official price</Label>
            <Input
              id="adjust-price"
              value={adjustPrice}
              onChange={(e) => setAdjustPrice(e.target.value)}
              placeholder="e.g. 9.5m, 850k or 9500000"
              autoFocus
            />
            {adjustPrice.trim() !== "" && !adjustValid && (
              <p className="text-destructive text-xs">
                Invalid amount — use 12m, 9.5m, 850k or a plain number.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdjustFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={!adjustValid || !adjustFor}
              onClick={() => {
                if (!adjustFor || parsedAdjust === null) return;
                onReview(adjustFor._id, "adjust", parsedAdjust);
                setAdjustFor(null);
              }}
            >
              <SlidersHorizontal className="mr-1.5 size-4" /> Apply & approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Announcement card (super admin only, shown in Settings tab) ──────────

function AnnouncementCard() {
  const config = useQuery(api.config.getConfig);
  const setAdminMessage = useMutation(api.config.setAdminMessage);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const value = msg ?? config?.adminMessage ?? "";
  const dirty = msg !== null && msg !== (config?.adminMessage ?? "");

  const save = async (next: string) => {
    setBusy(true);
    try {
      await setAdminMessage({ message: next });
      toast.success(next ? "Announcement published to all dashboards." : "Announcement cleared.");
      setMsg(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the announcement.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
          <Megaphone className="text-primary size-4" /> Global announcement
        </CardTitle>
        <CardDescription>
          Shown in a banner at the top of every manager's dashboard. Clear it to hide.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={value}
          onChange={(e) => setMsg(e.target.value)}
          placeholder="e.g. Semifinals start Friday — lock your squads by 6 PM!"
          rows={3}
          maxLength={500}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            {value.trim().length}/500 characters
            {config?.adminMessage ? " · currently live" : " · no message live"}
          </p>
          <div className="flex gap-2">
            {config?.adminMessage && (
              <Button variant="outline" size="sm" onClick={() => save("")} disabled={busy}>
                <Trash2 className="mr-1.5 size-3.5" /> Clear
              </Button>
            )}
            <Button size="sm" onClick={() => save(value.trim())} disabled={busy || !dirty}>
              {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Save className="mr-1.5 size-3.5" />}
              Publish
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── User roles & permissions tab (super admin only) ──────────────────

function RolesTab() {
  const usersResult = useQuery(api.usersAdmin.listAllUsersWithRoles);
  const updateUserRole = useMutation(api.usersAdmin.updateUserRole);
  const assignUserBadge = useMutation(api.usersAdmin.assignUserBadge);
  const users = (usersResult ?? []) as Array<{
    _id: Id<"users">;
    username: string | null;
    teamName: string | null;
    image: string | null;
    role: string;
    customBadge: string | null;
  }>;
  const loading = usersResult === undefined;
  const [busyId, setBusyId] = useState<Id<"users"> | null>(null);

  const changeRole = async (targetUserId: Id<"users">, newRole: string) => {
    setBusyId(targetUserId);
    try {
      await updateUserRole({ targetUserId, newRole });
      toast.success(`Role updated to ${newRole}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the role.");
    } finally {
      setBusyId(null);
    }
  };

  // Super Admin badge assignment — try/catch with clean toasts; "none"
  // clears the badge server-side.
  const changeBadge = async (targetUserId: Id<"users">, username: string | null, badgeType: string) => {
    setBusyId(targetUserId);
    try {
      await assignUserBadge({ targetUserId, badgeType });
      toast.success(
        badgeType === "none"
          ? `Badge removed from @${username ?? "user"}.`
          : `"${badgeType}" badge assigned to @${username ?? "user"}.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not assign the badge.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="border-border/80">
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
          <UserCog className="text-primary size-4" /> User roles & permissions
        </CardTitle>
        <CardDescription>
          Assign platform roles: super_admin (full control), admin (moderator
          scope) or user (standard manager). You cannot demote the last Super
          Admin.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading users…
          </p>
        ) : users.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            No registered users found.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Manager</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Current role</TableHead>
                <TableHead className="text-right">Change role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u._id}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <AdminAvatar username={u.username} image={u.image} />
                      <span className="font-semibold">@{u.username ?? "—"}</span>
                      {/* Current role checkmark + custom badge preview. */}
                      <UserBadges
                        sizeClass="size-3.5"
                        role={u.role}
                        customBadge={u.customBadge}
                      />
                    </span>
                  </TableCell>
                  <TableCell>{u.teamName ?? "—"}</TableCell>
                  <TableCell>
                    {u.role === "super_admin" ? (
                      <Badge className="bg-primary text-primary-foreground gap-1">
                        <Crown className="size-3" /> Super Admin
                      </Badge>
                    ) : u.role === "moderator" ? (
                      <Badge variant="outline" className="gap-1">
                        <Shield className="size-3" /> Admin
                      </Badge>
                    ) : (
                      <Badge variant="secondary">User</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* Assign badge — Super Admin only, validated server-side. */}
                      <Select
                        value={u.customBadge ?? "none"}
                        onValueChange={(v) => changeBadge(u._id, u.username, v)}
                        disabled={busyId === u._id}
                      >
                        <SelectTrigger className="h-8 w-[132px]" title="Assign badge">
                          <SelectValue placeholder="Badge" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">✕ No badge</SelectItem>
                          {ASSIGNABLE_BADGE_KEYS.map((key) => {
                            const meta = BADGE_META[key];
                            return (
                              <SelectItem key={key} value={key}>
                                {meta.glyph} {meta.label}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      <Select
                        value={u.role ?? "user"}
                        onValueChange={(v) => changeRole(u._id, v)}
                        disabled={busyId === u._id}
                      >
                        <SelectTrigger className="h-8 w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="super_admin">Super Admin</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="user">User</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ── Maintenance mode controls (super admin only) ─────────────────────

function MaintenanceCard() {
  const statusResult = useQuery(api.system.getMaintenanceStatus);
  const toggleMaintenanceMode = useMutation(api.system.toggleMaintenanceMode);
  const [busy, setBusy] = useState(false);

  // Safe fallback while loading — never render from `undefined`.
  const status = statusResult ?? { isMaintenanceMode: false };
  const active = status.isMaintenanceMode === true;

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      await toggleMaintenanceMode({ isMaintenanceMode: next === true });
      toast.success(
        next
          ? "Maintenance mode is ON — standard users now see the lock screen."
          : "Maintenance mode is OFF — the platform is open to everyone.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not toggle maintenance mode.");
    } finally {
      setBusy(false);
    }
  };
  
  return (
    <Card className={cn("border", active ? "border-amber-400/50 bg-amber-400/5" : "border-border/80")}>
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
          <Wrench className="text-primary size-4" /> Maintenance mode
        </CardTitle>
        <CardDescription>
          Locks the whole platform for standard users with an animated lock
          screen. Super Admin and admins keep full access and see a pulsing
          warning banner in the header.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">
              Status: {" "}
              {active ? (
                <span className="text-amber-300">⚠️ ACTIVE</span>
              ) : (
                <span className="text-emerald-400">Operational</span>
              )}
            </p>
            <p className="text-muted-foreground text-xs">
              {active
                ? "Non-staff visitors are blocked at the root layout."
                : "Everyone can browse, draft squads and view the bracket."}
            </p>
          </div>
          <Switch
            checked={active}
            onCheckedChange={(v) => toggle(v === true)}
            disabled={busy || statusResult === undefined}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          Tip: staff who were signed out can still reach the sign-in page from
          the lock screen and pass the gate by role.
          {busy && <Loader2 className="ml-1.5 inline size-3 animate-spin" />}
        </p>
      </CardContent>
    </Card>
  );
}

function HouseLogoSlot({ house, onUpload }: { house: House; onUpload: () => void }) {
  const logos = useQuery(api.houses.listHouseLogos);
  const custom = logos?.[house] ?? null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-secondary/40 p-3">
      <HouseCrest house={house} size={48} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{house}</p>
        <p className="text-muted-foreground truncate text-xs">
          {custom ? "Custom logo" : "Default crest"}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onUpload}>
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}
