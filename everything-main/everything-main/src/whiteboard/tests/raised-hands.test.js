import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readView, validCamera } from "../src/collaboration/attention.js";
import { raisedHands, readLower } from "../src/collaboration/live.js";
import { CollaborationSession } from "../src/collaboration/session.js";
import { createAttentionUI } from "../src/attention-ui.js";
import { createLiveUI, renderHands } from "../src/live-ui.js";
import { createPeopleView } from "../src/facilitation/people-view.js";
import { setLanguage } from "../src/i18n.js";
import { environment, owner, memoryStore } from "./collaboration-helpers.js";

const camera = { x: 100, y: -80, w: 1000, h: 500 };
const person = (session, user, username, role = "editor") => ({
  session,
  user,
  username,
  role,
});
const bob = person("bob", "bob-user", "Bob"),
  cam = person("cam", "cam-user", "Cam", "viewer"),
  facilitator = person("fac", "fac-user", "Fay", "facilitator");

// How views were read before raised hands, as clients still in use read
// them: a raised hand must leave such a client's view of the person as it
// was.
function releasedReadView(data, now) {
  if (
    !data ||
    !validCamera(data.camera) ||
    !Number.isSafeInteger(data.at) ||
    Math.abs(now - data.at) > 15000 ||
    (data.following !== null &&
      !(
        typeof data.following === "string" &&
        /^[a-zA-Z0-9_-]{1,128}$/.test(data.following)
      ))
  )
    return null;
  return { camera: { ...data.camera }, following: data.following, at: data.at };
}

test("raised hands travel with views, validated, and are ordered by when they went up, once per person", () => {
  const now = 2_000_000;
  const view = { camera, following: null, at: now };
  assert.equal(readView(view, now).hand, undefined);
  assert.equal(readView({ ...view, hand: now - 5000 }, now).hand, now - 5000);
  for (const hand of [now + 1, 0, -4, 1.5, "1", null, true])
    assert.equal(readView({ ...view, hand }, now), null, String(hand));
  // Clients from before raised hands read the same view and ignore it.
  assert.deepEqual(releasedReadView({ ...view, hand: now - 5000 }, now), view);
  assert.deepEqual(readLower({ lower: "all", at: now }, now), {
    lower: "all",
    at: now,
  });
  assert.deepEqual(readLower({ lower: "bob", at: now - 1000 }, now), {
    lower: "bob",
    at: now - 1000,
  });
  for (const data of [
    null,
    [],
    { lower: "everyone else!", at: now },
    { lower: "", at: now },
    { lower: "x".repeat(129), at: now },
    { lower: "bob" },
    { lower: "bob", at: now - 15001 },
    { lower: 4, at: now },
  ])
    assert.equal(readLower(data, now), null, JSON.stringify(data));
  const roster = [
    person("me", "me-user", "Me"),
    bob,
    person("bob-2", "bob-user", "Bob"),
    cam,
    person("gone", "gone-user", "Gone"),
  ];
  const views = new Map([
    ["bob", { hand: 300 }],
    ["bob-2", { hand: 100 }],
    ["cam", { hand: 200 }],
    ["gone", { hand: 50 }],
    ["left", { hand: 10 }],
  ]);
  // Someone not in the roster, as after leaving, is not listed.
  views.delete("gone");
  const list = raisedHands(views, roster.slice(0, 4), {
    session: "me",
    hand: 250,
  });
  assert.deepEqual(
    list.map((h) => [h.username, h.hand, h.sessions, h.self]),
    [
      ["Bob", 100, ["bob", "bob-2"], false],
      ["Cam", 200, ["cam"], false],
      ["Me", 250, ["me"], true],
    ],
  );
  assert.equal(list[0].session, "bob-2", "The tab raised first");
  assert.deepEqual(raisedHands(new Map(), roster, null), []);
});

function session(options = {}) {
  const env = environment();
  return new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: "room",
    user: owner,
    store: memoryStore(),
    changed() {
      throw Error("Raised hands never change the board");
    },
    activity() {},
    status() {},
    ...options,
  });
}
function link(s, sent, role = "editor") {
  s.peers = {
    ticket: {},
    links: new Map([["bob", { connected: true, whiteboardAuthorized: true }]]),
    broadcast: async (...packet) => sent.push(packet),
    close() {},
  };
  s.connected = true;
  s.applyRole(role);
  s.roster = [person(s.session, owner.uuid, "Alice", role), bob, cam];
}

