// ── In-app direct messages (manager ↔ manager) ────────────────────────────
//
// A tiny, self-contained chat engine. There is no `conversations` table: a
// thread IS the set of rows between two user ids, so the two can never drift
// out of sync.
//
// Safety contract (identical in spirit to the rest of the codebase):
//   1. QUERIES NEVER THROW — every one returns a fully-formed value (`[]`,
//      `0`, `null`) so a signed-out visitor, a deleted manager or a race on a
//      missing row renders a clean empty state instead of a rejected
//      subscription.
//   2. TEXT IS SANITISED — trimmed, whitespace-collapsed and hard-capped at
//      `MAX_MESSAGE_LENGTH` server-side, so a giant/spammy payload can never be
//      written to the database and never reaches a sibling manager's UI.
//   3. MANAGERS CANNOT MESSAGE THEMSELVES, and neither can non-existent users.
//   4. MUTATIONS RETURN `{ ok, error }` rather than throwing for an EXPECTED
//      rejection (empty message, self-DM), so the chat UI toasts it without a
//      server exception. Genuinely unexpected failures still degrade to a
//      friendly message.

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireUser } from "./lib";
import { MAX_MESSAGE_LENGTH } from "./configDefaults";
import type { Id } from "./_generated/dataModel";

/** How many messages a single thread read returns (newest slice). */
const MAX_THREAD_MESSAGES = 200;

/**
 * Normalise a message body: trim, collapse runs of whitespace/newlines to a
 * single space (keeps the bubble to one tidy line), strip control characters,
 * and cap the length. Returns "" for anything unusable.
 *
 * TOTAL: never throws. Returns "" rather than junk for null/undefined/non-strings.
 */
export function sanitizeMessageText(value: unknown): string {
  if (typeof value !== "string") return "";
  // Strip C0/C1 control characters (except nothing — newlines are collapsed below).
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
  const collapsed = cleaned.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, MAX_MESSAGE_LENGTH);
}

/**
 * Threads for the signed-in manager: one entry per conversation partner, with
 * the latest message and that thread's unread count. Newest activity first.
 *
 * Null-safe: `[]` for signed-out viewers, and a deleted counterpart is skipped
 * rather than rendered as a broken row.
 */
export const listThreads = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    try {
      // Both directions: anything I sent and anything I received.
      const received = await ctx.db
        .query("directMessages")
        .withIndex("by_recipient", (q) => q.eq("recipientId", userId))
        .collect();
      const sent = await ctx.db
        .query("directMessages")
        .withIndex("by_sender", (q) => q.eq("senderId", userId))
        .collect();

      const all = [...received, ...sent];

      // Group by the OTHER participant.
      const byPartner = new Map<string, {
        partnerId: Id<"users">;
        lastMessage: (typeof all)[number];
        unread: number;
      }>();

      for (const msg of all) {
        const partnerId: Id<"users"> =
          msg.senderId === userId ? msg.recipientId : msg.senderId;
        const key = String(partnerId);
        const entry = byPartner.get(key);
        if (!entry) {
          byPartner.set(key, {
            partnerId,
            lastMessage: msg,
            unread: msg.recipientId === userId && msg.isRead !== true ? 1 : 0,
          });
          continue;
        }
        // Keep the newest message as the preview.
        if (msg.createdAt > entry.lastMessage.createdAt) {
          entry.lastMessage = msg;
        }
        if (msg.recipientId === userId && msg.isRead !== true) entry.unread += 1;
      }

      const out = [];
      for (const entry of byPartner.values()) {
        // A deleted counterpart must not produce a broken thread row.
        const partner = await ctx.db.get(entry.partnerId).catch(() => null);
        if (!partner) continue;
        const last = entry.lastMessage;
        out.push({
          userId: entry.partnerId,
          username: partner.username ?? "unknown",
          teamName: partner.teamName ?? "Unnamed team",
          avatar: partner.image ?? null,
          lastText: last.text,
          lastAt: last.createdAt,
          lastFromMe: last.senderId === userId,
          unread: entry.unread,
        });
      }
      return out.sort((a, b) => b.lastAt - a.lastAt);
    } catch {
      return [];
    }
  },
});

/**
 * Total unread DM count for the nav badge. Always a finite number ≥ 0 — never
 * a rejected query, so the navbar can render unconditionally.
 */
export const getUnreadCount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return 0;
    try {
      const rows = await ctx.db
        .query("directMessages")
        .withIndex("by_recipient", (q) => q.eq("recipientId", userId))
        .collect();
      let count = 0;
      for (const row of rows) if (row.isRead !== true) count += 1;
      return Number.isFinite(count) ? count : 0;
    } catch {
      return 0;
    }
  },
});

