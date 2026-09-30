import { useState } from "react";
import { useConvex } from "convex/react";
import { useNavigate } from "react-router";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Loader2, Lock, RefreshCw, Settings, Wrench } from "lucide-react";
import { OwnershipWatermark } from "@/components/OwnershipWatermark";

/**
 * Full-screen maintenance lockout for standard (non-admin) visitors.
 * Dark, animated, and consistent with the sports-dashboard aesthetic.
 */
export function MaintenanceScreen() {
  const client = useConvex();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const [stillDown, setStillDown] = useState<boolean | null>(null);

  const checkStatus = async () => {
    setChecking(true);
    setStillDown(null);
    try {
      const status = await client.query(api.system.getMaintenanceStatus);
      setStillDown(status.isMaintenanceMode === true);
    } catch {
      setStillDown(true); // network/transport error — assume still down
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="stadium-bg relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4">
      {/* Soft vignette so the lock icon pops */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.55)_100%)]" />

      <div className="relative flex w-full max-w-md flex-col items-center gap-6 text-center">
        {/* Floating, pulsing lock wrapped by a spinning gear ring */}
        <div className="relative flex size-28 items-center justify-center">
          <Settings className="text-primary/30 absolute inset-0 size-28 animate-spin [animation-duration:9s]" />
          <div className="border-primary/40 bg-background/70 absolute inset-3 rounded-full border backdrop-blur-md" />
          <Lock className="text-primary relative size-10 animate-pulse drop-shadow-[0_0_14px_rgba(var(--primary-rgb,124,58,237),0.45)]" />
        </div>

        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            System Maintenance in Progress
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed sm:text-base">
            The website is currently in maintenance, need anything? Contact{" "}
            <span className="text-primary font-semibold">Zein</span>. It will
            probably be up in a few minutes!
          </p>
        </div>

        <div className="flex flex-col items-center gap-2">
          <Button onClick={checkStatus} disabled={checking} size="lg">
            {checking ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            Check Status
          </Button>
          {stillDown === false && (
            <p className="text-xs font-semibold text-emerald-400">
              We're back! Reloading…
            </p>
          )}
          {stillDown === true && (
            <p className="text-xs text-amber-300">
              Still under maintenance — hang tight.
            </p>
          )}
        </div>

        {/* Staff entry point — admins sign in and pass the gate by role. */}
        <button
          onClick={() => navigate("/auth")}
          className="text-muted-foreground/60 hover:text-muted-foreground text-xs underline-offset-4 transition-colors hover:underline"
        >
          Staff member? Sign in
        </button>
      </div>

      <Wrench className="text-muted-foreground/20 absolute bottom-16 left-8 size-16 -rotate-12" />
      <Wrench className="text-muted-foreground/15 absolute right-10 top-20 size-12 rotate-45" />

      {/* Ownership watermark stays visible on the lock screen */}
      <OwnershipWatermark />
    </div>
  );
}