test("a person raises and lowers their hand with their view, and renewals and follow requests keep it", async () => {
  const sent = [];
  const s = session();
  try {
    assert.equal(s.raiseHand(true), false, "No view or link yet");
    link(s, sent, "viewer");
    s.view(camera);
    await new Promise((r) => setTimeout(r));
    sent.length = 0;
    s.peers.links.get("bob").whiteboardAuthorized = false;
    assert.equal(s.raiseHand(true), false, "Not without a live link");
    s.peers.links.get("bob").whiteboardAuthorized = true;
    // Viewers raise their hand too.
    assert.equal(s.raiseHand(true), true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], "view");
    assert.ok(Number.isSafeInteger(sent[0][1].hand));
    assert.ok(sent[0][1].hand <= sent[0][1].at);
    assert.deepEqual(sent[0][1].camera, camera);
    const hand = s.hand;
    assert.equal(s.raiseHand(true), true);
    assert.equal(sent.length, 1, "Raising it again sends nothing");
    s.lastViewSent = 0;
    s.renewView();
    assert.equal(sent.at(-1)[1].hand, hand, "Renewals carry it");
    s.applyRole("editor");
    s.readOnly = false;
    await s.bring("all");
    assert.equal(sent.at(-1)[0], "attention");
    assert.equal(sent.at(-1)[1].hand, hand, "So do follow requests");
    // A hand comes down even without a link, so it is never stuck.
    s.peers.links.get("bob").whiteboardAuthorized = false;
    assert.equal(s.raiseHand(false), true);
    assert.equal(s.hand, null);
    assert.equal(sent.at(-1)[1].hand, undefined);
    assert.equal(s.shared.snapshot().items.length, 0);
    assert.equal(s.pending.size, 0, "Nothing waits to be saved");
  } finally {
    s.close();
  }
});

test("only owners and facilitators lower others' hands, and a lowered hand stays down until raised again", async () => {
  const sent = [],
    changes = [],
    lowered = [];
  const s = session({
    viewChanged: (views) => changes.push(new Map(views)),
    handLowered: (by) => lowered.push(by.username),
  });
  const now = () => Math.round(s.now());
  try {
    link(s, sent);
    s.view(camera);
    await s.receive(
      "view",
      { camera, following: null, at: now(), hand: now() - 2000 },
      bob,
      10,
    );
    assert.ok(s.views.get("bob").hand);
    // An editor's request, a stale one, or a malformed one does nothing.
    await s.receive("hand", { lower: "bob", at: now() }, cam, 5);
    await s.receive("hand", { lower: "bob", at: now() }, bob, 6);
    await s.receive(
      "hand",
      { lower: "bob", at: now() - 20000 },
      facilitator,
      7,
    );
    await s.receive("hand", { lower: "bob!", at: now() }, facilitator, 8);
    assert.ok(s.views.get("bob").hand);
    assert.equal(await s.lowerHand("bob"), false, "Editors cannot lower it");
    assert.equal(sent.filter(([kind]) => kind === "hand").length, 0);
    const at = now();
    await s.receive("hand", { lower: "bob", at }, facilitator, 9);
    assert.equal(s.views.get("bob").hand, undefined);
    assert.equal(changes.at(-1).get("bob").hand, undefined);
    // A request repeated, or older than one already taken, is ignored.
    await s.receive("hand", { lower: "all", at }, facilitator, 9);
    // A renewal sent before Bob heard of it still carries the hand.
    await s.receive(
      "view",
      { camera, following: null, at: now(), hand: at - 2000 },
      bob,
      11,
    );
    assert.equal(s.views.get("bob").hand, undefined, "It stays down");
    await s.receive(
      "view",
      { camera, following: null, at: now() + 5, hand: now() + 5 },
      bob,
      12,
    );
    assert.ok(s.views.get("bob").hand, "Raised again after");
    // This person's own hand, lowered by a facilitator's request for all.
    assert.equal(s.raiseHand(true), true);
    await new Promise((r) => setTimeout(r, 5));
    sent.length = 0;
    await s.receive("hand", { lower: "all", at: now() + 10 }, facilitator, 20);
    assert.equal(s.hand, null);
    assert.deepEqual(lowered, ["Fay"]);
    assert.equal(sent.at(-1)[0], "view");
    assert.equal(sent.at(-1)[1].hand, undefined, "Everyone hears it went");
    assert.equal(s.views.get("bob").hand, undefined, "Everyone's went");
    // A hand raised after the request stays up.
    await new Promise((r) => setTimeout(r, 20));
    s.raiseHand(true);
    await s.receive("hand", { lower: "all", at: s.hand - 15 }, facilitator, 21);
    assert.ok(s.hand);
    assert.deepEqual(lowered, ["Fay"]);
    // Leaving takes the hand down with the view.
    await s.receive(
      "view",
      { camera, following: null, at: now() + 30, hand: now() + 30 },
      bob,
      30,
    );
    await s.receive("view-left", { at: now() }, bob, 31);
    assert.equal(s.views.has("bob"), false);
    assert.equal(s.shared.snapshot().items.length, 0);
  } finally {
    s.close();
  }
});

