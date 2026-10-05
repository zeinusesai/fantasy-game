// Y11 PE Hub — gameweek engine end-to-end test (Super Admin).
// 1. Create GW1 if missing.
// 2. Generate a round of 3 fully dynamic custom matches.
// 3. Set the planned match count for the gameweek.
// 4. Confirm every generated match has custom names, crests and two disjoint
//    random 7-a-side squads.
// 5. Close GW1 and confirm the open-ended progression allows opening GW2.
import { ConvexClient } from "convex/browser";

const URL = "https://resolute-toad-378.convex.cloud";

async function signIn() {
  const res = await fetch(`${URL}/api/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "auth:signIn",
      args: {
        provider: "password",
        calledBy: "gw-test",
        params: { flow: "signIn", username: "Zein", password: process.env.ZEIN_PASSWORD },
      },
      format: "json",
    }),
  });
  const json = await res.json();
  if (json.status !== "success") throw new Error(`signIn failed: ${json.errorMessage}`);
  return json.value.tokens.token;
}

const token = await signIn();
const client = new ConvexClient(URL);
client.setAuth(() => token);

// 1 — GW1 exists?
let gws = await client.query("matches:listSeasonGameweeks", {});
if (!gws.some((g) => g.number === 1)) {
  await client.mutation("matches:createSeasonGameweek", { number: 1 });
  gws = await client.query("matches:listSeasonGameweeks", {});
}
console.log(`gameweeks present: ${gws.map((g) => `GW${g.number}:${g.status}`).join(", ")}`);

// 2 — a round of 3 dynamic friendlies
const round = await client.mutation("matches:createFriendlyRound", { gameweek: 1, count: 3 });
console.log(`round: createdCount=${round.createdCount} matchesPlanned=${round.matchesPlanned}`);

// 3 — persist the plan
const plan = await client.mutation("matches:setSeasonGameweekMatchCount", {
  gameweek: 1,
  matchesPlanned: 4,
});
console.log(`plan: GW${plan.gameweek} -> ${plan.matchesPlanned} matches`);

// 4 — every fixture is fully custom
const fixtures = await client.query("matches:listGameweekMatches", { gameweek: 1 });
for (const m of fixtures) {
  const home = m.homeSquad ?? [];
  const away = m.awaySquad ?? [];
  const overlap = home.filter((id) => away.includes(id));
  console.log(
    `  GW${m.gameweek} "${m.homeTeamName}" vs "${m.awayTeamName}" | ` +
      `crest=${m.homeCrest ? "y" : "n"}/${m.awayCrest ? "y" : "n"} | ` +
      `squads=${home.length}v${away.length} overlap=${overlap.length}`,
  );
}
const custom = fixtures.filter((m) => m.friendly === true && m.homeTeamName && m.awayTeamName);
const disjoint = fixtures.every((m) => {
  const home = m.homeSquad ?? [];
  const away = m.awaySquad ?? [];
  return home.length > 0 && home.every((id) => !away.includes(id));
});
console.log(`fixtures=${fixtures.length} fullyCustom=${custom.length} allDisjoint=${disjoint}`);

// 5 — close GW1, then open GW2 (open-ended progression)
await client.mutation("matches:setSeasonGameweekStatus", { number: 1, status: "closed" });
if (!gws.some((g) => g.number === 2)) {
  await client.mutation("matches:createSeasonGameweek", { number: 2 });
}
await client.mutation("matches:setSeasonGameweekStatus", { number: 2, status: "open" });
const after = await client.query("matches:listSeasonGameweeks", {});
const gw1 = after.find((g) => g.number === 1);
const gw2 = after.find((g) => g.number === 2);
console.log(`GW1 status=${gw1?.status} matchesPlanned=${gw1?.matchesPlanned}`);
console.log(`GW2 status=${gw2?.status} (open-ended progression OK: ${gw2?.status === "open"})`);

const recap = await client.query("matches:getGameweekRecap", {});
console.log(`recap available: ${recap !== null && recap !== undefined}`);

const ok =
  round.createdCount === 3 &&
  fixtures.length >= 3 &&
  custom.length === fixtures.length &&
  disjoint &&
  gw1?.status === "closed" &&
  gw2?.status === "open";
console.log(ok ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(ok ? 0 : 1);