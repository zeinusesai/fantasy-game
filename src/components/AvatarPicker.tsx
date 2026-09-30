import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AVATAR_PRESETS, avatarPresetUrl } from "@/lib/fantasy";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Crown,
  ImageUp,
  Loader2,
  Shield,
  UserRound,
  Users2,
} from "lucide-react";

const GROUP_LABELS: Record<string, string> = {
  houses: "House Emblems",
  footballers: "Football Icons",
  icons: "Sport & Abstract",
  mascots: "Mascots",
};

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_BYTES = 2 * 1024 * 1024; // 2MB — mirrors the server-side cap

type UploadState =
  | { phase: "idle" }
  | { phase: "error"; message: string }
  | { phase: "ready"; storageId: string; previewUrl: string; name: string }
  | { phase: "uploading" }
  | { phase: "saving" };

/**
 * Edit Profile Picture modal. Tab 1 picks a validated preset; Tab 2 uploads a
 * custom image (type + 2MB validated client-side, re-validated server-side).
 * Every mutation call is try/catch-wrapped with clean toasts.
 */
export function AvatarPicker({
  open,
  onOpenChange,
  currentAvatarId,
  username,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentAvatarId: string | null | undefined;
  username: string | null | undefined;
  role: string | null | undefined;
}) {
  const updateAvatar = useMutation(api.managers.updateAvatar);
  const getUploadUrl = useMutation(api.managers.generateAvatarUploadUrl);
  const finalizeUpload = useMutation(api.managers.finalizeAvatarUpload);

  const [selected, setSelected] = useState<string | null>(currentAvatarId ?? null);
  const [upload, setUpload] = useState<UploadState>({ phase: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const roleBadge =
    role === "super_admin" ? (
      <Badge className="bg-primary text-primary-foreground gap-1">
        <Crown className="size-3" /> Super Admin
      </Badge>
    ) : role === "moderator" ? (
      <Badge variant="outline" className="gap-1">
        <Shield className="size-3" /> Moderator
      </Badge>
    ) : (
      <Badge variant="secondary" className="gap-1">
        <UserRound className="size-3" /> Manager
      </Badge>
    );

  const pickPreset = async (id: string) => {
    setSelected(id);
    try {
      await updateAvatar({ avatarId: id });
      toast.success("Profile picture updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the avatar.");
    }
  };

  const handleFile = (file: File | null | undefined) => {
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setUpload({ phase: "error", message: "Unsupported file — use PNG, JPG, WEBP or GIF." });
      return;
    }
    if (file.size > MAX_BYTES) {
      setUpload({ phase: "error", message: "Image is over the 2MB limit — pick a smaller file." });
      return;
    }
    uploadFile(file);
  };

  const uploadFile = async (file: File) => {
    setUpload({ phase: "uploading" });
    try {
      const uploadUrl = await getUploadUrl({ fileType: file.type });
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("storage rejected the upload");
      const { storageId } = (await res.json()) as { storageId: string };

      const result = await finalizeUpload({ storageId: storageId as Id<"_storage"> });
      setUpload({ phase: "ready", storageId, previewUrl: result.url, name: file.name });
      toast.success("Custom avatar saved!");
    } catch (err) {
      toast.error(
        err instanceof Error && err.message.length > 0 && !err.message.startsWith("Uncaught")
          ? err.message
          : "Upload failed — please try again.",
      );
      setUpload({ phase: "idle" });
    }
  };

  const groups = ["houses", "footballers", "icons", "mascots"] as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit profile picture</DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <span>@{username ?? "you"}</span>
            {roleBadge}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="presets">
          <TabsList className="w-full">
            <TabsTrigger value="presets" className="flex-1 gap-1.5">
              <Users2 className="size-3.5" /> Choose Preset
            </TabsTrigger>
            <TabsTrigger value="upload" className="flex-1 gap-1.5">
              <ImageUp className="size-3.5" /> Upload Custom
            </TabsTrigger>
          </TabsList>

          <TabsContent value="presets" className="mt-4 space-y-4">
            {groups.map((group) => (
              <div key={group}>
                <p className="text-muted-foreground mb-2 text-[11px] font-bold uppercase tracking-widest">
                  {GROUP_LABELS[group]}
                </p>
                <div className="grid grid-cols-5 gap-2">
                  {AVATAR_PRESETS.filter((p) => p.group === group).map((preset) => {
                    const url = avatarPresetUrl(preset.id);
                    const isSelected = selected === preset.id;
                    return (
                      <button
                        key={preset.id}
                        onClick={() => pickPreset(preset.id)}
                        title={preset.label}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-xl p-1.5 transition-all",
                          isSelected
                            ? "bg-primary/15 ring-2 ring-primary"
                            : "hover:bg-secondary ring-1 ring-transparent hover:ring-border",
                        )}
                      >
                        {url ? (
                          <img
                            src={url}
                            alt={preset.label}
                            width={44}
                            height={44}
                            className="size-11 rounded-full"
                          />
                        ) : (
                          <span
                            className="flex size-11 items-center justify-center rounded-full text-lg"
                            style={{ backgroundColor: `${preset.color}33` }}
                          >
                            {preset.emoji ?? "?"}
                          </span>
                        )}
                        <span className="w-full truncate text-center text-[9px] text-muted-foreground">
                          {preset.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="upload" className="mt-4">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFile(e.dataTransfer.files?.[0]);
              }}
              onClick={() => fileInput.current?.click()}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
                dragOver ? "border-primary bg-primary/10" : "border-border/70 bg-secondary/30",
              )}
            >
              {upload.phase === "ready" ? (
                <>
                  <img
                    src={upload.previewUrl}
                    alt="Uploaded avatar"
                    className="size-16 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.visibility = "hidden";
                    }}
                  />
                  <p className="text-sm font-semibold text-emerald-400">Saved as your avatar!</p>
                  <p className="text-muted-foreground truncate text-xs">{upload.name}</p>
                </>
              ) : upload.phase === "uploading" || upload.phase === "saving" ? (
                <>
                  <Loader2 className="text-primary size-7 animate-spin" />
                  <p className="text-muted-foreground text-sm">Uploading…</p>
                </>
              ) : (
                <>
                  <ImageUp className="text-muted-foreground size-7" />
                  <p className="text-sm font-semibold">
                    Drag & drop an image, or click to browse
                  </p>
                  <p className="text-muted-foreground text-xs">
                    PNG, JPG, WEBP or GIF · max 2MB
                  </p>
                  {upload.phase === "error" && (
                    <p className="text-destructive text-xs">{upload.message}</p>
                  )}
                </>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  handleFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
