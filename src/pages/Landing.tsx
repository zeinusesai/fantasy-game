import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HouseCrest } from "@/components/houses";
import {
  HOUSES,
  HOUSE_DESCRIPTIONS,
  HOUSE_GRADIENTS,
  SCORING_RULE_LINES,
} from "@/lib/fantasy";
import { useAuth } from "@/hooks/use-auth";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  Play,
  Swords,
  Timer,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import { Link, useNavigate } from "react-router";

export default function Landing() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const leaderboard = useQuery(api.managers.getLeaderboard);
  const top = (leaderboard ?? []).slice(0, 3);

  return (
    <div className="stadium-bg min-h-screen">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="from-primary to-primary/60 flex size-9 items-center justify-center rounded-lg bg-gradient-to-br text-primary-foreground shadow-md">
              <Swords className="size-5" />
            </span>
            <span className="font-display text-2xl font-bold tracking-wide">
              HOUSE<span className="text-primary">CUP</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <Button onClick={() => navigate("/dashboard")}>
                Open Dashboard <ArrowRight className="ml-1 size-4" />
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => navigate("/auth?mode=signin")}>
                  Sign in
                </Button>
                <Button onClick={() => navigate("/auth")}>
                  Join the league <ArrowRight className="ml-1 size-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-16 lg:grid-cols-2 lg:items-center lg:py-24">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Badge variant="outline" className="border-primary/40 text-primary mb-4 gap-1.5">
              <Trophy className="size-3.5" /> Interhouse Tournament · Season 1
            </Badge>
            <h1 className="font-display text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
              Four houses.
              <br />
              One <span className="text-primary text-glow">cup.</span>
              <br />
              Your fantasy squad.
            </h1>
            <p className="text-muted-foreground mt-5 max-w-lg text-lg leading-relaxed">
              Fire, Earth, Wind and Water battle it out on the pitch. Build a 7-a-side
              fantasy team from real school players, pick your captain, and climb the
              global leaderboard as the tournament unfolds.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {isAuthenticated ? (
                <Button size="lg" onClick={() => navigate("/squad")}>
                  Build your squad <ArrowRight className="ml-1 size-4" />
                </Button>
              ) : (
                <Button size="lg" onClick={() => navigate("/auth")}>
                  Create your team <ArrowRight className="ml-1 size-4" />
                </Button>
              )}
              <Button size="lg" variant="outline" onClick={() => navigate("/tournament")}>
                <Play className="mr-1 size-4" /> View bracket
              </Button>
            </div>
            <div className="text-muted-foreground mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="flex items-center gap-1.5">
                <Users className="size-4 text-primary" /> 7-a-side fantasy squads
              </span>
              <span className="flex items-center gap-1.5">
                <Zap className="size-4 text-primary" /> $100m starting budget
              </span>
              <span className="flex items-center gap-1.5">
                <Timer className="size-4 text-primary" /> Live match centers
              </span>
            </div>
          </motion.div>

          {/* Bracket teaser card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="relative"
          >
            <div className="absolute -inset-4 rounded-3xl bg-primary/5 blur-2xl" aria-hidden />
            <Card className="card-sheen relative border-border/80 shadow-2xl">
              <CardContent className="space-y-4 p-6">
                <div className="flex items-center justify-between">
                  <span className="font-display text-lg font-bold uppercase tracking-wide">
                    Tournament bracket
                  </span>
                  <Badge variant="secondary" className="gap-1">
                    <Trophy className="size-3" /> Knockout
                  </Badge>
                </div>
                {[
                  { stage: "Semifinal 1", home: "Fire", away: "Earth", score: null },
                  { stage: "Semifinal 2", home: "Wind", away: "Water", score: null },
                ].map((m, i) => (
                  <div key={i} className="rounded-xl border border-border/70 bg-secondary/40 p-3">
                    <p className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-widest">
                      {m.stage}
                    </p>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 font-semibold">
                        <HouseCrest house={m.home as never} size={28} /> {m.home}
                      </span>
                      <span className="font-score text-muted-foreground text-sm font-bold">vs</span>
                      <span className="flex items-center gap-2 font-semibold">
                        {m.away} <HouseCrest house={m.away as never} size={28} />
                      </span>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/10 p-3">
                  <span className="font-display flex items-center gap-2 text-sm font-bold uppercase">
                    <Trophy className="text-primary size-4" /> Final — winner takes the cup
                  </span>
                  <Link
                    to="/tournament"
                    className="text-primary hover:text-primary/80 text-xs font-semibold"
                  >
                    Follow live →
                  </Link>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* Houses */}
      <section className="mx-auto w-full max-w-7xl px-4 py-12">
        <h2 className="font-display text-3xl font-bold tracking-tight">The four houses</h2>
        <p className="text-muted-foreground mt-1">Every player belongs to a house — scout them all.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {HOUSES.map((house, i) => (
            <motion.div
              key={house}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: i * 0.07 }}
            >
              <Card className={cnHouseCard(house)}>
                <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
                  <HouseCrest house={house} size={64} />
                  <div>
                    <h3 className="font-display text-xl font-bold">{house}</h3>
                    <p className="text-muted-foreground mt-1 text-sm">{HOUSE_DESCRIPTIONS[house]}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works + scoring */}
      <section className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-12 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight">How it works</h2>
          <ol className="mt-6 space-y-4">
            {[
              {
                title: "Register your team",
                body: "Pick a username, team name and crest. You get a $100m budget to spend.",
              },
              {
                title: "Draft 7 starters",
                body: "1 GK, 2 DEF, 2 MID, 2 FWD — max 3 players from any single house.",
              },
              {
                title: "Name your captain",
                body: "Your captain's fantasy points are doubled every single match.",
              },
              {
                title: "Climb the leaderboard",
                body: "Points are banked automatically after every recorded fixture.",
              },
            ].map((step, i) => (
              <li key={i} className="flex gap-4">
                <span className="font-score bg-primary/15 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg text-lg font-bold">
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-semibold">{step.title}</h3>
                  <p className="text-muted-foreground text-sm">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight">Scoring</h2>
          <p className="text-muted-foreground mt-1 text-sm">Fantasy points, straight from the match report.</p>
          <Card className="mt-6">
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 p-6 text-sm sm:grid-cols-3 lg:grid-cols-2">
              {SCORING_RULE_LINES.map((rule) => (
                <div key={rule.label} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{rule.label}</span>
                  <span
                    className={`font-score font-bold ${
                      rule.points.startsWith("+")
                        ? "text-emerald-400"
                        : rule.points.startsWith("-")
                          ? "text-red-400"
                          : "text-primary"
                    }`}
                  >
                    {rule.points}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Top managers strip */}
      {top.length > 0 && (
        <section className="mx-auto w-full max-w-7xl px-4 pb-16">
          <Card className="card-sheen border-border/80">
            <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display flex items-center gap-2 text-2xl font-bold">
                  <BarChart3 className="text-primary size-5" /> Current top managers
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  {top
                    .map((m, i) => `${i + 1}. ${m.teamName} (${m.totalPoints} pts)`)
                    .join("  ·  ")}
                </p>
              </div>
              <Button variant="outline" onClick={() => navigate("/leaderboard")}>
                Full leaderboard <ArrowRight className="ml-1 size-4" />
              </Button>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Final CTA */}
      <section className="border-t border-border/60">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-4 px-4 py-16 text-center">
          <h2 className="font-display text-4xl font-extrabold tracking-tight">
            The cup won't win itself.
          </h2>
          <p className="text-muted-foreground max-w-md">
            Register, draft your seven, and prove you're the sharpest manager in school.
          </p>
          <Button size="lg" className="mt-2" onClick={() => navigate(isAuthenticated ? "/squad" : "/auth")}>
            {isAuthenticated ? "Go to my squad" : "Sign up free"} <ArrowRight className="ml-1 size-4" />
          </Button>
        </div>
      </section>

      <footer className="text-muted-foreground border-t border-border/60 py-6 text-center text-xs">
        House Cup · Interhouse Tournament & Fantasy League
      </footer>
    </div>
  );
}

function cnHouseCard(house: string) {
  const map: Record<string, string> = {
    Fire: "hover:border-red-500/50",
    Earth: "hover:border-emerald-500/50",
    Wind: "hover:border-amber-400/50",
    Water: "hover:border-blue-500/50",
  };
  return `card-sheen border-border/80 transition-colors ${map[house] ?? ""}`;
}
