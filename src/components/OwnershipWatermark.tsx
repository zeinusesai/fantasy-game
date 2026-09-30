import { ShieldCheck } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const COPYRIGHT = "Developed by Zein | All Rights Reserved";
const WARNING =
  "Unauthorized copying, distribution, or code duplication of this platform is strictly prohibited.";

/**
 * Ownership watermark — hardcoded in the root layout (main.tsx) so it renders
 * on every view and cannot be toggled off by users or moderators.
 *
 * Layering: above app panels & pitch graphics, below dropdown/dialog overlays
 * (z-40 < z-50) so it never blocks interactive UI. `pointer-events: none` on
 * the shell with `pointer-events: auto` only on the chip itself.
 */
export function OwnershipWatermark() {
  return (
    <div
      role="contentinfo"
      aria-label={COPYRIGHT}
      className="pointer-events-none fixed bottom-3 right-3 z-40 select-none"
    >
      <Tooltip delayDuration={150}>
        <TooltipTrigger asChild>
          <div className="pointer-events-auto flex cursor-default items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 backdrop-blur-md">
            <ShieldCheck className="size-3.5 text-amber-300/90 drop-shadow-[0_0_6px_rgba(251,191,36,0.45)]" />
            <span className="font-display text-[11px] font-semibold tracking-[0.08em] whitespace-nowrap text-white/60 transition-colors hover:text-white/85">
              {COPYRIGHT}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" align="end" className="max-w-64">
          <p className="flex items-start gap-1.5 text-xs font-medium">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
            {WARNING}
          </p>
          <p className="text-muted-foreground mt-1 text-[10px] font-normal">
            {COPYRIGHT}
          </p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
