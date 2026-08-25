const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "app/src/main/assets/index.html"), "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
const startupIndex = script.indexOf("\nload();");

assert(startupIndex > 0, "startup boundary not found");

function createElement() {
  return {
    value: "",
    textContent: "",
    innerHTML: "",
    style: {},
    className: "",
    classList: { add() {}, remove() {}, contains() { return false; } },
    children: [{ className: "" }, { className: "" }],
  };
}

const elements = new Map();
const localStore = new Map();
const context = {
  console,
  Date,
  JSON,
  Math,
  Promise,
  parseInt,
  localStorage: {
    getItem(key) { return localStore.has(key) ? localStore.get(key) : null; },
    setItem(key, value) { localStore.set(key, String(value)); },
    removeItem(key) { localStore.delete(key); },
  },
  location: { protocol: "https:", host: "www.gullylegends.eu", search: "" },
  window: {},
  document: {
    body: createElement(),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, createElement());
      return elements.get(id);
    },
    querySelectorAll() { return []; },
  },
  fetch() {
    return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) });
  },
  scrollTo() {},
  setTimeout() {},
  clearTimeout() {},
  alert(message) {
    throw new Error(`Unexpected alert: ${message}`);
  },
  confirm() {
    return true;
  },
};
context.window = context;
context.window.crypto = { randomUUID: () => "test-uuid" };
context.window.AndroidArenaMigration = null;

vm.createContext(context);
vm.runInContext(script.slice(0, startupIndex), context, { filename: "index.html" });

function roster(ids) {
  return ids.map((id) => ({ id, name: id.toUpperCase(), stats: {}, ratings: {} }));
}

context.roster = roster(["a", "b", "c", "d", "x", "y", "z", "s"]);

function runOutMatch({ who, runs, nextStriker, nextNonStriker }) {
  return {
    id: `runout-${who}-${runs}`,
    startedAt: "2026-08-22T10:00:00.000Z",
    date: "2026-08-22T10:00:00.000Z",
    overs: 2,
    battingMode: "two_batter",
    shared: null,
    helpers: [],
    teamA: { name: "Team A", ids: ["a", "b", "c"] },
    teamB: { name: "Team B", ids: ["x", "y", "z"] },
    innings: [
      {
        batting: "A",
        openers: { s: "a", ns: "b" },
        events: [
          { t: "bowler", id: "x" },
          {
            t: "wicket",
            who,
            kind: "runout",
            fielder: "y",
            runs,
            next: "c",
            newBatter: "c",
            nextStriker,
            nextNonStriker,
          },
        ],
      },
    ],
  };
}

function assertRunOutCase({ who, runs, nextStriker, nextNonStriker }) {
  const match = runOutMatch({ who, runs, nextStriker, nextNonStriker });
  const collected = [];
  const state = context.replay(match, 0, null, collected);
  const dismissed = who === "striker" ? "a" : "b";

  assert.strictEqual(state.score, runs, `${who} run out should add completed runs`);
  assert.strictEqual(state.wickets, 1, `${who} run out should add one wicket`);
  assert.strictEqual(state.batsmen.a.runs, runs, `${who} run out should credit completed runs to striker`);
  assert.strictEqual(state.batsmen[dismissed].out, true, `${who} should be dismissed`);
  assert.strictEqual(state.bowlers.x.wickets, 0, "run out must not credit bowler wicket");
  assert.strictEqual(state.bowlers.x.runs, runs, "completed run-out runs should count against bowler");
  assert.strictEqual(state.fielding.y.runouts, 1, "run-out fielder should get fielding credit");
  assert.strictEqual(state.striker, nextStriker, "explicit next striker should be preserved");
  assert.strictEqual(state.nonStriker, nextNonStriker, "explicit next non-striker should be preserved");
  assert.strictEqual(collected[0].wicket.type, "run_out", "sync payload should use website run_out type");
  assert.strictEqual(collected[0].batterRuns, runs, "sync payload should include completed batter runs");
  assert.strictEqual(collected[0].wicket.completedRuns, runs, "sync wicket should include completed runs");
  assert.strictEqual(collected[0].wicket.dismissedPlayerId, dismissed, "sync wicket should preserve dismissed player");
  assert.strictEqual(collected[0].wicket.fielderId, "y", "sync wicket should preserve fielder");
  assert.strictEqual(collected[0].wicket.newBatterId, "c", "sync wicket should preserve new batter");
  assert.strictEqual(collected[0].wicket.nextStrikerId, nextStriker, "sync wicket should preserve next striker");
  assert.strictEqual(collected[0].wicket.nextNonStrikerId, nextNonStriker, "sync wicket should preserve next non-striker");
}

