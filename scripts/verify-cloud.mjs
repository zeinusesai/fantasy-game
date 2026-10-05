// Y11 PE Hub — end-to-end verification against Convex Cloud.
// Signs in as Zein over the auth action, then drives the app's public queries
// through the same Convex websocket client the browser uses (setAuth + query),
// proving each one hydrates instead of hanging.
import { ConvexClient } from "convex/browser";

const URL = "https://resolute-toad-378.convex.cloud";
const PASSWORD = process.env.ZEIN_PASSWORD;

async function signIn() {
  const res = await fetch(`${URL}/api/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "auth:signIn",
      args: {
        provider: "password",
        calledBy: "e2e-verification",
        params: { flow: "signIn", username: "Zein", password: PASSWORD },
      },
      format: "json",
    }),
  });
  const json = await res.json();
  if (json.status !== "success") throw new Error(`signIn failed: ${json.errorMessage}`);
  return json.value.tokens.token;
}

const QUERIES = [
  "users:currentUser",
  "config:getConfig",
  "system:getMaintenanceStatus",
  "gameweeks:getGameweekStatus",
  "gameweeks:getHouseStandings",
  "gameweeks:getTournamentStats",
  "gameweeks:getHallOfFame",
  "managers:getMyStats",
  "managers:getLeaderboard",
  "matches:listMatches",
  "matches:getGameweekRecap",
  "activity:getRecentActivity",
  "awards:getAwards",
  "squads:getMySquad",
  "requests:getMyPriceRequests",
  "requests:getMyPhotoRequests",
  "admin:getSeasonStatus",
  "admin:getTransitionPreview",
  // Y11 PE Hub: mandatory onboarding + the Section Leaderboard and its
  // temporary weekly "Section Champions" cosmetic.
  "users:listSections",
  "users:getOnboardingStatus",
  "leaderboard:getSectionChampion",
  "leaderboard:getSectionLeaderboard",
];

const token = await signIn();
console.log(`signIn: OK (token ${token.length} chars)`);

const client = new ConvexClient(URL);
client.setAuth(() => token);

let ok = 0;
let failed = 0;
// Confirm WHO we authenticated as before hydrating anything else.
try {
  const me = await client.query("users:currentUser");
  console.log(
    `identity: username=${me?.username} role=${me?.role} team=${me?.teamName} section=${me?.section ?? null}`,
  );
} catch (err) {
  console.log(`identity: FAILED ${err instanceof Error ? err.message : err}`);
}
for (const path of QUERIES) {
  const started = Date.now();
  try {
    // Hard timeout so a hanging query is reported as a hang, not a test stall.
    const value = await Promise.race([
      client.query(path),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("TIMED OUT (would have hung the UI)")), 4000),
      ),
    ]);
    const size = Array.isArray(value)
      ? `${value.length} items`
      : value === null || value === undefined
        ? "null"
        : typeof value === "object"
          ? Object.keys(value).length + " keys"
          : typeof value;
    console.log(`  ok   ${path.padEnd(34)} ${String(Date.now() - started).padStart(5)}ms  ${size}`);
    ok++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  FAIL ${path.padEnd(34)} ${msg.slice(0, 110)}`);
    failed++;
  }
}
console.log(`\nhydrated ${ok}/${QUERIES.length} queries, ${failed} failed`);
// The client keeps its websocket open, so exit once the report is printed.
process.exit(failed > 0 ? 1 : 0);