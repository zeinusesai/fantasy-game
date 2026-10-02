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
import { StatusBadge, STATUS_OPTIONS } from "@/components/StatusBadge";
import { ScoreLine, PenaltyBadge } from "@/components/ScoreLine";
import {
  isKnockoutMatch,
  isKnockoutStage,
  validatePenaltyShootout,
} from "@/convex/penalties";
import { MAX_PRICE_AED } from "@/convex/storeItems";
import type { PlayerStatusLabel } from "@/convex/schema";
import { avatarPresetUrl } from "@/lib/fantasy";
import { UserBadges, BADGE_META, ASSIGNABLE_BADGE_KEYS } from "@/components/UserBadge";
import { HOUSES, POSITION_LABELS, STAGE_LABELS, STAGE_ORDER } from "@/lib/fantasy";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { House, Position, RequestStatus, Stage } from "@/convex/schema";
import type { Doc, Id } from "@/convex/_generated/dataModel";

type PriceRequest = Doc<"priceRequests"> & { avatar: string | null };
type PhotoRequest = Doc<"photoRequests"> & {
  avatar: string | null;
  /** The player's live photo (null when already cleared / player deleted). */
  currentPhoto: string | null;
};
type Purchase = {
  _id: Id<"purchases">;
  username: string | null;
  avatar: string | null;
  itemId: string;
  itemName: string;
  priceAED: number;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
  decidedBy: string | null;
};

/** "12 Aug, 14:03" — locale-formatted, with a safe fallback for junk input. */
function formatWhen(ts: unknown): string {
  const n = typeof ts === "number" ? ts : Number(ts);
  if (!Number.isFinite(n) || n <= 0) return "unknown time";
  try {
    return new Date(n).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "unknown time";
  }
}

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
  HandCoins,
  ImagePlus,
  Inbox,
  KeyRound,
  Loader2,
  Lock,
  Megaphone,
  Pencil,
  Plus,
  Save,
  ScrollText,
  Shield,
  SlidersHorizontal,
  Trash2,
  Trophy,
  UserCog,
  Users,
  Users2,
  Wallet,
  Wrench,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { PageLoading } from "@/components/PageLoading";
import { MatchControlCenter } from "@/components/MatchControlCenter";
import { GameweeksTab } from "@/components/GameweeksTab";
import { CustomizationTab } from "@/components/CustomizationTab";
import { useAdminConfig } from "@/hooks/use-admin-config";
import { AuditLogTab } from "@/components/AuditLogTab";
import { UserInspectorTab } from "@/components/UserInspectorTab";
import { BulkOpsTab } from "@/components/BulkOpsTab";

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

  // ── Photo removal requests — same queue shape, same defensive [] default ──
  const photoRequestsResult = useQuery(api.requests.listPhotoRequests);
  const reviewPhotoRequest = useMutation(api.requests.reviewPhotoRequest);
  const photoRequests = photoRequestsResult ?? [];
  const photoRequestsLoading = photoRequestsResult === undefined;
  const pendingPhotoCount = photoRequests.filter(
    (r) => r.status === "pending",
  ).length;

  // ── Store micro-transactions (cash, hard 10 AED ceiling) ──
  const purchasesResult = useQuery(api.transactions.listPurchases);
  const approvePurchase = useMutation(api.transactions.approvePurchase);
  const rejectPurchase = useMutation(api.transactions.rejectPurchase);
  const purchases = purchasesResult ?? [];
  const purchasesLoading = purchasesResult === undefined;
  const pendingPurchaseCount = purchases.filter(
    (r) => r.status === "pending",
  ).length;

  const handleApprovePurchase = async (purchaseId: Id<"purchases">) => {
    try {
      const result = await approvePurchase({ purchaseId });
      toast.success(
        result.granted
          ? `Transaction approved! ${result.itemName} granted.`
          : `Transaction approved — ${result.itemName} is no longer available to grant.`,
      );
    } catch (err) {
      // The server's idempotency guard arrives as a clean message here, so a
      // double click reports honestly instead of silently failing.
      toast.error(
        err instanceof Error ? err.message : "Could not approve the transaction.",
      );
    }
  };

  const handleRejectPurchase = async (purchaseId: Id<"purchases">) => {
    try {
      const result = await rejectPurchase({ purchaseId });
      toast.success(`${result.itemName} rejected — nothing was granted.`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not reject the transaction.",
      );
    }
  };

  const handleReviewPhoto = async (
    requestId: Id<"photoRequests">,
    decision: "approve" | "deny",
  ) => {
    try {
      const result = await reviewPhotoRequest({ requestId, decision });
      toast.success(
        decision === "approve"
          ? result.removed
            ? "Photo removed successfully — the player now uses the default avatar."
            : "Request approved — the player no longer has a photo."
          : "Photo request dismissed — the photo stays.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record the decision.");
    }
  };

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
      <div className="mx-auto w-full max-w-md space-y-6 sm:max-w-7xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Admin panel</h1>
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
              {pendingCount + pendingPhotoCount + pendingPurchaseCount > 0 && (
                <Badge className="bg-amber-400/20 text-amber-300 border border-amber-400/40 px-1.5">
                  {pendingCount + pendingPhotoCount + pendingPurchaseCount}
                </Badge>
              )}
            </TabsTrigger>
            {isSuper && (
              <TabsTrigger value="roles" className="gap-1.5">
                <UserCog className="size-3.5" /> Roles
              </TabsTrigger>
            )}
            {isSuper && <TabsTrigger value="matches">Matches</TabsTrigger>}
            {isSuper && <TabsTrigger value="gameweeks">Gameweeks</TabsTrigger>}
            {isSuper && (
              <TabsTrigger value="customize" className="gap-1.5">
                <SlidersHorizontal className="size-3.5" /> Customize
              </TabsTrigger>
            )}
            {isSuper && <TabsTrigger value="users">Users</TabsTrigger>}
            {isSuper && (
              <TabsTrigger value="inspector" className="gap-1.5">
                <UserCog className="size-3.5" /> Inspector
              </TabsTrigger>
            )}
            {isSuper && (
              <TabsTrigger value="bulk" className="gap-1.5">
                <Wrench className="size-3.5" /> Bulk Ops
              </TabsTrigger>
            )}
            {isSuper && (
              <TabsTrigger value="audit" className="gap-1.5">
                <ScrollText className="size-3.5" /> Audit
              </TabsTrigger>
            )}
            {isSuper && <TabsTrigger value="settings">Settings</TabsTrigger>}
            {isSuper && <TabsTrigger value="maintenance">Maintenance</TabsTrigger>}
          </TabsList>

          <TabsContent value="players" className="mt-4">
            <PlayersTab isSuper={isSuper} />
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
              photoRequests={photoRequests}
              photoRequestsLoading={photoRequestsLoading}
              onReviewPhoto={handleReviewPhoto}
              isSuper={isSuper}
              purchases={purchases}
              purchasesLoading={purchasesLoading}
              onApprovePurchase={handleApprovePurchase}
              onRejectPurchase={handleRejectPurchase}
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
              <TabsContent value="gameweeks" className="mt-4">
                <GameweeksTab />
              </TabsContent>
              <TabsContent value="customize" className="mt-4">
                <CustomizationTab />
              </TabsContent>
              <TabsContent value="users" className="mt-4">
                <UsersTab />
              </TabsContent>
              <TabsContent value="inspector" className="mt-4">
                <UserInspectorTab />
              </TabsContent>
              <TabsContent value="bulk" className="mt-4">
                <BulkOpsTab />
              </TabsContent>
              <TabsContent value="audit" className="mt-4">
                <AuditLogTab />
              </TabsContent>
              <TabsContent value="settings" className="mt-4">
                <SettingsTab onOpenMaintenance={() => setTab("maintenance")} />
              </TabsContent>
              <TabsContent value="maintenance" className="mt-4">
                <div className="space-y-6">
                  <MaintenanceCard />
                  <MaintenanceCopyEditor />
                </div>
              </TabsContent>
            </>
          )}
        </Tabs>
      </div>
    </AppNav>
  );
}