test("a facilitator lowers one hand or all of them, their own included", async () => {
  const sent = [],
    changes = [];
  const s = session({ viewChanged: (views) => changes.push(views.size) });
  const now = () => Math.round(s.now());
  try {
    link(s, sent, "facilitator");
    s.view(camera);
    for (const [who, seq] of [
      [bob, 1],
      [cam, 2],
    ])
      await s.receive(
        "view",
        { camera, following: null, at: now(), hand: now() - seq },
        who,
        seq,
      );
    assert.equal(await s.lowerHand("nobody"), false, "No such hand");
    assert.equal(await s.lowerHand("bob"), true);
    assert.equal(sent.at(-1)[0], "hand");
    assert.equal(sent.at(-1)[1].lower, "bob");
    assert.ok(Math.abs(sent.at(-1)[1].at - now()) < 1000);
    assert.equal(s.views.get("bob").hand, undefined, "Down at once here");
    assert.ok(s.views.get("cam").hand);
    s.raiseHand(true);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(await s.lowerHand("all"), true);
    assert.equal(sent.at(-1)[1].lower, "all");
    assert.equal(s.views.get("cam").hand, undefined);
    assert.equal(s.hand, null);
    // Lowering one's own hand needs no role and sends no request.
    s.applyRole("viewer");
    s.peers.links.get("bob").whiteboardAuthorized = true;
    s.raiseHand(true);
    const requests = sent.filter(([kind]) => kind === "hand").length;
    assert.equal(await s.lowerHand(s.session), true);
    assert.equal(s.hand, null);
    assert.equal(sent.filter(([kind]) => kind === "hand").length, requests);
    assert.equal(await s.lowerHand("all"), false, "Viewers cannot");
  } finally {
    s.close();
  }
});

// A document for UI tests, set as the global one the modules use.
function page(markup) {
  const dom = new JSDOM(markup, { pretendToBeVisual: true });
  const saved = new Map();
  for (const [key, value] of Object.entries({
    document: dom.window.document,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  })) {
    saved.set(key, globalThis[key]);
    globalThis[key] = value;
  }
  return {
    doc: dom.window.document,
    w: dom.window,
    close() {
      dom.window.close();
      for (const [key, value] of saved) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    },
  };
}

