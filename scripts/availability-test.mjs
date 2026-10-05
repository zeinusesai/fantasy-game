// Y11 PE Hub — availability engine end-to-end check.
// Imports two temporary players, toggles availability (injured / doubtful),
// verifies it reads back through the same query the SquadBuilder market uses,
// then soft-deletes them so the roster is left exactly as it was found.
import { ConvexClient } from "convex/browser";
import { parsePlayersCsv } from "../src/lib/csvPlayers.ts";

const URL = "https://resolute-toad-378.convex.cloud";

const res = await fetch(`${URL}/api/action`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    path: "auth:signIn",
    args: {
      provider: "password",
      calledBy: "availability-test",
      params: { flow: "signIn", username: "Zein", password: process.env.ZEIN_PASSWORD },
    },
    format: "json",
  }),
});
const json = await res.json();
if (json.status !== "success") throw new Error(`signIn failed: ${json.errorMessage}`);

const client = new ConvexClient(URL);
client.setAuth(() => json.value.tokens.token);

const parsed = parsePlayersCsv(
  `Name,House,Position,Price
Availability Test GK,Fire,GK,9.0m
Availability Test FWD,Wind,FWD,10.0m`,
);
await client.mutation("admin:importPlayersFromCSV", {
  players: parsed.rows.map((r) => ({
    name: r.name,
    house: r.house,
    position: r.position,
    price: r.price,
  })),
});

let roster = await client.query("players:listPlayers", {});
const targets = roster.filter((p) => p.name.startsWith("Availability Test"));
console.log(`imported test players: ${targets.length}`);
for (const [i, p] of targets.entries()) {
  await client.mutation("players:setPlayerAvailability", {
    playerId: p._id,
    status: i === 0 ? "injured" : "doubtful",
  });
}

roster = await client.query("players:listPlayers", {});
const after = roster.filter((p) => p.name.startsWith("Availability Test"));
for (const p of after) {
  console.log(
    `  ${p.name}: status=${p.status ?? "available"} ` +
      `(no tier field: ${!("tier" in p) && !("rating" in p) && !("stars" in p)}) ` +
      `stats=${p.stats ? "kept" : "none"}`,
  );
}
const ok = after.length === 2 && after[0].status === "injured" && after[1].status === "doubtful";

// Clean up: soft-delete so the roster returns to exactly its previous state.
for (const p of after) {
  await client.mutation("players:deletePlayer", { playerId: p._id });
}
const final = await client.query("players:listPlayers", {});
console.log(`cleanup: active players now ${final.length}`);
console.log(ok ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(ok ? 0 : 1);