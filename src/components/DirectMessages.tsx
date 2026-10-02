import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { avatarPresetUrl } from "@/lib/fantasy";
import { cn } from "@/lib/utils";
import { MAX_MESSAGE_LENGTH } from "@/convex/configDefaults";
import type { Id } from "@/convex/_generated/dataModel";
import { Inbox, Loader2, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";

/**
 * Unread DM counter for the navigation bar.
 *
 * TOTAL-SAFE: the query resolves to `0` for signed-out viewers and never
 * rejects, so the badge can be rendered unconditionally. It renders nothing
 * when the count is zero rather than an empty pill.
 */
export function UnreadBadge() {
  const unread = useQuery(api.messages.getUnreadCount) ?? 0;
  const safe = Number.isFinite(unread) && unread > 0 ? Math.floor(unread) : 0;
  if (safe === 0) return null;
  return (
    <Badge
      className="border border-amber-400/40 bg-amber-400/20 px-1.5 text-[10px] text-amber-300"
      title={`${safe} unread message${safe === 1 ? "" : "s"}`}
    >
      {safe > 99 ? "99+" : safe}
    </Badge>
  );
}

/**
 * In-app direct-message centre: a thread list plus a realtime chat window.
 *
 * Every read path is defensive — `threads ?? []`, `messages ?? []` — so a
 * signed-out viewer, a deleted counterpart or a loading query renders a clean
 * empty state instead of crashing. Sending is wrapped in try/catch and toasts
 * cleanly; the server returns `{ ok, error }` for expected rejections so no
 * server exception is raised for an empty or self-addressed message.
 */
export function DirectMessages({
  open,
  onOpenChange,
  initialPeerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open straight into a conversation with this manager. */
  initialPeerId?: Id<"users"> | null;
}) {
  const { user } = useAuth();
  const myId = user?._id ?? null;
  const [peerId, setPeerId] = useState<Id<"users"> | null>(initialPeerId ?? null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const threadsResult = useQuery(api.messages.listThreads);
  const threads = threadsResult ?? [];
  const sendMessage = useMutation(api.messages.sendMessage);
  const markRead = useMutation(api.messages.markThreadRead);

  // Adopt the requested peer whenever the modal is opened from a profile.
  useEffect(() => {
    if (open && initialPeerId) setPeerId(initialPeerId);
  }, [open, initialPeerId]);

  // Guard: never let the chat target the viewer themselves.
  const peer = peerId && myId && peerId !== myId ? peerId : null;
  const messagesResult = useQuery(
    api.messages.getThread,
    peer ? { otherUserId: peer } : "skip",
  );
  const messages = messagesResult ?? [];
  const recipientResult = useQuery(
    api.messages.getRecipient,
    peer ? { userId: peer } : "skip",
  );
  const recipient = recipientResult ?? null;

  // Auto-scroll to the newest message whenever the thread grows.
  useEffect(() => {
    if (messages.length > 0 && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [messages.length]);

  // Opening a thread marks it read, which clears the nav badge.
  useEffect(() => {
    if (!peer) return;
    void markRead({ otherUserId: peer }).catch(() => {
      // Marking read is cosmetic — a failure must never break the chat.
    });
  }, [peer, messages.length, markRead]);

  const send = async () => {
    const text = draft.trim();
    if (!peer) return;
    if (text.length === 0) {
      toast.error("Type a message before sending.");
      return;
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      toast.error(`Messages are ${MAX_MESSAGE_LENGTH} characters or fewer.`);
      return;
    }
    setSending(true);
    try {
      const result = await sendMessage({ recipientId: peer, text });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDraft("");
    } catch (err) {
      toast.error(
        err instanceof Error && err.message.length > 0
          ? err.message
          : "Could not send your message.",
      );
    } finally {
      setSending(false);
    }
  };

  const remaining = MAX_MESSAGE_LENGTH - draft.length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 border-l p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="flex items-center gap-2">
            <MessageSquare className="text-primary size-4" /> Messages
          </SheetTitle>
        </SheetHeader>

        {/* ── Thread list ── */}
        {threads.length === 0 ? (
          <p className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm">
            <Inbox className="text-muted-foreground/50 size-7" />
            No conversations yet. Open a manager's profile from the leaderboard
            and hit “Send message”.
          </p>
        ) : (
          <>
            <ul className="max-h-40 shrink-0 overflow-y-auto border-b">
              {threads.map((t) => (
                <li key={t.userId}>
                  <button
                    type="button"
                    onClick={() => setPeerId(t.userId)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-secondary/50",
                      peer === t.userId && "bg-primary/10",
                    )}
                  >
                    <ThreadAvatar
                      name={t.username}
                      teamName={t.teamName}
                      avatar={t.avatar}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold">
                          @{t.username}
                        </span>
                        {t.unread > 0 && (
                          <Badge className="border border-amber-400/40 bg-amber-400/20 px-1.5 text-[10px] text-amber-300">
                            {t.unread}
                          </Badge>
                        )}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {t.lastFromMe ? "You: " : ""}
                        {t.lastText}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {/* ── Chat window ── */}
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b px-4 py-2">
                <p className="text-sm font-semibold">
                  {recipient ? `@${recipient.username}` : "Conversation"}
                </p>
                <p className="text-muted-foreground text-xs">
                  {recipient?.teamName ?? "—"}
                </p>
              </div>

              <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                {messages.length === 0 ? (
                  <p className="text-muted-foreground py-10 text-center text-sm">
                    No messages yet — say hello.
                  </p>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m._id}
                      className={cn(
                        "flex",
                        m.isMine ? "justify-end" : "justify-start",
                      )}
                    >
                      <span
                        className={cn(
                          "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                          m.isMine
                            ? "bg-primary/20 text-foreground"
                            : "bg-secondary text-secondary-foreground",
                        )}
                      >
                        {/* Plain text from the server (whitespace already
                            collapsed + capped), so no HTML is ever rendered. */}
                        {m.text}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-1.5 border-t p-3">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter sends, Shift+Enter is a newline — and never
                    // submits when the field is empty.
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (draft.trim().length > 0 && !sending) void send();
                    }
                  }}
                  placeholder="Write a message…"
                  rows={2}
                  maxLength={MAX_MESSAGE_LENGTH}
                />
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "text-muted-foreground text-[11px]",
                      remaining < 50 && "text-amber-400",
                    )}
                  >
                    {draft.trim().length === 0
                      ? "Enter to send"
                      : `${remaining} characters left`}
                  </span>
                  <Button size="sm" onClick={() => void send()} disabled={sending}>
                    {sending ? (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    ) : (
                      <Send className="mr-1.5 size-3.5" />
                    )}
                    Send
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Compact chat dialog used from the profile card — opens directly into a
 * conversation with one manager (no thread list to pick through).
 */
export function DirectMessageDialog({
  open,
  onOpenChange,
  peerId,
  peerName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  peerId: Id<"users"> | null;
  peerName?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="text-primary size-4" />
            {peerName ? `Message @${peerName}` : "New message"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Messages are private to the two of you.
          </DialogDescription>
        </DialogHeader>
        <DirectMessagesInline open={open} peerId={peerId} />
      </DialogContent>
    </Dialog>
  );
}

/** The chat body without its own sheet chrome (used inside the dialog). */
function DirectMessagesInline({
  open,
  peerId,
}: {
  open: boolean;
  peerId: Id<"users"> | null;
}) {
  const { user } = useAuth();
  const myId = user?._id ?? null;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const sendMessage = useMutation(api.messages.sendMessage);
  const markRead = useMutation(api.messages.markThreadRead);

  const peer = peerId && myId && peerId !== myId ? peerId : null;
  const messagesResult = useQuery(
    api.messages.getThread,
    peer ? { otherUserId: peer } : "skip",
  );
  const messages = messagesResult ?? [];
  const recipientResult = useQuery(
    api.messages.getRecipient,
    peer ? { userId: peer } : "skip",
  );
  const recipient = recipientResult ?? null;

  useEffect(() => {
    if (messages.length > 0 && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [messages.length]);

  useEffect(() => {
    if (!peer || !open) return;
    void markRead({ otherUserId: peer }).catch(() => {});
  }, [peer, open, messages.length, markRead]);

  const send = async () => {
    const text = draft.trim();
    if (!peer) return;
    if (text.length === 0) {
      toast.error("Type a message before sending.");
      return;
    }
    setSending(true);
    try {
      const result = await sendMessage({ recipientId: peer, text });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDraft("");
    } catch (err) {
      toast.error(
        err instanceof Error && err.message.length > 0
          ? err.message
          : "Could not send your message.",
      );
    } finally {
      setSending(false);
    }
  };

  if (!peer) {
    return (
      <p className="text-muted-foreground p-8 text-center text-sm">
        This manager can't be messaged.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-4 py-2">
        <p className="text-sm font-semibold">
          {recipient ? `@${recipient.username}` : "Conversation"}
        </p>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            No messages yet — say hello.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m._id}
              className={cn("flex", m.isMine ? "justify-end" : "justify-start")}
            >
              <span
                className={cn(
                  "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                  m.isMine
                    ? "bg-primary/20 text-foreground"
                    : "bg-secondary text-secondary-foreground",
                )}
              >
                {m.text}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="space-y-1.5 border-t p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (draft.trim().length > 0 && !sending) void send();
            }
          }}
          placeholder="Write a message…"
          rows={2}
          maxLength={MAX_MESSAGE_LENGTH}
        />
        <div className="flex items-center justify-end">
          <Button size="sm" onClick={() => void send()} disabled={sending}>
            {sending ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Send className="mr-1.5 size-3.5" />
            )}
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Avatar with the same layered fallback used across the app. */
function ThreadAvatar({
  name,
  teamName,
  avatar,
}: {
  name: string | null;
  teamName: string | null;
  avatar: string | null;
}) {
  const src =
    avatar && (avatar.startsWith("http") || avatar.startsWith("data:"))
      ? avatar
      : avatarPresetUrl(avatar);
  return (
    <Avatar className="size-8 shrink-0">
      <AvatarImage
        src={src ?? undefined}
        alt={name ?? "manager"}
        onError={(e) => {
          (e.target as HTMLImageElement).style.visibility = "hidden";
        }}
      />
      <AvatarFallback className="bg-primary/20 text-primary text-[10px] font-bold">
        {(name ?? teamName ?? "?").slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}