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
import { formatMoney } from "@/convex/configDefaults";
import { avatarPresetUrl } from "@/lib/fantasy";
import { AvatarPicker } from "@/components/AvatarPicker";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { PageLoading } from "@/components/PageLoading";
import { toast } from "sonner";
import { Camera, Loader2, Save, Star } from "lucide-react";
import { useEffect, useState } from "react";

export default function Profile() {
  const { user, isLoading: authLoading } = useAuth();
  const mySquadResult = useQuery(api.squads.getMySquad);
  const myStatsResult = useQuery(api.managers.getMyStats);
  const config = useQuery(api.config.getConfig);
  const updateProfile = useMutation(api.managers.updateProfile);

  const mySquad = mySquadResult ?? null;
  const myStats = myStatsResult ?? null;
  const loading = authLoading || mySquadResult === undefined || myStatsResult === undefined;

  const [teamName, setTeamName] = useState("");
  const [avatar, setAvatar] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (user && !loaded) {
      setTeamName(user.teamName ?? "");
      // Mirror the stored avatar value (preset id OR upload URL).
      setAvatar(user.image ?? "");
      setLoaded(true);
    }
  }, [user, loaded]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({ teamName: teamName.trim() });
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
        isCaptain: mySquad?.captainId === p._id,
      });
      return acc;
    },
    {} as Record<string, Array<{
      playerId: string;
      name: string;
      position: string;
      house: string;
      isCaptain: boolean;
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
              <div>
                <p className="font-semibold">@{user?.username}</p>
                <p className="text-muted-foreground text-sm">
                  {user?.role === "super_admin"
                    ? "Super Admin"
                    : user?.role === "moderator"
                      ? "Moderator Admin"
                      : "Fantasy Manager"}
                </p>
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
                  {formatMoney(Math.max((config?.budget ?? 0) - (mySquad?.totalSpent ?? 0), 0))}
                </span>
              </p>
            </CardHeader>
            <CardContent>
              <div className="mx-auto max-w-lg">
                <PitchView byPosition={byPosition} emptyLabel="Pick" />
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
    </AppNav>
  );
}
