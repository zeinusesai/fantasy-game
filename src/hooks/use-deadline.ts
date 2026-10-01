import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useEffect, useState } from "react";
import { scheduleDeadlineReminder } from "@/lib/notifications";
import { useAdminConfig } from "@/hooks/use-admin-config";
import { DEFAULT_MARKET_RULES } from "@/convex/defaults";

export type DeadlineState = {
  /** The closest future deadline across all stages (epoch ms), or null. */
  nearestDeadline: number | null;
  /** Stage id the nearest deadline belongs to. */
  stage: string | null;
  /** Gameweek (1 or 2) the nearest deadline belongs to, or null. */
  gameweek: number | null;
  /** Minutes left until the nearest deadline (rounded down). */
  minutesLeft: number | null;
  /**
   * True when the nearest deadline is inside the Super-Admin configured panic
   * threshold (default 60 minutes) — triggers the crimson panic banner.
   */
  panic: boolean;
  /** True when any deadline has fully passed without settle (read-only hint). */
  anyExpired: boolean;
  /** True when the server has closed transfers entirely. */
  transfersClosed: boolean;
  label: string;
};

/**
 * Tracks gameweek deadlines for the panic banner and read-only enforcement.
 * Re-renders once a minute while a deadline is live; all queries use safe
 * fallbacks so a missing table never breaks the nav.
 */
export function useDeadlineBanner(): DeadlineState {
  // The panic threshold is Super-Admin editable. `useAdminConfig` layers the
  // hardcoded default under the server response, so this is always a sane
  // positive number even while the config query is loading or was rejected.
  const { marketRules } = useAdminConfig();
  const panicMinutes =
    Number.isFinite(marketRules.panicThresholdMinutes) && marketRules.panicThresholdMinutes > 0
      ? marketRules.panicThresholdMinutes
      : DEFAULT_MARKET_RULES.panicThresholdMinutes;

  const gwStatus = useQuery(api.gameweeks.getGameweekStatus) ?? {
    byStage: {} as Record<string, { deadlineAt: number | null; locked: boolean; settled: boolean }>,
    byGameweek: [] as Array<{
      number: number;
      label: string;
      shortLabel: string;
      summary: string;
      stages: readonly string[];
      settled: boolean;
      locked: boolean;
      closed: boolean;
      nextDeadlineAt: number | null;
    }>,
    activeGameweek: null as number | null,
    lockReason: null as string | null,
  };

  // Ticking clock — re-render every 30s so countdowns stay fresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const byStage = gwStatus?.byStage ?? {};
  // Server-authoritative: identical helper to the one `saveSquad` uses, so
  // the banner can never claim transfers are open when the backend will
  // reject the change (or vice-versa).
  const transfersClosed = gwStatus?.lockReason != null;

  // Nearest future deadline.
  let nearestDeadline: number | null = null;
  let stage: string | null = null;
  let anyExpired = false;
  for (const [st, state] of Object.entries(byStage)) {
    const deadline = typeof state?.deadlineAt === "number" ? state.deadlineAt : null;
    if (deadline === null) continue;
    if (state.settled === true) continue; // settled stages are done
    if (deadline > now) {
      if (nearestDeadline === null || deadline < nearestDeadline) {
        nearestDeadline = deadline;
        stage = st;
      }
    } else {
      anyExpired = true;
    }
  }

  // Which gameweek the nearest deadline belongs to (GW1 = semifinals,
  // GW2 = 3rd place + final). Derived from the live gameweek list.
  let gameweek: number | null = null;
  for (const gw of gwStatus?.byGameweek ?? []) {
    if (!gw || !Array.isArray(gw.stages)) continue;
    if (stage !== null && gw.stages.includes(stage)) {
      gameweek = gw.number;
      break;
    }
  }
  if (gameweek === null && transfersClosed) {
    gameweek = gwStatus?.activeGameweek ?? null;
  }

  const minutesLeft =
    nearestDeadline !== null ? Math.max(0, Math.floor((nearestDeadline - now) / 60000)) : null;
  const panic =
    !transfersClosed &&
    nearestDeadline !== null &&
    nearestDeadline - now < panicMinutes * 60 * 1000;

  // One-shot browser notification at T-30 and T-10 (never double-fires).
  useEffect(() => {
    if (nearestDeadline === null || stage === null) return;
    scheduleDeadlineReminder(
      `deadline-${stage}-${nearestDeadline}`,
      nearestDeadline,
      30,
      "⏳ Transfer deadline soon",
      "Transfers lock in 30 minutes — set your squad and captain now!",
    );
    scheduleDeadlineReminder(
      `deadline-${stage}-${nearestDeadline}`,
      nearestDeadline,
      10,
      "🚨 Transfers lock in 10 minutes",
      "Final call — lock your seven before the deadline!",
    );
  }, [nearestDeadline, stage]);

  // Prefer the server's gameweek number (single source of truth) and fall
  // back to the stage→GW mapping only if it is somehow unavailable.
  const gwNumber = gameweek ?? (stage === "semifinal1" || stage === "semifinal2" ? 1 : 2);
  const label =
    minutesLeft !== null
      ? `GW${gwNumber} · ${minutesLeft} min left`
      : "";

  return {
    nearestDeadline,
    stage,
    gameweek,
    minutesLeft,
    panic,
    anyExpired,
    transfersClosed,
    label,
  };
}