assertRunOutCase({ who: "striker", runs: 0, nextStriker: "c", nextNonStriker: "b" });
assertRunOutCase({ who: "striker", runs: 1, nextStriker: "c", nextNonStriker: "b" });
assertRunOutCase({ who: "nonstriker", runs: 1, nextStriker: "c", nextNonStriker: "a" });
assertRunOutCase({ who: "nonstriker", runs: 2, nextStriker: "a", nextNonStriker: "c" });

const twoBatterRunOutMatch = runOutMatch({
  who: "nonstriker",
  runs: 2,
  nextStriker: "a",
  nextNonStriker: "c",
});
const collected = [];
const state = context.replay(twoBatterRunOutMatch, 0, null, collected);

assert.strictEqual(state.score, 2, "completed run-out runs should count in team score");
assert.strictEqual(state.wickets, 1, "run out should add one wicket");
assert.strictEqual(state.batsmen.a.runs, 2, "striker should receive completed run-out runs");
assert.strictEqual(state.batsmen.a.balls, 1, "legal run-out delivery should count to striker when non-striker is out");
assert.strictEqual(state.batsmen.b.out, true, "non-striker should be dismissed");
assert.strictEqual(state.bowlers.x.wickets, 0, "run out must not credit bowler wicket");
assert.strictEqual(state.bowlers.x.runs, 2, "completed run-out runs should count against bowler");
assert.strictEqual(state.fielding.y.runouts, 1, "run-out fielder should get fielding credit");
assert.strictEqual(state.striker, "a", "explicit next striker should be preserved");
assert.strictEqual(state.nonStriker, "c", "explicit next non-striker should be preserved");
assert.strictEqual(collected[0].wicket.type, "run_out", "sync payload should use website run_out type");
assert.strictEqual(collected[0].batterRuns, 2, "sync payload should include completed batter runs");
assert.strictEqual(collected[0].wicket.completedRuns, 2, "sync wicket should include completed runs");
assert.strictEqual(collected[0].wicket.dismissedPlayerId, "b", "sync wicket should preserve dismissed player");
assert.strictEqual(collected[0].wicket.fielderId, "y", "sync wicket should preserve fielder");
assert.strictEqual(collected[0].wicket.newBatterId, "c", "sync wicket should preserve new batter");
assert.strictEqual(collected[0].wicket.nextStrikerId, "a", "sync wicket should preserve next striker");
assert.strictEqual(collected[0].wicket.nextNonStrikerId, "c", "sync wicket should preserve next non-striker");

const undoMatch = JSON.parse(JSON.stringify(twoBatterRunOutMatch));
undoMatch.innings[0].events.pop();
const undoState = context.replay(undoMatch, 0, null, []);
assert.strictEqual(undoState.score, 0, "undo replay should remove run-out runs");
assert.strictEqual(undoState.wickets, 0, "undo replay should remove run-out wicket");

const singleBatterMatch = JSON.parse(JSON.stringify(twoBatterRunOutMatch));
singleBatterMatch.id = "runout-single";
singleBatterMatch.battingMode = "single_batter";
singleBatterMatch.innings[0].openers = { s: "a", ns: null };
singleBatterMatch.innings[0].events[1] = {
  t: "wicket",
  who: "striker",
  kind: "runout",
  fielder: "y",
  runs: 1,
  next: "b",
  newBatter: "b",
  nextStriker: "b",
  nextNonStriker: null,
};
const singleCollected = [];
const singleState = context.replay(singleBatterMatch, 0, null, singleCollected);
assert.strictEqual(singleState.striker, "b", "single-batter run out should set explicit next batter");
assert.strictEqual(singleState.nonStriker, null, "single-batter mode should not require next non-striker");
assert.strictEqual(singleCollected[0].wicket.nextNonStrikerId, null, "single-batter sync payload should omit next non-striker");

