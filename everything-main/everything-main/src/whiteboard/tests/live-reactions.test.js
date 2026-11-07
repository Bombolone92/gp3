import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  LIVE_REACTIONS,
  Pace,
  readReaction,
} from "../src/collaboration/live.js";
import { REACTIONS } from "../src/facilitation/model.js";
import { CollaborationSession } from "../src/collaboration/session.js";
import { createLiveUI, MAX_FLOATING } from "../src/live-ui.js";
import { setLanguage } from "../src/i18n.js";
import { environment, owner, memoryStore } from "./collaboration-helpers.js";

const editor = {
    session: "editor",
    user: "editor-user",
    username: "Bob",
    role: "editor",
  },
  viewer = {
    ...editor,
    session: "viewer",
    user: "viewer-user",
    role: "viewer",
  };

function session(options = {}) {
  const env = environment();
  const s = new CollaborationSession({
    puter: env.sdk(owner),
    server: "https://whiteboard-test.puter.work",
    room: "room",
    user: owner,
    store: memoryStore(),
    changed() {
      throw Error("Live reactions never change the board");
    },
    activity() {},
    status() {},
    ...options,
  });
  return s;
}
// A session whose peer network is stood in for, with one live link.
function linked(s, sent) {
  s.peers = {
    ticket: {},
    links: new Map([
      ["editor", { connected: true, whiteboardAuthorized: true }],
    ]),
    broadcast: async (...packet) => sent.push(packet),
    close() {},
  };
  s.connected = true;
}

test("live reactions are one of the eight kinds, current, and paced per person", () => {
  assert.deepEqual(
    LIVE_REACTIONS,
    REACTIONS.map((r) => r[0]),
  );
  const now = 1_000_000;
  assert.deepEqual(readReaction({ type: "heart", at: now }, now), {
    type: "heart",
    at: now,
  });
  // A field a later version adds is left out, not a reason to refuse.
  assert.deepEqual(readReaction({ type: "eyes", at: now, x: 3 }, now), {
    type: "eyes",
    at: now,
  });
  for (const data of [
    null,
    "heart",
    [],
    { type: "fire", at: now },
    { type: "__proto__", at: now },
    { type: "heart" },
    { type: "heart", at: now - 15001 },
    { type: "heart", at: now + 15001 },
    { type: "heart", at: 1.5 },
    { type: "heart", at: String(now) },
  ])
    assert.equal(readReaction(data, now), null, JSON.stringify(data));
  const pace = new Pace(3);
  assert.deepEqual(
    [0, 100, 200, 300].map((t) => pace.take("a", now + t)),
    [true, true, true, false],
  );
  assert.equal(pace.take("b", now + 300), true, "Each person has their own");
  assert.equal(pace.take("a", now + 999), false);
  assert.equal(pace.take("a", now + 1000), true, "A second later, again");
  // Hundreds of senders keep at most 512 counts.
  for (let n = 0; n < 600; n++) pace.take(`p${n}`, now);
  assert.ok(pace.times.size <= 512);
});

test("sessions send live reactions only over a live link, at most three a second, and never save them", async () => {
  const sent = [];
  const s = session();
  try {
    assert.equal(s.react("heart"), false, "No peer network yet");
    linked(s, sent);
    s.peers.links.get("editor").whiteboardAuthorized = false;
    assert.equal(s.react("heart"), false, "No live link");
    s.peers.links.get("editor").whiteboardAuthorized = true;
    assert.equal(s.react("fire"), false, "Not a reaction");
    assert.deepEqual(
      ["heart", "laugh", "idea", "eyes"].map((type) => s.react(type)),
      [true, true, true, false],
    );
    await new Promise((r) => setTimeout(r));
    assert.deepEqual(
      sent.map(([kind, data]) => [kind, data.type]),
      [
        ["reaction", "heart"],
        ["reaction", "laugh"],
        ["reaction", "idea"],
      ],
    );
    assert.ok(Math.abs(sent[0][1].at - s.now()) < 1000);
    assert.equal(s.shared.snapshot().items.length, 0);
    assert.equal(s.pending.size, 0, "Nothing waits to be saved");
    await s.finishView();
    assert.equal(s.react("thumbs"), false, "Not after leaving");
  } finally {
    s.close();
  }
});

