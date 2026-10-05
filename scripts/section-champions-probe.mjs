// Y11 PE Hub — read-only probe of the live section/gameweek state.
// Used to confirm that verification runs leave no residue behind.
import { ConvexClient } from "convex/browser";

const URL = "https://resolute-toad-378.convex.cloud";

const res = await fetch(`${URL}/api/action`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    path: "auth:signIn",
    args: {
      provider: "password",
      calledBy: "e2e-section-probe",
      params: { flow: "signIn", username: "Zein", password: process.env.ZEIN_PASSWORD },
    },
    format: "json",
  }),
});
const json = await res.json();
if (json.status !== "success") throw new Error(`signIn failed: ${json.errorMessage}`);

const client = new ConvexClient(URL);
client.setAuth(() => json.value.tokens.token);

const gws = await client.query("matches:listSeasonGameweeks");
const matches = await client.query("matches:listMatches");
const champion = await client.query("leaderboard:getSectionChampion");
const me = await client.query("users:currentUser");

console.log("gameweeks:", gws.map((g) => `${g.number}:${g.status}`).join(" "));
console.log("matches:", matches.length, JSON.stringify(matches.map((m) => m.gameweek)));
console.log("section champion:", JSON.stringify(champion));
console.log(`zein: section=${me.section} favoritePlayerId=${me.favoritePlayerId}`);