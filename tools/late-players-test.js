const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "app/src/main/assets/index.html"), "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
const startupIndex = script.indexOf("\nload();");
assert(startupIndex > 0, "startup boundary not found");

function element() {
  return {
    value: "", textContent: "", innerHTML: "", style: {}, className: "", disabled: false,
    classList: { add() {}, remove() {}, contains() { return false; } },
    children: [{ className: "" }, { className: "" }],
  };
}

const elements = new Map();
const localStore = new Map();
const alerts = [];
const context = {
  console, Date, JSON, Math, Promise, parseInt,
  localStorage: {
    getItem(key) { return localStore.has(key) ? localStore.get(key) : null; },
    setItem(key, value) { localStore.set(key, String(value)); },
    removeItem(key) { localStore.delete(key); },
  },
  location: { protocol: "https:", host: "www.gullylegends.eu", search: "" },
  window: {},
  document: {
    body: element(),
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    querySelectorAll() { return []; },
  },
  fetch() { return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) }); },
  scrollTo() {}, setTimeout() {}, clearTimeout() {},
  alert(message) { alerts.push(String(message)); },
  confirm() { return true; },
};
context.window = context;
context.window.crypto = { randomUUID: () => "late-player-test-uuid" };
context.window.AndroidArenaMigration = null;
vm.createContext(context);
vm.runInContext(script.slice(0, startupIndex), context, { filename: "index.html" });

const A = ["a1", "a2", "a3", "a4", "a5"];
const B = ["b1", "b2", "b3", "b4", "b5"];
const NEW = ["n1", "n2", "n3", "n4"];
const ALL = A.concat(B, ["s"], NEW);
context.roster = ALL.map((id) => ({ id, name: id.toUpperCase(), stats: {}, ratings: {} }));

function thirteenBallEvents(firstBowler = "b1") {
  return [
    { t: "bowler", id: firstBowler },
    { t: "run", r: 6 }, { t: "run", r: 6 }, { t: "run", r: 2 },
    { t: "run", r: 0 }, { t: "run", r: 0 }, { t: "run", r: 0 },
    { t: "bowler", id: "b2" },
    { t: "run", r: 0 }, { t: "run", r: 0 }, { t: "run", r: 0 },
    { t: "run", r: 0 }, { t: "run", r: 0 }, { t: "run", r: 0 },
    { t: "bowler", id: "b1" }, { t: "run", r: 0 },
  ];
}

function eventsForLegalBalls(legalBalls, firstBowler = "b1") {
  const bowlers = [firstBowler, "b2", "b3", "b1"].filter((id, ix, arr) => arr.indexOf(id) === ix);
  const events = [{ t: "bowler", id: bowlers[0] }];
  for (let i = 0; i < legalBalls; i += 1) {
    if (i > 0 && i % 6 === 0) {
      const next = bowlers[Math.floor(i / 6) % bowlers.length];
      events.push({ t: "bowler", id: next });
    }
    events.push({ t: "run", r: 0 });
  }
  return events;
}

function nextAllowedBowler(state) {
  return B.find((id) => id !== state.striker && id !== state.nonStriker && id !== state.lastOverBowler) || "b2";
}

function liveMatch({ shared = null, a = A, b = B, events = null } = {}) {
  const teamA = a.concat(shared ? [shared] : []);
  const teamB = b.concat(shared ? [shared] : []);
  return {
    id: `late-${Math.random()}`, offlineMatchId: "apk-stable-id", syncVersion: 1,
    lastUploadedSyncVersion: 0, syncState: "pending_sync", syncMsg: "",
    date: "2026-09-02T10:00:00.000Z", startedAt: "2026-09-02T10:00:00.000Z",
    matchDate: "2026-09-02", matchName: "Late players test", venue: "Arena",
    overs: 4, battingMode: "two_batter", rules: { wide: true, nb: true },
    teamA: { name: "Team A", ids: teamA.slice() }, teamB: { name: "Team B", ids: teamB.slice() },
    shared, helpers: ["b4"], stage: "live", current: 0, finished: false, result: "", potm: null,
    innings: [{ batting: "A", openers: { s: "a1", ns: "a2" }, events: events ? events.slice() : thirteenBallEvents(shared || "b1") }],
    names: Object.fromEntries(ALL.map((id) => [id, id.toUpperCase()])),
    rosterTransitions: [{
      inningsIndex: 0, eventIndex: 0, teamAPlayerIds: a.slice(), teamBPlayerIds: b.slice(),
      sharedPlayerId: shared, fieldingHelperIds: ["b4"], appliedAt: "2026-09-02T10:00:00.000Z",
    }],
  };
}

