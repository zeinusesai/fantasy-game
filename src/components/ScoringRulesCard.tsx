import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { resolveScoringRules } from "@/convex/points";
import { POSITION_LABELS } from "@/lib/fantasy";
import { Gauge, Loader2, Minus, Sparkles, Zap } from "lucide-react";
import { useNavigate } from "react-router";

/**
 * Live "Scoring Rules" panel for the manager dashboard.
 *
 * DYNAMIC SYNC: the numbers come straight from `systemConfig.scoringRules`
 * (the same matrix the Super Admin edits in Admin → Customize and the same one
 * the scoring engine uses), so any admin retune is reflected here instantly —
 * `useQuery` is reactive, no reload needed.
 *
 * FALLBACK SAFE STATE: the query may be `undefined` (loading), a partial rules
 * object, or outright missing. `resolveScoringRules` is a *total* function — it
 * coerces any input (null, a string, NaN-filled junk) into a complete, finite,
 * in-range matrix — so this panel can never render `NaN`, `undefined` or crash.
 */
export function ScoringRulesCard() {
  const config = useQuery(api.config.getConfig);
  const navigate = useNavigate();

  // One defensive call: garbage in → complete, safe rules out.
  const rules = resolveScoringRules(config?.scoringRules);

  const goals: Array<{ position: keyof typeof POSITION_LABELS; points: number }> = [
    { position: "GK", points: rules.goalGk },
    { position: "DEF", points: rules.goalDef },
    { position: "MID", points: rules.goalMid },
    { position: "FWD", points: rules.goalFwd },
  ];

  const positives = [
    { label: "Assist", value: `+${rules.assist}` },
    { label: "Clean sheet · GK/DEF", value: `+${rules.cleanSheetGkDef}` },
    { label: "Clean sheet · MID", value: `+${rules.cleanSheetMid}` },
    {
      label: `Saves · GK (per ${rules.savesPerPoint})`,
      value: "+1",
    },
    { label: "Player of the Match", value: `+${rules.potmBonus}` },
    {
      label: `Rating ≥ ${rules.ratingBonus8Threshold}`,
      value: `+${rules.ratingBonus8Points}`,
    },
  ];

  const negatives = [
    { label: "Yellow card", value: rules.yellowCard },
    { label: "Red card", value: rules.redCard },
    { label: "Own goal", value: rules.ownGoal },
  ];

  return (
    <Card className="border-border/80">
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2 text-lg font-bold uppercase tracking-wide">
          <Gauge className="text-primary size-4" /> Scoring rules
          {config === undefined && <Loader2 className="size-3.5 animate-spin opacity-60" />}
        </CardTitle>
        <CardDescription>
          Exactly how points are awarded. These numbers update live whenever the
          Super Admin retunes the scoring matrix — no refresh needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Goals — position-keyed */}
        <div>
          <p className="text-muted-foreground mb-2 text-[11px] font-bold uppercase tracking-widest">
            Goals
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {goals.map((g) => (
              <div
                key={g.position}
                className="rounded-lg border border-border/70 bg-secondary/40 px-3 py-2"
              >
                <p className="font-score text-lg font-bold text-primary">
                  +{g.points}
                </p>
                <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wide">
                  {POSITION_LABELS[g.position] ?? g.position}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Everything that adds points */}
        <div>
          <p className="text-muted-foreground mb-2 text-[11px] font-bold uppercase tracking-widest">
            Bonuses
          </p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {positives.map((p) => (
              <li
                key={p.label}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-1 text-sm even:bg-secondary/30"
              >
                <span className="text-muted-foreground">{p.label}</span>
                <span className="font-score font-bold text-emerald-400">{p.value}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Deductions */}
        <div>
          <p className="text-muted-foreground mb-2 text-[11px] font-bold uppercase tracking-widest">
            Deductions
          </p>
          <ul className="grid gap-1.5 sm:grid-cols-3">
            {negatives.map((p) => (
              <li
                key={p.label}
                className="flex items-center justify-between gap-3 rounded-md bg-secondary/30 px-2 py-1 text-sm"
              >
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Minus className="size-3" />
                  {p.label}
                </span>
                <span className="font-score font-bold text-rose-400">
                  {p.value > 0 ? `-${p.value}` : p.value}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Multipliers */}
        <div>
          <p className="text-muted-foreground mb-2 text-[11px] font-bold uppercase tracking-widest">
            Multipliers
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <MultiplierTile
              icon={<Sparkles className="size-3.5" />}
              label="Captain"
              value={`×${rules.captainMultiplier}`}
              note="your captain's points"
            />
            <MultiplierTile
              icon={<Zap className="size-3.5" />}
              label="Double Down chip"
              value="×2"
              note="all team points that gameweek"
            />
            <MultiplierTile
              icon={<Gauge className="size-3.5" />}
              label={`Rating ≥ ${rules.ratingBonus9Threshold}`}
              value={`+${rules.ratingBonus9Points}`}
              note={`at ${rules.ratingBonus9Threshold} and above`}
            />
          </div>
        </div>

        <p className="text-muted-foreground text-[11px]">
          Admins can adjust every number above in{" "}
          <button
            type="button"
            onClick={() => navigate("/admin")}
            className="text-primary font-semibold underline-offset-2 hover:underline"
          >
            Admin → Customize
          </button>
          .
        </p>
      </CardContent>
    </Card>
  );
}

function MultiplierTile({
  icon,
  label,
  value,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2">
      <p className="text-amber-300 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide">
        {icon}
        {label}
      </p>
      <p className="font-score text-lg font-bold text-amber-200">{value}</p>
      <p className="text-muted-foreground text-[11px]">{note}</p>
    </div>
  );
}