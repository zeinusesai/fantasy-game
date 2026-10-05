import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Heart, Lightbulb, ShieldCheck, Swords } from "lucide-react";

const CREDITS = [
  { role: "Lead Developer & Creator", name: "Zein", icon: "🛠️" },
  { role: "Idea Contributor", name: "Yasin", icon: "💡" },
] as const;

/**
 * Discreet "About & Credits" modal — reachable ONLY from the Profile page
 * (a small text link), never from the main navigation or footer. All text
 * is module-constants so rendering can never throw on missing data.
 */
export function AboutCreditsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <Swords className="text-primary size-4" /> About & Credits
          </DialogTitle>
          <DialogDescription>
            Y11 PE Hub — Year 11 PE · 7-a-side Fantasy League
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {CREDITS.map((c) => (
            <div
              key={c.name}
              className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-secondary/40 px-3 py-2.5"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm">
                  {c.icon}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{c.name}</p>
                  <p className="text-muted-foreground truncate text-xs">{c.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="text-muted-foreground flex items-center gap-1.5 border-t border-border/60 pt-3 text-[11px]">
          <ShieldCheck className="size-3.5 shrink-0 text-amber-300/80" />
          Developed by Zein | All Rights Reserved
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** Small unobtrusive trigger link (used on the Profile page only). */
export function AboutCreditsTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-muted-foreground hover:text-foreground mt-1 inline-flex items-center gap-1 text-[11px] underline-offset-2 transition-colors hover:underline"
    >
      <Lightbulb className="size-3" />
      About &amp; Credits
      <Heart className="size-2.5 opacity-60" />
    </button>
  );
}