context.matches = [
  {
    id: "demo-ignore",
    finished: true,
    isDemo: true,
    completedAt: "2026-08-22T08:00:00.000Z",
    overs: 4,
    battingMode: "two_batter",
    teamA: { ids: ["x"] },
    teamB: { ids: ["y"] },
  },
  {
    id: "latest-real",
    finished: true,
    isDemo: false,
    completedAt: "2026-08-22T09:00:00.000Z",
    matchDate: "2026-01-05",
    overs: 8,
    battingMode: "single_batter",
    shared: "s",
    helpers: ["a", "s", "missing-helper"],
    teamA: { ids: ["a", "s"] },
    teamB: { ids: ["b", "gone", "s"] },
  },
];

const template = context.previousSetupTemplate();
assert.strictEqual(JSON.stringify(template.a), JSON.stringify(["a"]), "previous teams should carry Team A membership without shared");
assert.strictEqual(JSON.stringify(template.b), JSON.stringify(["b"]), "previous teams should carry only current Team B players without shared");
assert.strictEqual(template.shared, "s", "previous teams should carry shared player");
assert.strictEqual(JSON.stringify(template.helpers), JSON.stringify(["a"]), "fielding helpers should be current normal team players only");
assert.strictEqual(template.overs, 8, "previous teams should carry overs");
assert.strictEqual(template.battingMode, "single_batter", "previous teams should carry batting mode");
assert.strictEqual(template.matchDate, undefined, "previous teams must not carry an old match date");
assert.strictEqual(JSON.stringify(template.missing.sort()), JSON.stringify(["gone", "missing-helper"]), "missing roster ids should be reported");

context.prepareMatchSetup(template);
assert.strictEqual(context.pickState.a, "A", "Use Previous Teams should prefill Team A");
assert.strictEqual(context.pickState.b, "B", "Use Previous Teams should prefill Team B");
assert.strictEqual(context.pickState.s, "S", "Use Previous Teams should prefill shared player");
assert.strictEqual(context.helperState.a, true, "Use Previous Teams should prefill valid helpers");
assert.strictEqual(context.helperState.s, undefined, "shared player should not be carried as helper");
assert.strictEqual(elements.get("setupNotice").textContent.includes("Missing roster player"), true, "missing players should be visibly reported");
assert.strictEqual(elements.get("matchDateInput").value, context.currentPragueMatchDate(), "Use Previous Teams should default Match Date to today in Prague");
context.setTeam("a", "B");
assert.strictEqual(context.pickState.a, "B", "reused team preset must remain editable");
context.setTeam("a", "A");

elements.get("matchNameInput").value = "New Reused Match";
elements.get("venueInput").value = "CZU Gully Arena";
elements.get("teamAName").value = "Team A";
elements.get("teamBName").value = "Team B";
elements.get("oversInput").value = "8";
elements.get("matchDateInput").value = "2026-08-26";
context.setupDone();
assert(context.active, "setupDone should create a fresh active match");
assert.strictEqual(context.active.offlineMatchId, "apk-match-test-uuid", "new reused setup should get a fresh offlineMatchId");
assert.strictEqual(context.active.syncVersion, 1, "new reused setup should reset syncVersion");
assert.strictEqual(context.active.startedAt != null, true, "new reused setup should get fresh startedAt");
assert.strictEqual(context.active.matchDate, "2026-08-26", "new reused setup should store explicit Match Date");
assert.strictEqual(context.active.completedAt, null, "new reused setup must not carry completedAt");
assert.strictEqual(context.active.innings.length, 0, "new reused setup must not carry previous innings/events");
assert.strictEqual(context.active.result, "", "new reused setup must not carry result");
assert.strictEqual(context.active.potm, null, "new reused setup must not carry POM");
assert.strictEqual(context.active.syncState, "pending_sync", "new reused setup should start with APK pending sync state");
context.save();
context.active = null;
context.load();
assert.strictEqual(context.active.matchDate, "2026-08-26", "explicit Match Date should survive local save and reload");
const syncReadyActive = {
  ...context.active,
  innings: [{ batting: "A", openers: { s: "a", ns: null }, events: [{ t: "bowler", id: "b" }] }],
};
assert.strictEqual(context.convertMatch(syncReadyActive).matchDate, "2026-08-26", "sync payload should include exact explicit Match Date");