test("received live reactions are validated, paced per sender, and refused past the limit so relays drop them", async () => {
  const shown = [];
  const s = session({ reaction: (p) => shown.push(p) });
  const now = () => Math.round(s.now());
  try {
    assert.equal(
      await s.receive("reaction", { type: "fire", at: now() }, editor, 1),
      undefined,
    );
    await s.receive(
      "reaction",
      { type: "heart", at: now() - 20000 },
      editor,
      2,
    );
    await s.receive("reaction", { type: "heart" }, editor, 3);
    assert.equal(shown.length, 0);
    // Viewers are an audience and react too.
    await s.receive("reaction", { type: "celebrate", at: now() }, viewer, 4);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].type, "celebrate");
    assert.equal(shown[0].username, "Bob");
    assert.equal(shown[0].session, "viewer");
    const results = [];
    for (let n = 0; n < 8; n++)
      results.push(
        await s.receive(
          "reaction",
          { type: "thumbs", at: now() },
          editor,
          10 + n,
        ),
      );
    assert.deepEqual(results.slice(0, 5), Array(5).fill(undefined));
    assert.deepEqual(
      results.slice(5),
      [false, false, false],
      "Past five a second the rest are refused",
    );
    assert.equal(shown.length, 6);
    // Someone who left sends no more.
    await s.receive("view-left", { at: now() }, viewer, 20);
    await s.receive("reaction", { type: "heart", at: now() }, viewer, 21);
    assert.equal(shown.length, 6);
    // Kinds this version does not know are ignored, as older versions
    // ignore live reactions.
    await s.receive("wave", { type: "heart", at: now() }, editor, 30);
    assert.equal(shown.length, 6);
    assert.equal(s.shared.snapshot().items.length, 0);
  } finally {
    s.close();
  }
});

function setup({ linkedTo = true, anonymous = false, still = false } = {}) {
  const dom = new JSDOM(
    `<div class="canvas-wrap"><canvas tabindex="0"></canvas><div class="canvas-top"><div class="canvas-navigation"><button data-action="live" aria-expanded="false" hidden>Live reactions</button></div></div></div>`,
    { pretendToBeVisual: true },
  );
  const saved = new Map();
  for (const [key, value] of Object.entries({
    document: dom.window.document,
  })) {
    saved.set(key, globalThis[key]);
    globalThis[key] = value;
  }
  const state = {
    shared: true,
    anonymous,
    still,
    linked: linkedTo,
    sent: [],
    allow: true,
    announced: [],
  };
  state.s = {
    session: "self",
    user: { username: "Alice" },
    linked: () => state.linked,
    react(type) {
      if (!state.linked || !state.allow) return false;
      state.sent.push(type);
      return true;
    },
  };
  const ui = createLiveUI({
    session: () => state.s,
    shared: () => state.shared,
    anonymous: () => state.anonymous,
    reducedMotion: () => state.still,
    announce: (m) => state.announced.push(m),
  });
  const doc = dom.window.document;
  ui.bind(doc.querySelector(".canvas-wrap"));
  return {
    ui,
    state,
    doc,
    w: dom.window,
    button: doc.querySelector('[data-action="live"]'),
    floating: () => [...doc.querySelectorAll(".live-reaction")],
    close() {
      ui.detach();
      dom.window.close();
      for (const [key, value] of saved) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    },
  };
}

