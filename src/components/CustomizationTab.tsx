import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, parseMoneyInput, safeBudget, toSafeAmount } from "@/convex/configDefaults";
import { HOUSES } from "@/lib/fantasy";
import { useAdminConfig } from "@/hooks/use-admin-config";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  AlertTriangle,
  BadgeCheck,
  Coins,
  Gauge,
  Loader2,
  Lock,
  Palette,
  PartyPopper,
  Save,
  ScrollText,
  Sparkles,
  Trash2,
  Type,
  Unlock,
  Wallet,
} from "lucide-react";
import { useState } from "react";

// ── Super Admin customization engine UI ──────────────────────────────────
//
// Every configurable constant in the app is editable here, live, with no code
// redeploy: house names + brand colors + crests + mottos, award titles/icons/
// descriptions/thresholds, the budget & market rule window, the whole scoring
// matrix, every piece of user-facing copy, and the master Squad Builder switch.
//
// Three invariants hold across every editor below:
//   1. every numeric input is parsed with parseFloat/Number and re-validated
//      before it reaches a mutation,
//   2. every text input is trimmed and length-capped before committing,
//   3. every mutation is try/catch'd and reports a clean toast.
//
// The displayed values always come from `useAdminConfig()`, which layers
// hardcoded defaults UNDER the server response — so an undefined or corrupt
// field renders the default instead of `undefined`.

/**
 * Fields in the scoring matrix, in display order, with safe limits. `step`
 * marks the fractional fields (ratings, the captain multiplier); everything
 * else is rounded to an integer on save.
 */
type ScoringField = {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
};

const SCORING_FIELDS: readonly ScoringField[] = [
  { key: "goalGk", label: "Goal — GK", min: 0, max: 100 },
  { key: "goalDef", label: "Goal — DEF", min: 0, max: 100 },
  { key: "goalMid", label: "Goal — MID", min: 0, max: 100 },
  { key: "goalFwd", label: "Goal — FWD", min: 0, max: 100 },
  { key: "assist", label: "Assist", min: 0, max: 100 },
  { key: "cleanSheetGkDef", label: "Clean sheet (GK/DEF)", min: 0, max: 100 },
  { key: "cleanSheetMid", label: "Clean sheet (MID)", min: 0, max: 100 },
  { key: "savesPerPoint", label: "Saves per point (÷)", min: 1, max: 50 },
  { key: "yellowCard", label: "Yellow card", min: -100, max: 0 },
  { key: "redCard", label: "Red card", min: -100, max: 0 },
  { key: "ownGoal", label: "Own goal", min: -100, max: 0 },
  { key: "potmBonus", label: "Player of the match", min: 0, max: 100 },
  { key: "ratingBonus8Threshold", label: "Rating ≥ (bonus 1)", min: 0, max: 10, step: 0.1 },
  { key: "ratingBonus8Points", label: "Bonus 1 points", min: 0, max: 100 },
  { key: "ratingBonus9Threshold", label: "Rating ≥ (bonus 2)", min: 0, max: 10, step: 0.1 },
  { key: "ratingBonus9Points", label: "Bonus 2 points", min: 0, max: 100 },
  { key: "captainMultiplier", label: "Captain multiplier (×)", min: 1, max: 5, step: 0.5 },
];

const MARKET_FIELDS = [
  { key: "minBudget", label: "Minimum budget", money: true },
  { key: "defaultBudget", label: "Default starting budget", money: true },
  { key: "maxBudget", label: "Maximum budget", money: true },
  { key: "minPlayerPrice", label: "Min player price", money: true },
  { key: "maxPlayerPrice", label: "Max player price", money: true },
  { key: "maxTransfersPerGameweek", label: "Max transfers per GW (0 = ∞)" },
  { key: "panicThresholdMinutes", label: "Panic banner (mins before deadline)" },
  { key: "houseLimit", label: "Max players per house" },
] as const;

const UI_TEXT_FIELDS = [
  { key: "appTitle", label: "App title", max: 60 },
  { key: "appTagline", label: "Tagline", max: 120 },
  { key: "maintenanceTitle", label: "Maintenance screen title", max: 60 },
  { key: "maintenanceMessage", label: "Maintenance message", max: 400, long: true },
  { key: "instagramHandle", label: "Instagram handle", max: 40 },
  { key: "year12Banner", label: "Year 12 banner", max: 80 },
  { key: "year12Message", label: "Year 12 message", max: 240, long: true },
  { key: "goldMedalText", label: "Gold medal text", max: 60 },
  { key: "goldMedalHeadline", label: "Gold medal headline", max: 120 },
  { key: "forfeitText", label: "Forfeit badge text", max: 60 },
] as const;

