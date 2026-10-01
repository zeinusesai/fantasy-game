import { useEffect } from "react";
import { useAdminConfig } from "@/hooks/use-admin-config";

/**
 * Keeps `document.title` in sync with the Super-Admin editable app title.
 *
 * Rendered once, above the router, so the title is correct on every route and
 * changes instantly when the title is edited in the Customize tab — no
 * redeploy, no hardcoded string left behind in `index.html`.
 *
 * Renders nothing. `useAdminConfig` already layers the hardcoded default under
 * the server response, so an unset or corrupt field can never produce an
 * empty tab title.
 */
export function AppTitleSync() {
  const { uiText } = useAdminConfig();

  useEffect(() => {
    const title = uiText.appTitle.trim();
    if (title.length === 0) return;
    document.title = title;
  }, [uiText.appTitle]);

  return null;
}
