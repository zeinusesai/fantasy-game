// Y11 PE Hub — CSV import end-to-end test.
//
// Uses the REAL parser from src/lib/csvPlayers.ts (bun resolves the TS
// import), signs in as Zein over Convex Cloud, runs admin.importPlayersFromCSV
// against the sample CSV, then re-reads the players table to prove every row
// landed with the right house/position/price and no duplicates were created.
//
// Usage: ZEIN_PASSWORD='…' bun scripts/import-players.mjs [csvPath]
import { readFileSync } from "node:fs";
import { ConvexClient } from "convex/browser";
import { parsePlayersCsv } from "../src/lib/csvPlayers.ts";

const URL = "https://resolute-toad-378.convex.cloud";
const csvPath = process.argv[2] ?? "scripts/sample-players.csv";
const PASSWORD = process.env.ZEIN_PASSWORD;

async function signIn() {
  const res = await fetch(`${URL}/api/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "auth:signIn",
      args: {
        provider: "password",
        calledBy: "csv-import-test",
        params: { flow: "signIn", username: "Zein", password: PASSWORD },
      },
      format: "json",
    }),
  });
  const json = await res.json();
  if (json.status !== "success") throw new Error(`signIn failed: ${json.errorMessage}`);
  return json.value.tokens.token;
}

const raw = readFileSync(csvPath, "utf8");
const parsed = parsePlayersCsv(raw);
console.log(
  `parser: delimiter="${parsed.delimiter}" header=${parsed.headerFound} rows=${parsed.rows.length} issues=${parsed.issues.length}`,
);
for (const issue of parsed.issues) {
  console.log(`  ${issue.level}: line ${issue.line} — ${issue.message}`);
}
if (parsed.rows.length === 0) {
  console.error("nothing to import");
  process.exit(1);
}

const token = await signIn();
const client = new ConvexClient(URL);
client.setAuth(() => token);

const result = await client.mutation("admin:importPlayersFromCSV", {
  players: parsed.rows.map((r) => ({
    name: r.name,
    house: r.house,
    position: r.position,
    price: r.price,
  })),
});
console.log(
  `mutation: imported=${result.importedCount} updated=${result.updatedCount} skipped=${result.skippedCount} errors=${result.errors.length}`,
);
for (const e of result.errors) console.log(`  error: ${e}`);

// ── Verify what actually landed in the players table ───────────────────────
const roster = await client.query("players:listPlayers", {});
const byName = new Map(roster.map((p) => [p.name.trim().toLowerCase(), p]));

let missing = 0;
let mismatched = 0;
for (const row of parsed.rows) {
  const stored = byName.get(row.name.toLowerCase());
  if (!stored) {
    missing++;
    console.log(`  MISSING ${row.name}`);
    continue;
  }
  const priceOk = Number(stored.price) === Number(row.price);
  const metaOk = stored.house === row.house && stored.position === row.position;
  if (!priceOk || !metaOk) {
    mismatched++;
    console.log(
      `  MISMATCH ${row.name}: stored ${stored.house}/${stored.position}/${stored.price} vs expected ${row.house}/${row.position}/${row.price}`,
    );
  }
}
const duplicates = roster.length - byName.size;
console.log(
  `verify: roster=${roster.length} matched=${parsed.rows.length - missing - mismatched}/${parsed.rows.length} missing=${missing} mismatched=${mismatched} duplicateNames=${duplicates}`,
);
console.log(`sample rows in db: ${JSON.stringify(roster.slice(0, 3))}`);

const failures = missing + mismatched + result.errors.length;
process.exit(failures > 0 ? 1 : 0);