/**
 * One thread, oldest → newest, for the chat window. Both directions merged and
 * sorted, capped at the newest `MAX_THREAD_MESSAGES`.
 *
 * Null-safe: `[]` when not signed in, when the counterpart doesn't exist, or
 * when the thread is empty. A viewer can only ever read their OWN thread.
 */
export const getThread = query({
  args: { otherUserId: v.id("users") },
  handler: async (ctx, { otherUserId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    if (userId === otherUserId) return [];
    try {
      const other = await ctx.db.get(otherUserId).catch(() => null);
      if (!other) return []; // deleted manager → clean empty thread

      const incoming = await ctx.db
        .query("directMessages")
        .withIndex("by_recipient", (q) => q.eq("recipientId", userId))
        .collect();
      const outgoing = await ctx.db
        .query("directMessages")
        .withIndex("by_sender", (q) => q.eq("senderId", userId))
        .collect();

      const thread = [...incoming, ...outgoing].filter(
        (m) =>
          (m.senderId === userId && m.recipientId === otherUserId) ||
          (m.senderId === otherUserId && m.recipientId === userId),
      );
      thread.sort((a, b) => a.createdAt - b.createdAt);

      return thread.slice(-MAX_THREAD_MESSAGES).map((m) => ({
        _id: m._id,
        senderId: m.senderId,
        text: m.text,
        isRead: m.isRead === true,
        createdAt: m.createdAt,
        isMine: m.senderId === userId,
      }));
    } catch {
      return [];
    }
  },
});

/** Counterpart header info for the chat window (name, avatar, role). */
export const getRecipient = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const viewerId = await getAuthUserId(ctx);
    if (viewerId === null) return null;
    try {
      const user = await ctx.db.get(userId).catch(() => null);
      if (!user) return null;
      return {
        userId: user._id,
        username: user.username ?? "unknown",
        teamName: user.teamName ?? "Unnamed team",
        avatar: user.image ?? null,
        role: user.role ?? null,
        customBadge: user.customBadge ?? null,
      };
    } catch {
      return null;
    }
  },
});

/**
 * Send a direct message.
 *
 * Returns `{ ok: true, messageId }` or `{ ok: false, error }` — it never
 * rejects for an expected rejection, so the chat input can toast inline
 * instead of surfacing a server exception.
 */
export const sendMessage = mutation({
  args: { recipientId: v.id("users"), text: v.string() },
  handler: async (ctx, args) => {
    let me;
    try {
      me = await requireUser(ctx);
    } catch (err) {
      return {
        ok: false as const,
        error:
          err instanceof Error ? err.message : "You must be signed in to message.",
      };
    }

    // Server-side sanitisation — the client's trimmed value is never trusted.
    const text = sanitizeMessageText(args.text);
    if (text.length === 0) {
      return { ok: false as const, error: "Type a message before sending." };
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      return {
        ok: false as const,
        error: `Messages are ${MAX_MESSAGE_LENGTH} characters or fewer.`,
      };
    }
    if (args.recipientId === me._id) {
      return { ok: false as const, error: "You can't message yourself." };
    }

    try {
      const recipient = await ctx.db.get(args.recipientId).catch(() => null);
      if (!recipient) {
        return {
          ok: false as const,
          error: "That manager no longer exists.",
        };
      }
      const messageId = await ctx.db.insert("directMessages", {
        senderId: me._id,
        recipientId: recipient._id,
        text,
        isRead: false,
        createdAt: Date.now(),
      });
      return { ok: true as const, messageId };
    } catch (err) {
      if (err instanceof Error && err.message.length > 0) {
        return { ok: false as const, error: err.message };
      }
      return {
        ok: false as const,
        error: "Could not send your message — please try again.",
      };
    }
  },
});

/**
 * Mark every message in a thread as read. Idempotent and non-throwing — an
 * already-read thread, a missing counterpart or no messages all succeed.
 */
export const markThreadRead = mutation({
  args: { otherUserId: v.id("users") },
  handler: async (ctx, { otherUserId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { marked: 0 };
    if (userId === otherUserId) return { marked: 0 };
    try {
      const rows = await ctx.db
        .query("directMessages")
        .withIndex("by_recipient", (q) => q.eq("recipientId", userId))
        .collect();
      let marked = 0;
      for (const row of rows) {
        if (row.senderId !== otherUserId) continue; // only this thread
        if (row.isRead === true) continue; // already read
        await ctx.db.patch(row._id, { isRead: true });
        marked += 1;
      }
      return { marked };
    } catch {
      return { marked: 0 };
    }
  },
});