function beginUpdate(match, ids) {
  context.active = match;
  context.lateSelected = Object.fromEntries(ids.map((id) => [id, true]));
  context.continueLatePlayers();
}

function counts() {
  return {
    a: context.latePlayerOrder.filter((id) => context.lateRoles[id] === "A").length,
    b: context.latePlayerOrder.filter((id) => context.lateRoles[id] === "B").length,
    s: context.latePlayerOrder.filter((id) => context.lateRoles[id] === "S").length,
  };
}

function applyUpdate() {
  const beforeAlerts = alerts.length;
  context.applyLatePlayers();
  assert.strictEqual(alerts.length, beforeAlerts + 1, "a successful roster update should confirm preservation");
  assert.match(alerts.at(-1), /Score and match history preserved/);
}

// Mid-over late-player updates are safe at every committed delivery boundary.
for (const legalBalls of [0, 1, 3, 5, 6, 13]) {
  const match = liveMatch({ events: eventsForLegalBalls(legalBalls) });
  context.active = match;
  const beforeState = context.curState();
  const beforeEvents = JSON.stringify(match.innings[0].events);
  const beforeEventIndex = match.innings[0].events.length;
  assert.strictEqual(beforeState.balls, legalBalls, `fixture starts at ${context.ov(legalBalls)}`);
  assert.strictEqual(context.canAddLatePlayers(), true, `late players available at ${context.ov(legalBalls)}`);

  context.renderScore(beforeState);
  assert.strictEqual(elements.get("latePlayersLiveBtn").style.display, "block", `live Add Late Players button visible at ${context.ov(legalBalls)}`);

  beginUpdate(match, ["n1", "n2"]);
  applyUpdate();

  const transition = match.rosterTransitions.at(-1);
  assert.deepStrictEqual([transition.inningsIndex, transition.eventIndex], [0, beforeEventIndex],
    `transition is after the latest committed event at ${context.ov(legalBalls)}`);
  assert(!context.snapshotTeamIds(context.rosterSnapshotAt(match, 0, Math.max(0, beforeEventIndex - 1)), "A").includes("n1"),
    "late player is not retroactively available before the transition boundary");
  assert(context.snapshotTeamIds(context.rosterSnapshotAt(match, 0, beforeEventIndex), "A").concat(
    context.snapshotTeamIds(context.rosterSnapshotAt(match, 0, beforeEventIndex), "B"),
  ).some((id) => id === "n1" || id === "n2"), "late players are available at the transition boundary");

  const afterState = context.replay(match, 0, null);
  assert.strictEqual(afterState.score, beforeState.score, `score is preserved at ${context.ov(legalBalls)}`);
  assert.strictEqual(afterState.balls, beforeState.balls, `overs are preserved at ${context.ov(legalBalls)}`);
  assert.strictEqual(afterState.wickets, beforeState.wickets, `wickets are preserved at ${context.ov(legalBalls)}`);
  assert.strictEqual(afterState.striker, beforeState.striker, `striker is preserved at ${context.ov(legalBalls)}`);
  assert.strictEqual(afterState.nonStriker, beforeState.nonStriker, `non-striker is preserved at ${context.ov(legalBalls)}`);
  assert.strictEqual(afterState.bowler, beforeState.bowler, `current bowler is preserved at ${context.ov(legalBalls)}`);
  assert.strictEqual(JSON.stringify(match.innings[0].events), beforeEvents, `event history is unchanged at ${context.ov(legalBalls)}`);

  if (afterState.needsBowler) {
    match.innings[0].events.push({ t: "bowler", id: nextAllowedBowler(afterState) });
  }
  match.innings[0].events.push({ t: "run", r: 1 });
  const continued = context.replay(match, 0, null);
  assert.strictEqual(continued.balls, legalBalls + 1, `next legal ball continues from ${context.ov(legalBalls)}`);
}

