// Y11 PE Hub — remove the sample CSV roster from the cloud deployment.
// Uses the existing super-admin mutation players:deletePlayer, which is a
// SOFT delete (active: false): the players disappear from every market and
// admin view while any historical match data stays intact.
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
        calledBy: "cleanup",
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

const before = await client.query("players:listPlayers", {});
console.log(`active players before: ${before.length}`);

let removed = 0;
for (const p of before) {
  await client.mutation("players:deletePlayer", { playerId: p._id });
  removed++;
}

const after = await client.query("players:listPlayers", {});
console.log(`soft-deleted: ${removed}`);
console.log(`active players after: ${after.length}`);
console.log(after.length === 0 ? "OK: sample roster cleared" : "FAIL: players remain");
process.exit(after.length === 0 ? 0 : 1);