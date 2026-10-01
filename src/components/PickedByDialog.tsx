import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { avatarPresetUrl } from "@/lib/fantasy";
import { UserBadges } from "./UserBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, UserRound } from "lucide-react";
import { useEffect } from "react";

/**
 * Manager pick inspection dialog — lists every manager with this player in
 * their starting 7. Strictly defensive:
 *  - query result defaults to [] (loading, error and empty DB all degrade);
 *  - avatar URLs fail silently to initials;
 *  - an empty list shows an animated empty state, never a crash.
 */
export function PickedByDialog({
  player,
  open,
  onOpenChange,
}: {
  player: { _id: Id<"players">; name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Safe fallback per spec: `?? []` — loading, error and empty DB all render
  // as an empty list. "skip" keeps the per-player query off the wire while
  // the dialog is closed. `managersRaw === undefined` = still loading.
  const managersRaw = useQuery(
    api.squads.getManagersWhoPickedPlayer,
    player && open ? { playerId: player._id } : "skip",
  );
  const managers = managersRaw ?? [];
  const loading = player !== null && open && managersRaw === undefined;

  // Auto-close if the underlying player disappears (deleted mid-open).
  useEffect(() => {
    if (open && !player) onOpenChange(false);
  }, [open, player, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="text-primary size-4" />
            Managers who picked
            <span className="text-primary truncate">{player?.name ?? "this player"}</span>
          </DialogTitle>
          <DialogDescription>
            Every manager with {player?.name ?? "this player"} in their starting 7.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
          {managers.length === 0 && !loading ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="text-2xl">🔍</span>
              <p className="text-muted-foreground animate-pulse text-sm font-medium">
                No managers have picked this player yet.
              </p>
              <p className="text-muted-foreground/60 text-xs">
                Be the first to draft them — a true differential.
              </p>
            </div>
          ) : managers.length === 0 && loading ? (
            <p className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
              <Loader2 className="size-4 animate-spin" /> Loading managers…
            </p>
          ) : (
            managers.map((m) => {
              const src =
                m.profilePic &&
                (m.profilePic.startsWith("http") || m.profilePic.startsWith("data:"))
                  ? m.profilePic
                  : avatarPresetUrl(m.profilePic);
              return (
                <div
                  key={String(m.userId)}
                  className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-secondary/40 px-3 py-2"
                >
                  <Avatar className="size-8">
                    <AvatarImage
                      src={src ?? undefined}
                      alt={m.username}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.visibility = "hidden";
                      }}
                    />
                    <AvatarFallback className="bg-primary/20 text-primary text-[10px] font-bold">
                      {m.username.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      <span className="truncate">{m.teamName}</span>
                      <UserBadges role={m.role} customBadge={m.customBadge} sizeClass="size-3.5" />
                    </p>
                    <p className="text-muted-foreground truncate text-xs">@{m.username}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