const adjacentStartedAtMatch = {
  ...syncReadyActive,
  matchDate: "2026-08-26",
  startedAt: "2026-08-25T21:58:00.000Z",
  date: "2026-08-25T21:58:00.000Z",
};
assert.strictEqual(
  context.convertMatch(adjacentStartedAtMatch).matchDate,
  "2026-08-26",
  "explicit Match Date should win over adjacent startedAt timestamp"
);
assert.strictEqual(
  context.pragueMatchDateFromTimestamp("2026-08-25T22:30:00.000Z"),
  "2026-08-26",
  "legacy fallback should derive Prague date without UTC slicing"
);
assert.strictEqual(
  context.convertMatch({ ...syncReadyActive, matchDate: undefined, startedAt: "2026-08-25T22:30:00.000Z", date: "2026-08-25T22:30:00.000Z" }).matchDate,
  "2026-08-26",
  "legacy local matches without explicit Match Date should use Prague startedAt fallback"
);
assert.strictEqual(context.isIsoCalendarDate("2026-08-26"), true, "valid Match Date should pass APK validation");
assert.strictEqual(context.isIsoCalendarDate("2026-02-29"), false, "invalid calendar dates should fail APK validation");
context.active.isDemo = true;
assert.strictEqual(context.convertMatch({ ...syncReadyActive, isDemo: true }).isDemo, true, "demo state should remain in sync payload");
assert.strictEqual(context.convertMatch({ ...syncReadyActive, isDemo: true }).matchDate, "2026-08-26", "demo sync payload should still carry explicit Match Date");
context.active.isDemo = false;

function pomRecommendationMatch({ scorer = "a", shared = null, potm = null, isDemo = false } = {}) {
  const teamAIds = shared ? ["a", shared] : ["a", "b"];
  const teamBIds = shared ? ["x", shared] : ["x", "y"];
  const striker = scorer;
  const nonStriker = teamAIds.find((id) => id !== striker) || null;

  return {
    ...syncReadyActive,
    isDemo,
    shared,
    potm,
    teamA: { name: "Team A", ids: teamAIds },
    teamB: { name: "Team B", ids: teamBIds },
    innings: [
      {
        batting: "A",
        openers: { s: striker, ns: nonStriker },
        events: [{ t: "bowler", id: "x" }, { t: "run", r: 6 }],
      },
    ],
  };
}

const uniquePomPayload = context.convertMatch(pomRecommendationMatch());
assert.strictEqual(uniquePomPayload.pomRecommendationPlayerId, "a", "unique highest pre-POM XP should sync the stable player id");

const tiePomPayload = context.convertMatch({
  ...pomRecommendationMatch(),
  innings: [{ batting: "A", openers: { s: "a", ns: "b" }, events: [{ t: "bowler", id: "x" }] }],
});
assert.strictEqual(tiePomPayload.pomRecommendationPlayerId, null, "exact pre-POM XP tie should sync no recommendation");

const sharedPomPayload = context.convertMatch(pomRecommendationMatch({ scorer: "s", shared: "s" }));
assert.strictEqual(sharedPomPayload.pomRecommendationPlayerId, "s", "Shared Player may be synced as the APK POM recommendation");

const demoPomPayload = context.convertMatch(pomRecommendationMatch({ isDemo: true }));
assert.strictEqual(demoPomPayload.isDemo, true, "demo recommendation payload should remain demo");
assert.strictEqual(demoPomPayload.pomRecommendationPlayerId, "a", "demo matches may carry a recommendation without becoming official");

const manualPomPayload = context.convertMatch(pomRecommendationMatch({ potm: "b" }));
assert.strictEqual(manualPomPayload.pomRecommendationPlayerId, "a", "POM +15 preview bonus must not influence the synced recommendation");
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(manualPomPayload, "selectedPlayerOfMatchId"),
  false,
  "APK sync must not send an authoritative selected Player of the Match"
);

