import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createAttentionUI } from "../src/attention-ui.js";
function setup() {
  const dom = new JSDOM(
    '<div class="canvas-wrap"><canvas tabindex="0"></canvas></div>',
    { pretendToBeVisual: true },
  );
  const saved = new Map();
  for (const [key, value] of Object.entries({
    document: dom.window.document,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  })) {
    saved.set(key, globalThis[key]);
    globalThis[key] = value;
  }
  const state = {
    view: { x: 0, y: 0, z: 1 },
    busy: false,
    canBring: true,
    moves: 0,
    sent: [],
    toasts: [],
    s: {
      session: "self",
      readOnly: false,
      view(...v) {
        state.sent.push(v);
      },
      async bring() {
        return true;
      },
    },
  };
  const ui = createAttentionUI({
    session: () => state.s,
    canBring: () => state.canBring,
    view: () => state.view,
    size: () => ({ width: 800, height: 600 }),
    busy: () => state.busy,
    prepare() {
      state.busy = false;
    },
    navigate(v) {
      state.moves++;
      state.view = v;
    },
    focusCanvas: () => dom.window.document.querySelector("canvas").focus(),
    toast: (m) => state.toasts.push(m),
    redrawCursors() {},
  });
  ui.bind(dom.window.document.querySelector(".canvas-wrap"));
  const views = new Map([
      [
        "peer",
        {
          session: "peer",
          username: "Alice <literal>",
          role: "editor",
          camera: { x: 500, y: 400, w: 800, h: 600 },
          following: null,
        },
      ],
    ]),
    roster = [
      { session: "self", username: "You", role: "owner" },
      ...views.values(),
    ];
  ui.update(views, roster);
  return {
    ui,
    state,
    views,
    roster,
    doc: dom.window.document,
    w: dom.window,
    tick: () => new Promise((r) => setTimeout(r, 25)),
    close() {
      ui.reset();
      dom.window.close();
      for (const [key, value] of saved) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    },
  };
}
test("following preserves board state, stops on manual input, catches disconnection, and avoids loops", async () => {
  const a = setup();
  try {
    assert.equal(a.ui.follow("peer"), true);
    assert.deepEqual(a.state.view, { x: -100, y: -100, z: 1 });
    assert.match(
      a.doc.querySelector(".follow-banner").textContent,
      /Alice <literal>/,
    );
    assert.equal(a.doc.querySelector("literal"), null);
    a.views.get("peer").camera.x = 600;
    a.ui.update(a.views, a.roster);
    await a.tick();
    assert.equal(a.state.view.x, -200);
    a.doc
      .querySelector("canvas")
      .dispatchEvent(new a.w.Event("pointerdown", { bubbles: true }));
    assert.equal(a.ui.following(), null);
    a.views.get("peer").camera.x = 700;
    a.ui.update(a.views, a.roster);
    await a.tick();
    assert.equal(a.state.view.x, -200);
    a.ui.follow("peer");
    a.views.clear();
    a.ui.update(a.views, a.roster);
    await a.tick();
    assert.equal(a.ui.following(), null);
    assert.match(a.state.toasts.at(-1), /unavailable/);
    a.views.set("peer", { ...a.roster[1], following: "self" });
    assert.equal(a.ui.follow("peer"), false);
  } finally {
    a.close();
  }
});
test("bring requests defer while editing and presentation sends the selected frame without persistent writes", async () => {
  const a = setup();
  try {
    a.state.busy = true;
    const draft = a.doc.createElement("textarea");
    draft.value = "Unfinished thought";
    a.doc.body.append(draft);
    draft.focus();
    a.ui.receive(a.views.get("peer"));
    a.doc.querySelector("[data-follow-stop]").click();
    assert.equal(a.doc.activeElement, draft);
    assert.equal(draft.value, "Unfinished thought");
    a.ui.receive(a.views.get("peer"));
    assert.equal(a.ui.following(), null);
    assert.equal(a.state.moves, 0);
    assert.equal(a.doc.querySelector("[data-follow-accept]").hidden, false);
    a.doc.querySelector("[data-follow-accept]").click();
    assert.equal(a.ui.following(), "peer");
    a.doc.querySelector("canvas").dispatchEvent(
      new a.w.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(a.ui.following(), null);
    const d = a.doc.createElement("dialog");
    a.doc.body.append(d);
    a.ui.present(d, { x: 10, y: 20, w: 400, h: 200 });
    assert.deepEqual(a.state.sent.at(-1)[0], {
      x: 210,
      y: 120,
      w: 400,
      h: 200,
    });
    d.dispatchEvent(new a.w.Event("close"));
    assert.notDeepEqual(a.state.sent.at(-1)[0], {
      x: 210,
      y: 120,
      w: 400,
      h: 200,
    });
  } finally {
    a.close();
  }
});
test("participant navigation bounds its rows, retains focused controls, searches names and disables viewer bring", async () => {
  const a = setup();
  try {
    a.state.s.readOnly = true;
    const d = a.doc.createElement("dialog");
    d.innerHTML = '<div id="participant-list"></div>';
    d.close = () => d.dispatchEvent(new a.w.Event("close"));
    a.doc.body.append(d);
    const roster = Array.from({ length: 512 }, (_, n) => ({
      session: `member-${n}`,
      username: `Member ${n}`,
      role: "editor",
    }));
    a.views.clear();
    for (const p of roster)
      a.views.set(p.session, {
        ...p,
        camera: { x: 0, y: 0, w: 800, h: 600 },
        following: null,
      });
    a.ui.update(a.views, roster);
    a.ui.mountDialog(d);
    assert.equal(d.querySelectorAll(".live-participant-row").length, 50);
    const first = d.querySelector("[data-follow]");
    first.focus();
    a.ui.update(a.views, roster);
    await a.tick();
    assert.equal(a.doc.activeElement, first);
    assert.equal(d.querySelector("#bring-everyone").disabled, true);
    assert.equal(d.querySelector("[data-bring]").disabled, true);
    const query = d.querySelector("#live-participant-search");
    query.value = "Member 511";
    query.dispatchEvent(new a.w.Event("input"));
    assert.equal(d.querySelectorAll(".live-participant-row").length, 1);
    assert.equal(d.querySelector("[data-follow]").dataset.follow, "member-511");
    // Clearing a search puts the rows back in the roster's order, and the
    // control that has focus keeps it.
    query.value = "Member 4";
    query.dispatchEvent(new a.w.Event("input"));
    const kept = d.querySelector('[data-follow="member-4"]');
    kept.focus();
    query.value = "";
    query.dispatchEvent(new a.w.Event("input"));
    assert.deepEqual(
      [...d.querySelectorAll(".live-participant-row")].map(
        (row) => row.dataset.session,
      ),
      roster.slice(0, 50).map((p) => p.session),
    );
    assert.equal(a.doc.activeElement, kept);
  } finally {
    a.close();
  }
});
test("typing and panel controls neither dismiss invitations nor stop following", async () => {
  const a = setup();
  try {
    const wrap = a.doc.querySelector(".canvas-wrap");
    const editor = a.doc.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const panel = a.doc.createElement("section");
    panel.className = "workshop-timer panel";
    panel.innerHTML = "<button>Pause</button>";
    wrap.append(editor, panel);
    a.state.busy = true;
    editor.focus();
    a.ui.receive(a.views.get("peer"));
    for (const key of [" ", "Home", "ArrowLeft", "-"])
      editor.dispatchEvent(
        new a.w.KeyboardEvent("keydown", { key, bubbles: true }),
      );
    assert.equal(a.doc.querySelector("[data-follow-accept]").hidden, false);
    a.doc.querySelector("[data-follow-accept]").click();
    assert.equal(a.ui.following(), "peer");
    panel
      .querySelector("button")
      .dispatchEvent(new a.w.Event("pointerdown", { bubbles: true }));
    panel.dispatchEvent(new a.w.Event("wheel", { bubbles: true }));
    assert.equal(a.ui.following(), "peer");
    a.doc
      .querySelector("canvas")
      .dispatchEvent(
        new a.w.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
    assert.equal(a.ui.following(), null, "Canvas navigation still stops");
  } finally {
    a.close();
  }
});
test("Escape in a panel reaches its own control instead of stopping a followed view", () => {
  const a = setup();
  try {
    const panel = a.doc.createElement("section");
    panel.className = "panel";
    panel.innerHTML = "<button>Panel action</button>";
    a.doc.querySelector(".canvas-wrap").append(panel);
    const button = panel.querySelector("button");
    let reached = false;
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        reached = true;
        e.preventDefault();
        e.stopPropagation();
      }
    });
    assert.equal(a.ui.follow("peer"), true);
    button.focus();
    button.dispatchEvent(
      new a.w.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(reached, true, "The panel handles its own Escape");
    assert.equal(a.ui.following(), "peer");
    a.doc.querySelector("canvas").dispatchEvent(
      new a.w.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(a.ui.following(), null, "Canvas Escape still stops following");
  } finally {
    a.close();
  }
});

test("camera updates leave the participant list DOM unchanged while names and navigation states still update", async () => {
  const a = setup();
  let observer;
  try {
    const d = a.doc.createElement("dialog");
    d.innerHTML = '<div id="participant-list"></div>';
    a.doc.body.append(d);
    const roster = Array.from({ length: 512 }, (_, n) => ({
      session: `person-${n}`,
      username: `Person ${n}`,
      role: "editor",
    }));
    a.views.clear();
    for (const p of roster)
      a.views.set(p.session, {
        ...p,
        camera: { x: 0, y: 0, w: 800, h: 600 },
        following: null,
      });
    a.ui.update(a.views, roster);
    a.ui.mountDialog(d);
    await a.tick();
    const section = d.querySelector(".live-participants"),
      follow = d.querySelector("[data-follow]"),
      row = follow.parentElement,
      mutations = [];
    const list = d.querySelector("#live-participant-list"),
      children = Object.getOwnPropertyDescriptor(
        a.w.Element.prototype,
        "children",
      ).get;
    let rowScans = 0;
    Object.defineProperty(list, "children", {
      get() {
        rowScans++;
        return children.call(this);
      },
    });
    assert.equal(section.querySelectorAll(".live-participant-row").length, 50);
    follow.focus();
    observer = new a.w.MutationObserver((batch) => mutations.push(...batch));
    observer.observe(section, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    for (let n = 0; n < 5; n++) {
      a.views.get(roster[0].session).camera.x++;
      a.ui.update(a.views, roster);
      await a.tick();
    }
    assert.equal(
      mutations.length,
      0,
      "Camera movement does not rewrite unchanged participant controls",
    );
    assert.equal(a.doc.activeElement, follow);
    assert.equal(follow.parentElement, row);
    assert.ok(
      rowScans < 50,
      "Five camera updates do not rescan the row collection for every participant",
    );
    observer.disconnect();
    roster[0].username = "New <literal> name";
    a.views.get(roster[0].session).following = "self";
    a.state.canBring = false;
    a.ui.update(a.views, roster);
    await a.tick();
    assert.equal(row.children[0].textContent, "New <literal> name");
    assert.equal(row.children[1].textContent, "Following you");
    assert.equal(row.querySelector("literal"), null);
    assert.match(follow.getAttribute("aria-label"), /New <literal> name/);
    assert.equal(
      follow.disabled,
      true,
      "A new follow cycle disables its action",
    );
    assert.equal(row.querySelector("[data-bring]").disabled, true);
    assert.equal(d.querySelector("#bring-everyone").disabled, true);
    assert.equal(
      a.doc.activeElement,
      d.querySelector("#live-participant-search"),
    );
  } finally {
    observer?.disconnect();
    a.close();
  }
});

test("participant pagination keeps focus usable when remote roster changes remove pages", async () => {
  const a = setup();
  try {
    const d = a.doc.createElement("dialog");
    d.innerHTML = '<div id="participant-list"></div>';
    a.doc.body.append(d);
    let roster = Array.from({ length: 101 }, (_, n) => ({
      session: `person-${n}`,
      username: `Person ${n}`,
      role: "editor",
    }));
    a.ui.update(a.views, roster);
    a.ui.mountDialog(d);
    await a.tick();
    const previous = d.querySelector("#live-participant-prev"),
      next = d.querySelector("#live-participant-next"),
      search = d.querySelector("#live-participant-search");
    next.focus();
    next.click();
    next.focus();
    roster = roster.slice(0, 51);
    a.ui.update(a.views, roster);
    await a.tick();
    assert.equal(next.disabled, true);
    assert.equal(
      a.doc.activeElement,
      previous,
      "The remaining page control keeps focus",
    );
    roster = roster.slice(0, 50);
    a.ui.update(a.views, roster);
    await a.tick();
    assert.equal(d.querySelector("#live-participant-pages").hidden, true);
    assert.equal(
      a.doc.activeElement,
      search,
      "Focus leaves hidden pagination controls",
    );
    roster.push({ session: "extra", username: "Extra", role: "editor" });
    a.ui.update(a.views, roster);
    await a.tick();
    next.focus();
    next.click();
    assert.equal(a.doc.activeElement, previous);
    previous.click();
    assert.equal(
      a.doc.activeElement,
      next,
      "Manual paging still moves focus to the usable button",
    );
  } finally {
    a.close();
  }
});

test("follower and participant counts use each language's singular", async () => {
  const { setLanguage } = await import("../src/i18n.js");
  const a = setup();
  try {
    setLanguage("fr");
    const banner = () =>
      a.doc.querySelector(".follow-banner [data-follow-label]").textContent;
    a.views.get("peer").following = "self";
    a.ui.update(a.views, a.roster);
    await a.tick();
    assert.equal(banner(), "1 vous suit");
    const other = { session: "other", username: "Bea", role: "editor" };
    a.views.set("other", {
      ...other,
      camera: { x: 0, y: 0, w: 800, h: 600 },
      following: "self",
    });
    a.ui.update(a.views, [...a.roster, other]);
    // A changed count is shown once it settles.
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(banner(), "2 vous suivent");
    const d = a.doc.createElement("dialog");
    d.innerHTML = '<div id="participant-list"></div>';
    a.doc.body.append(d);
    a.ui.update(new Map(), [a.roster[0]]);
    a.ui.mountDialog(d);
    assert.equal(
      d.querySelector("#live-participant-count").textContent,
      "0 participant",
    );
    setLanguage("en");
    a.ui.update(a.views, [...a.roster, other]);
    await a.tick();
    assert.equal(
      d.querySelector("#live-participant-count").textContent,
      "2 participants",
    );
    assert.equal(banner(), "2 following you");
  } finally {
    setLanguage("en");
    a.close();
  }
});

test("participants of a locked workshop board cannot bring others to their view", async () => {
  const a = setup();
  try {
    let asked = 0;
    a.state.s.bring = async () => (asked++, true);
    const d = a.doc.createElement("dialog");
    d.innerHTML = '<div id="participant-list"></div>';
    a.doc.body.append(d);
    a.ui.mountDialog(d);
    const everyone = () => d.querySelector("#bring-everyone"),
      one = () => d.querySelector("[data-bring]");
    assert.equal(everyone().disabled, false);
    assert.equal(one().disabled, false);
    a.state.canBring = false;
    a.ui.update(a.views, a.roster);
    await a.tick();
    assert.equal(everyone().disabled, true);
    assert.equal(one().disabled, true);
    everyone().disabled = false;
    everyone().click();
    await a.tick();
    assert.equal(asked, 0, "No request is sent");
  } finally {
    a.close();
  }
});
test("Escape while typing reaches the editor, and dismissing an invitation keeps following", () => {
  const a = setup();
  try {
    a.views.set("host", {
      session: "host",
      username: "Facilitator",
      role: "facilitator",
      camera: { x: 0, y: 0, w: 800, h: 600 },
      following: null,
    });
    const roster = [...a.roster, a.views.get("host")];
    a.ui.update(a.views, roster);
    assert.equal(a.ui.follow("peer"), true);
    a.state.busy = true;
    const draft = a.doc.createElement("textarea");
    a.doc.querySelector(".canvas-wrap").append(draft);
    draft.focus();
    a.ui.receive(a.views.get("host"));
    assert.match(a.doc.querySelector(".follow-banner").textContent, /Invited/);
    let reached = false;
    draft.addEventListener("keydown", () => (reached = true));
    const escape = new a.w.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    draft.dispatchEvent(escape);
    assert.equal(reached, true, "the text editor receives Escape");
    assert.equal(escape.defaultPrevented, false);
    assert.equal(a.doc.querySelector("[data-follow-accept]").hidden, false);
    assert.equal(a.ui.following(), "peer");
    a.doc.querySelector("[data-follow-stop]").click();
    assert.equal(a.doc.querySelector("[data-follow-accept]").hidden, true);
    assert.equal(a.ui.following(), "peer", "the earlier follow continues");
    assert.equal(a.doc.activeElement, draft);
    a.doc.querySelector("[data-follow-stop]").click();
    assert.equal(a.ui.following(), null);
  } finally {
    a.close();
  }
});
test("pressing buttons over the board keeps following; pressing the board stops it", () => {
  const a = setup();
  try {
    const wrap = a.doc.querySelector(".canvas-wrap");
    wrap.insertAdjacentHTML(
      "beforeend",
      '<div class="canvas-top"><button data-action="participants">Participants</button></div><button class="fac-vote-add">Vote</button>',
    );
    assert.equal(a.ui.follow("peer"), true);
    for (const selector of ['[data-action="participants"]', ".fac-vote-add"]) {
      a.doc
        .querySelector(selector)
        .dispatchEvent(new a.w.Event("pointerdown", { bubbles: true }));
      assert.equal(a.ui.following(), "peer", selector);
    }
    a.doc
      .querySelector("canvas")
      .dispatchEvent(new a.w.Event("pointerdown", { bubbles: true }));
    assert.equal(a.ui.following(), null);
  } finally {
    a.close();
  }
});
test("focus stays in the live participant list when the focused participant leaves", async () => {
  const a = setup();
  try {
    const d = a.doc.createElement("dialog");
    d.innerHTML = '<div id="participant-list"></div>';
    d.close = () => d.dispatchEvent(new a.w.Event("close"));
    a.doc.body.append(d);
    const roster = ["a", "b", "c"].map((session) => ({
      session,
      username: `Member ${session}`,
      role: "editor",
    }));
    a.views.clear();
    for (const p of roster)
      a.views.set(p.session, {
        ...p,
        camera: { x: 0, y: 0, w: 800, h: 600 },
        following: null,
      });
    a.ui.update(a.views, [{ session: "self", username: "You" }, ...roster]);
    a.ui.mountDialog(d);
    await a.tick();
    d.querySelector('[data-follow="b"]').focus();
    a.views.delete("b");
    a.ui.update(a.views, [
      { session: "self", username: "You" },
      ...roster.filter((p) => p.session !== "b"),
    ]);
    await a.tick();
    assert.equal(
      a.doc.activeElement,
      d.querySelector('[data-follow="c"]'),
      "the same control of the next participant",
    );
  } finally {
    a.close();
  }
});
test("a followed view going offline restores focus from its disappearing banner", async () => {
  const a = setup();
  try {
    a.ui.follow("peer");
    a.doc.querySelector("[data-follow-stop]").focus();
    a.views.clear();
    a.ui.update(a.views, a.roster);
    await a.tick();
    assert.equal(a.ui.following(), null);
    assert.equal(a.doc.querySelector(".follow-banner").hidden, true);
    assert.equal(a.doc.activeElement, a.doc.querySelector("canvas"));
    const editor = a.doc.createElement("textarea");
    a.doc.querySelector(".canvas-wrap").append(editor);
    editor.focus();
    a.ui.update(a.views, a.roster);
    await a.tick();
    assert.equal(
      a.doc.activeElement,
      editor,
      "An unrelated editor keeps focus",
    );
    const peer = a.roster[1],
      host = { ...peer, session: "host", username: "Host", following: "self" };
    a.views.set("peer", peer);
    a.views.set("host", host);
    a.ui.update(a.views, [...a.roster, host]);
    a.ui.follow("peer");
    a.state.busy = true;
    a.ui.receive(host);
    a.doc.querySelector("[data-follow-accept]").focus();
    a.views.delete("host");
    a.ui.update(a.views, a.roster);
    await a.tick();
    assert.equal(
      a.doc.activeElement,
      a.doc.querySelector("[data-follow-stop]"),
    );
    assert.equal(a.ui.following(), "peer");
    a.views.set("host", host);
    a.doc.querySelector("[data-follow-stop]").focus();
    a.views.delete("peer");
    a.ui.update(a.views, [...a.roster, host]);
    await a.tick();
    assert.equal(
      a.doc.querySelector(".follow-banner").hidden,
      false,
      "The follower count remains visible",
    );
    assert.equal(a.doc.activeElement, a.doc.querySelector("canvas"));
  } finally {
    a.close();
  }
});

test("live-navigation controls losing availability restore focus inside the participant dialog", async () => {
  const a = setup();
  try {
    const d = a.doc.createElement("dialog");
    d.innerHTML = '<div id="participant-list"></div>';
    a.doc.body.append(d);
    a.ui.mountDialog(d);
    const search = d.querySelector("#live-participant-search");
    d.querySelector('[data-follow="peer"]').focus();
    a.views.clear();
    a.ui.update(a.views, a.roster);
    await a.tick();
    assert.equal(d.querySelector('[data-follow="peer"]').disabled, true);
    assert.equal(a.doc.activeElement, search);
    a.views.set("peer", a.roster[1]);
    a.ui.update(a.views, a.roster);
    await a.tick();
    d.querySelector('[data-bring="peer"]').focus();
    a.state.canBring = false;
    a.ui.update(a.views, a.roster);
    await a.tick();
    assert.equal(a.doc.activeElement, search);
    a.state.canBring = true;
    a.ui.update(a.views, a.roster);
    await a.tick();
    d.querySelector("#bring-everyone").focus();
    a.state.s.readOnly = true;
    a.ui.update(a.views, a.roster);
    await a.tick();
    assert.equal(a.doc.activeElement, search);
    search.focus();
    a.ui.update(a.views, a.roster);
    await a.tick();
    assert.equal(a.doc.activeElement, search);
  } finally {
    a.close();
  }
});

test("how many follow is announced once it settles, not once for each new follower", async () => {
  const a = setup();
  try {
    const label = () => a.doc.querySelector("[data-follow-label]").textContent;
    const followers = (n) => {
      for (let k = 0; k < n; k++)
        a.views.set(`f${k}`, {
          session: `f${k}`,
          username: `F${k}`,
          role: "editor",
          camera: { x: 0, y: 0, w: 800, h: 600 },
          following: "self",
        });
      a.ui.update(a.views, [...a.roster, ...[...a.views.values()]]);
    };
    followers(1);
    await a.tick();
    assert.equal(label(), "1 following you");
    for (let n = 2; n <= 6; n++) {
      followers(n);
      await a.tick();
    }
    assert.equal(label(), "1 following you", "not yet read out again");
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(label(), "6 following you");
  } finally {
    a.close();
  }
});
