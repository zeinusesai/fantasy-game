import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useEffect, useState } from "react";
import { scheduleDeadlineReminder } from "@/lib/notifications";

export type DeadlineState = {
  /** The closest future deadline across all stages (epoch ms), or null. */
  nearestDeadline: number | null;
  /** Stage id the nearest deadline belongs to. */
  stage: string | null;
  /** Minutes left until the nearest deadline (rounded down). */
  minutesLeft: number | null;
  /** True when a deadline is < 60 minutes away — triggers the panic banner. */
  panic: boolean;
  /** True when any deadline has fully passed without settle (read-only hint). */
  anyExpired: boolean;
  label: string;
};

/**
 * Tracks gameweek deadlines for the panic banner and read-only enforcement.
 * Re-renders once a minute while a deadline is live; all queries use safe
 * fallbacks so a missing table never breaks the nav.
 */
export function useDeadlineBanner(): DeadlineState {
  const gwStatus = useQuery(api.gameweeks.getGameweekStatus) ?? {
    byStage: {} as Record<string, { deadlineAt: number | null; locked: boolean; settled: boolean }>,
  };

  // Ticking clock — re-render every 30s so countdowns stay fresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const byStage = gwStatus?.byStage ?? {};

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

  const minutesLeft =
    nearestDeadline !== null ? Math.max(0, Math.floor((nearestDeadline - now) / 60000)) : null;
  const panic = nearestDeadline !== null && nearestDeadline - now < 60 * 60 * 1000;

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

  const label =
    stage !== null && minutesLeft !== null
      ? `GW${stage === "semifinal1" || stage === "semifinal2" ? "1" : "2"} · ${minutesLeft} min left`
      : "";

  return { nearestDeadline, stage, minutesLeft, panic, anyExpired, label };
}
