import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { scoringRuleLines } from "@/lib/fantasy";
import { useAuth } from "@/hooks/use-auth";
import { useAdminConfig } from "@/hooks/use-admin-config";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  Dribbble,
  Flame,
  Play,
  Shield,
  Swords,
  Timer,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import { Link, useNavigate } from "react-router";

/**
 * Y11 PE Hub — public landing page.
 *
 * Rebranded away from the old four-house / elemental theme onto a sleek
 * PE & sports aesthetic: deep slate background, glassmorphic containers and
 * electric-teal + gold accents (see src/index.css for the token values).
 */
export default function Landing() {
  const { isAuthenticated } = useAuth();
  // Live scoring matrix — the Super Admin can retune every value from the
  // Customization tab, so the public rules table must reflect the config.
  const { scoringRules, uiText } = useAdminConfig();
  const navigate = useNavigate();
  const leaderboard = useQuery(api.managers.getLeaderboard);
  const top = (leaderboard ?? []).slice(0, 3);

  return (
    <div className="stadium-bg min-h-screen bg-slate-950">
      {/* Nav */}
      <header className="border-b border-white/10 bg-slate-950/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-lg border border-teal-400/40 bg-teal-400/10 text-teal-300">
              <Swords className="size-5" />
            </span>
            <span className="font-display text-2xl font-bold tracking-wide text-white">
              Y11 <span className="text-teal-300">PE HUB</span>
            </span>
          </Link>
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
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(20,184,166,0.16),transparent_55%)]"
          aria-hidden
        />
        <div className="relative mx-auto w-full max-w-7xl px-4 py-16 lg:py-24">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="max-w-3xl"
          >
            <Badge
              variant="outline"
              className="mb-4 gap-1.5 border-teal-400/40 bg-teal-400/10 text-teal-300"
            >
              <Trophy className="size-3.5" /> {uiText.appTitle} · Season 1
            </Badge>
            <h1 className="font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-6xl">
              Thirty gameweeks.
              <br />
              One <span className="text-teal-300">pitch.</span>
              <br />
              Your seven.
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-slate-400">
              A fresh friendly is drawn every week of the PE year. Draft a 7-a-side
              fantasy team from the real Year 11 roster, pick your captain, and climb
              the leaderboard as the gameweeks roll on.
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
              <Button size="lg" variant="outline" onClick={() => navigate("/leaderboard")}>
                <Play className="mr-1 size-4" /> See the standings
              </Button>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-400">
              <span className="flex items-center gap-1.5">
                <Users className="size-4 text-teal-300" /> 7-a-side fantasy squads
              </span>
              <span className="flex items-center gap-1.5">
                <Zap className="size-4 text-teal-300" /> $70m starting budget
              </span>
              <span className="flex items-center gap-1.5">
                <Timer className="size-4 text-teal-300" /> Live match centers
              </span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* PE feature grid */}
      <section className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6">
        <h2 className="font-display text-3xl font-bold tracking-tight text-white">
          Built for the PE year
        </h2>
        <p className="mt-1 text-slate-400">
          Skill tiers, tactical formations and a brand new fixture every single week.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: Swords,
              title: "Weekly friendlies",
              body: "Dynamic, randomized 7-a-side matchups drawn fresh for every gameweek — never a fixed fixture list.",
              tone: "text-teal-300 border-teal-400/30 bg-teal-400/10",
            },
            {
              icon: Shield,
              title: "Tight formations",
              body: "1-2-3-1, 1-3-2-1, 1-2-2-2. Goalkeepers are locked to the GK slot — no square pegs.",
              tone: "text-amber-300 border-amber-400/30 bg-amber-400/10",
            },
            {
              icon: Flame,
              title: "Skill tiers & form",
              body: "Numeric Tier 1–5 badges, points per gameweek and a 🔥 Hot / ❄️ Cold form trend on every card.",
              tone: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
            },
            {
              icon: Dribbble,
              title: "Your locker",
              body: "Equip pitch skins, entrance stingers and a retro 8-bit pixel theme for your whole profile.",
              tone: "text-sky-300 border-sky-400/30 bg-sky-400/10",
            },
          ].map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: i * 0.07 }}
            >
              <Card className="card-sheen h-full border-white/10 bg-white/[0.03] transition-colors hover:border-teal-400/40">
                <CardContent className="flex h-full flex-col gap-3 p-6">
                  <span
                    className={`flex size-10 items-center justify-center rounded-lg border ${f.tone}`}
                  >
                    <f.icon className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-display text-lg font-bold text-white">{f.title}</h3>
                    <p className="mt-1 text-sm text-slate-400">{f.body}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works + scoring */}
      <section className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight text-white">
            How it works
          </h2>
          <ol className="mt-6 space-y-4">
            {[
              {
                title: "Register your team",
                body: "Pick a username, team name and crest. You get a $70m budget to spend.",
              },
              {
                title: "Draft 7 starters",
                body: "1 GK, 2 DEF, 2 MID, 2 FWD — or switch to a 1-3-2-1 / 1-2-2-2 shape.",
              },
              {
                title: "Name your captain",
                body: "Your captain's fantasy points are doubled every single match.",
              },
              {
                title: "Climb the leaderboard",
                body: "Every manager sits on 0 pts from day one — GW1 scores land the moment it closes.",
              },
            ].map((step, i) => (
              <li key={i} className="flex gap-4">
                <span className="font-score flex size-9 shrink-0 items-center justify-center rounded-lg border border-teal-400/30 bg-teal-400/10 text-lg font-bold text-teal-300">
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-semibold text-white">{step.title}</h3>
                  <p className="text-sm text-slate-400">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h2 className="font-display text-3xl font-bold tracking-tight text-white">Scoring</h2>
          <p className="mt-1 text-sm text-slate-400">
            Fantasy points, straight from the match report.
          </p>
          <Card className="mt-6 border-white/10 bg-white/[0.03]">
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 p-6 text-sm sm:grid-cols-3 lg:grid-cols-2">
              {scoringRuleLines(scoringRules).map((rule) => (
                <div key={rule.label} className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">{rule.label}</span>
                  <span
                    className={`font-score font-bold ${
                      rule.points.startsWith("+")
                        ? "text-emerald-400"
                        : rule.points.startsWith("-")
                          ? "text-red-400"
                          : "text-teal-300"
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
        <section className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6">
          <Card className="card-sheen border-white/10 bg-white/[0.03]">
            <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display flex items-center gap-2 text-2xl font-bold text-white">
                  <BarChart3 className="size-5 text-teal-300" /> Current top managers
                </h2>
                <p className="mt-1 text-sm text-slate-400">
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
      <section className="border-t border-white/10">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-4 px-4 py-16 text-center">
          <h2 className="font-display text-4xl font-extrabold tracking-tight text-white">
            The pitch won't pick itself.
          </h2>
          <p className="max-w-md text-slate-400">
            Register, draft your seven, and prove you're the sharpest manager in Year 11.
          </p>
          <Button
            size="lg"
            className="mt-2"
            onClick={() => navigate(isAuthenticated ? "/squad" : "/auth")}
          >
            {isAuthenticated ? "Go to my squad" : "Sign up free"}{" "}
            <ArrowRight className="ml-1 size-4" />
          </Button>
        </div>
      </section>

      <footer className="border-t border-white/10 py-6 text-center text-xs text-slate-400">
        {uiText.appTitle} · Year 11 PE · 7-a-side Fantasy League
      </footer>
    </div>
  );
}