function editorMatch(event, battingMode = "two_batter") {
  return {
    id: `editor-${Math.random().toString(36).slice(2)}`,
    startedAt: "2026-08-22T10:00:00.000Z",
    date: "2026-08-22T10:00:00.000Z",
    finished: true,
    isDemo: false,
    overs: 2,
    battingMode,
    shared: null,
    helpers: [],
    syncVersion: 1,
    syncState: "pending_sync",
    teamA: { name: "Team A", ids: battingMode === "single_batter" ? ["a", "b"] : ["a", "b", "c", "d"] },
    teamB: { name: "Team B", ids: ["x", "y", "z"] },
    innings: [
      {
        batting: "A",
        openers: { s: "a", ns: battingMode === "single_batter" ? null : "b" },
        events: [{ t: "bowler", id: "x" }, event],
      },
    ],
    result: "",
    potm: null,
  };
}

function editRunOut(match, next) {
  context.matches = [match];
  context.editingMatchId = match.id;
  context.edCtx = { mode: "edit", ix: 0, evIdx: 1 };
  context.edRunOut(next.startWho || next.who);
  context.edRunOutSetWho(next.who);
  context.edRunOutSetRuns(next.runs);
  context.edRunOutSetFielder(next.fielder);
  context.edRunOutSetNewBatter(next.newBatter);
  if (context.edRunOutPick) context.edRunOutSetNextStriker(next.nextStriker);
  if (match.battingMode !== "single_batter" && context.edRunOutPick) {
    context.edRunOutSetNextNonStriker(next.nextNonStriker);
  }
  return context.findMatch(match.id);
}

const oldRunOut = {
  t: "wicket",
  who: "striker",
  kind: "runout",
  fielder: "y",
  runs: 0,
  next: "c",
  newBatter: "c",
  nextStriker: "c",
  nextNonStriker: "b",
};

let edited = editRunOut(editorMatch({ ...oldRunOut }), {
  who: "striker",
  runs: 1,
  fielder: "y",
  newBatter: "c",
  nextStriker: "c",
  nextNonStriker: "b",
});
let editedState = context.getView(edited, 0);
assert.strictEqual(edited.innings[0].events[1].runs, 1, "editor should save completedRuns 0 -> 1");
assert.strictEqual(editedState.score, 1, "edited 0 -> 1 run-out should replay into team score");
assert.strictEqual(editedState.batsmen.a.runs, 1, "edited 0 -> 1 run-out should replay batter runs");
assert.strictEqual(editedState.batsmen.a.out, true, "edited striker run-out should keep striker dismissed");
assert.strictEqual(editedState.striker, "c", "edited run-out should preserve next striker");
assert.strictEqual(editedState.nonStriker, "b", "edited run-out should preserve next non-striker");
assert.strictEqual(editedState.bowlers.x.wickets, 0, "edited run-out must keep bowler wicket at zero");

edited = editRunOut(editorMatch({ ...oldRunOut, runs: 1 }), {
  who: "striker",
  runs: 2,
  fielder: "y",
  newBatter: "c",
  nextStriker: "b",
  nextNonStriker: "c",
});
editedState = context.getView(edited, 0);
assert.strictEqual(editedState.score, 2, "editor should save completedRuns 1 -> 2");
assert.strictEqual(editedState.striker, "b", "editor should save changed next striker");
assert.strictEqual(editedState.nonStriker, "c", "editor should save changed next non-striker");

edited = editRunOut(editorMatch({ ...oldRunOut }), {
  who: "nonstriker",
  runs: 1,
  fielder: "y",
  newBatter: "c",
  nextStriker: "c",
  nextNonStriker: "a",
});
editedState = context.getView(edited, 0);
assert.strictEqual(editedState.batsmen.a.out, false, "changing dismissed striker -> non-striker should remove old striker out state");
assert.strictEqual(editedState.batsmen.b.out, true, "changing dismissed striker -> non-striker should dismiss non-striker");

edited = editRunOut(editorMatch({ ...oldRunOut, who: "nonstriker", nextNonStriker: "a" }), {
  who: "striker",
  runs: 1,
  fielder: "y",
  newBatter: "c",
  nextStriker: "c",
  nextNonStriker: "b",
});
editedState = context.getView(edited, 0);
assert.strictEqual(editedState.batsmen.b.out, false, "changing dismissed non-striker -> striker should remove old non-striker out state");
assert.strictEqual(editedState.batsmen.a.out, true, "changing dismissed non-striker -> striker should dismiss striker");