test("the live reactions popover is keyboard reachable, named, and closes with Escape back to its control", () => {
  const a = setup();
  try {
    assert.equal(a.button.hidden, false, "Shown on a shared board");
    a.ui.toggle();
    const popover = a.doc.querySelector("#live-popover");
    assert.ok(popover);
    assert.equal(popover.getAttribute("role"), "dialog");
    assert.equal(popover.getAttribute("aria-label"), "Live reactions");
    assert.equal(a.button.getAttribute("aria-expanded"), "true");
    const choices = [...popover.querySelectorAll("[data-live-reaction]")];
    assert.deepEqual(
      choices.map((b) => b.getAttribute("aria-label")),
      REACTIONS.map((r) => r[2]),
    );
    assert.ok(choices.every((b) => b.type === "button" && !b.disabled));
    assert.equal(a.doc.activeElement, choices[0], "Focus moves into it");
    choices[1].dispatchEvent(
      new a.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    assert.equal(a.doc.querySelector("#live-popover"), null);
    assert.equal(a.button.getAttribute("aria-expanded"), "false");
    assert.equal(a.doc.activeElement, a.button);
    // A press elsewhere closes it and leaves focus where it went.
    a.ui.toggle();
    a.doc
      .querySelector("canvas")
      .dispatchEvent(new a.w.Event("pointerdown", { bubbles: true }));
    assert.equal(a.doc.querySelector("#live-popover"), null);
    // Off a shared board, or out of a session, there is no control.
    a.state.shared = false;
    a.ui.render();
    assert.equal(a.button.hidden, true);
    a.ui.toggle();
    assert.equal(a.doc.querySelector("#live-popover"), null);
  } finally {
    a.close();
  }
});

test("the live reactions popover reads in French", () => {
  const a = setup({ linkedTo: false });
  setLanguage("fr");
  try {
    a.ui.toggle();
    const popover = a.doc.querySelector("#live-popover");
    assert.equal(popover.getAttribute("aria-label"), "Réactions en direct");
    assert.equal(
      popover.querySelector('[data-live-reaction="thumbs"]').title,
      "Pouce levé",
    );
    assert.match(
      popover.querySelector(".live-offline").textContent,
      /connexion en direct/,
    );
  } finally {
    setLanguage("en");
    a.close();
  }
});

test("choosing a reaction floats it with the sender's name, without it under anonymous input, and removes it after", async () => {
  const a = setup();
  try {
    a.ui.toggle();
    a.doc.querySelector('[data-live-reaction="celebrate"]').click();
    assert.deepEqual(a.state.sent, ["celebrate"]);
    let [node] = a.floating();
    assert.equal(node.querySelector(".live-reaction-emoji").textContent, "🎉");
    assert.equal(
      node.querySelector(".live-reaction-name").textContent,
      "Alice",
    );
    assert.equal(node.classList.contains("is-still"), false);
    assert.equal(
      a.doc.querySelector(".live-reactions").getAttribute("aria-hidden"),
      "true",
    );
    assert.equal(a.state.announced.at(-1), "Reaction sent: Celebrate");
    assert.ok(a.doc.querySelector("#live-popover"), "Stays open for more");
    // The animation's end removes the node.
    node.dispatchEvent(new a.w.Event("animationend"));
    assert.equal(a.floating().length, 0);
    a.ui.receive({ session: "peer", username: "Bob <b>", type: "heart" });
    [node] = a.floating();
    assert.equal(
      node.querySelector(".live-reaction-name").textContent,
      "Bob <b>",
    );
    assert.equal(node.querySelector("b"), null);
    // This person's own reaction coming back is not shown twice.
    a.ui.receive({ session: "self", username: "Alice", type: "heart" });
    assert.equal(a.floating().length, 1);
    a.state.anonymous = true;
    a.ui.receive({ session: "peer", username: "Bob", type: "idea" });
    node = a.floating().at(-1);
    assert.equal(node.querySelector(".live-reaction-name"), null);
    a.doc.querySelector('[data-live-reaction="eyes"]').click();
    assert.equal(
      a.floating().at(-1).querySelector(".live-reaction-name"),
      null,
      "Not even the sender's own name",
    );
    // Without an animation, as when it never ran, a timer removes it.
    await new Promise((r) => setTimeout(r, 3100));
    assert.equal(a.floating().length, 0);
  } finally {
    a.close();
  }
});

test("reactions fade in place for reduced motion, cap at thirty on screen, and say when they cannot go", () => {
  const a = setup({ still: true });
  try {
    a.ui.receive({ session: "peer", username: "Bob", type: "thumbs" });
    assert.ok(a.floating()[0].classList.contains("is-still"));
    for (let n = 0; n < 50; n++)
      a.ui.receive({ session: `p${n}`, username: `P${n}`, type: "heart" });
    assert.equal(a.floating().length, MAX_FLOATING);
    // The sender's own still shows, in place of the oldest.
    a.ui.toggle();
    a.doc.querySelector('[data-live-reaction="plus"]').click();
    assert.equal(a.floating().length, MAX_FLOATING);
    assert.equal(
      a.floating().at(-1).querySelector(".live-reaction-emoji").textContent,
      "➕",
    );
    a.state.allow = false;
    a.doc.querySelector('[data-live-reaction="plus"]').click();
    assert.match(a.state.announced.at(-1), /Too many reactions/);
    a.state.linked = false;
    a.ui.render();
    assert.ok(
      [...a.doc.querySelectorAll("[data-live-reaction]")].every(
        (b) => b.disabled,
      ),
    );
    assert.equal(a.doc.querySelector(".live-offline").hidden, false);
    a.ui.detach();
    assert.equal(a.floating().length, 0, "Leaving the board clears them");
  } finally {
    a.close();
  }
});