// A. Score, wickets, balls, active pair, and event history are byte-for-byte preserved.
{
  const match = liveMatch();
  const beforeState = context.replay(match, 0, null);
  const beforeEvents = JSON.stringify(match.innings[0].events);
  assert.strictEqual(beforeState.score, 14);
  assert.strictEqual(context.ov(beforeState.balls), "2.1");
  beginUpdate(match, ["n1"]);
  applyUpdate();
  const afterState = context.replay(match, 0, null);
  assert.strictEqual(afterState.score, 14);
  assert.strictEqual(afterState.balls, 13);
  assert.strictEqual(afterState.wickets, beforeState.wickets);
  assert.strictEqual(afterState.striker, beforeState.striker);
  assert.strictEqual(afterState.nonStriker, beforeState.nonStriker);
  assert.strictEqual(afterState.bowler, beforeState.bowler);
  assert.strictEqual(JSON.stringify(match.innings[0].events), beforeEvents);
}

// B/C. Even/odd proposals and flexible Shared choice.
for (const [arrivals, expectedShared] of [[1, 1], [2, 0], [3, 1], [4, 0]]) {
  const match = liveMatch();
  beginUpdate(match, NEW.slice(0, arrivals));
  const c = counts();
  assert.strictEqual(c.s, expectedShared, `10 + ${arrivals} Shared count`);
  assert.strictEqual(c.a, c.b, `10 + ${arrivals} exclusive teams should be equal`);
}
{
  const match = liveMatch({ shared: "s" });
  beginUpdate(match, ["n1", "n2"]);
  assert.strictEqual(context.lateRoles.s, "S", "current Shared should remain suggested while total stays odd");
}
{
  const match = liveMatch();
  beginUpdate(match, ["n1"]);
  assert.strictEqual(context.lateRoles.n1, "S", "newcomer may be Shared");
  context.setLateRole("a3", "S");
  assert.strictEqual(context.lateRoles.a3, "S", "existing Team A player may become Shared");
  assert.notStrictEqual(context.lateRoles.n1, "S", "Shared is not forced to newcomer");
  context.setLateRole("b3", "S");
  assert.strictEqual(context.lateRoles.b3, "S", "existing Team B player may become Shared");
}
{
  const odd = liveMatch({ shared: "s" });
  beginUpdate(odd, ["n1"]);
  assert.deepStrictEqual(counts(), { a: 6, b: 6, s: 0 }, "11 -> 12 removes current Shared");
  const even = liveMatch({ a: A.concat("n1"), b: B.concat("n2") });
  beginUpdate(even, ["n3"]);
  assert.deepStrictEqual(counts(), { a: 6, b: 6, s: 1 }, "12 -> 13 creates current Shared");
}

// D/I. Historical Shared roles survive current reassignment and block win XP exactly once.
{
  const match = liveMatch({ shared: "s" });
  const pastEvents = JSON.stringify(match.innings[0].events);
  beginUpdate(match, ["n1"]); // odd -> even; default moves old Shared to A
  context.setLateRole("s", "B");
  context.setLateRole("n1", "A");
  applyUpdate();
  assert.strictEqual(match.shared, null);
  assert(match.teamB.ids.includes("s"), "former Shared may become Team B exclusive");
  assert.strictEqual(JSON.stringify(match.innings[0].events), pastEvents, "earlier Shared deliveries remain untouched");
  assert.strictEqual(context.wasEverShared(match, "s"), true);
  beginUpdate(match, ["n2"]);
  context.setLateRole("b3", "S");
  applyUpdate();
  assert.strictEqual(match.shared, "b3", "a different player can become Shared later");
  assert.strictEqual(context.wasEverShared(match, "s"), true);
  assert.strictEqual(context.wasEverShared(match, "b3"), true);

  match.innings.push({
    batting: "B", openers: { s: "b1", ns: "b2" },
    events: [{ t: "bowler", id: "a3" }, { t: "run", r: 6 }, { t: "run", r: 6 }, { t: "run", r: 4 }],
  });
  match.current = 1; match.finished = true; match.stage = "done"; match.potm = null;
  const xp = context.computeXP(match);
  assert.strictEqual(xp.players.s.participation, 20, "former Shared gets one Played contribution");
  assert.strictEqual(xp.players.s.win, 0, "any past Shared role removes the win bonus");
  assert.strictEqual(xp.players.b3.win, 0, "all players ever Shared lose the normal win bonus");
  assert.strictEqual(Object.keys(xp.players).filter((id) => id === "s").length, 1, "Shared player receives one XP application");
}