edited = editRunOut(editorMatch({ ...oldRunOut, fielder: "y" }), {
  who: "striker",
  runs: 1,
  fielder: "z",
  newBatter: "c",
  nextStriker: "c",
  nextNonStriker: "b",
});
editedState = context.getView(edited, 0);
assert.strictEqual(editedState.fielding.y, undefined, "old run-out fielding credit should disappear after fielder edit");
assert.strictEqual(editedState.fielding.z.runouts, 1, "new run-out fielder should get exactly one credit");

edited = editRunOut(editorMatch({ ...oldRunOut, newBatter: "c", next: "c" }), {
  who: "striker",
  runs: 1,
  fielder: "y",
  newBatter: "d",
  nextStriker: "d",
  nextNonStriker: "b",
});
editedState = context.getView(edited, 0);
assert.strictEqual(edited.innings[0].events[1].newBatter, "d", "editor should save changed new batter");
assert.strictEqual(edited.innings[0].events[1].next, "d", "editor should preserve legacy next field for new batter compatibility");
assert.strictEqual(editedState.batsmen.c.didBat, false, "old new batter should no longer be marked as batted after replay");
assert.strictEqual(editedState.batsmen.d.didBat, true, "new batter should be marked as batted after replay");

const legacyRunOut = editorMatch({ t: "wicket", who: "striker", kind: "runout", fielder: "y", next: null });
assert.doesNotThrow(() => context.getView(legacyRunOut, 0), "legacy run-out with missing new fields should not crash");
const legacyState = context.getView(legacyRunOut, 0);
assert.strictEqual(legacyState.needsBatsman, true, "legacy run-out should fall back to safe new-batter prompt state");

const singleEdited = editRunOut(
  editorMatch({ t: "wicket", who: "striker", kind: "runout", fielder: "y", runs: 0, next: "b", newBatter: "b", nextStriker: "b" }, "single_batter"),
  {
    who: "striker",
    runs: 1,
    fielder: "z",
    newBatter: "b",
    nextStriker: "b",
    nextNonStriker: "a",
  },
);
assert.strictEqual(singleEdited.innings[0].events[1].nextNonStriker, null, "single_batter editor must not create nextNonStriker");

function liveMatch(events, overs = 2) {
  return {
    id: `live-${Math.random().toString(36).slice(2)}`,
    startedAt: "2026-08-22T10:00:00.000Z",
    date: "2026-08-22T10:00:00.000Z",
    finished: false,
    isDemo: false,
    overs,
    battingMode: "two_batter",
    shared: null,
    helpers: [],
    syncVersion: 1,
    syncState: "pending_sync",
    teamA: { name: "Team A", ids: ["a", "b", "c"] },
    teamB: { name: "Team B", ids: ["x", "y", "z"] },
    innings: [{ batting: "A", openers: { s: "a", ns: "b" }, events }],
    current: 0,
    stage: "live",
    result: "",
    potm: null,
  };
}

function fiveLegalZeros() {
  return [{ t: "bowler", id: "x" }, { t: "run", r: 0 }, { t: "run", r: 0 }, { t: "run", r: 0 }, { t: "run", r: 0 }, { t: "run", r: 0 }];
}

function setActive(match) {
  context.active = match;
  context.navStack = ["home", "score"];
  return match;
}

let undoOver = setActive(liveMatch(fiveLegalZeros().concat([{ t: "run", r: 1 }, { t: "bowler", id: "y" }])));
context.undo();
let overUndoState = context.curState();
assert.strictEqual(undoOver.innings[0].events.length, 6, "undo should remove trailing next-over bowler and sixth ball");
assert.strictEqual(overUndoState.balls, 5, "sixth-ball undo should reopen previous over at five legal balls");
assert.strictEqual(overUndoState.score, 0, "sixth-ball undo should reverse team score");
assert.strictEqual(overUndoState.batsmen.a.runs, 0, "sixth-ball undo should reverse batter runs");
assert.strictEqual(overUndoState.bowler, "x", "previous over bowler should remain current after reopening over");
assert.strictEqual(overUndoState.needsBowler, false, "reopened over should not ask for next bowler");

