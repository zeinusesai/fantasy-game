import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";

/**
 * Y11 PE Hub — retro 8-bit arcade toggle.
 *
 * Mirrors the signed-in manager's `pixelMode` profile flag onto a
 * `pixel-mode` class on <html>, where `src/index.css` applies the nostalgic
 * 1980s treatment to player cards, pitch turf and badges.
 *
 * Rendered once, above the router, so the theme is correct on every route and
 * updates instantly when the toggle changes. Total: no flag (or a signed-out
 * viewer) simply removes the class, so a corrupt row can never leave the app
 * stuck in pixel mode.
 */
export function PixelThemeSync() {
  const { user } = useAuth();
  const enabled = user?.pixelMode === true;

  useEffect(() => {
    const root = document.documentElement;
    if (enabled) root.classList.add("pixel-mode");
    else root.classList.remove("pixel-mode");
    return () => root.classList.remove("pixel-mode");
  }, [enabled]);

  return null;
}