// E/F. Active roles are protected; newcomers have only future eligibility and zero retroactive stats.
{
  const match = liveMatch();
  beginUpdate(match, ["n1", "n2"]);
  context.setLateRole("a1", "B"); context.setLateRole("b3", "A");
  const transitions = match.rosterTransitions.length;
  const alertCount = alerts.length;
  context.applyLatePlayers();
  assert.strictEqual(match.rosterTransitions.length, transitions, "illegal striker reassignment is rejected");
  assert.strictEqual(alerts.length, alertCount + 1);
  assert.match(alerts.at(-1), /current striker/);

  beginUpdate(match, ["n1", "n2"]);
  context.setLateRole("b1", "A"); context.setLateRole("a3", "B");
  context.applyLatePlayers();
  assert.strictEqual(match.rosterTransitions.length, transitions, "illegal current-bowler reassignment is rejected");
  assert.match(alerts.at(-1), /current bowler/);

  beginUpdate(match, ["n1", "n2"]);
  applyUpdate();
  const st = context.curState();
  const lateBat = ["n1", "n2"].find((id) => st.battingIds.includes(id));
  const lateBowl = ["n1", "n2"].find((id) => st.bowlingIds.includes(id));
  assert(lateBat && lateBowl, "new players are eligible on their future current sides");
  assert.strictEqual(st.batsmen[lateBat].didBat, false);
  assert.strictEqual(st.batsmen[lateBat].runs, 0);
  assert(st.bowlingIds.includes(lateBowl), "late bowler is future-eligible");
  assert(context.fielderChoices(st, "caught").some((x) => x.id === lateBowl), "late fielder is future-eligible");
}

// G/H. Reload and legacy migration preserve history; cricket Undo never removes it.
{
  const match = liveMatch();
  beginUpdate(match, ["n1"]); applyUpdate();
  const roundTrip = JSON.parse(JSON.stringify(match));
  context.migrateMatchShape(roundTrip, true);
  assert.strictEqual(roundTrip.rosterTransitions.length, 2, "reload retains roster transitions");
  const legacy = liveMatch(); delete legacy.rosterTransitions;
  context.migrateMatchShape(legacy, true);
  assert.strictEqual(legacy.rosterTransitions.length, 1, "legacy match gets one compatible initial snapshot");

  context.active = match;
  const transitionCount = match.rosterTransitions.length;
  const eventCount = match.innings[0].events.length;
  context.undo();
  assert.strictEqual(match.innings[0].events.length, eventCount - 1, "cricket Undo removes a scoring event");
  assert.strictEqual(match.rosterTransitions.length, transitionCount, "cricket Undo does not erase roster history");
  assert.strictEqual(context.rosterSnapshotAt(match, 0, match.innings[0].events.length).sharedPlayerId, match.shared,
    "roster update remains effective after cricket Undo");
}

// Between innings is allowed and cannot reopen the completed first innings.
{
  const match = liveMatch();
  match.stage = "break";
  const before = context.replay(match, 0, null);
  beginUpdate(match, ["n1"]); applyUpdate();
  const transition = match.rosterTransitions.at(-1);
  assert.deepStrictEqual([transition.inningsIndex, transition.eventIndex], [1, 0]);
  const after = context.replay(match, 0, null);
  assert.strictEqual(after.score, before.score);
  assert.strictEqual(after.balls, before.balls);
}

// J. Stable sync identity/version, complete raw history, unchanged POM recommendation, no XP authority.
{
  const match = liveMatch();
  match.lastUploadedSyncVersion = 1;
  const beforeId = match.offlineMatchId;
  const beforePom = context.convertMatch(match).pomRecommendationPlayerId;
  beginUpdate(match, ["n1", "n2"]); applyUpdate();
  const payload = context.convertMatch(match);
  assert.strictEqual(match.offlineMatchId, beforeId);
  assert.strictEqual(match.syncVersion, 2, "uploaded match follows existing syncVersion increment rule");
  assert.strictEqual(payload.offlineMatchId, beforeId);
  assert.strictEqual(payload.rosterTransitions.length, 2);
  assert.strictEqual(payload.pomRecommendationPlayerId, beforePom);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(payload, "xp"), false, "XP remains server-authoritative");
  assert.strictEqual(JSON.stringify(payload).includes("ratings"), false, "private Balance data is absent");
}

console.log("APK late players test passed.");