context.pushEv({ t: "run", r: 0 });
let correctedState = context.curState();
assert.strictEqual(correctedState.balls, 6, "corrected sixth legal ball should be accepted");
assert.strictEqual(correctedState.needsBowler, true, "next-bowler selection should appear after corrected over completion");

let nextOver = setActive(liveMatch(fiveLegalZeros().concat([{ t: "run", r: 0 }, { t: "bowler", id: "y" }, { t: "run", r: 4 }])));
context.undo();
let nextOverState = context.curState();
assert.strictEqual(nextOver.innings[0].events.length, 8, "first ball of next over undo should remove only that ball");
assert.strictEqual(nextOver.innings[0].events[nextOver.innings[0].events.length - 1].t, "bowler", "next-over bowler should remain selected after undoing first ball");
assert.strictEqual(nextOverState.balls, 6, "undoing next-over ball should not jump back to previous over");
assert.strictEqual(nextOverState.bowler, "y", "next-over bowler should remain current at start of over");

let wicketOver = setActive(liveMatch(fiveLegalZeros().concat([{ t: "wicket", who: "striker", kind: "bowled", fielder: null, next: "c" }, { t: "bowler", id: "y" }])));
context.undo();
let wicketUndoState = context.curState();
assert.strictEqual(wicketUndoState.balls, 5, "sixth-ball wicket undo should reopen over");
assert.strictEqual(wicketUndoState.wickets, 0, "sixth-ball wicket undo should reverse wicket");
assert.strictEqual(wicketUndoState.bowlers.x.wickets, 0, "sixth-ball wicket undo should reverse bowler wicket");

let runOutOver = setActive(liveMatch(fiveLegalZeros().concat([{
  t: "wicket",
  who: "striker",
  kind: "runout",
  fielder: "y",
  runs: 2,
  next: "c",
  newBatter: "c",
  nextStriker: "c",
  nextNonStriker: "b",
}, { t: "bowler", id: "y" }])));
context.undo();
let runOutUndoState = context.curState();
assert.strictEqual(runOutUndoState.balls, 5, "sixth-ball run-out undo should reopen over");
assert.strictEqual(runOutUndoState.score, 0, "sixth-ball run-out undo should reverse completed runs");
assert.strictEqual(runOutUndoState.wickets, 0, "sixth-ball run-out undo should reverse wicket");
assert.strictEqual(runOutUndoState.fielding.y, undefined, "sixth-ball run-out undo should reverse fielding credit");

let wideSixth = setActive(liveMatch(fiveLegalZeros().concat([{ t: "wide" }, { t: "run", r: 0 }, { t: "bowler", id: "y" }])));
context.undo();
let wideUndoState = context.curState();
assert.strictEqual(wideUndoState.balls, 5, "wide before sixth ball should remain illegal after undoing legal sixth");
assert.strictEqual(wideUndoState.score, 1, "wide extra should remain after undoing following legal sixth ball");
assert.strictEqual(wideUndoState.extras, 1, "wide extra should not be removed unless it is the last scoring event");
assert.strictEqual(wideUndoState.thisOver.join(","), "0,0,0,0,0,Wd", "wide should remain in current over display");

let noBallSixth = setActive(liveMatch(fiveLegalZeros().concat([{ t: "nb", r: 1 }, { t: "run", r: 0 }, { t: "bowler", id: "y" }])));
context.undo();
let noBallUndoState = context.curState();
assert.strictEqual(noBallUndoState.balls, 5, "no-ball before sixth ball should remain illegal after undoing legal sixth");
assert.strictEqual(noBallUndoState.score, 2, "no-ball score should remain after undoing following legal sixth ball");
assert.strictEqual(noBallUndoState.extras, 1, "no-ball extra should remain");

let finalOver = setActive(liveMatch(fiveLegalZeros().concat([{ t: "run", r: 1 }]), 1));
finalOver.stage = "break";
context.undo();
let finalUndoState = context.curState();
assert.strictEqual(finalOver.stage, "live", "final-over undo should reopen live scoring");
assert.strictEqual(finalUndoState.closed, false, "final-over undo should remove innings-complete state");
assert.strictEqual(finalUndoState.balls, 5, "final-over undo should restore five legal balls");
assert.strictEqual(finalUndoState.score, 0, "final-over undo should reverse final delivery score");

