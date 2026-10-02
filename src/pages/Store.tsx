import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppNav } from "@/components/AppNav";
import { PageLoading } from "@/components/PageLoading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import {
  MAX_PRICE_AED,
  STORE_ITEMS,
  isValidPriceAED,
  type StoreItem,
} from "@/convex/storeItems";
import {
  Banknote,
  CheckCircle2,
  Coins,
  Crown,
  Flame,
  HandCoins,
  Loader2,
  Palette,
  Receipt,
  ShieldCheck,
  Sparkles,
  Timer,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

/** Icon per catalogue item — keyed by `StoreItem.icon`. */
const ICONS = {
  title: Crown,
  border: Flame,
  theme: Palette,
  chip: Zap,
  budget: Coins,
} as const;

/**
 * Format an AED amount safely. Anything non-finite or absurd renders as "—"
 * so a corrupt row can never print "NaN AED" into the UI.
 */
function formatAED(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return "—";
  const whole = Math.round(n * 100) / 100;
  return `${whole} AED`;
}

/** "12 Aug, 14:03" — locale-formatted, with a safe fallback. */
function formatWhen(ts: unknown): string {
  const n = typeof ts === "number" ? ts : Number(ts);
  if (!Number.isFinite(n) || n <= 0) return "unknown time";
  try {
    return new Date(n).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "unknown time";
  }
}

/** A catalogue item plus the signed-in manager's state for it. */
type StoreItemView = StoreItem & {
  owned: boolean;
  unlocked: boolean;
  ownedVia: string | null;
  grantedAt: number | null;
  pendingPurchaseId: string | null;
};

export default function Store() {
  const { user, isLoading: authLoading } = useAuth();

  // FALLBACK SAFE STATE: the query can be `undefined` (loading) or fail
  // entirely. We render from a fully-formed fallback object instead of
  // touching a possibly-undefined array, so the store never crashes.
  const storeResult = useQuery(api.transactions.getStore);
  const store =
    storeResult ?? {
      isSuper: false,
      maxPriceAED: MAX_PRICE_AED,
      items: STORE_ITEMS.map((item) => ({
        ...item,
        owned: false,
        unlocked: false,
        ownedVia: null,
        grantedAt: null,
        pendingPurchaseId: null,
      })),
      purchases: [],
      extraChips: 0,
      budgetBonus: 0,
    };
  const items = store.items ?? [];
  const purchases = store.purchases ?? [];

  const requestPurchase = useMutation(api.transactions.requestPurchase);
  const setSuperUnlock = useMutation(api.transactions.setSuperUnlock);
  const setEntitlementEnabled = useMutation(api.transactions.setEntitlementEnabled);

  const [payFor, setPayFor] = useState<StoreItemView | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);

  const isSuper = user?.role === "super_admin" || store.isSuper;

  if (authLoading || user === undefined) {
    return (
      <AppNav>
        <PageLoading label="Opening the store…" />
      </AppNav>
    );
  }

  // ── Cash payment flow (3 explicit steps, then the request goes out) ──
  const submitPurchase = async (item: StoreItemView) => {
    // Client-side ceiling check mirrors the server one. The server never
    // trusts this value — it re-reads the catalogue price.
    if (!isValidPriceAED(item.priceAED) || item.priceAED > MAX_PRICE_AED) {
      toast.error(`Store items are capped at ${MAX_PRICE_AED} AED.`);
      return;
    }
    setBusyItem(item.id);
    try {
      await requestPurchase({ itemId: item.id, priceAED: item.priceAED });
      toast.success("Purchase request sent to Zein — pay in cash to confirm.");
      setPayFor(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not send the request.",
      );
    } finally {
      setBusyItem(null);
    }
  };

  const toggleUnlock = async (item: StoreItemView, next: boolean) => {
    setBusyItem(item.id);
    try {
      if (isSuper) {
        await setSuperUnlock({ itemId: item.id, enabled: next });
        toast.success(
          `${item.name} ${next ? "enabled" : "disabled"} (Super Admin).`,
        );
      } else {
        await setEntitlementEnabled({ itemId: item.id, enabled: next });
        toast.success(`${item.name} ${next ? "on" : "off"}.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change that.");
    } finally {
      setBusyItem(null);
    }
  };

  return (
    <AppNav>
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div>
          <p className="text-muted-foreground flex items-center gap-1.5 text-sm font-medium">
            <HandCoins className="text-primary size-3.5" /> Manager store
          </p>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            {isSuper ? "Super Admin — everything unlocked" : "Upgrade your manager"}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {isSuper ? (
              <>
                As Super Admin you own and unlock every item below by default — no
                purchase, no payment, no request needed. Use the switches to turn
                any perk on or off instantly.
              </>
            ) : (
              <>
                Pay Zein in cash, then submit a request. Everything costs{" "}
                <span className="text-foreground font-semibold">
                  {MAX_PRICE_AED} AED or less
                </span>{" "}
                — nothing in this store goes over the ceiling.
              </>
            )}
          </p>
        </div>

        {isSuper && (
          <Card className="border-amber-400/40 bg-amber-400/5">
            <CardContent className="flex items-start gap-3 p-4">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-amber-300" />
              <div>
                <p className="font-semibold text-amber-200">
                  Super Admin instant-access engine
                </p>
                <p className="text-muted-foreground text-sm">
                  All {STORE_ITEMS.length} items are permanently unlocked for you.
                  Toggling one off hides the perk without revoking ownership.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Catalogue */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <StoreItemCard
              key={item.id}
              item={item}
              isSuper={isSuper}
              busy={busyItem === item.id}
              onBuy={() => setPayFor(item)}
              onToggle={(next) => void toggleUnlock(item, next)}
            />
          ))}
        </div>

        {/* My transactions */}
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
              <Receipt className="text-primary size-4" /> My transactions
            </CardTitle>
            <CardDescription>
              {isSuper
                ? "You never need to buy anything — your unlocks are listed above."
                : "Every purchase request you've submitted, newest first."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {purchases.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                {isSuper
                  ? "No purchases needed — everything is unlocked."
                  : "No transactions yet. Buy your first item above."}
              </p>
            ) : (
              <ul className="space-y-2">
                {purchases.map((p) => (
                  <li
                    key={p._id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-secondary/30 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{p.itemName}</p>
                      <p className="text-muted-foreground text-[11px]">
                        {formatWhen(p.createdAt)}
                        {p.decidedBy ? ` · decided by ${p.decidedBy}` : ""}
                      </p>
                      {p.note ? (
                        <p className="text-muted-foreground mt-0.5 text-[11px] italic">
                          “{p.note}”
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-score text-sm font-bold">
                        {formatAED(p.priceAED)}
                      </span>
                      <StatusBadge status={p.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Cash payment modal ── */}
      <Dialog
        open={payFor !== null}
        onOpenChange={(open) => {
          if (!open) setPayFor(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="text-primary size-4" /> Pay in cash
            </DialogTitle>
            <DialogDescription>
              Manual cash purchase of{" "}
              <span className="text-foreground font-semibold">
                {payFor?.name ?? "this item"}
              </span>{" "}
              for{" "}
              <span className="font-score text-foreground font-bold">
                {formatAED(payFor?.priceAED)}
              </span>
              .
            </DialogDescription>
          </DialogHeader>

          <ol className="space-y-2.5">
            <Step
              n={1}
              title={`Pay Zein in cash in person (Max ${MAX_PRICE_AED} AED).`}
            />
            <Step
              n={2}
              title="Click 'Submit Purchase Request' to alert the Super Admin."
            />
            <Step
              n={3}
              title="Once Zein confirms cash received, your item will be granted automatically."
            />
          </ol>

          <p className="text-muted-foreground rounded-lg border border-border/60 bg-secondary/30 p-2.5 text-xs">
            Nothing is charged digitally — this store is cash only, handled in
            person. You'll see a <strong>Pending Approval</strong> badge on the
            item until Zein approves it.
          </p>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPayFor(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => payFor && void submitPurchase(payFor)}
              disabled={
                payFor === null ||
                busyItem === payFor.id ||
                payFor.pendingPurchaseId !== null
              }
            >
              {busyItem === payFor?.id ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1.5 size-4" />
              )}
              Submit purchase request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppNav>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function Step({ n, title }: { n: number; title: string }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border/60 bg-secondary/30 p-3">
      <span className="font-display bg-primary/15 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
        {n}
      </span>
      <span className="text-sm leading-snug">{title}</span>
    </li>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "approved") {
    return (
      <Badge className="border border-emerald-400/40 bg-emerald-400/15 text-[10px] text-emerald-300 uppercase">
        Approved
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge variant="secondary" className="text-[10px] uppercase">
        Rejected
      </Badge>
    );
  }
  // Anything unknown (defensive) still renders as a safe, honest pending state.
  return (
    <Badge className="border border-amber-400/40 bg-amber-400/15 text-[10px] text-amber-300 uppercase">
      Pending approval
    </Badge>
  );
}

function StoreItemCard({
  item,
  isSuper,
  busy,
  onBuy,
  onToggle,
}: {
  item: StoreItemView;
  isSuper: boolean;
  busy: boolean;
  onBuy: () => void;
  onToggle: (next: boolean) => void;
}) {
  // Defensive: an unknown icon key must never render a blank card.
  const Icon = ICONS[item.icon] ?? Sparkles;
  const pending = item.pendingPurchaseId !== null;
  const owned = item.owned === true;

  return (
    <Card
      className={`relative overflow-hidden border-border/80 bg-gradient-to-br ${item.accent}`}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <span className="bg-background/60 flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-border">
            <Icon className="text-primary size-4" />
          </span>
          <div className="flex flex-col items-end gap-1">
            <span className="font-score text-xl font-bold text-foreground">
              {formatAED(item.priceAED)}
            </span>
            {isSuper ? (
              <Badge className="border border-amber-400/40 bg-amber-400/15 text-[10px] text-amber-300 uppercase">
                Unlocked (Super Admin)
              </Badge>
            ) : pending ? (
              <Badge className="border border-amber-400/40 bg-amber-400/15 text-[10px] text-amber-300 uppercase">
                <Timer className="mr-1 size-3" /> Pending approval
              </Badge>
            ) : owned ? (
              <Badge className="border border-emerald-400/40 bg-emerald-400/15 text-[10px] text-emerald-300 uppercase">
                Owned
              </Badge>
            ) : null}
          </div>
        </div>
        <CardTitle className="mt-1 text-base leading-snug">{item.name}</CardTitle>
        <CardDescription>{item.blurb}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Super Admin: direct on-demand toggles. */}
        {isSuper ? (
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
            <span className="text-sm font-medium">
              {item.unlocked ? "Active" : "Turned off"}
            </span>
            <Switch
              checked={item.unlocked === true}
              disabled={busy}
              onCheckedChange={(next) => onToggle(next === true)}
              aria-label={`Toggle ${item.name}`}
            />
          </div>
        ) : (
          <Button
            className="w-full"
            variant={pending || owned ? "outline" : "default"}
            disabled={busy || pending || owned}
            onClick={onBuy}
            title={
              pending
                ? "Waiting on the Super Admin"
                : owned
                  ? "You already own this"
                  : `Buy for ${formatAED(item.priceAED)}`
            }
          >
            {busy ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <HandCoins className="mr-1.5 size-4" />
            )}
            {pending ? "Pending approval" : owned ? "Owned" : "Purchase"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}