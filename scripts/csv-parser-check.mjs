// Y11 PE Hub — parser robustness check for the CSV import tool.
// Exercises delimiter sniffing, title casing, price variants, position
// aliases, house fallback and the warning/error paths. No backend required.
import { parsePlayersCsv } from "../src/lib/csvPlayers.ts";

const CASES = {
  "requested sample (comma)": `Name,House,Position,Price
Taym,Earth,MID,13.5m
Mazin,Fire,DEF,10.5m
Mannaa,Fire,DEF,10.5m
Omar Elgammal,Wind,MID,9.0m
Adam Alkamal,Fire,MID,13.5m
George Palabekhian,Fire,FWD,10.5m`,

  "pipe delimited + lowercase names + price variants": `Name|House|Position|Price
adam alkamal|fire|defender|13.5m
Taym|Earth|goalkeeper|£10m
Mazin|fire|MID|$9,500
Zaid|wind|midfielder|9
Omar|earth|forward|12.75M`,

  "messy rows (bad position, bad price, missing house, duplicate)": `Name,House,Position,Price
Good Player,Fire,GK,8.5m
Bad Pos,Fire,STRIKER!,8.5m
Bad Price,Earth,MID,abc
No House,,DEF,7m
Good Player,Fire,GK,9m`,

  "no header (positional fallback)": `Taym,Earth,MID,13.5m
Mazin,Fire,DEF,10.5m`,

  "quoted fields + trailing commas + comment": `# exported by the tutor
Name, House , Position , Price
"Palabekhian, George",Fire,FWD,"£10.5m",`,
};

let failed = 0;
for (const [label, csv] of Object.entries(CASES)) {
  const out = parsePlayersCsv(csv);
  console.log(`\n── ${label}`);
  console.log(
    `   delimiter="${out.delimiter}" header=${out.headerFound} rows=${out.rows.length}`,
  );
  for (const r of out.rows) {
    console.log(
      `   row  L${r.line}: ${r.name} | ${r.house} | ${r.position} | ${r.price}`,
    );
  }
  for (const i of out.issues) {
    console.log(`   ${i.level === "error" ? "ERR " : "WARN"} L${i.line}: ${i.message}`);
  }
  if (out.rows.length === 0 && out.issues.length === 0) failed++;
}
console.log(`\nparser check: ${failed === 0 ? "all cases produced output" : "a case produced nothing"}`);