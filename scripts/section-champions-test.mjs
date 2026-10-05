// Y11 PE Hub — end-to-end verification of the Section Leaderboard and the
// temporary weekly "Section Champions" cosmetic.
//
// Everything runs on a THROWAWAY gameweek (GW 90/91) so the real PE season is
// never advanced, and every row it creates is deleted at the end — the live
// deployment is left exactly as it was found.
//
// Reads the Super Admin password from ZEIN_PASSWORD; exits non-zero on failure.
import { ConvexClient } from "convex/browser";

const URL = "https://resolute-toad-378.convex.cloud";
const PASSWORD = process.env.ZEIN_PASSWORD;
// The two throwaway gameweeks are the next two numbers after whatever already
// exists, so the real season is never skipped ahead — and both are deleted
// again in the `finally` block below.
let GW_A = 0;
let GW_B = 0;
const SECTION_ONE = "Section C";
const SECTION_TWO = "Section D";

const failures = [];
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
}

async function signIn() {
  const res = await fetch(`${URL}/api/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "auth:signIn",
      args: {
        provider: "password",
        calledBy: "e2e-section-champions",
        params: { flow: "signIn", username: "Zein", password: PASSWORD },
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

const me = await client.query("users:currentUser");
console.log(`signed in as @${me.username} (role=${me.role})`);

const originalSection = me.section ?? null;
const originalFavoritePlayerId =
  typeof me.favoritePlayerId === "string" && me.favoritePlayerId !== ""
    ? me.favoritePlayerId
    : null;
{
  const existing = await client.query("matches:listSeasonGameweeks");
  const highest = existing.reduce((max, g) => Math.max(max, g.number), 0);
  GW_A = highest + 1;
  GW_B = highest + 2;
  console.log(`throwaway gameweeks: GW${GW_A} and GW${GW_B}`);
}
const createdMatchIds = [];
const createdGameweeks = [];

try {
  // ── 1. Sections list + normalisation ──────────────────────────────────
  const sections = await client.query("users:listSections");
  check("listSections returns Section A–H", sections.length === 8, sections.join(", "));

  await client.mutation("users:setSection", { section: SECTION_ONE });
  check("setSection accepts a canonical section", true, SECTION_ONE);

  // Deliberately sloppy input must normalise, not corrupt.
  await client.mutation("users:setSection", { section: "  section a " });
  const afterLoose = await client.query("users:currentUser");
  check(
    "setSection normalises ' section a '",
    afterLoose.section === "Section A",
    `stored as ${afterLoose.section}`,
  );
  await client.mutation("users:setSection", { section: SECTION_ONE });

  let rejected = false;
  try {
    await client.mutation("users:setSection", { section: "Section Z" });
  } catch (err) {
    rejected = /Section must be one of/i.test(err.message ?? "");
  }
  check("setSection rejects an unknown section", rejected);

  // ── 2. Favourite player validation ─────────────────────────────────────
  const players = await client.query("players:listPlayers");
  check("roster is populated for the picker", players.length > 0, `${players.length} players`);
  await client.mutation("users:setFavoritePlayer", { playerId: String(players[0]._id) });
  const afterFav = await client.query("users:currentUser");
  check(
    "setFavoritePlayer stores a real player",
    afterFav.favoritePlayerId === String(players[0]._id),
    players[0].name,
  );
  let favRejected = false;
  try {
    await client.mutation("users:setFavoritePlayer", { playerId: "not-a-real-id" });
  } catch (err) {
    favRejected = /could not be found/i.test(err.message ?? "");
  }
  check("setFavoritePlayer rejects a dangling id", favRejected);

  const onboarding = await client.query("users:getOnboardingStatus");
  check("onboarding reports complete", onboarding.complete === true);

  // ── 3. Section leaderboard aggregation ────────────────────────────────
  const squad = await client.query("squads:getMySquad");
  const myTotal = (await client.query("managers:getMyStats"))?.totalPoints ?? 0;
  void squad;
  const board = await client.query("leaderboard:getSectionLeaderboard", {
    membersPerSection: 4,
  });
  check("section board returns all 8 sections", board.standings.length === 8);
  const sectionOne = board.standings.find((s) => s.section === SECTION_ONE);
  check(
    "my points are aggregated into my section",
    sectionOne?.totalPoints === myTotal,
    `${SECTION_ONE}=${sectionOne?.totalPoints} vs myTotal=${myTotal}`,
  );
  check(
    "section standings are sorted by points",
    board.standings.every(
      (s, i, arr) => i === 0 || arr[i - 1].totalPoints >= s.totalPoints,
    ),
  );
  check("no champion before any gameweek is closed", board.champion === null);

  // ── 4. Gameweek closure awards the cosmetic ───────────────────────────
  await client.mutation("matches:createSeasonGameweek", { number: GW_A });
  createdGameweeks.push(GW_A);
  await client.mutation("matches:createSeasonGameweek", { number: GW_B });
  createdGameweeks.push(GW_B);
  await client.mutation("matches:setSeasonGameweekStatus", { number: GW_A, status: "open" });
  const round = await client.mutation("matches:createFriendlyRound", {
    gameweek: GW_A,
    count: 1,
  });
  createdMatchIds.push(...round.matchIds);
  const matchId = round.matchIds[0];
  check("throwaway friendly created", typeof matchId === "string" && matchId.length > 0);

  // Report every active player so the scoring engine credits whichever of them
  // appear in a manager's squad.
  const lines = players.map((p) => ({
    playerId: p._id,
    goals: p.position === "FWD" ? 1 : 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    ownGoals: 0,
    saves: 0,
    cleanSheet: false,
  }));
  await client.mutation("matches:saveMatch", {
    matchId,
    stage: "group_stage",
    homeHouse: "Fire",
    awayHouse: "Water",
    homeGoals: 1,
    awayGoals: 0,
    status: "completed",
    lines,
  });
  // `squads:getMySquad.totalPoints` is the squad's stored field, not the live
  // aggregate — the leaderboard row is the authoritative total.
  const afterSave = await client.query("managers:getMyStats");
  check(
    "points were scored in the throwaway gameweek",
    (afterSave?.totalPoints ?? 0) > myTotal,
    `${myTotal} -> ${afterSave?.totalPoints ?? 0}`,
  );

  // Awarding must be refused while the gameweek is still open.
  const early = await client.mutation("leaderboard:recomputeSectionChampion", {
    gameweek: GW_A,
  });
  check("no award while the gameweek is open", early.awarded === false, early.reason ?? "");

  const closed = await client.mutation("matches:setSeasonGameweekStatus", {
    number: GW_A,
    status: "closed",
  });
  check(
    "closing the gameweek awards the winning section",
    closed.sectionChampion?.awarded === true && closed.sectionChampion?.section === SECTION_ONE,
    JSON.stringify(closed.sectionChampion),
  );

  const champion = await client.query("leaderboard:getSectionChampion");
  check("active champion is read back", champion?.section === SECTION_ONE, `GW${champion?.gameweek}`);
  check("champion records the scoring managers", (champion?.managerCount ?? 0) >= 1, `${champion?.managerCount}`);

  const boardAfter = await client.query("leaderboard:getSectionLeaderboard", {});
  const winnerCard = boardAfter.standings.find((s) => s.section === SECTION_ONE);
  const loserCard = boardAfter.standings.find((s) => s.section === SECTION_TWO);
  check("winning section card is flagged", winnerCard?.isChampion === true);
  check("every other section card is not", loserCard?.isChampion === false);
  check(
    "winning section shows its weekly haul",
    (winnerCard?.weeklyPoints ?? 0) > 0,
    `${winnerCard?.weeklyPoints} pts`,
  );

  const lb = await client.query("managers:getLeaderboard");
  const myRow = lb.find((r) => r.userId === me._id);
  check("manager row carries the champion glow", myRow?.isSectionChampion === true);
  check("manager row reports the source gameweek", myRow?.sectionChampionGameweek === GW_A);

  const profile = await client.query("users:getPublicProfile", { userId: me._id });
  check("public profile carries the champion glow", profile?.isSectionChampion === true);
  check("public profile normalises the section", profile?.section === SECTION_ONE);

  // ── 5. Re-evaluation supersedes the previous winner ────────────────────
  await client.mutation("users:setSection", { section: SECTION_TWO });
  await client.mutation("matches:setSeasonGameweekStatus", { number: GW_B, status: "open" });
  const round2 = await client.mutation("matches:createFriendlyRound", {
    gameweek: GW_B,
    count: 1,
  });
  createdMatchIds.push(...round2.matchIds);
  await client.mutation("matches:saveMatch", {
    matchId: round2.matchIds[0],
    stage: "group_stage",
    homeHouse: "Fire",
    awayHouse: "Water",
    homeGoals: 2,
    awayGoals: 0,
    status: "completed",
    lines,
  });
  await client.mutation("matches:setSeasonGameweekStatus", { number: GW_B, status: "closed" });

  const champion2 = await client.query("leaderboard:getSectionChampion");
  check(
    "the next closure re-evaluates the award",
    champion2?.section === SECTION_TWO && champion2?.gameweek === GW_B,
    `${champion2?.section} GW${champion2?.gameweek}`,
  );
  const boardAfter2 = await client.query("leaderboard:getSectionLeaderboard", {});
  check(
    "the previous winner's glow has expired",
    boardAfter2.standings.find((s) => s.section === SECTION_ONE)?.isChampion === false &&
      boardAfter2.standings.find((s) => s.section === SECTION_TWO)?.isChampion === true,
  );
  // Zein moved to Section D for this week, so the row still glows — but for the
  // NEW gameweek. The stale GW90 glow is what must be gone.
  const lb2 = await client.query("managers:getLeaderboard");
  const myRow2 = lb2.find((r) => r.userId === me._id);
  check(
    "manager row's glow now points at the new gameweek",
    myRow2?.isSectionChampion === true && myRow2?.sectionChampionGameweek === GW_B,
    `GW${myRow2?.sectionChampionGameweek}`,
  );

  // ── 6. Admin panel can read and correct the same fields ────────────────
  const users = await client.query("usersAdmin:listAllUsersWithRoles");
  const myAdminRow = users.find((u) => u._id === me._id);
  check("admin user list exposes the section", myAdminRow?.section === SECTION_TWO);
  check(
    "admin user list resolves the favourite player name",
    typeof myAdminRow?.favoritePlayerName === "string" && myAdminRow.favoritePlayerName.length > 0,
    myAdminRow?.favoritePlayerName ?? "",
  );
  await client.mutation("usersAdmin:setUserSection", {
    targetUserId: me._id,
    section: SECTION_ONE,
  });
  check(
    "admin can correct a user's section",
    (await client.query("users:currentUser")).section === SECTION_ONE,
  );
} finally {
  // ── Cleanup: leave the live deployment exactly as we found it. ─────────
  for (const id of createdMatchIds) {
    try {
      await client.mutation("matches:deleteMatch", { matchId: id });
    } catch (err) {
      console.log(`  cleanup: could not delete match ${id}: ${err.message}`);
    }
  }
  for (const n of createdGameweeks) {
    try {
      await client.mutation("matches:deleteSeasonGameweek", { number: n });
    } catch (err) {
      console.log(`  cleanup: could not delete GW${n}: ${err.message}`);
    }
  }
  await client.mutation("leaderboard:clearSectionChampion").catch((err) =>
    console.log(`  cleanup: ${err.message}`),
  );
  await client.mutation("users:setFavoritePlayer", {
    playerId: originalFavoritePlayerId ?? "",
  }).catch((err) => console.log(`  cleanup: favourite player — ${err.message}`));
  if (originalSection === null) {
    await client.mutation("users:setSection", { section: "" }).catch(() => {});
  } else {
    await client.mutation("users:setSection", { section: originalSection }).catch(() => {});
  }

  const finalChampion = await client.query("leaderboard:getSectionChampion");
  const finalMatches = await client.query("matches:listMatches");
  const finalGws = await client.query("matches:listSeasonGameweeks");
  console.log(
    `cleanup: champion=${finalChampion === null ? "none" : finalChampion.section}, ` +
      `matches=${finalMatches.length}, throwaway GWs left=${
        finalGws.filter((g) => createdGameweeks.includes(g.number)).length
      }`,
  );
  check(
    "cleanup removed every throwaway gameweek",
    !finalGws.some((g) => createdGameweeks.includes(g.number)),
  );
  check("cleanup cleared the test cosmetic", finalChampion === null);
  check("cleanup removed every throwaway match", !finalMatches.some((m) => createdMatchIds.includes(m._id)));
}

console.log("");
if (failures.length > 0) {
  console.log(`RESULT: FAIL (${failures.length}) — ${failures.join("; ")}`);
  process.exit(1);
}
console.log("RESULT: PASS");