// ── Players tab (super admin + moderator) ────────────────────────────────

/**
 * `isSuper` gates the Super-Admin-only roster controls: soft-deleting a
 * player, setting a custom photo, and the availability status labels.
 */
function PlayersTab({ isSuper }: { isSuper: boolean }) {
  const playersResult = useQuery(api.players.listPlayers);
  const players = playersResult ?? [];
  const addPlayer = useMutation(api.players.addPlayer);
  const updatePlayer = useMutation(api.players.updatePlayer);
  const deletePlayer = useMutation(api.players.deletePlayer);
  const setPlayerImage = useMutation(api.players.setPlayerImage);
  const removePlayerPhoto = useMutation(api.players.removePlayerPhoto);
  const setPlayerStatus = useMutation(api.players.setPlayerStatus);
  const bulkSetPlayerStatus = useMutation(api.players.bulkSetPlayerStatus);

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
  const [updating, setUpdating] = useState(false);

  // ── Availability status labels (Super Admin only) ──
  // "Default" clears the stored label, so the player falls back to
  // "Expected to Start" everywhere in the market and on the pitch.
  const NONE = "__none__" as const;
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [bulkHouse, setBulkHouse] = useState<string>("all");
  const [bulkStatus, setBulkStatus] = useState<string>(NONE);
  const [bulkBusy, setBulkBusy] = useState(false);

  const handleSetStatus = async (p: Doc<"players">, next: string) => {
    setStatusBusy(p._id);
    try {
      await setPlayerStatus({
        playerId: p._id,
        statusLabel: next === NONE ? null : (next as PlayerStatusLabel),
      });
      toast.success(
        next === NONE
          ? `${p.name}'s status reset to the default.`
          : `${p.name} marked "${next}".`,
      );
    } catch (err) {
      // Server errors already arrive as friendly human-readable messages.
      toast.error(err instanceof Error ? err.message : "Could not update the status.");
    } finally {
      setStatusBusy(null);
    }
  };

  const handleBulkStatus = async () => {
    const targets = players.filter((p) => bulkHouse === "all" || p.house === bulkHouse);
    if (targets.length === 0) {
      toast.error("No players match that house.");
      return;
    }
    setBulkBusy(true);
    try {
      const result = await bulkSetPlayerStatus({
        playerIds: targets.map((p) => p._id),
        statusLabel: bulkStatus === NONE ? null : (bulkStatus as PlayerStatusLabel),
      });
      const what = bulkStatus === NONE ? "cleared" : bulkStatus;
      toast.success(
        `${result.updated} player${result.updated === 1 ? "" : "s"} → ${what}.` +
          (result.skipped > 0 ? ` ${result.skipped} unchanged or skipped.` : ""),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not bulk-update the statuses.");
    } finally {
      setBulkBusy(false);
    }
  };

  // ── Player photo management (Super Admin) ──
  const [imgFor, setImgFor] = useState<Doc<"players"> | null>(null);
  const [imgUrl, setImgUrl] = useState("");
  const [imgBusy, setImgBusy] = useState(false);

  const startImageEdit = (p: Doc<"players">) => {
    setImgBusy(false);
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

  // Dedicated moderation path (Super Admin only, enforced server-side).
  // Idempotent on the server, so a double click or a stale tab still resolves
  // with a success toast instead of an error.
  const handleRemoveImage = async () => {
    if (!imgFor) return;
    const name = imgFor.name;
    setImgBusy(true);
    try {
      const result = await removePlayerPhoto({ playerId: imgFor._id });
      toast.success(
        result.removed
          ? `Player photo removed successfully — ${name} now uses the default avatar.`
          : `${name} already has no photo.`,
      );
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
    // Parse before calling: parseMoneyInput understands "12m" / "8,500,000"
    // and returns null for anything unparseable, so we never send NaN.
    const parsed = parseMoneyInput(editPrice);
    if (!editName.trim()) {
      toast.error("Enter a valid name.");
      return;
    }
    if (parsed === null || !Number.isFinite(Number(parsed))) {
      toast.error("Enter a valid price (e.g. 12m or 8,500,000).");
      return;
    }
    setUpdating(true);
    try {
      // Partial update — only the fields in the edit form are sent.
      const result = await updatePlayer({
        id: editing,
        name: editName.trim(),
        house: editHouse,
        position: editPosition,
        price: Number(parsed),
      });
      toast.success(
        result.changed.length > 0
          ? `Player updated successfully — ${result.changed.join(", ")}.`
          : "Player updated successfully.",
      );
      setEditing(null);
    } catch (err) {
      // The server returns friendly, human-readable validation messages.
      toast.error(
        `Failed to update player: ${err instanceof Error ? err.message : "Invalid input"}`,
      );
    } finally {
      setUpdating(false);
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
            <div>
              {/* Bulk availability update — Super Admin only. */}
              {isSuper && (
                <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-border/70 bg-secondary/30 p-3">
                  <div className="grid gap-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">House</Label>
                    <Select value={bulkHouse} onValueChange={setBulkHouse}>
                      <SelectTrigger className="h-8 w-36 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All houses</SelectItem>
                        {HOUSES.map((h) => (
                          <SelectItem key={h} value={h}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">
                      Mark as
                    </Label>
                    <Select value={bulkStatus} onValueChange={setBulkStatus}>
                      <SelectTrigger className="h-8 w-44 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Default (Expected to Start)</SelectItem>
                        {STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button size="sm" variant="outline" onClick={handleBulkStatus} disabled={bulkBusy}>
                    {bulkBusy ? (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    ) : (
                      <Users className="mr-1.5 size-3.5" />
                    )}
                    Apply to {bulkHouse === "all" ? "everyone" : bulkHouse}
                  </Button>
                  <p className="text-muted-foreground w-full text-[11px] leading-snug">
                    Status badges appear on every player card in the market, on the
                    squad-builder pitch, and in the match control center.
                  </p>
                </div>
              )}
              <div className="max-h-[520px] overflow-y-auto overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>House</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    {isSuper && <TableHead className="w-40">Status</TableHead>}
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
                        {/* Status is edited inline via its own select below. */}
                        {isSuper && <TableCell />}
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleUpdate}
                              disabled={
                                updating ||
                                !editName.trim() ||
                                parseMoneyInput(editPrice) === null
                              }
                              title={
                                updating
                                  ? "Saving…"
                                  : !editName.trim() || parseMoneyInput(editPrice) === null
                                    ? "Enter a valid name and price first"
                                    : "Save changes"
                              }
                            >
                              {updating ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Save className="size-3.5" />
                              )}
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
                        {isSuper && (
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <StatusBadge status={p.statusLabel} short />
                              <Select
                                value={p.statusLabel ?? NONE}
                                onValueChange={(v) => handleSetStatus(p, v)}
                                disabled={statusBusy === p._id}
                              >
                                <SelectTrigger
                                  className="h-7 w-32 text-[11px]"
                                  aria-label={`Set status for ${p.name}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NONE}>Default</SelectItem>
                                  {STATUS_OPTIONS.map((s) => (
                                    <SelectItem key={s} value={s}>
                                      {s}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </TableCell>
                        )}
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
                            {isSuper && (
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
                <Label htmlFor="player-image" className="flex items-center justify-between gap-2">
                  <span>Image URL</span>
                  {/* Direct removal — Super Admin only (server-enforced).
                      Clears the stored photo immediately; every avatar on the
                      page falls back to the initials/position disc. */}
                  {imgFor?.image && isSuper ? (
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      disabled={imgBusy}
                      title="Remove this player's photo (Super Admin only)"
                      className="text-destructive inline-flex items-center gap-1 text-[11px] font-semibold underline-offset-2 hover:underline disabled:opacity-50"
                    >
                      <Trash2 className="size-3" />
                      Remove photo
                    </button>
                  ) : null}
                </Label>
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
              press Save to clear the photo. Removing it falls back to the default
              initials/position avatar everywhere — pitch cards, market and lineups.
            </p>
          </div>
          <DialogFooter>
            {imgFor?.image && isSuper ? (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={handleRemoveImage}
                disabled={imgBusy}
              >
                {imgBusy ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="mr-1.5 size-3.5" />
                )}
                Remove photo
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

/**
 * Inline PK editor for an already-recorded knockout fixture.
 *
 * Renders nothing unless the match is a knockout that finished level on
 * goals — the only state a shootout can apply to. Every failure path
 * (tied PK scores, server rejection) surfaces as a toast rather than an
 * exception, because the mutation returns {ok,error} rather than throwing.
 */
function RecordedShootoutEditor({
  match,
  onSave,
  onClear,
}: {
  match: {
    _id: string;
    stage: string;
    homeHouse: any;
    awayHouse: any;
    homeGoals: number;
    awayGoals: number;
    homePenaltiesScore?: number | null;
    awayPenaltiesScore?: number | null;
  };
  onSave: (home: number, away: number) => Promise<any>;
  onClear: () => Promise<any>;
}) {
  const eligible = isKnockoutMatch(match) && match.homeGoals === match.awayGoals;
  const [open, setOpen] = useState(false);
  const [home, setHome] = useState(String(match.homePenaltiesScore ?? ""));
  const [away, setAway] = useState(String(match.awayPenaltiesScore ?? ""));
  const [busy, setBusy] = useState(false);

  if (!eligible) return null;

  const h = parseInt(home, 10);
  const a = parseInt(away, 10);
  const error = validatePenaltyShootout({
    stage: match.stage as any,
    homeGoals: match.homeGoals,
    awayGoals: match.awayGoals,
    homePenaltiesScore: home === "" ? null : h,
    awayPenaltiesScore: away === "" ? null : a,
  });
  const hasShootout =
    match.homePenaltiesScore != null && match.awayPenaltiesScore != null;

  const submit = async () => {
    if (error || Number.isNaN(h) || Number.isNaN(a)) {
      toast.error(error ?? "Enter both penalty scores.");
      return;
    }
    setBusy(true);
    try {
      const res = await onSave(h, a);
      if (res && res.ok) {
        toast.success("Match result saved with penalty shootout outcome!");
        setOpen(false);
      } else {
        toast.error(res?.error ?? "Could not save the penalty shootout.");
      }
    } catch (err) {
      console.error("Failed to save penalty shootout:", err);
      toast.error(
        err instanceof Error ? err.message : "Could not save the penalty shootout.",
      );
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      const res = await onClear();
      if (res && res.ok) {
        toast.success("Penalty shootout cleared.");
        setHome("");
        setAway("");
        setOpen(false);
      } else {
        toast.error(res?.error ?? "Could not clear the penalty shootout.");
      }
    } catch (err) {
      console.error("Failed to clear penalty shootout:", err);
      toast.error(
        err instanceof Error ? err.message : "Could not clear the penalty shootout.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 hover:text-amber-300"
      >
        <Trophy className="size-3" />
        {hasShootout ? "Edit shootout" : "Record shootout"}
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {match.homeHouse} PK
          </Label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={20}
            value={home}
            onChange={(e) => setHome(e.target.value)}
            className="h-9"
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {match.awayHouse} PK
          </Label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={20}
            value={away}
            onChange={(e) => setAway(e.target.value)}
            className="h-9"
          />
        </div>
      </div>
      {error && <p className="text-destructive mt-1 text-[11px]">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button size="sm" onClick={submit} disabled={busy || !!error}>
          {busy ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
          Save shootout
        </Button>
        {hasShootout && (
          <Button size="sm" variant="ghost" onClick={clear} disabled={busy}>
            Clear
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function MatchesTab() {
  const playersResult = useQuery(api.players.listPlayers);
  const matchesResult = useQuery(api.matches.listMatches);
  const players = playersResult ?? [];
  const matches = matchesResult ?? [];
  const saveMatch = useMutation(api.matches.saveMatch);
  const recordPenaltyShootout = useMutation(api.matches.recordPenaltyShootout);
  const scheduleMatch = useMutation(api.matches.scheduleMatch);
  const deleteMatch = useMutation(api.matches.deleteMatch);
  const setMatchStatus = useMutation(api.matches.setMatchStatus);

  const [stage, setStage] = useState<Stage>("semifinal1");
  const [homeHouse, setHomeHouse] = useState<House>("Fire");
  const [awayHouse, setAwayHouse] = useState<House>("Earth");
  const [homeGoals, setHomeGoals] = useState("0");
  const [awayGoals, setAwayGoals] = useState("0");
  // Penalty shootout draft. `shootoutOn` is the admin's explicit toggle;
  // the PK fields only render when it is on AND the stage is a knockout.
  const [shootoutOn, setShootoutOn] = useState(false);
  const [homePk, setHomePk] = useState("");
  const [awayPk, setAwayPk] = useState("");
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

  // Knockout + level-on-goals is the only situation a shootout applies to.
  const stageIsKnockout = isKnockoutStage(stage);
  const goalsLevel = parseInt(homeGoals, 10) === parseInt(awayGoals, 10);
  const shootoutEligible = stageIsKnockout && goalsLevel;
  // Turning the toggle off (or switching to a group fixture) must drop a
  // stale PK entry rather than submit it.
  const shootoutActive = shootoutOn && shootoutEligible;

  // Client-side mirror of the server rule so the admin sees the exact
  // rejection reason before spending a round trip. The server re-validates;
  // this is UX, not the security boundary.
  const penaltyProblem = shootoutActive
    ? validatePenaltyShootout({
        stage,
        homeGoals: parseInt(homeGoals, 10) || 0,
        awayGoals: parseInt(awayGoals, 10) || 0,
        homePenaltiesScore: homePk === "" ? null : parseInt(homePk, 10),
        awayPenaltiesScore: awayPk === "" ? null : parseInt(awayPk, 10),
      })
    : null;

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
    if (penaltyProblem) {
      toast.error(penaltyProblem);
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
        homePenaltiesScore: shootoutActive
          ? parseInt(homePk, 10) || 0
          : undefined,
        awayPenaltiesScore: shootoutActive
          ? parseInt(awayPk, 10) || 0
          : undefined,
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
      toast.success(
        shootoutActive
          ? "Match result saved with penalty shootout outcome!"
          : "Match saved — fantasy points have been distributed.",
      );
      setLines([]);
      setPotmPlayerId("");
      setShootoutOn(false);
      setHomePk("");
      setAwayPk("");
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

            {/* ── Penalty shootout ──
                Only a knockout fixture that finished level on goals can go
                to penalties. The toggle is disabled (with a reason) until
                both conditions hold, so an admin can never submit a
                shootout that the server will reject. */}
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Trophy className="size-4 text-amber-400" />
                  <Label className="text-sm font-semibold">Penalty shootout</Label>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">
                    {!stageIsKnockout
                      ? "Knockout fixtures only"
                      : !goalsLevel
                        ? "Available once the score is level"
                        : shootoutActive
                          ? "Shootout recorded"
                          : "Ready"}
                  </span>
                  <Switch
                    checked={shootoutActive}
                    disabled={!shootoutEligible}
                    onCheckedChange={(v) => {
                      setShootoutOn(v);
                      if (!v) {
                        setHomePk("");
                        setAwayPk("");
                      }
                    }}
                    aria-label="Toggle penalty shootout"
                  />
                </div>
              </div>

              {shootoutActive && (
                <div className="mt-3 space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    {numInput(homePk, setHomePk, `${homeHouse} PK`)}
                    {numInput(awayPk, setAwayPk, `${awayHouse} PK`)}
                  </div>
                  {/* Derived winner preview — advisory only; the server
                      recomputes and stores penaltyWinnerId itself. */}
                  {!penaltyProblem &&
                  homePk !== "" &&
                  awayPk !== "" &&
                  parseInt(homePk, 10) !== parseInt(awayPk, 10) && (
                    <p className="text-xs font-semibold text-amber-200">
                      {parseInt(homePk, 10) > parseInt(awayPk, 10)
                        ? `${homeHouse} advances on penalties.`
                        : `${awayHouse} advances on penalties.`}
                    </p>
                  )}
                  {penaltyProblem && (
                    <p className="text-destructive text-xs font-medium">
                      {penaltyProblem}
                    </p>
                  )}
                  <p className="text-muted-foreground text-[11px]">
                    Penalty kicks decide the fixture only. They are not
                    player statistics, so they never award fantasy points.
                  </p>
                </div>
              )}
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
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                    <HouseCrest house={m.homeHouse} size={20} /> {m.homeHouse}{" "}
                    <span className="font-score text-primary">
                      <ScoreLine match={m} />
                    </span>{" "}
                    {m.awayHouse} <HouseCrest house={m.awayHouse} size={20} />
                    <PenaltyBadge match={m} />
                  </p>
                  {/* Inline shootout editor for a recorded knockout that
                      finished level. Uses recordPenaltyShootout, which
                      touches ONLY the shootout fields — it cannot disturb
                      the match report or re-award fantasy points. */}
                  <RecordedShootoutEditor
                    match={m}
                    onSave={async (home, away) => {
                      const res = await recordPenaltyShootout({
                        matchId: m._id,
                        homePenaltiesScore: home,
                        awayPenaltiesScore: away,
                      });
                      return res;
                    }}
                    onClear={async () => {
                      const res = await recordPenaltyShootout({
                        matchId: m._id,
                        clear: true,
                      });
                      return res;
                    }}
                  />
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
  }>;
  const usersLoading = usersResult === undefined;
  const updateUser = useMutation(api.usersAdmin.updateUser);
  const requestPasswordReset = useMutation(api.usersAdmin.requestPasswordReset);
  const deleteUser = useMutation(api.usersAdmin.deleteUserWithCascade);
  const { user: me } = useAuth();

  const [editingId, setEditingId] = useState<Id<"users"> | null>(null);
  const [editTeam, setEditTeam] = useState("");
  const [resetFor, setResetFor] = useState<{ id: Id<"users">; username: string | null } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  // Server-generated temporary password, shown once and never stored anywhere.
  const [tempPassword, setTempPassword] = useState<{ username: string | null; value: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Delete user with cascade (Super Admin) ──
  const [deleteFor, setDeleteFor] = useState<{ id: Id<"users">; username: string | null } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Budgets are a fixed $70m for every manager — there is nothing to override.
  const FIXED_BUDGET = 70_000_000;

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

  const startEdit = (u: { _id: Id<"users">; teamName: string | null }) => {
    setEditingId(u._id);
    setEditTeam(u.teamName ?? "");
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    try {
      await updateUser({
        userId: editingId,
        teamName: editTeam.trim(),
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
    // Defensive client-side parse: never send a malformed credential.
    const trimmed = newPassword.trim();
    if (trimmed !== "" && trimmed.length < 4) {
      toast.error("New password must be at least 4 characters.");
      return;
    }
    setBusy(true);
    try {
      const res = await requestPasswordReset({
        userId: resetFor.id,
        newPassword: trimmed === "" ? undefined : trimmed,
      });
      if (res?.temporaryPassword) {
        setTempPassword({ username: resetFor.username, value: res.temporaryPassword });
        toast.success(`Temporary password generated for @${resetFor.username}.`);
      } else {
        toast.success(`Password reset for @${resetFor.username}. Their sessions were signed out.`);
      }
      setResetFor(null);
      setNewPassword("");
    } catch (err) {
      // Generic, safe toast — no unhandled rejection, UI stays intact.
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Could not reset the password — please try again.",
      );
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
          Edit team names, reset passwords and delete accounts. Every manager shares the
          same fixed $70m starting budget — it is not editable.
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
          // Dense admin table: scrolls INSIDE its own box on narrow screens
          // (`overflow-x-auto`) so the page itself never scrolls sideways and
          // no cell is clipped by the viewport edge.
          <div className="overflow-x-auto">
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
                    <TableCell className="text-right font-score text-xs text-muted-foreground">
                      {formatMoney(FIXED_BUDGET)}
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
                      {formatMoney(FIXED_BUDGET)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => startEdit(u)} title="Edit">
                          <Pencil className="size-3.5" />
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
          </div>
        )}

        {/* Password reset inline panel */}
        {resetFor && (
          <div className="mt-4 rounded-xl border border-primary/40 bg-primary/5 p-4">
            <p className="text-sm font-semibold">
              Reset access for <span className="text-primary">@{resetFor.username}</span>
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Passwords are stored as one-way scrypt hashes — the original can never be read
              back, by anyone. Leave the field blank to generate a strong temporary password,
              or type your own to set a specific one.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Input
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Blank = generate a temporary password"
                type="text"
                autoComplete="off"
                className="sm:max-w-xs"
              />
              <Button onClick={handleReset} disabled={busy}>
                {busy ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <KeyRound className="mr-1.5 size-4" />
                )}
                Reset password
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

        {/* Generated temporary password — shown once, never stored */}
        {tempPassword && (
          <div className="mt-4 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4">
            <p className="text-sm font-semibold text-amber-200">
              Temporary password for @{tempPassword.username}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="font-mono text-base font-bold tracking-wider text-amber-100">
                {tempPassword.value}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  try {
                    void navigator.clipboard?.writeText(tempPassword.value);
                    toast.success("Copied to clipboard.");
                  } catch {
                    toast.error("Could not copy — select and copy it manually.");
                  }
                }}
              >
                Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setTempPassword(null)}>
                Done
              </Button>
            </div>
            <p className="mt-2 text-xs text-amber-200/80">
              Copy it now — it is not saved anywhere and cannot be shown again. Share it with
              the manager over a private channel and ask them to change it after signing in.
            </p>
          </div>
        )}

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
  const FIXED_BUDGET = 70_000_000;
  const setHouseLimit = useMutation(api.config.setHouseLimit);
  const setHouseLogo = useMutation(api.houses.setHouseLogo);
  const clearHouseLogo = useMutation(api.houses.clearHouseLogo);
  const generateLogoUploadUrl = useMutation(api.houses.generateLogoUploadUrl);
  const MAX_LOGO_BYTES = 2_000_000;

  const [houseLimit, setHouseLimitLocal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Which house is mid-upload. Non-null disables that slot's button so a
  // double click can't fire two concurrent mutations.
  const [logoBusy, setLogoBusy] = useState<House | null>(null);

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

  /**
   * Upload a house crest.
   *
   * The file goes straight to Convex FILE STORAGE (via a one-time upload URL)
   * and only the short storage ID is sent to `setHouseLogo`. This is the whole
   * point of the fix: a base64 data URL used to be written into the database
   * row, which cannot fit in a 1 MiB Convex document and crashed the server
   * with an opaque error.
   *
   * Every step is guarded, `logoBusy` disables the slot so a double click
   * can't fire two mutations, and failures surface as a clean toast.
   */
  const uploadLogo = (house: House) => {
    if (logoBusy !== null) return; // a mutation is already in flight
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      // Client-side guard so an oversized file never costs a round trip.
      if (file.size > MAX_LOGO_BYTES) {
        toast.error("Image too large — please use an image under 2 MB.");
        return;
      }
      setLogoBusy(house);
      try {
        const { url } = await generateLogoUploadUrl({ fileType: file.type });
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!res.ok) {
          throw new Error("The image upload did not complete — please retry.");
        }
        const { storageId } = (await res.json()) as { storageId?: unknown };
        const id = typeof storageId === "string" ? storageId.trim() : "";
        if (!id) {
          throw new Error("The upload did not return a file reference.");
        }
        // Only the storage ID travels through the mutation — never the bytes.
        await setHouseLogo({ house, storageId: id });
        toast.success(`${house} logo updated successfully!`);
      } catch (error) {
        console.error("Failed to set house logo:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to update house logo",
        );
      } finally {
        setLogoBusy(null);
      }
    };
    input.click();
  };

  /** Revert a house to its themed default crest. */
  const removeLogo = async (house: House) => {
    if (logoBusy !== null) return;
    setLogoBusy(house);
    try {
      await clearHouseLogo({ house });
      toast.success(`${house} reset to its default crest.`);
    } catch (error) {
      console.error("Failed to clear house logo:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to update house logo",
      );
    } finally {
      setLogoBusy(null);
    }
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
            Every manager builds their 7-a-side squad within the same fixed budget.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-secondary/40 px-4 py-3">
            <Wallet className="text-primary size-5 shrink-0" />
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide">
                Starting budget (fixed)
              </p>
              <p className="font-score text-xl font-bold">{formatMoney(FIXED_BUDGET)}</p>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            This is the tournament-wide cap for every manager — it is not editable and there are
            no per-user overrides.
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
            Upload custom crests — shown across the bracket, match center and
            leaderboards. Images are stored in Convex file storage (max 2 MB), so
            a large crest can't overload the database. Remove one to fall back
            to the themed default crest.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          {HOUSES.map((house) => (
            <HouseLogoSlot
              key={house}
              house={house}
              onUpload={() => uploadLogo(house)}
              onClear={() => void removeLogo(house)}
              busy={logoBusy === house}
              disabled={logoBusy !== null && logoBusy !== house}
            />
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
  photoRequests,
  photoRequestsLoading,
  onReviewPhoto,
  isSuper,
  purchases,
  purchasesLoading,
  onApprovePurchase,
  onRejectPurchase,
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
  photoRequests: PhotoRequest[];
  photoRequestsLoading: boolean;
  onReviewPhoto: (
    requestId: Id<"photoRequests">,
    decision: "approve" | "deny",
  ) => void;
  isSuper: boolean;
  purchases: Purchase[];
  purchasesLoading: boolean;
  onApprovePurchase: (purchaseId: Id<"purchases">) => void;
  onRejectPurchase: (purchaseId: Id<"purchases">) => void;
}) {
  const parsedAdjust = parseMoneyInput(adjustPrice);
  const adjustValid = parsedAdjust !== null && parsedAdjust >= 0;

  const pending = requests.filter((r) => r.status === "pending");
  const reviewed = requests.filter((r) => r.status !== "pending");
  const photoPending = photoRequests.filter((r) => r.status === "pending");
  const photoReviewed = photoRequests.filter((r) => r.status !== "pending");
  const purchasePending = purchases.filter((r) => r.status === "pending");
  const purchaseReviewed = purchases.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-4">
      {/* ── Pending micro-transactions (store, manual cash, max 10 AED) ── */}
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <HandCoins className="text-primary size-4" /> Pending micro-transactions
            {purchasePending.length > 0 && (
              <Badge className="border border-amber-400/40 bg-amber-400/20 px-1.5 text-[10px] text-amber-300">
                {purchasePending.length}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Managers pay you cash in person, then file a request. Approving flips
            the transaction and grants the perk automatically. Hard ceiling:{" "}
            <span className="text-foreground font-semibold">
              {MAX_PRICE_AED} AED
            </span>{" "}
            per item.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {purchasesLoading ? (
            <p className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
              <Loader2 className="size-4 animate-spin" /> Loading transactions…
            </p>
          ) : purchasePending.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No pending transactions right now.
            </p>
          ) : (
            <div className="space-y-3">
              {purchasePending.map((p) => (
                <div
                  key={p._id}
                  className="rounded-xl border border-border/70 bg-secondary/40 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <AdminAvatar username={p.username} image={p.avatar} />
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                          <span>@{p.username || "unknown"}</span>
                          <span className="text-muted-foreground font-normal">
                            wants
                          </span>
                          <span className="text-primary">{p.itemName}</span>
                        </p>
                        <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-score font-bold text-foreground">
                            {p.priceAED} AED
                          </span>
                          <span>· requested {formatWhen(p.createdAt)}</span>
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className="border border-amber-400/40 bg-amber-400/15 text-[10px] text-amber-300 uppercase"
                    >
                      pending
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={!isSuper}
                      title={
                        isSuper
                          ? "Confirm cash received and grant the item"
                          : "Only the Super Admin can approve purchases"
                      }
                      onClick={() => onApprovePurchase(p._id)}
                    >
                      <CheckCircle2 className="mr-1.5 size-3.5" /> Accept &amp; grant
                      item
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      disabled={!isSuper}
                      title={
                        isSuper
                          ? "Reject — no items or stats change"
                          : "Only the Super Admin can reject purchases"
                      }
                      onClick={() => onRejectPurchase(p._id)}
                    >
                      <XCircle className="mr-1.5 size-3.5" /> Reject request
                    </Button>
                  </div>
                  {!isSuper && (
                    <p className="text-muted-foreground mt-2 text-[11px]">
                      Waiting on the Super Admin (Zein) to confirm the cash.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {purchaseReviewed.length > 0 && (
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="font-display text-sm font-bold uppercase tracking-widest">
              Transactions settled
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {purchaseReviewed.slice(0, 25).map((p) => (
              <div
                key={p._id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-secondary/30 px-3 py-2"
              >
                <p className="text-sm">
                  <span className="font-semibold">{p.itemName}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    for @{p.username || "unknown"}
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  <span className="font-score text-xs font-bold">{p.priceAED} AED</span>
                  <Badge
                    className={
                      p.status === "approved"
                        ? "border border-emerald-400/40 bg-emerald-400/15 text-[10px] text-emerald-300 uppercase"
                        : "text-[10px] uppercase"
                    }
                  >
                    {p.status}
                  </Badge>
                  {p.decidedBy ? (
                    <span className="text-muted-foreground text-[11px]">
                      by {p.decidedBy}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Photo removal requests (manager-reported, Super Admin decides) ── */}
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <ImagePlus className="text-primary size-4" /> Photo removal requests
            {photoPending.length > 0 && (
              <Badge className="border border-amber-400/40 bg-amber-400/20 text-amber-300 px-1.5 text-[10px]">
                {photoPending.length}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Managers can flag a player photo as wrong or inappropriate. Approving
            clears the photo instantly — the player falls back to their default
            initials/position avatar everywhere.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {photoRequestsLoading ? (
            <p className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
              <Loader2 className="size-4 animate-spin" /> Loading photo requests…
            </p>
          ) : photoPending.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No pending photo requests right now.
            </p>
          ) : (
            <div className="space-y-3">
              {photoPending.map((r) => (
                <div
                  key={r._id}
                  className="rounded-xl border border-border/70 bg-secondary/40 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <PlayerCellPhoto name={r.playerName} image={r.currentPhoto} />
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                          <span className="text-primary">{r.playerName}</span>
                          <span className="text-muted-foreground font-normal">
                            reported by
                          </span>
                          <span>@{r.username || "unknown"}</span>
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {r.currentPhoto
                            ? "Photo is currently live on this player."
                            : "The photo has already been cleared on this player."}
                        </p>
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-[10px] uppercase">
                      pending
                    </Badge>
                  </div>
                  {r.reason ? (
                    <p className="text-muted-foreground mt-2 rounded-lg border border-border/60 bg-background/40 p-2.5 text-sm italic">
                      “{r.reason}”
                    </p>
                  ) : (
                    <p className="text-muted-foreground mt-2 text-xs italic">
                      No reason given.
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={!isSuper}
                      title={
                        isSuper
                          ? "Approve and clear this player's photo"
                          : "Only the Super Admin can approve photo removals"
                      }
                      onClick={() => onReviewPhoto(r._id, "approve")}
                    >
                      <Trash2 className="mr-1.5 size-3.5" /> Approve removal (clear
                      photo)
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!isSuper}
                      title={
                        isSuper
                          ? "Dismiss — keep the photo"
                          : "Only the Super Admin can dismiss photo requests"
                      }
                      onClick={() => onReviewPhoto(r._id, "deny")}
                    >
                      <XCircle className="mr-1.5 size-3.5" /> Dismiss
                    </Button>
                  </div>
                  {!isSuper && (
                    <p className="text-muted-foreground mt-2 text-[11px]">
                      Waiting on the Super Admin (Zein) to review this request.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {photoReviewed.length > 0 && (
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="font-display text-sm font-bold uppercase tracking-widest">
              Photo requests reviewed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {photoReviewed.map((r) => (
              <div
                key={r._id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-secondary/30 px-3 py-2"
              >
                <p className="text-sm">
                  <span className="font-semibold">{r.playerName}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    for @{r.username || "unknown"}
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="secondary"
                    className={
                      r.status === "approved"
                        ? "border border-emerald-400/40 bg-emerald-400/15 text-[10px] text-emerald-300 uppercase"
                        : "text-[10px] uppercase"
                    }
                  >
                    {r.status}
                  </Badge>
                  {r.decidedBy ? (
                    <span className="text-muted-foreground text-[11px]">
                      by {r.decidedBy}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

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
  // Live badge registry (built-ins + any custom badge the Super Admin
  // created in the Customize tab) so new badges appear here immediately.
  // Safe fallback: an empty/undefined query renders just the built-ins.
  const badgesResult = useQuery(api.adminConfig.listAssignableBadges);
  const badgeOptions = (badgesResult ?? []).filter((b) => typeof b.id === "string" && b.id.length > 0);
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
          // Dense admin table: scrolls INSIDE its own box on narrow screens
          // (`overflow-x-auto`) so the page itself never scrolls sideways and
          // no cell is clipped by the viewport edge.
          <div className="overflow-x-auto">
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
                          {/* Built-ins first, then any admin-created badges. */}
                          {ASSIGNABLE_BADGE_KEYS.map((key) => {
                            const meta = BADGE_META[key];
                            if (!meta) return null;
                            return (
                              <SelectItem key={key} value={key}>
                                {meta.glyph} {meta.label}
                              </SelectItem>
                            );
                          })}
                          {badgeOptions
                            .filter(
                              (b) =>
                                !(ASSIGNABLE_BADGE_KEYS as readonly string[]).includes(b.id),
                            )
                            .map((b) => (
                              <SelectItem key={b.id} value={b.id}>
                                {b.emoji} {b.label}
                              </SelectItem>
                            ))}
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Maintenance mode controls (super admin only) ─────────────────────

/**
 * Live editing of the maintenance screen copy + the Instagram contact link,
 * so the lock screen can be rewritten without a code change. Mirrors the UI
 * text editor in the Customize tab but sits next to the toggle itself, which
 * is where it is actually needed while the platform is down.
 */
function MaintenanceCopyEditor() {
  const { uiText, instagramUrl, loading } = useAdminConfig();
  const setUiText = useMutation(api.adminConfig.setUiText);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);

  const value = (key: string) =>
    draft?.[key] ?? (uiText as unknown as Record<string, string>)[key] ?? "";

  const save = async () => {
    const title = value("maintenanceTitle").trim();
    const message = value("maintenanceMessage").trim();
    const handle = value("instagramHandle").trim().replace(/^@/, "");
    if (title.length === 0 || title.length > 60) {
      toast.error("The maintenance title must be 1-60 characters.");
      return;
    }
    if (message.length === 0 || message.length > 400) {
      toast.error("The maintenance message must be 1-400 characters.");
      return;
    }
    if (handle.length > 0 && !/^[A-Za-z0-9._]{1,40}$/.test(handle)) {
      toast.error("Instagram handles use letters, numbers, dots and underscores only.");
      return;
    }
    setBusy(true);
    try {
      await setUiText({
        maintenanceTitle: title,
        maintenanceMessage: message,
        instagramHandle: handle,
      });
      toast.success("Maintenance screen copy saved.");
      setDraft(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the maintenance copy.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-border/80">
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
          <Megaphone className="text-primary size-4" /> Lock screen copy
        </CardTitle>
        <CardDescription>
          Exactly what non-staff visitors see while maintenance mode is on. The button links to{" "}
          <a
            href={instagramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {uiText.instagramHandle}
          </a>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-1.5">
          <Label htmlFor="maint-title">Screen title</Label>
          <Input
            id="maint-title"
            value={value("maintenanceTitle")}
            onChange={(e) => setDraft((prev) => ({ ...(prev ?? {}), maintenanceTitle: e.target.value }))}
            maxLength={60}
            disabled={loading}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="maint-message">Status message</Label>
          <Textarea
            id="maint-message"
            value={value("maintenanceMessage")}
            onChange={(e) =>
              setDraft((prev) => ({ ...(prev ?? {}), maintenanceMessage: e.target.value }))
            }
            rows={3}
            maxLength={400}
            disabled={loading}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="maint-instagram">Instagram handle</Label>
          <Input
            id="maint-instagram"
            value={value("instagramHandle")}
            onChange={(e) =>
              setDraft((prev) => ({ ...(prev ?? {}), instagramHandle: e.target.value }))
            }
            placeholder="zein.e9"
            maxLength={40}
            disabled={loading}
          />
          <p className="text-muted-foreground text-xs">No @ — it is added for you.</p>
        </div>
        <Button onClick={save} disabled={busy || loading}>
          {busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Save className="mr-1.5 size-4" />}
          Save lock screen copy
        </Button>
      </CardContent>
    </Card>
  );
}

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

/**
 * One house's crest slot in the Settings tab.
 *
 * `HouseCrest` already falls back to the themed initials crest when the URL is
 * missing, blank or fails to load, so there is no broken-image path here. A
 * `Clear` action is only offered once a custom crest exists.
 */
function HouseLogoSlot({
  house,
  onUpload,
  onClear,
  busy,
  disabled,
}: {
  house: House;
  onUpload: () => void;
  onClear: () => void;
  /** This slot has a mutation in flight. */
  busy: boolean;
  /** Another slot is busy — keep the layout stable, just block the click. */
  disabled: boolean;
}) {
  const logos = useQuery(api.houses.listHouseLogos);
  // Null-safe: `logos` is undefined while loading and a missing key is null.
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
      <div className="flex shrink-0 items-center gap-1">
        {custom && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onClear}
            disabled={disabled || busy}
            title={`Reset ${house} to its default crest`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={onUpload}
          disabled={disabled || busy}
          title={custom ? `Replace ${house} crest` : `Upload ${house} crest`}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Plus className="size-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}