test("the raise hand toggle is pressed while the hand is up, shows on the control, and says what happened", () => {
  const p = page(
    `<div class="canvas-wrap"><canvas tabindex="0"></canvas><button data-action="live" aria-expanded="false" hidden></button></div>`,
  );
  const announced = [],
    changed = [];
  const state = { linked: true };
  const s = {
    session: "self",
    hand: null,
    user: { username: "Alice" },
    linked: () => state.linked,
    react: () => true,
    raiseHand(up) {
      if (up && !state.linked) return false;
      s.hand = up ? 123 : null;
      return true;
    },
  };
  const ui = createLiveUI({
    session: () => s,
    shared: () => true,
    anonymous: () => false,
    canManage: () => false,
    handChanged: () => changed.push(s.hand),
    announce: (m) => announced.push(m),
  });
  try {
    ui.bind(p.doc.querySelector(".canvas-wrap"));
    const control = p.doc.querySelector('[data-action="live"]');
    ui.toggle();
    const hand = p.doc.querySelector("[data-live-hand]");
    assert.equal(hand.textContent, "Raise hand");
    assert.equal(hand.getAttribute("aria-pressed"), "false");
    hand.click();
    assert.equal(hand.getAttribute("aria-pressed"), "true");
    assert.equal(hand.textContent, "Raise hand", "Its name stays put");
    assert.ok(control.classList.contains("is-raised"));
    assert.equal(announced.at(-1), "Your hand is raised.");
    assert.deepEqual(changed, [123]);
    // Without a link the hand can still come down, but not go up.
    state.linked = false;
    ui.render();
    assert.equal(hand.disabled, false);
    hand.click();
    assert.equal(hand.getAttribute("aria-pressed"), "false");
    assert.equal(announced.at(-1), "Your hand is lowered.");
    assert.equal(hand.disabled, true);
    state.linked = true;
    ui.render();
    hand.click();
    s.hand = null;
    ui.loweredBy();
    assert.equal(announced.at(-1), "A facilitator lowered your hand.");
    assert.equal(hand.getAttribute("aria-pressed"), "false");
    assert.equal(control.classList.contains("is-raised"), false);
    hand.dispatchEvent(
      new p.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    assert.equal(p.doc.activeElement, control);
  } finally {
    ui.detach();
    p.close();
  }
});

test("facilitators hear who raised or lowered a hand, together within a second; others hear nothing", async () => {
  const p = page(`<div class="canvas-wrap"></div>`);
  const announced = [];
  let manage = true;
  const s = { session: "self", linked: () => true };
  const ui = createLiveUI({
    session: () => s,
    shared: () => true,
    anonymous: () => true,
    canManage: () => manage,
    announce: (m) => announced.push(m),
  });
  const hand = (user, username, self = false) => ({
    user,
    username,
    session: user,
    sessions: [user],
    self,
  });
  try {
    ui.bind(p.doc.querySelector(".canvas-wrap"));
    ui.hands([hand("a", "Ann")]);
    await new Promise((r) => setTimeout(r, 1100));
    assert.deepEqual(announced, ["Hand raised: Ann"], "By name, anonymous");
    // This person's own hand is not said.
    ui.hands([hand("a", "Ann"), hand("b", "Bob"), hand("me", "Me", true)]);
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(announced.at(-1), "Hand raised: Bob");
    ui.hands([]);
    ui.hands([hand("c", "Cy"), hand("d", "Di")]);
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(announced.at(-1), "2 hands raised. 2 hands lowered.");
    manage = false;
    ui.hands([]);
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(announced.length, 3);
  } finally {
    ui.detach();
    p.close();
  }
});

test("hand lists show names and lowering to facilitators, and only a count to others under anonymous input", () => {
  const p = page(`<section id="hands" hidden></section><input id="other">`);
  try {
    const section = p.doc.querySelector("#hands");
    const list = [
      { user: "b", username: "Bob <i>", session: "b1", sessions: ["b1", "b2"] },
      {
        user: "me",
        username: "Me",
        session: "me",
        sessions: ["me"],
        self: true,
      },
    ];
    renderHands(section, list, { manage: true, anonymous: true });
    assert.equal(section.hidden, false);
    assert.equal(section.querySelector("h4").textContent, "2 raised hands");
    assert.deepEqual(
      [...section.querySelectorAll("li")].map((li) => li.textContent),
      ["Bob <i>Lower hand", "Me (you)Lower hand"],
    );
    assert.equal(section.querySelector("i"), null);
    const buttons = [...section.querySelectorAll("button")];
    assert.deepEqual(
      buttons.map((b) => [b.dataset.lowerHand, b.getAttribute("aria-label")]),
      [
        ["all", null],
        ["b1 b2", "Lower hand: Bob <i>"],
        ["me", "Lower hand: Me"],
      ],
    );
    assert.equal(buttons[0].textContent, "Lower all hands");
    // Others see who unless input is anonymous, and lower only their own.
    renderHands(section, list, { manage: false, anonymous: false });
    assert.deepEqual(
      [...section.querySelectorAll("button")].map((b) => b.dataset.lowerHand),
      ["me"],
    );
    renderHands(section, list, { manage: false, anonymous: true });
    assert.equal(section.querySelector("ol"), null);
    assert.equal(section.querySelector("button"), null);
    assert.equal(section.textContent, "2 raised hands");
    // Focus stays on the control in the same place, or is handed back.
    renderHands(section, list, { manage: true, anonymous: false });
    section.querySelectorAll("button")[2].focus();
    assert.equal(
      renderHands(section, list.slice(0, 1), {
        manage: true,
        anonymous: false,
      }),
      false,
    );
    assert.equal(p.doc.activeElement.dataset.lowerHand, "b1 b2");
    assert.equal(
      renderHands(section, [], { manage: true, anonymous: false }),
      true,
    );
    assert.equal(section.hidden, true);
    setLanguage("fr");
    renderHands(section, list.slice(1), { manage: true, anonymous: false });
    assert.equal(section.querySelector("h4").textContent, "1 main levée");
    assert.equal(
      section.querySelector("[data-lower-hand]").textContent,
      "Baisser toutes les mains",
    );
  } finally {
    setLanguage("en");
    p.close();
  }
});

function attentionSetup({ manage, anonymous }) {
  const p = page(
    '<div class="canvas-wrap"><canvas tabindex="0"></canvas></div><dialog><div id="participant-list"></div></dialog>',
  );
  const state = { lowered: [], changed: [], manage, anonymous };
  const s = { session: "self", readOnly: false, hand: null, view() {} };
  const ui = createAttentionUI({
    session: () => s,
    canBring: () => true,
    canManage: () => state.manage,
    anonymous: () => state.anonymous,
    lowerHand: (sessions) => state.lowered.push(sessions),
    handsChanged: (list) => state.changed.push(list.map((h) => h.username)),
    view: () => ({ x: 0, y: 0, z: 1 }),
    size: () => ({ width: 800, height: 600 }),
    busy: () => false,
    prepare() {},
    navigate() {},
    focusCanvas() {},
    toast() {},
    redrawCursors() {},
  });
  ui.bind(p.doc.querySelector(".canvas-wrap"));
  const roster = [
    person("self", "self-user", "Alice", manage ? "facilitator" : "editor"),
    bob,
    cam,
    person("dee", "dee-user", "Dee"),
  ];
  const views = new Map(
    roster.slice(1).map((r) => [r.session, { ...r, camera, following: null }]),
  );
  views.get("cam").hand = 100;
  views.get("bob").hand = 200;
  const d = p.doc.querySelector("dialog");
  d.close = () => d.dispatchEvent(new p.w.Event("close"));
  return { ...p, ui, state, s, roster, views, d };
}

test("facilitators see raised hands in Participants in order, with a count, and lower them", async () => {
  const a = attentionSetup({ manage: true, anonymous: true });
  try {
    a.ui.update(a.views, a.roster);
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(a.state.changed.at(-1), ["Cam", "Bob"]);
    a.ui.mountDialog(a.d);
    const section = a.d.querySelector("#raised-hands");
    assert.equal(section.hidden, false);
    assert.equal(section.querySelector("h4").textContent, "2 raised hands");
    assert.deepEqual(
      [...section.querySelectorAll("li [data-user-content]")].map(
        (n) => n.textContent,
      ),
      ["Cam", "Bob"],
      "In the order raised, by name even under anonymous input",
    );
    const states = Object.fromEntries(
      [...a.d.querySelectorAll(".live-participant-row")].map((row) => [
        row.dataset.session,
        row.querySelector("small").textContent,
      ]),
    );
    assert.deepEqual(states, {
      bob: "Live · Hand raised",
      cam: "Live · Hand raised",
      dee: "Live",
    });
    section.querySelector('[data-lower-hand="cam"]').click();
    section.querySelector('[data-lower-hand="all"]').click();
    assert.deepEqual(a.state.lowered, ["cam", "all"]);
    // A hand going down, here or elsewhere, updates the list.
    a.d.querySelector('[data-lower-hand="bob"]').focus();
    delete a.views.get("bob").hand;
    a.ui.update(a.views, a.roster);
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(a.state.changed.at(-1), ["Cam"]);
    assert.equal(a.doc.activeElement.dataset.lowerHand, "cam");
    // The person's own hand counts too, once raised.
    a.s.hand = 300;
    a.ui.refresh();
    assert.deepEqual(a.state.changed.at(-1), ["Cam", "Alice"]);
    assert.deepEqual(
      a.ui.hands().map((h) => h.username),
      ["Cam", "Alice"],
    );
    // Leaving the roster takes a hand away.
    a.ui.update(
      a.views,
      a.roster.filter((r) => r.session !== "cam"),
    );
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(a.state.changed.at(-1), ["Alice"]);
  } finally {
    a.ui.reset();
    a.close();
  }
});

test("participants see who has a hand up unless input is anonymous, and cannot lower others' hands", async () => {
  const a = attentionSetup({ manage: false, anonymous: true });
  try {
    a.ui.update(a.views, a.roster);
    await new Promise((r) => setTimeout(r, 40));
    a.ui.mountDialog(a.d);
    const section = a.d.querySelector("#raised-hands");
    assert.equal(section.textContent, "2 raised hands");
    assert.equal(section.querySelector("button"), null);
    assert.ok(
      [...a.d.querySelectorAll(".live-participant-row small")].every(
        (s) => !s.textContent.includes("Hand raised"),
      ),
      "Rows do not say whose hand is up",
    );
    a.state.anonymous = false;
    a.ui.refresh();
    assert.deepEqual(
      [...section.querySelectorAll("li")].map((li) => li.textContent),
      ["Cam", "Bob"],
    );
    assert.equal(section.querySelector("button"), null);
  } finally {
    a.ui.reset();
    a.close();
  }
});

test("the People tab lists raised hands in order for facilitators to lower, and marks their rows", () => {
  const p = page(`<div id="content"></div>`);
  const state = {
    role: "facilitator",
    anonymous: false,
    lowered: [],
    hands: [
      { ...cam, hand: 100, sessions: ["cam"] },
      { ...bob, hand: 200, sessions: ["bob"] },
    ],
  };
  const live = {};
  const view = createPeopleView({
    board: () => ({
      id: "board",
      shared: {},
      workshop: { settings: { anonymous: state.anonymous } },
    }),
    session: () => live,
    role: () => state.role,
    canParticipate: () => true,
    identity: () => ({ id: "fac-user", name: "Fay" }),
    roster: () => [facilitator, bob, cam],
    hands: () => state.hands,
    lowerHand: (sessions) => state.lowered.push(sessions),
    refresh() {},
    announce() {},
    toast() {},
  });
  try {
    const content = p.doc.querySelector("#content");
    view.render(content);
    const section = content.querySelector("#fac-hands");
    assert.equal(section.hidden, false);
    assert.deepEqual(
      [...section.querySelectorAll("li [data-user-content]")].map(
        (n) => n.textContent,
      ),
      ["Cam", "Bob"],
    );
    const marked = (user) =>
      !!content.querySelector(`[data-fac-person="${user}"] .raised-hand-badge`);
    assert.ok(marked("bob-user") && marked("cam-user"));
    assert.equal(marked("fac-user"), false);
    section.querySelector('[data-lower-hand="bob"]').click();
    section.querySelector('[data-lower-hand="all"]').click();
    assert.deepEqual(state.lowered, ["bob", "all"]);
    // A participant under anonymous input sees how many, not whose.
    state.role = "editor";
    state.anonymous = true;
    view.render(content);
    assert.equal(section.textContent, "2 raised hands");
    assert.equal(marked("bob-user"), false);
    state.hands = [];
    view.render(content);
    assert.equal(section.hidden, true);
  } finally {
    p.close();
  }
});