const AWARD_ROWS = [
  { key: "tacticalGenius", label: "Tactical Genius", hint: "Highest total points" },
  { key: "unluckyManager", label: "Unlucky Manager", hint: "Lowest total points" },
  { key: "differentialMaster", label: "Differential Master", hint: "Most points from <15% owned" },
  { key: "playerOfTheWeek", label: "Player of the Week", hint: "Top scorer of latest gameweek" },
  { key: "goldenBoot", label: "Golden Boot", hint: "Top goalscorer" },
  { key: "goldenGlove", label: "Golden Glove", hint: "Most clean sheets" },
] as const;

/**
 * Local draft state for a numeric record. Values are kept as STRINGS while
 * editing (so a half-typed "-" or "7." doesn't get clobbered by a round-trip
 * through the server) and only strictly parsed on save.
 */
type NumDraft = Record<string, string>;

/** Strict numeric parse: returns null for NaN, Infinity and blank input. */
function strictNum(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Money-shaped strict parse: accepts "60m", "60.5m", "60000000". */
function strictMoney(raw: string): number | null {
  const parsed = parseMoneyInput(raw);
  return parsed !== null && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function CustomizationTab() {
  const {
    houseNames,
    houseBrand,
    awardDef,
    awardTitles,
    awards,
    badgeRegistry,
    tournamentEnded,
    year12Message,
    marketRules,
    scoringRules,
    uiText,
    editableSquads,
    instagramUrl,
  } = useAdminConfig();

  const setHouseNames = useMutation(api.adminConfig.setHouseNames);
  const setHouseBranding = useMutation(api.adminConfig.setHouseBranding);
  const setAwardTitles = useMutation(api.adminConfig.setAwardTitles);
  const setAwardDefs = useMutation(api.adminConfig.setAwardDefs);
  const setMarketRules = useMutation(api.adminConfig.setMarketRules);
  const setScoringRules = useMutation(api.adminConfig.setScoringRules);
  const setUiText = useMutation(api.adminConfig.setUiText);
  const setMasterReadOnly = useMutation(api.adminConfig.setMasterReadOnly);
  const upsertCustomBadge = useMutation(api.adminConfig.upsertCustomBadge);
  const setBudgetOverride = useMutation(api.adminConfig.setBudgetOverride);
  const setYear12Message = useMutation(api.adminConfig.setYear12Message);
  const endTournament = useMutation(api.tournament.endTournament);
  const usersResult = useQuery(api.usersAdmin.listUsers);

  // Safe fallback: undefined (loading) and null both render as an empty list.
  const users = (usersResult ?? []) as Array<{
    _id: Id<"users">;
    username: string | null;
    teamName: string | null;
  }>;

  const [busy, setBusy] = useState<string | null>(null);

  // ── House branding (name + color + crest + motto) ──
  const [brandDraft, setBrandDraft] = useState<
    Record<string, { name: string; color: string; logoUrl: string; motto: string }> | null
  >(null);
  const brandValue = (house: string) => {
    const live = houseBrand(house);
    return (
      brandDraft?.[house] ?? {
        name: live.name,
        color: live.color,
        logoUrl: live.logoUrl,
        motto: live.motto,
      }
    );
  };
  const setBrandField = (
    house: string,
    field: "name" | "color" | "logoUrl" | "motto",
    value: string,
  ) =>
    setBrandDraft((prev) => ({ ...(prev ?? {}), [house]: { ...brandValue(house), [field]: value } }));

  const saveBranding = async () => {
    setBusy("branding");
    try {
      const entries = HOUSES.map((house) => {
        const v = brandValue(house);
        const name = v.name.trim();
        if (name.length === 0 || name.length > 24) {
          throw new Error("House names must be 1-24 characters.");
        }
        const color = v.color.trim();
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
          throw new Error(`${name}: colour must be a hex code like "#e64530".`);
        }
        return {
          house,
          name,
          color,
          logoUrl: v.logoUrl.trim(),
          motto: v.motto.trim().slice(0, 120),
        };
      });
      // `house` is typed as the house id by HOUSES; the validator is strict.
      await setHouseBranding({ entries: entries as never });
      // Keep the legacy flat name copy in sync so older panels update too.
      await setHouseNames({
        houseNames: entries.map((e) => ({ house: e.house, name: e.name })) as never,
      });
      toast.success("House names, colours, crests and mottos saved.");
      setBrandDraft(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the house branding.");
    } finally {
      setBusy(null);
    }
  };

  // ── Award definitions (title + icon + description + threshold) ──
  const [awardDraft, setAwardDraft] = useState<Record<string, { title: string; icon: string; description: string; threshold: string }> | null>(null);
  const awardValue = (key: string) => {
    const live = awardDef(key);
    return (
      awardDraft?.[key] ?? {
        title: live.title,
        icon: live.icon,
        description: live.description,
        threshold: String(live.threshold ?? 0),
      }
    );
  };
  const setAwardField = (key: string, field: string, value: string) =>
    setAwardDraft((prev) => ({
      ...(prev ?? {}),
      [key]: { ...awardValue(key), [field]: value },
    }));

  const saveAwardDefs = async () => {
    setBusy("awardDefs");
    try {
      const entries = AWARD_ROWS.map((row) => {
        const v = awardValue(row.key);
        const title = v.title.trim();
        if (title.length === 0 || title.length > 40) {
          throw new Error("Award titles must be 1-40 characters.");
        }
        const threshold = strictNum(v.threshold);
        if (threshold === null || threshold < 0) {
          throw new Error(`${row.label}: threshold must be a positive number.`);
        }
        return {
          key: row.key,
          title,
          icon: v.icon.trim().slice(0, 8),
          description: v.description.trim().slice(0, 160),
          threshold: Math.round(threshold),
        };
      });
      await setAwardDefs({ entries });
      // Mirror into the legacy title/description record for older consumers.
      await setAwardTitles({
        titles: entries.map((e) => ({
          key: e.key,
          title: e.title,
          description: e.description,
        })) as never,
      });
      toast.success("Award titles, icons, descriptions and thresholds saved.");
      setAwardDraft(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the awards.");
    } finally {
      setBusy(null);
    }
  };

  // ── Market & budget rules ──
  const [marketDraft, setMarketDraft] = useState<NumDraft | null>(null);
  const marketValue = (key: string) => {
    const live = (marketRules as unknown as Record<string, number>)[key] ?? 0;
    return marketDraft?.[key] ?? String(live);
  };

  const saveMarketRules = async () => {
    setBusy("market");
    try {
      const patch: Record<string, number> = {};
      for (const field of MARKET_FIELDS) {
        const raw = marketValue(field.key);
        const parsed = "money" in field && field.money ? strictMoney(raw) : strictNum(raw);
        if (parsed === null) {
          throw new Error(`${field.label}: enter a valid number.`);
        }
        patch[field.key] = Math.round(parsed);
      }
      await setMarketRules(patch);
      toast.success(
        `Market rules saved — default budget ${formatMoney(patch.defaultBudget)}, prices ${formatMoney(
          patch.minPlayerPrice,
        )}–${formatMoney(patch.maxPlayerPrice)}.`,
      );
      setMarketDraft(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the market rules.");
    } finally {
      setBusy(null);
    }
  };

  // ── Scoring matrix ──
  const [scoringDraft, setScoringDraft] = useState<NumDraft | null>(null);
  const scoringValue = (key: string) => {
    const live = (scoringRules as unknown as Record<string, number>)[key] ?? 0;
    return scoringDraft?.[key] ?? String(live);
  };

  const saveScoringRules = async () => {
    setBusy("scoring");
    try {
      const rules: Record<string, number> = {};
      for (const field of SCORING_FIELDS) {
        const parsed = strictNum(scoringValue(field.key));
        if (parsed === null) {
          throw new Error(`${field.label}: enter a valid number.`);
        }
        if (parsed < field.min || parsed > field.max) {
          throw new Error(`${field.label}: must be between ${field.min} and ${field.max}.`);
        }
        rules[field.key] = field.step ? parsed : Math.round(parsed);
      }
      await setScoringRules({ rules });
      toast.success(
        `Scoring saved — GK/DEF ${rules.goalGk}pts, MID/FWD ${rules.goalMid}pts, captain ×${rules.captainMultiplier}.`,
      );
      setScoringDraft(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the scoring rules.");
    } finally {
      setBusy(null);
    }
  };

  // ── UI text & branding ──
  const [uiDraft, setUiDraft] = useState<Record<string, string> | null>(null);
  const uiValue = (key: string) => uiDraft?.[key] ?? (uiText as unknown as Record<string, string>)[key] ?? "";

  const saveUiText = async () => {
    setBusy("uiText");
    try {
      const handle = uiValue("instagramHandle").trim().replace(/^@/, "");
      if (handle.length > 0 && !/^[A-Za-z0-9._]{1,40}$/.test(handle)) {
        throw new Error("Instagram handles use letters, numbers, dots and underscores only.");
      }
      for (const field of UI_TEXT_FIELDS) {
        if ("long" in field && field.long) continue;
        if (uiValue(field.key).trim().length > field.max) {
          throw new Error(`${field.label} must be ${field.max} characters or fewer.`);
        }
      }
      const patch: Record<string, string> = {};
      for (const field of UI_TEXT_FIELDS) {
        const text = uiValue(field.key).trim();
        if (text.length === 0) continue; // empty = keep the current value
        patch[field.key] = text;
      }
      await setUiText(patch);
      toast.success("UI text saved across the whole platform.");
      setUiDraft(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the UI text.");
    } finally {
      setBusy(null);
    }
  };

  // ── Master read-only switch ──
  const [readOnlyBusy, setReadOnlyBusy] = useState(false);
  const toggleMasterReadOnly = async (editable: boolean) => {
    setReadOnlyBusy(true);
    try {
      await setMasterReadOnly({ editable });
      toast.success(
        editable
          ? "Squad Builder reopened for every manager."
          : "Squad Builder is now read-only for every manager.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the squad builder mode.");
    } finally {
      setReadOnlyBusy(false);
    }
  };

  // ── House names (legacy flat editor kept for muscle memory) ──
  const [houseInputs, setHouseInputs] = useState<Record<string, string> | null>(null);
  const houseValue = (house: string) =>
    (houseInputs ?? houseNames)[house] ?? houseNames[house] ?? house;

  const saveHouseNames = async () => {
    setBusy("houses");
    try {
      const payload = HOUSES.map((house) => ({
        house,
        name: houseValue(house).trim() || house,
      }));
      for (const entry of payload) {
        if (entry.name.length > 24) throw new Error("House names must be 1-24 characters.");
      }
      await setHouseNames({ houseNames: payload as never });
      toast.success("House names updated across the whole platform.");
      setHouseInputs(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the house names.");
    } finally {
      setBusy(null);
    }
  };

  // ── Award copy (legacy flat editor) ──
  const [awardInputs, setAwardInputs] = useState<Record<string, { title: string; description: string }> | null>(null);
  const awardCopy = (key: string) =>
    (awardInputs ?? awardTitles)[key] ?? { title: key, description: "" };

  const saveAwards = async () => {
    setBusy("awards");
    try {
      const titles = AWARD_ROWS.map((row) => ({
        key: row.key,
        title: awardCopy(row.key).title.trim(),
        description: awardCopy(row.key).description.trim(),
      }));
      for (const t of titles) {
        if (t.title.length < 1 || t.title.length > 40) {
          throw new Error("Award titles must be 1-40 characters.");
        }
        if (t.description.length < 1 || t.description.length > 160) {
          throw new Error("Award descriptions must be 1-160 characters.");
        }
      }
      await setAwardTitles({ titles: titles as never });
      toast.success("Award titles updated.");
      setAwardInputs(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the award titles.");
    } finally {
      setBusy(null);
    }
  };

  // ── Custom badge ──
  const [badgeId, setBadgeId] = useState("");
  const [badgeEmoji, setBadgeEmoji] = useState("");
  const [badgeLabel, setBadgeLabel] = useState("");

  const saveBadge = async () => {
    setBusy("badge");
    try {
      const id = badgeId.trim().toLowerCase();
      if (!/^[a-z0-9_]{2,24}$/.test(id)) {
        toast.error("Badge ID must be 2-24 characters: a-z, 0-9 or _");
        return;
      }
      if (badgeLabel.trim().length > 24) {
        toast.error("Badge label must be 24 characters or fewer.");
        return;
      }
      await upsertCustomBadge({ badgeId: id, emoji: badgeEmoji, label: badgeLabel });
      toast.success(`Badge "${id}" saved — assign it from the Roles tab.`);
      setBadgeId("");
      setBadgeEmoji("");
      setBadgeLabel("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the badge.");
    } finally {
      setBusy(null);
    }
  };

  const deleteBadge = async (id: string) => {
    setBusy(`del-${id}`);
    try {
      await upsertCustomBadge({ badgeId: id });
      toast.success(`Badge "${id}" removed.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the badge.");
    } finally {
      setBusy(null);
    }
  };

  const customBadges = Object.entries(badgeRegistry).filter(
    ([id]) => !["star", "gold_checkmark", "fire", "crown", "shield", "diamond", "contributor"].includes(id),
  );

  // ── Budget overrides ──
  const [budgetFor, setBudgetFor] = useState<Id<"users"> | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [budgetBusy, setBudgetBusy] = useState(false);

  const saveBudgetOverride = async () => {
    if (!budgetFor) return;
    // Empty input clears the override; otherwise strict-parse the amount.
    const trimmed = budgetInput.trim();
    let parsed: number | undefined;
    if (trimmed !== "") {
      parsed = strictMoney(trimmed) ?? undefined;
      if (parsed === undefined) {
        toast.error('Invalid budget — use e.g. "60m" or "60000000".');
        return;
      }
    }
    setBudgetBusy(true);
    try {
      const res = await setBudgetOverride({ userId: budgetFor, budget: parsed });
      toast.success(
        res?.hasOverride
          ? `Override set to ${formatMoney(res.budget)} (platform default ${formatMoney(safeBudget())}).`
          : "Override cleared — back to the platform budget.",
      );
      setBudgetFor(null);
      setBudgetInput("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set the budget override.");
    } finally {
      setBudgetBusy(false);
    }
  };

  // ── Year 12 message ──
  const [messageInput, setMessageInput] = useState<string | null>(null);
  const saveMessage = async () => {
    setBusy("message");
    try {
      const text = (messageInput ?? "").trim();
      if (text.length > 240) {
        toast.error("Message must be 240 characters or fewer.");
        return;
      }
      await setYear12Message({ message: text });
      toast.success("Year 12 message saved.");
      setMessageInput(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the message.");
    } finally {
      setBusy(null);
    }
  };

  // ── End tournament ──
  const [endOpen, setEndOpen] = useState(false);
  const [endConfirm, setEndConfirm] = useState("");
  const [endBusy, setEndBusy] = useState(false);

  const confirmEnd = async () => {
    setEndBusy(true);
    try {
      await endTournament({ ended: true });
      toast.success("Tournament ended — every manager now sees the Year 12 podium.");
      setEndOpen(false);
      setEndConfirm("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not end the tournament.");
    } finally {
      setEndBusy(false);
    }
  };

  const reopenTournament = async () => {
    setEndBusy(true);
    try {
      await endTournament({ ended: false });
      toast.success("Tournament reopened.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reopen the tournament.");
    } finally {
      setEndBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Emergency locks ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          className={cn(
            "border-2",
            editableSquads ? "border-border/80" : "border-amber-400/50 bg-amber-500/5",
          )}
        >
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
              {editableSquads ? (
                <Unlock className="size-4 text-emerald-300" />
              ) : (
                <Lock className="size-4 text-amber-300" />
              )}
              Squad Builder mode
            </CardTitle>
            <CardDescription>
              The master switch. Off makes every manager's squad builder read-only, on
              top of whatever the gameweek deadlines say.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">
                {editableSquads ? "🟢 Editable" : "🔒 Read-only platform-wide"}
              </p>
              <p className="text-muted-foreground text-xs">
                {editableSquads
                  ? "Managers can pick and save their seven."
                  : "Managers can view their squad but not change it."}
              </p>
            </div>
            <Switch
              checked={editableSquads}
              onCheckedChange={(v) => toggleMasterReadOnly(v === true)}
              disabled={readOnlyBusy}
            />
          </CardContent>
        </Card>

        <Card
          className={cn(
            "border-2",
            tournamentEnded
              ? "border-emerald-400/50 bg-emerald-500/5"
              : "border-red-400/50 bg-red-500/5",
          )}
        >
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
              <PartyPopper
                className={cn("size-4", tournamentEnded ? "text-emerald-300" : "text-red-300")}
              />
              Tournament lifecycle
            </CardTitle>
            <CardDescription>
              Ending the tournament locks every gameweek and switches every manager's dashboard
              to the "See you in Year 12!" celebration with the final podium.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Badge
                variant="outline"
                className={cn(
                  tournamentEnded
                    ? "border-emerald-400/50 text-emerald-300"
                    : "border-amber-400/50 text-amber-300",
                )}
              >
                {tournamentEnded ? "🏁 ENDED — Year 12 mode live" : "🟢 IN PROGRESS"}
              </Badge>
              {tournamentEnded ? (
                <Button variant="outline" onClick={reopenTournament} disabled={endBusy}>
                  {endBusy ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <AlertTriangle className="mr-1.5 size-4" />
                  )}
                  Reopen tournament
                </Button>
              ) : (
                <Button variant="destructive" onClick={() => setEndOpen(true)} disabled={endBusy}>
                  <PartyPopper className="mr-1.5 size-4" />
                  End Entire Tournament
                </Button>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="year12-msg">Year 12 celebration message</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="year12-msg"
                  value={messageInput ?? year12Message}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder="See you all in Year 12!"
                  maxLength={240}
                />
                <Button variant="outline" onClick={saveMessage} disabled={busy === "message"}>
                  <Save className="mr-1.5 size-4" /> Save
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── House branding ── */}
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <Palette className="text-primary size-4" /> House branding
          </CardTitle>
          <CardDescription>
            Rename, recolour, re-crest and re-motto all four houses. Colours are hex codes and
            are applied live across the bracket, standings and match center.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {HOUSES.map((house) => {
            const v = brandValue(house);
            return (
              <div
                key={house}
                className="grid gap-3 rounded-xl border border-border/60 p-3 sm:grid-cols-[auto_1fr_1fr]"
              >
                <div className="flex items-center gap-2 sm:flex-col">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-lg text-lg font-bold text-white ring-2 ring-white/20"
                    style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(v.color) ? v.color : "#64748b" }}
                    aria-hidden
                  >
                    {v.name.slice(0, 1).toUpperCase()}
                  </span>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`brand-name-${house}`}>Name</Label>
                  <Input
                    id={`brand-name-${house}`}
                    value={v.name}
                    onChange={(e) => setBrandField(house, "name", e.target.value)}
                    maxLength={24}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`brand-color-${house}`}>Brand colour</Label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      aria-label={`${house} colour picker`}
                      value={/^#[0-9a-fA-F]{6}$/.test(v.color) ? v.color : "#64748b"}
                      onChange={(e) => setBrandField(house, "color", e.target.value)}
                      className="h-9 w-12 cursor-pointer rounded-md border border-border bg-transparent"
                    />
                    <Input
                      id={`brand-color-${house}`}
                      value={v.color}
                      onChange={(e) => setBrandField(house, "color", e.target.value)}
                      placeholder="#e64530"
                      maxLength={7}
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor={`brand-motto-${house}`}>Motto</Label>
                  <Input
                    id={`brand-motto-${house}`}
                    value={v.motto}
                    onChange={(e) => setBrandField(house, "motto", e.target.value)}
                    maxLength={120}
                  />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor={`brand-logo-${house}`}>Crest / emblem URL</Label>
                  <Input
                    id={`brand-logo-${house}`}
                    value={v.logoUrl}
                    onChange={(e) => setBrandField(house, "logoUrl", e.target.value)}
                    placeholder="https://… or leave blank for the built-in crest"
                    maxLength={2000}
                  />
                  <p className="text-muted-foreground text-xs">
                    Only http(s) and inline image links are accepted.
                  </p>
                </div>
              </div>
            );
          })}
          <Button onClick={saveBranding} disabled={busy === "branding"}>
            {busy === "branding" ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 size-4" />
            )}
            Save house branding
          </Button>
        </CardContent>
      </Card>

      {/* ── Award definitions ── */}
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <Sparkles className="text-primary size-4" /> Award definitions
          </CardTitle>
          <CardDescription>
            Titles, icons, descriptions and the points threshold each award needs before it is
            handed out. These render on the dashboard awards card, leaderboard chips and the
            Player of the Week highlight.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {AWARD_ROWS.map((row) => {
            const v = awardValue(row.key);
            return (
              <div
                key={row.key}
                className="grid gap-2 rounded-xl border border-border/60 p-3 sm:grid-cols-[5rem_1fr_1fr_8rem]"
              >
                <div className="grid gap-1.5">
                  <Label htmlFor={`award-icon-${row.key}`}>Icon</Label>
                  <Input
                    id={`award-icon-${row.key}`}
                    value={v.icon}
                    onChange={(e) => setAwardField(row.key, "icon", e.target.value)}
                    placeholder="🏅"
                    maxLength={8}
                    className="text-center text-lg"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`award-title-${row.key}`}>{row.label}</Label>
                  <Input
                    id={`award-title-${row.key}`}
                    value={v.title}
                    onChange={(e) => setAwardField(row.key, "title", e.target.value)}
                    maxLength={40}
                    placeholder={row.hint}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`award-desc-${row.key}`}>Description</Label>
                  <Input
                    id={`award-desc-${row.key}`}
                    value={v.description}
                    onChange={(e) => setAwardField(row.key, "description", e.target.value)}
                    maxLength={160}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`award-threshold-${row.key}`}>Threshold</Label>
                  <Input
                    id={`award-threshold-${row.key}`}
                    value={v.threshold}
                    onChange={(e) => setAwardField(row.key, "threshold", e.target.value)}
                    inputMode="numeric"
                    placeholder="0"
                  />
                </div>
              </div>
            );
          })}
          <Button onClick={saveAwardDefs} disabled={busy === "awardDefs"}>
            {busy === "awardDefs" ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 size-4" />
            )}
            Save award definitions
          </Button>
        </CardContent>
      </Card>

      {/* ── Market & budget rules ── */}
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <Wallet className="text-primary size-4" /> Budget &amp; market rules
          </CardTitle>
          <CardDescription>
            The global starting budget, the price window every player and squad must sit inside,
            the panic-banner threshold and the transfer cap. Amounts accept "70m" or 70000000.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {MARKET_FIELDS.map((field) => {
              const isMoney = "money" in field && field.money;
              return (
                <div key={field.key} className="grid gap-1.5">
                  <Label htmlFor={`market-${field.key}`}>{field.label}</Label>
                  <Input
                    id={`market-${field.key}`}
                    value={marketValue(field.key)}
                    onChange={(e) =>
                      setMarketDraft((prev) => ({ ...(prev ?? {}), [field.key]: e.target.value }))
                    }
                    inputMode="decimal"
                    placeholder={isMoney ? "70m" : "0"}
                    className={isMoney ? "font-mono text-xs" : undefined}
                  />
                  {isMoney && (
                    <p className="text-muted-foreground text-[10px]">
                      ≈ {formatMoney(strictMoney(marketValue(field.key)) ?? 0)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <Button onClick={saveMarketRules} disabled={busy === "market"}>
            {busy === "market" ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Coins className="mr-1.5 size-4" />
            )}
            Save market rules
          </Button>
        </CardContent>
      </Card>

      {/* ── Scoring matrix ── */}
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <Gauge className="text-primary size-4" /> Scoring rule matrix
          </CardTitle>
          <CardDescription>
            Every point value in the game. Changing a rule here re-scores nothing retroactively —
            it applies from the next match you save, and recalculating a match applies it to that
            match immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SCORING_FIELDS.map((field) => (
              <div key={field.key} className="grid gap-1.5">
                <Label htmlFor={`scoring-${field.key}`}>{field.label}</Label>
                <Input
                  id={`scoring-${field.key}`}
                  value={scoringValue(field.key)}
                  onChange={(e) =>
                    setScoringDraft((prev) => ({ ...(prev ?? {}), [field.key]: e.target.value }))
                  }
                  inputMode="decimal"
                  placeholder="0"
                  className="font-mono text-xs"
                />
                <p className="text-muted-foreground text-[10px]">
                  allowed {field.min} – {field.max}
                </p>
              </div>
            ))}
          </div>
          <Button onClick={saveScoringRules} disabled={busy === "scoring"}>
            {busy === "scoring" ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 size-4" />
            )}
            Save scoring rules
          </Button>
        </CardContent>
      </Card>

      {/* ── UI text & branding ── */}
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <Type className="text-primary size-4" /> UI text &amp; branding
          </CardTitle>
          <CardDescription>
            App title, maintenance copy, the Instagram contact link and every celebration string.
            Leave a field blank to keep its current value.{" "}
            <a
              href={instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              {uiText.instagramHandle}
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {UI_TEXT_FIELDS.map((field) => {
              const isLong = "long" in field && field.long;
              return (
                <div
                  key={field.key}
                  className={cn("grid gap-1.5", isLong && "sm:col-span-2")}
                >
                  <Label htmlFor={`uitext-${field.key}`}>{field.label}</Label>
                  {isLong ? (
                    <Textarea
                      id={`uitext-${field.key}`}
                      value={uiValue(field.key)}
                      onChange={(e) =>
                        setUiDraft((prev) => ({ ...(prev ?? {}), [field.key]: e.target.value }))
                      }
                      rows={2}
                      maxLength={field.max}
                    />
                  ) : (
                    <Input
                      id={`uitext-${field.key}`}
                      value={uiValue(field.key)}
                      onChange={(e) =>
                        setUiDraft((prev) => ({ ...(prev ?? {}), [field.key]: e.target.value }))
                      }
                      maxLength={field.max}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <Button onClick={saveUiText} disabled={busy === "uiText"}>
            {busy === "uiText" ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 size-4" />
            )}
            Save UI text
          </Button>
        </CardContent>
      </Card>

      {/* ── House names (quick rename) ── */}
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <ScrollText className="size-4" /> Quick rename
          </CardTitle>
          <CardDescription>
            Names only — the same fields as House branding, for when you just want to retype them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {HOUSES.map((house) => (
              <div key={house} className="grid gap-1.5">
                <Label htmlFor={`house-${house}`}>{house}</Label>
                <Input
                  id={`house-${house}`}
                  value={houseValue(house)}
                  onChange={(e) =>
                    setHouseInputs((prev) => ({ ...(prev ?? houseNames), [house]: e.target.value }))
                  }
                  maxLength={24}
                />
              </div>
            ))}
          </div>
          <Button variant="outline" onClick={saveHouseNames} disabled={busy === "houses"}>
            {busy === "houses" ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 size-4" />
            )}
            Save names only
          </Button>
        </CardContent>
      </Card>

      {/* ── Award copy (quick titles) ── */}
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <Sparkles className="size-4" /> Quick award copy
          </CardTitle>
          <CardDescription>
            Titles and descriptions only, for the four headline awards.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {AWARD_ROWS.slice(0, 4).map((row) => (
            <div key={row.key} className="grid gap-1.5 rounded-xl border border-border/60 p-3">
              <Label htmlFor={`quick-award-${row.key}`}>{row.label}</Label>
              <Input
                id={`quick-award-${row.key}`}
                value={awardCopy(row.key).title}
                onChange={(e) =>
                  setAwardInputs((prev) => ({
                    ...(prev ?? awardTitles),
                    [row.key]: { ...awardCopy(row.key), title: e.target.value },
                  }))
                }
                maxLength={40}
                placeholder={row.hint}
              />
              <Input
                value={awardCopy(row.key).description}
                onChange={(e) =>
                  setAwardInputs((prev) => ({
                    ...(prev ?? awardTitles),
                    [row.key]: { ...awardCopy(row.key), description: e.target.value },
                  }))
                }
                maxLength={160}
                placeholder="Shown when no one has earned it yet"
              />
            </div>
          ))}
          <Button variant="outline" onClick={saveAwards} disabled={busy === "awards"}>
            {busy === "awards" ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 size-4" />
            )}
            Save award copy
          </Button>
        </CardContent>
      </Card>

      {/* ── Custom badges ── */}
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <BadgeCheck className="text-primary size-4" /> Custom badges
          </CardTitle>
          <CardDescription>
            Create your own badge variants, then assign them to any manager from the Roles tab.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_5rem_1fr_auto]">
            <Input
              value={badgeId}
              onChange={(e) => setBadgeId(e.target.value)}
              placeholder="badge id (e.g. legend)"
              maxLength={24}
            />
            <Input
              value={badgeEmoji}
              onChange={(e) => setBadgeEmoji(e.target.value)}
              placeholder="🏅"
              maxLength={8}
            />
            <Input
              value={badgeLabel}
              onChange={(e) => setBadgeLabel(e.target.value)}
              placeholder="Label (e.g. Legend)"
              maxLength={24}
            />
            <Button onClick={saveBadge} disabled={busy === "badge"}>
              {busy === "badge" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
            </Button>
          </div>
          {customBadges.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {customBadges.map(([id, meta]) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-secondary/40 px-2.5 py-1 text-xs"
                >
                  <span>{meta.emoji}</span>
                  <span className="font-semibold">{meta.label}</span>
                  <code className="text-muted-foreground text-[10px]">{id}</code>
                  <button
                    onClick={() => deleteBadge(id)}
                    disabled={busy === `del-${id}`}
                    title="Delete badge"
                    className="text-destructive transition-colors hover:text-destructive/80"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Budget overrides ── */}
      <Card className="border-border/80">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
            <Wallet className="text-primary size-4" /> Per-manager budget overrides
          </CardTitle>
          <CardDescription>
            Every manager starts at the platform default of{" "}
            <strong>{formatMoney(marketRules.defaultBudget)}</strong>. An override is always
            clamped into the min/max window configured above.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              No users found — or your account doesn't have access to this list.
            </p>
          ) : (
            <div className="grid gap-2">
              {users.map((u) => (
                <div
                  key={u._id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-secondary/30 px-3 py-2"
                >
                  <span className="text-sm font-semibold">
                    @{u.username ?? "unknown"}
                    <span className="text-muted-foreground ml-2 text-xs">
                      {u.teamName ?? "Unnamed team"}
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    <UserBudgetOverride userId={u._id} />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setBudgetFor(u._id);
                        setBudgetInput("");
                      }}
                    >
                      Override
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Budget override dialog ── */}
      <Dialog
        open={budgetFor !== null}
        onOpenChange={(open) => {
          if (!open) setBudgetFor(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="text-primary size-4" /> Budget override
            </DialogTitle>
            <DialogDescription>
              Set this manager's budget between{" "}
              <span className="text-foreground font-semibold">
                {formatMoney(marketRules.minBudget)}
              </span>{" "}
              and{" "}
              <span className="text-foreground font-semibold">
                {formatMoney(marketRules.maxBudget)}
              </span>
              . Leave the field blank to clear the override and restore the platform default.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="override-budget">New budget</Label>
            <Input
              id="override-budget"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              placeholder='e.g. "60m" — or blank to clear'
              autoFocus
            />
            {budgetInput.trim() !== "" && strictMoney(budgetInput) === null && (
              <p className="text-destructive text-xs">
                Invalid amount — use 60m, 60.5m or 60000000.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBudgetFor(null)}>
              Cancel
            </Button>
            <Button onClick={saveBudgetOverride} disabled={budgetBusy}>
              {budgetBusy ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Wallet className="mr-1.5 size-4" />
              )}
              Save override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── End tournament confirmation ── */}
      <Dialog open={endOpen} onOpenChange={(open) => !open && setEndOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" /> End the entire tournament?
            </DialogTitle>
            <DialogDescription>
              This is the final call. Ending the tournament:
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
                <li>Locks every gameweek — no more transfers or match edits.</li>
                <li>Freezes the final standings and the Hall of Fame podium.</li>
                <li>
                  Switches every manager's dashboard to the{" "}
                  <strong>"See you in Year 12!"</strong> celebration screen.
                </li>
                <li>Assigns the ⚠️ Forfeit badge to the bottom-place manager(s).</li>
              </ul>
              <p className="mt-3 font-semibold">
                Type <span className="text-destructive">END</span> to confirm.
              </p>
            </DialogDescription>
          </DialogHeader>
          <Input
            value={endConfirm}
            onChange={(e) => setEndConfirm(e.target.value)}
            placeholder="END"
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEndOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmEnd}
              disabled={endBusy || endConfirm.trim().toUpperCase() !== "END"}
            >
              {endBusy ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <PartyPopper className="mr-1.5 size-4" />
              )}
              End tournament
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Shows a manager's effective budget + whether an override is active. */
function UserBudgetOverride({ userId }: { userId: Id<"users"> }) {
  const { budgetOverrides } = useAdminConfig();
  const override = budgetOverrides[String(userId)];
  const hasOverride = typeof override === "number" && override > 0;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-score text-sm font-bold">
        {formatMoney(hasOverride ? toSafeAmount(override) : safeBudget())}
      </span>
      {hasOverride && (
        <Badge variant="outline" className="px-1.5 py-0 text-[9px] uppercase">
          override
        </Badge>
      )}
    </span>
  );
}
