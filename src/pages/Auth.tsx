import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/convex/_generated/api";
import { AVATAR_PRESETS, avatarPresetUrl } from "@/lib/fantasy";
import { cn } from "@/lib/utils";
import { Eye, EyeOff, Loader2, LogIn, Swords, UserPlus } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "convex/react";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(returnTo: string | null, fallback = "/dashboard") {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) return returnTo;
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );

  const [mode, setMode] = useState<"signin" | "signup">(
    searchParams.get("mode") === "signin" ? "signin" : "signup",
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [avatar, setAvatar] = useState<string>(AVATAR_PRESETS[0].id);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Username availability hint (case-insensitive, checked server-side).
  const usernameClean = username.trim().toLowerCase();
  const validUsername = /^[a-zA-Z0-9_]{3,24}$/.test(username.trim());
  const taken = useQuery(
    api.managers.getUsernameExists,
    mode === "signup" && validUsername ? { username: usernameClean } : "skip",
  );

  useEffect(() => {
    if (!authLoading && isAuthenticated) navigate(redirect, { replace: true });
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      if (mode === "signup") {
        if (!validUsername) throw new Error("Username must be 3-24 letters, numbers or underscores.");
        if (taken) throw new Error("That username is already taken.");
        if (password.length < 4) throw new Error("Password must be at least 4 characters.");
        if (teamName.trim().length < 2) throw new Error("Team name must be at least 2 characters.");
        await signIn("password", {
          flow: "signUp",
          username: username.trim(),
          password,
          teamName: teamName.trim(),
          avatar,
        });
      } else {
        await signIn("password", {
          flow: "signIn",
          username: username.trim(),
          password,
        });
      }
      navigate(redirect, { replace: true });
    } catch (err) {
      // Generic, account-existence-safe messaging: any credential failure maps
      // to the same string, so a wrong username can't be told apart from a
      // wrong password. Validation errors thrown above still pass through.
      const raw = err instanceof Error ? err.message : "";
      const isCredentialFailure =
        /invalid credentials|invalid username|invalid password|user not found|no user/i.test(
          raw,
        );
      setError(
        isCredentialFailure
          ? "Invalid username or password."
          : raw.trim() !== ""
            ? raw
            : "Something went wrong. Please try again.",
      );
      // Keep the form fully usable after a failure — clear only the password
      // so a typo can be corrected without retyping the username.
      setPassword("");
      setIsLoading(false);
    }
  };

  return (
    <div className="stadium-bg flex min-h-screen flex-col">
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center px-4">
          <button onClick={() => navigate("/")} className="flex items-center gap-2">
            <span className="from-primary to-primary/60 flex size-9 items-center justify-center rounded-lg bg-gradient-to-br text-primary-foreground shadow-md">
              <Swords className="size-5" />
            </span>
            <span className="font-display text-2xl font-bold tracking-wide">
              YEAR 11 <span className="text-primary">INTERHOUSE</span>
            </span>
          </button>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <Card className="card-sheen w-full max-w-md border-border/80 shadow-2xl">
          <CardHeader className="text-center">
            <CardTitle className="font-display text-2xl font-bold">
              {mode === "signup" ? "Register your team" : "Welcome back, manager"}
            </CardTitle>
            <CardDescription>
              {mode === "signup"
                ? "Claim your username, name your team, pick a crest."
                : "Sign in with your username and password."}
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. striker_king"
                  autoComplete="username"
                  disabled={isLoading}
                  required
                />
                {mode === "signup" && username.trim() !== "" && !validUsername && (
                  <p className="text-xs text-red-400">
                    3-24 characters, letters / numbers / underscore only.
                  </p>
                )}
                {mode === "signup" && validUsername && taken && (
                  <p className="text-xs text-red-400">That username is taken.</p>
                )}
                {mode === "signup" && validUsername && taken === false && (
                  <p className="text-xs text-emerald-400">@{usernameClean} is available!</p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === "signup" ? "At least 4 characters" : "Your password"}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    disabled={isLoading}
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="text-muted-foreground absolute right-2 top-2.5 hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              {mode === "signup" && (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="teamName">Team name</Label>
                    <Input
                      id="teamName"
                      value={teamName}
                      onChange={(e) => setTeamName(e.target.value)}
                      placeholder="e.g. Golden Booters FC"
                      maxLength={40}
                      disabled={isLoading}
                      required
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label>Profile crest</Label>
                    <div className="grid grid-cols-6 gap-2">
                      {AVATAR_PRESETS.filter(
                        (p) => p.group === "houses" || p.group === "footballers" || p.group === "icons",
                      ).map((preset) => {
                        const url = avatarPresetUrl(preset.id);
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => setAvatar(preset.id)}
                            className={cn(
                              "flex items-center justify-center rounded-full border-2 transition-all",
                              avatar === preset.id
                                ? "border-primary scale-110 bg-primary/10"
                                : "border-transparent bg-secondary hover:border-border",
                            )}
                            title={preset.label}
                            disabled={isLoading}
                          >
                            {url ? (
                              <img
                                src={url}
                                alt={preset.label}
                                width={44}
                                height={44}
                                className="size-11 rounded-full"
                                onError={(e) => {
                                  // Presets are inline SVGs; this is pure
                                  // defense — hide a broken image, never crash.
                                  (e.target as HTMLImageElement).style.visibility = "hidden";
                                }}
                              />
                            ) : (
                              <span className="text-xl">{preset.emoji ?? "⚽"}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-muted-foreground text-xs">
                      House crests, football icons and sport badges — you can
                      upload a custom photo from your profile page later.
                    </p>
                  </div>
                </>
              )}

              {error && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-red-400">
                  {error}
                </p>
              )}
            </CardContent>

            <CardFooter className="flex-col gap-3">
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : mode === "signup" ? (
                  <UserPlus className="mr-2 size-4" />
                ) : (
                  <LogIn className="mr-2 size-4" />
                )}
                {mode === "signup" ? "Create my team" : "Sign in"}
              </Button>
              <p className="text-muted-foreground text-sm">
                {mode === "signup" ? "Already have a team?" : "New to the league?"}{" "}
                <button
                  type="button"
                  className="text-primary hover:text-primary/80 font-semibold"
                  onClick={() => {
                    setMode(mode === "signup" ? "signin" : "signup");
                    setError(null);
                  }}
                  disabled={isLoading}
                >
                  {mode === "signup" ? "Sign in" : "Register now"}
                </button>
              </p>
            </CardFooter>
          </form>
        </Card>
      </div>

      <footer className="text-muted-foreground py-4 text-center text-xs">
        Year 11 Interhouse · Tournament & Fantasy League
      </footer>
    </div>
  );
}

export default function AuthPage(props: AuthProps = {}) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
