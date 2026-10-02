import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppNav } from "@/components/AppNav";
import { PitchView } from "@/components/PitchView";
import { HouseBadge, PositionChip } from "@/components/houses";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney, safeBudget, toSafeAmount } from "@/convex/configDefaults";
import { avatarPresetUrl } from "@/lib/fantasy";
import { UserBadges } from "@/components/UserBadge";
import { AboutCreditsModal, AboutCreditsTrigger } from "@/components/AboutCreditsModal";
import { AvatarPicker } from "@/components/AvatarPicker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { PageLoading } from "@/components/PageLoading";
import { toast } from "sonner";
import { Camera, Crown, Flame, Loader2, Save, Star, Zap } from "lucide-react";
import { useEffect, useState } from "react";

export default function Profile() {
  const { user, isLoading: authLoading } = useAuth();
  const mySquadResult = useQuery(api.squads.getMySquad);
  // Store cosmetics + the "Custom Manager Title" editor (server-gated).
  const store = useQuery(api.transactions.getStore);
  const setCustomTitle = useMutation(api.transactions.setCustomTitle);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleBusy, setTitleBusy] = useState(false);
  // Defensive: the query can be undefined / partial while loading.
  const ownedCosmetics = new Set(
    (store?.items ?? [])
      .filter((i) => i.owned && i.unlocked && i.toggleable)
      .map((i) => i.id),
  );
  const hasGoldTheme = ownedCosmetics.has("golden_theme");

  // Hydrate the title editor once the user row arrives (effect, never
  // render-phase setState). Keyed on the id so it re-syncs if the row changes.
  useEffect(() => {
    if (user) setTitleDraft(user.customTitle ?? "");
  }, [user?._id]); // eslint-disable-line react-hooks/exhaustive-deps
  const myStatsResult = useQuery(api.managers.getMyStats);
  const config = useQuery(api.config.getConfig);
  const updateProfile = useMutation(api.managers.updateProfile);

  const mySquad = mySquadResult ?? null;
  const myStats = myStatsResult ?? null;
  const loading = authLoading || mySquadResult === undefined || myStatsResult === undefined;

  const [teamName, setTeamName] = useState("");
  const [avatar, setAvatar] = useState<string>("");
  const [favoritePlayerId, setFavoritePlayerId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);

  const playersResult = useQuery(api.players.listPlayers);
  const playerChoices = playersResult ?? [];

  useEffect(() => {
    if (user && !loaded) {
      setTeamName(user.teamName ?? "");
      // Mirror the stored avatar value (preset id OR upload URL).
      setAvatar(user.image ?? "");
      setFavoritePlayerId(user.favoritePlayerId ?? "");
      setLoaded(true);
    }
  }, [user, loaded]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({
        teamName: teamName.trim(),
        favoritePlayerId: favoritePlayerId || undefined,
      });
      toast.success("Profile updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update profile.");
    } finally {
      setSaving(false);
    }
  };

  const squadPlayers = mySquad?.players ?? [];
  const byPosition = squadPlayers.reduce(
    (acc, p) => {
      (acc[p.position] ??= []).push({
        playerId: p._id,
        name: p.name,
        position: p.position,
        house: p.house,
        image: p.image ?? null,
        isCaptain: mySquad?.captainId === p._id,
        statusLabel: p.statusLabel ?? null,
      });
      return acc;
    },
    {} as Record<string, Array<{
      playerId: string;
      name: string;
      position: string;
      house: string;
      image: string | null;
      isCaptain: boolean;
      statusLabel: string | null;
    }>>,
  );

  // Preset id -> generated SVG; upload -> its own URL; nothing -> undefined
  // so the Avatar's fallback initials render.
  const avatarSrc =
    avatarPresetUrl(avatar) ??
    (avatar.startsWith("http") || avatar.startsWith("data:") ? avatar : undefined);

  return (
    <AppNav>
      {loading ? (
        <PageLoading label="Loading profile…" />
      ) : (
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Profile editor */}
        <Card className="card-sheen border-border/80 lg:col-span-1">
          <CardHeader>
            <CardTitle className="font-display text-lg font-bold uppercase tracking-wide">
              Manager profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              {/* Store cosmetic: "Custom Profile Border" — animated glowing
                  fire frame, only while the perk is switched on. */}
              <span
                className={cn(
                  "inline-flex shrink-0 rounded-full",
                  ownedCosmetics.has("profile_border") &&
                    "animate-pulse ring-2 ring-orange-400/80 shadow-[0_0_18px_rgba(249,115,22,0.55)]",
                )}
              >
                <Avatar className="size-16">
                  <AvatarImage
                    src={avatarSrc}
                    alt="avatar"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.visibility = "hidden";
                    }}
                  />
                  <AvatarFallback className="bg-primary/20 text-primary font-bold">
                    {(user?.username ?? "?").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </span>
              <div>
                <p className="flex items-center gap-1.5 font-semibold">
                  <span className="truncate">@{user?.username}</span>
                  {/* Role checkmark + custom badge (profile header). */}
                  <UserBadges
                    sizeClass="size-4"
                    role={user?.role ?? null}
                    customBadge={user?.customBadge ?? null}
                  />
                </p>
                <p className="text-muted-foreground text-sm">
                  {user?.role === "super_admin"
                    ? "Super Admin"
                    : user?.role === "moderator"
                      ? "Moderator Admin"
                      : "Fantasy Manager"}
                </p>
                {/* Discreet credits entry point — Profile page only. */}
                <AboutCreditsTrigger onOpen={() => setCreditsOpen(true)} />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="teamName">Team name</Label>
              <Input
                id="teamName"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                maxLength={40}
              />
            </div>

            <div className="grid gap-2">
              <Label>Favorite player</Label>
              <Select
                value={favoritePlayerId || "none"}
                onValueChange={(v) => setFavoritePlayerId(v === "none" ? "" : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick your favorite player" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="none">None (N/A)</SelectItem>
                  {playerChoices.map((p) => (
                    <SelectItem key={p._id} value={String(p._id)}>
                      {p.name} · {p.house} {p.position}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Shown next to your team on the global leaderboard.
              </p>
            </div>

            <div className="grid gap-2">
              <Label>Profile picture</Label>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPickerOpen(true)}
                className="w-full"
              >
                <Camera className="mr-1.5 size-4" /> Edit profile picture
              </Button>
              <p className="text-muted-foreground text-xs">
                Pick a preset (house crests, football icons, mascots) or upload
                your own image (max 2MB).
              </p>
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Save className="mr-1.5 size-4" />}
              Save profile
            </Button>

            <div className="border-border/70 grid grid-cols-2 gap-3 rounded-xl border bg-secondary/40 p-3 text-center">
              <div>
                <p className="text-muted-foreground text-xs uppercase">Total pts</p>
                <p className="font-score text-xl font-bold">{myStats?.totalPoints ?? 0}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase">Rank</p>
                <p className="font-score text-xl font-bold">
                  {myStats?.rank ? `#${myStats.rank}` : "—"}
                </p>
              </div>
            </div>

            {/* ── Store perks ── */}
            <div className="border-border/70 space-y-3 rounded-xl border bg-secondary/30 p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest">
                <Crown className="text-primary size-3.5" /> My store perks
              </p>
              {(store?.items ?? []).filter((i) => i.owned).length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No perks yet — buy them in the store for cash.
                </p>
              ) : (
                <ul className="space-y-1">
                  {(store?.items ?? [])
                    .filter((i) => i.owned)
                    .map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate">{i.name}</span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                            i.unlocked
                              ? "bg-emerald-400/15 text-emerald-300"
                              : "bg-secondary text-muted-foreground",
                          )}
                        >
                          {i.unlocked ? "Active" : "Off"}
                        </span>
                      </li>
                    ))}
                </ul>
              )}

              {/* Custom title editor — only shown once the perk is unlocked. */}
              {ownedCosmetics.has("custom_title") || user?.role === "super_admin" ? (
                <div className="grid gap-1.5 border-t border-border/60 pt-3">
                  <Label htmlFor="customTitle" className="text-xs">
                    Custom manager title
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="customTitle"
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      placeholder="e.g. Boss of the Bosses"
                      maxLength={24}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={titleBusy}
                      onClick={async () => {
                        setTitleBusy(true);
                        try {
                          const res = await setCustomTitle({ title: titleDraft });
                          setTitleDraft(res.customTitle ?? "");
                          toast.success(
                            res.customTitle
                              ? `Title saved: ${res.customTitle}`
                              : "Title cleared.",
                          );
                        } catch (err) {
                          toast.error(
                            err instanceof Error
                              ? err.message
                              : "Could not save your title.",
                          );
                        } finally {
                          setTitleBusy(false);
                        }
                      }}
                    >
                      {titleBusy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                    </Button>
                  </div>
                  <p className="text-muted-foreground text-[11px]">
                    Shown next to your team name on the leaderboard (max 24
                    characters).
                  </p>
                </div>
              ) : null}

              {/* Quick visual cues for the two cosmetic perks. */}
              {hasGoldTheme || ownedCosmetics.has("profile_border") ? (
                <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3 text-[11px]">
                  {hasGoldTheme ? (
                    <span className="flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-amber-300">
                      <Zap className="size-3" /> Gold pitch active
                    </span>
                  ) : null}
                  {ownedCosmetics.has("profile_border") ? (
                    <span className="flex items-center gap-1 rounded-full border border-orange-400/40 bg-orange-400/10 px-2 py-0.5 text-orange-300">
                      <Flame className="size-3" /> Fire border active
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* Squad view */}
        <div className="space-y-6 lg:col-span-2">
          <Card className="card-sheen border-border/80">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="font-display text-lg font-bold uppercase tracking-wide">
                  {user?.teamName ?? "My squad"}
                </CardTitle>
                <p className="text-muted-foreground text-sm">
                  {mySquad
                    ? `${squadPlayers.length} players · ${formatMoney(mySquad.totalSpent)} spent`
                    : "No squad picked yet"}
                </p>
              </div>
              <p className="font-score text-muted-foreground text-sm font-semibold">
                Budget left:{" "}
                <span className="text-emerald-400">
                  {formatMoney(
                    Math.max(safeBudget(config?.budget) - toSafeAmount(mySquad?.totalSpent), 0),
                  )}
                </span>
              </p>
            </CardHeader>
            <CardContent>
              <div className="mx-auto max-w-lg">
                <PitchView
                  byPosition={byPosition}
                  emptyLabel="Pick"
                  formation={mySquad?.formation ?? "2-3-1"}
                  showStatus
                  showFormationLabel
                />
              </div>
            </CardContent>
          </Card>

          {mySquad && (
            <Card className="border-border/80">
              <CardHeader>
                <CardTitle className="font-display text-sm font-bold uppercase tracking-widest">
                  Squad list
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {squadPlayers.map((p) => (
                  <div
                    key={p._id}
                    className="flex items-center justify-between rounded-xl border border-border/70 bg-secondary/40 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      {mySquad.captainId === p._id && (
                        <span className="flex size-6 items-center justify-center rounded-full bg-amber-400/20 text-xs font-bold text-amber-300">
                          <Star className="size-3.5" />
                        </span>
                      )}
                      <span className="text-sm font-semibold">{p.name}</span>
                    </div>
                    <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                      <HouseBadge house={p.house} className="hidden sm:inline-flex" />
                      <PositionChip position={p.position} />
                      {formatMoney(p.price)}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      )}
      <AvatarPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        currentAvatarId={avatar || null}
        username={user?.username ?? null}
        role={user?.role ?? null}
      />
      {/* About & Credits — discreet modal, Profile page only. */}
      <AboutCreditsModal open={creditsOpen} onOpenChange={setCreditsOpen} />
    </AppNav>
  );
}