function resetSetupForBalance() {
  context.roster = roster(["a", "b", "c", "d", "x", "y", "z", "s"]);
  context.pickState = {};
  context.helperState = {};
  context.setupNoticeText = "";
  context.setupBalancedOnce = false;
}

resetSetupForBalance();
context.applyBalancedTeams(
  { teamAPlayerIds: ["a", "b"], teamBPlayerIds: ["x", "y"], sharedPlayerId: null },
  ["a", "b", "x", "y"],
);
assert.strictEqual(context.pickState.a, "A", "balanced response should populate Team A");
assert.strictEqual(context.pickState.b, "A", "balanced response should populate all Team A ids");
assert.strictEqual(context.pickState.x, "B", "balanced response should populate Team B");
assert.strictEqual(context.pickState.y, "B", "balanced response should populate all Team B ids");
assert.strictEqual(context.setupBalancedOnce, true, "successful balance should enable Balance Again label");
context.setTeam("a", "B");
assert.strictEqual(context.pickState.a, "B", "balanced result remains manually editable");
assert.strictEqual(context.setupBalancedOnce, false, "manual edit returns the setup to normal Balance Teams mode");

resetSetupForBalance();
context.helperState.s = true;
context.helperState.a = true;
context.applyBalancedTeams(
  { teamAPlayerIds: ["a"], teamBPlayerIds: ["b"], sharedPlayerId: "s" },
  ["a", "b", "s"],
);
assert.strictEqual(context.pickState.s, "S", "odd attendance balance should retain Shared Player");
assert.strictEqual(context.helperState.s, undefined, "Shared Player should be removed from helper selections");
assert.strictEqual(context.helperState.a, true, "valid helper selections may remain after balance");

assert(html.includes("/api/app-sync/team-balance"), "APK should call the authenticated app-sync balance endpoint");
assert(html.includes("Balance Again"), "APK should offer Balance Again after a server balance result");
assert(html.includes("Choose Shared Player"), "odd attendance should ask for Shared Player before balancing");
assert(html.includes("BALANCE TEAMS NEEDS INTERNET"), "offline balance failure should keep manual setup available");
assert(!/privateBalanceRatings|batting:\s*[1-5]|bowling:\s*[1-5]|fielding:\s*[1-5]|prohibitedPairs/.test(html), "APK asset must not contain private balance ratings or rules");
assert(context.convertMatch.toString().includes("pomRecommendationPlayerId"), "sync payload should keep POM recommendation support");
assert(!context.convertMatch.toString().includes("teamBalance"), "sync payload should not reveal how teams were created");

async function runBalanceRequestTests() {
  resetSetupForBalance();
  context.settings.accessToken = "token";
  context.fetch = function (_url, opts) {
    const body = JSON.parse(opts.body);
    assert.deepStrictEqual(body, {
      playerIds: ["a", "b", "x", "y"],
      sharedPlayerId: null,
    }, "authenticated balance request should send only ids and Shared Player");
    assert.strictEqual(opts.headers.Authorization, "Bearer token", "balance request should use Admin bearer token");
    return Promise.resolve({
      status: 200,
      json: () => Promise.resolve({
        teamAPlayerIds: ["a", "x"],
        teamBPlayerIds: ["b", "y"],
        sharedPlayerId: null,
      }),
    });
  };
  let ok = await context.requestBalanceTeams(["a", "b", "x", "y"], null);
  assert.strictEqual(ok.ok, true, "authenticated balance request should succeed");
  assert.deepStrictEqual(ok.j.teamAPlayerIds, ["a", "x"], "balance response should be returned to setup");

  context.fetch = function () {
    return Promise.resolve({ status: 0, json: () => Promise.resolve({}) });
  };
  let offline = await context.requestBalanceTeams(["a", "b", "x", "y"], null);
  assert.strictEqual(offline.ok, false, "offline balance should fail safely");
  assert.match(offline.msg, /BALANCE TEAMS NEEDS INTERNET/);
  assert.deepStrictEqual(context.pickState, {}, "offline balance must not clear setup selections");
}

runBalanceRequestTests()
  .then(function () {
    console.log("APK match setup parity test passed.");
  })
  .catch(function (error) {
    console.error(error);
    process.exit(1);
  });
