// Y11 PE Hub — PWA push notifications (deadline & result alerts).
//
// Design notes (zero-risk defaults):
//  - Permission is only requested from an explicit user click ("Enable alerts").
//  - Local scheduled reminders run inside the app via setTimeout while the tab
//    is open; a service-worker push server is NOT required for this release.
//  - Every browser API is feature-detected; unsupported browsers silently
//    degrade and the UI reports "not supported" instead of throwing.
//  - Fired reminder ids are persisted in localStorage so a reminder never
//    double-fires for the same deadline.

const REMINDER_KEY = "y11-notifications-reminded";

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function alreadyReminded(key: string): boolean {
  try {
    const raw = storage()?.getItem(REMINDER_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) && parsed.includes(key);
  } catch {
    return false;
  }
}

function markReminded(key: string): void {
  try {
    const raw = storage()?.getItem(REMINDER_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    const next = Array.isArray(list) ? list.filter((k) => typeof k === "string") : [];
    if (!next.includes(key)) next.push(key);
    // Keep the list bounded — only the latest 50 matter.
    storage()?.setItem(REMINDER_KEY, JSON.stringify(next.slice(-50)));
  } catch {
    // storage unavailable — reminders may re-fire; harmless
  }
}

export type NotificationSupport = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
};

/** Feature-detect the Notifications API without touching it. */
export function getNotificationSupport(): NotificationSupport {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return { supported: false, permission: "unsupported" };
    }
    return { supported: true, permission: Notification.permission };
  } catch {
    return { supported: false, permission: "unsupported" };
  }
}

/**
 * Ask the browser for notification permission. Must be called from a user
 * gesture (the Enable Alerts button). Returns the resulting permission.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return "denied";
  }
}

/** Fire a notification — silently no-ops when unsupported/denied. */
export function showNotification(title: string, body: string, tag?: string): boolean {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return false;
    if (Notification.permission !== "granted") return false;
    new Notification(title, {
      body,
      tag,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Schedule a one-shot deadline reminder. The timer lives only while the tab
 * is open — acceptable for a 60-minute transfer window. Never double-fires
 * for the same deadline id and never throws.
 */
export function scheduleDeadlineReminder(
  id: string,
  deadlineAt: number,
  minutesBefore: number,
  title: string,
  body: string,
): boolean {
  try {
    const key = `${id}:${minutesBefore}`;
    if (alreadyReminded(key)) return false;
    const msUntil = deadlineAt - Date.now() - minutesBefore * 60 * 1000;
    if (msUntil <= 0 || msUntil > 24 * 60 * 60 * 1000) return false; // past or >24h away
    if (typeof window === "undefined") return false;
    window.setTimeout(() => {
      if (alreadyReminded(key)) return;
      markReminded(key);
      showNotification(title, body, key);
    }, Math.max(msUntil, 0));
    return true;
  } catch {
    return false;
  }
}

/** One-time "results published" style notification fired immediately. */
export function notifyNow(title: string, body: string, tag: string): boolean {
  try {
    const key = `${tag}:${Math.floor(Date.now() / 60000)}`;
    if (alreadyReminded(key)) return false;
    markReminded(key);
    return showNotification(title, body, tag);
  } catch {
    return false;
  }
}
