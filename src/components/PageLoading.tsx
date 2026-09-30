import { Loader2 } from "lucide-react";

/** Centered spinner shown inside AppNav while queries resolve. */
export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
      <Loader2 className="text-muted-foreground size-8 animate-spin" />
      <p className="text-muted-foreground text-sm">{label}</p>
    </div>
  );
}
