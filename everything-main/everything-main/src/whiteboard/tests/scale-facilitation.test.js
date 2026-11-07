import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import axe from "axe-core";
import { createFacilitationUI } from "../src/facilitation/ui.js";
import { scaleData } from "../scripts/generate-scale-data.mjs";
import { setLanguage } from "../src/i18n.js";
const sample = scaleData();

test("the 500-person facilitation roster bounds rows and action controls", () => {
  const a = setup();
  try {
    assert.equal(document.querySelectorAll(".fac-people li").length, 50);
    assert.ok(document.querySelectorAll(".fac-people button").length <= 100);
    assert.ok(document.querySelector("#fac-people-search"));
  } finally {
    a.close();
  }
});

test("the summary pages 500 participants and keeps an unchanged page in place through remote changes", () => {
  const a = setup();
  try {
    const comment = (id, user, name) => ({
      id,
      x: 0,
      y: 0,
      resolved: false,
      messages: [1, 2].map((n) => ({
        id: `${id}-${n}`,
        authorId: user,
        authorName: name,
        text: "hi",
        createdAt: sample.now - 1000,
      })),
    });
    a.state.board = {
      ...a.state.board,
      comments: sample.users.map((u, n) =>
        comment(`c${n}`, u.uuid, u.username),
      ),
    };
    a.ui.open("summary");
    const rows = () =>
      document.querySelectorAll("#fac-summary-table tbody tr").length;
    const range = () =>
      document.querySelector("#fac-summary-range").textContent;
    assert.equal(rows(), 50);
    assert.equal(range(), "Showing participants 1–50 of 500.");
    const table = document.querySelector("#fac-summary-table");
    table.focus();
    // Someone new comments once: they are listed last, off this page, so
    // the rows shown stay where they are while the totals follow.
    const late = comment("late", "late-user", "Late arrival");
    late.messages.pop();
    a.state.board = {
      ...a.state.board,
      comments: [...a.state.board.comments, late],
    };
    a.ui.render();
    assert.equal(document.querySelector("#fac-summary-table"), table);
    assert.equal(document.activeElement, table);
    assert.equal(range(), "Showing participants 1–50 of 501.");
    const next = document.querySelector('[data-fac="summary-next"]');
    next.focus();
    next.click();
    assert.equal(rows(), 50);
    assert.equal(range(), "Showing participants 51–100 of 501.");
    assert.equal(
      document.activeElement,
      document.querySelector('[data-fac="summary-next"]'),
    );
    for (let n = 0; n < 9; n++)
      document.querySelector('[data-fac="summary-next"]').click();
    assert.equal(rows(), 1);
    assert.equal(
      document.querySelector('[data-fac="summary-next"]').disabled,
      true,
    );
    assert.equal(
      document.activeElement,
      document.querySelector('[data-fac="summary-prev"]'),
    );
  } finally {
    a.close();
  }
});

function setup({ size = 500, role = "owner" } = {}) {
  const dom = new JSDOM(
    '<div class="canvas-wrap"><canvas></canvas><div class="canvas-navigation"><button data-action="facilitation"></button></div></div>',
    { runScripts: "outside-only", pretendToBeVisual: true },
  );
  globalThis.document = dom.window.document;
  setLanguage("en");
  const board = {
    ...sample.workshop,
    items: [],
    shared: { room: "sample-room" },
    workshop: {},
  };
  const state = {
    board,
    role,
    canParticipate: true,
    roster: (size === 500 ? sample : scaleData(size)).users.map((u, n) => ({
      user: u.uuid,
      username: u.username,
      role: "editor",
      session: `session-${n}`,
      guest: false,
    })),
    follow: [],
    requests: [],
    heartbeat: 0,
    toasts: [],
    bring: 0,
  };
  const changes = [];
  state.session = {
    session: "owner",
    async request(op, data) {
      state.requests.push({ op, data });
      await state.requestHook?.(op, data);
      changes.push(data);
    },
    async heartbeat() {
      state.heartbeat++;
      for (const { uuid, role } of changes.splice(0))
        state.roster =
          role === "removed"
            ? state.roster.filter((p) => p.user !== uuid)
            : state.roster.map((p) => (p.user === uuid ? { ...p, role } : p));
    },
  };
  const ui = createFacilitationUI({
    board: () => state.board,
    identity: () => ({ id: sample.owner.uuid, name: sample.owner.username }),
    role: () => state.role,
    canParticipate: () => state.canParticipate,
    canEdit: () => true,
    now: () => sample.now,
    view: () => ({ x: 0, y: 0, z: 1 }),
    canvas: () => document.querySelector("canvas"),
    hidden: () => new Map(),
    selection: () => new Set(),
    select() {},
    commit() {},
    setTimer() {},
    focusFrame() {},
    bring: () => state.bring++,
    follow: (id) => state.follow.push(id),
    session: () => state.session,
    roster: () => state.roster,
    icon: () => "",
    toast: (text) => state.toasts.push(text),
    download() {},
    draw() {},
  });
  ui.bind(document.querySelector(".canvas-wrap"));
  ui.open("people");
  return {
    state,
    ui,
    dom,
    close() {
      ui.detach();
      setLanguage("en");
      dom.window.close();
      delete globalThis.document;
    },
  };
}
test("a reconnecting participant keeps a working follow action with 500 people", () => {
  const a = setup();
  try {
    const first = a.state.roster[0];
    a.state.roster = a.state.roster.map((p) =>
      p === first ? { ...p, session: "reconnected-session" } : p,
    );
    a.ui.render();
    const button = [...document.querySelectorAll('[data-fac="follow"]')].find(
      (b) =>
        b.closest("li").querySelector("[data-fac-role]")?.dataset.facRole ===
        first.user,
    );
    button.click();
    assert.deepEqual(a.state.follow, ["reconnected-session"]);
  } finally {
    a.close();
  }
});
test("guest status updates a live participant badge without changing their name or role", () => {
  const a = setup();
  try {
    const first = a.state.roster[0];
    a.state.roster = a.state.roster.map((p) =>
      p === first ? { ...p, guest: true } : p,
    );
    a.ui.render();
    const row = [...document.querySelectorAll(".fac-people li")].find(
      (row) =>
        row.querySelector("[data-fac-role]")?.dataset.facRole === first.user,
    );
    assert.ok(
      [...row.querySelectorAll(".badge")].some(
        (b) => b.textContent === "Guest",
      ),
    );
  } finally {
    a.close();
  }
});

test("participant movement retains controls and keyboard focus in a 500-person roster", () => {
  const a = setup();
  try {
    const row = document.querySelector(".fac-people li");
    const control = row.querySelector("select");
    control.focus();
    for (let n = 0; n < 20; n++) {
      a.state.roster = a.state.roster.map((p) => ({
        ...p,
        cursor: { x: n, y: n },
        camera: { x: n, y: n, z: 1 },
      }));
      a.ui.render();
      assert.equal(document.querySelector(".fac-people li"), row);
      assert.equal(document.activeElement, control);
    }
  } finally {
    a.close();
  }
});

const rows = () => [...document.querySelectorAll(".fac-people li")];
const rowFor = (id) => rows().find((row) => row.dataset.facPerson === id);
// Removing takes Remove, then Confirm remove in the redrawn row.
const remove = (id) => {
  rowFor(id).querySelector('[data-fac="remove"]').click();
  rowFor(id).querySelector('[data-fac="remove"]').click();
};
const searchFor = (a, text) => {
  const search = document.querySelector("#fac-people-search");
  search.value = text;
  search.dispatchEvent(new a.dom.window.Event("input", { bubbles: true }));
  return search;
};
const settle = () => new Promise((done) => setTimeout(done, 0));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

for (const size of [500, 1000])
  test(`${size} people remain reachable through pages with duplicate sessions and the owner`, () => {
    const a = setup({ size });
    try {
      const all = new Set(a.state.roster.map((p) => p.user));
      const first = a.state.roster[0];
      a.state.roster.push(
        { ...first, session: "another-device" },
        {
          user: sample.owner.uuid,
          username: sample.owner.username,
          role: "owner",
          session: "owner",
        },
      );
      all.add(sample.owner.uuid);
      a.ui.render();
      assert.match(
        document.querySelector("#fac-people-heading").textContent,
        new RegExp(String(size + 1)),
      );
      const seen = new Set(),
        next = document.querySelector("#fac-people-next");
      for (let page = 0; page <= Math.floor(size / 50); page++) {
        assert.ok(rows().length <= 50);
        for (const row of rows()) {
          assert.ok(!seen.has(row.dataset.facPerson));
          seen.add(row.dataset.facPerson);
        }
        if (page < Math.floor(size / 50)) next.click();
      }
      assert.deepEqual(seen, all);
      assert.ok(next.disabled);
      assert.match(
        document.querySelector("#fac-people-count").textContent,
        new RegExp(`${size + 1}–${size + 1} of ${size + 1}`),
      );
      assert.equal(a.state.requests.length, 0);
      const search = searchFor(a, first.username);
      assert.equal(rows().length, 1);
      rowFor(first.user).querySelector('[data-fac="follow"]').click();
      assert.deepEqual(a.state.follow, [first.session]);
      assert.equal(document.querySelector("#fac-people-search"), search);
    } finally {
      a.close();
    }
  });

test("participant search retains typing focus, language, escaped names and live metadata", () => {
  const a = setup();
  try {
    const last = a.state.roster.at(-1);
    a.state.roster = a.state.roster.map((p) =>
      p === last
        ? {
            ...p,
            username: "Zoë <img src=x onerror=bad()> 最後",
            guest: true,
            role: "viewer",
          }
        : p,
    );
    a.ui.render();
    const search = document.querySelector("#fac-people-search");
    search.focus();
    searchFor(a, "最");
    assert.equal(document.activeElement, search);
    assert.equal(rows().length, 1);
    assert.equal(
      rowFor(last.user).querySelector("[data-user-content]").textContent,
      "Zoë <img src=x onerror=bad()> 最後",
    );
    assert.equal(document.querySelectorAll(".fac-people img").length, 0);
    setLanguage("fr");
    a.ui.render();
    assert.equal(document.querySelector("#fac-people-search"), search);
    assert.equal(search.value, "最");
    assert.equal(document.activeElement, search);
    assert.equal(
      document.querySelector("#fac-people-label").textContent,
      "Trouver un participant",
    );
    assert.equal(
      document.querySelector("#fac-people-count").textContent,
      "Participants 1–1 sur 1.",
    );
    searchFor(a, "Invité");
    assert.equal(rows().length, 1);
    searchFor(a, "viewer");
    assert.equal(rows().length, 1);
    searchFor(a, "no such participant");
    assert.equal(rows().length, 0);
    assert.equal(
      document.querySelector("#fac-people-count").textContent,
      "0 participant",
    );
    assert.equal(
      document.querySelector("#fac-people-empty").textContent,
      "Aucun participant ne correspond à votre recherche.",
    );
    assert.ok(document.querySelector("#fac-people-pages").hidden);
    assert.equal(document.activeElement, search);
    a.state.roster = [];
    searchFor(a, "");
    assert.equal(
      document.querySelector("#fac-people-empty").textContent,
      "Aucun participant sur ce tableau.",
    );
  } finally {
    a.close();
  }
});

test("paging and live departures preserve usable keyboard focus and clamp the current page", () => {
  const a = setup();
  try {
    const previous = document.querySelector("#fac-people-prev"),
      next = document.querySelector("#fac-people-next");
    next.focus();
    for (let n = 0; n < 9; n++) next.click();
    assert.equal(document.activeElement, previous);
    assert.equal(
      document.querySelector("#fac-people-count").textContent,
      "Showing participants 451–500 of 500.",
    );
    const target = rows()[0].querySelector('[data-fac="follow"]');
    target.focus();
    const departed = rows()[0].dataset.facPerson;
    a.state.roster = a.state.roster.filter((p) => p.user !== departed);
    a.ui.render();
    assert.equal(
      document.activeElement,
      rows()[0].querySelector('[data-fac="follow"]'),
    );
    previous.focus();
    a.state.roster = a.state.roster.slice(0, 20);
    a.ui.render();
    assert.equal(rows().length, 20);
    assert.equal(
      document.activeElement,
      document.querySelector("#fac-people-search"),
    );
    assert.ok(document.querySelector("#fac-people-pages").hidden);
    assert.equal(
      document.querySelector("#fac-people-count").textContent,
      "Showing participants 1–20 of 20.",
    );
  } finally {
    a.close();
  }
});

test("unchanged participant rows and search survive another participant reconnecting and reordering", () => {
  const a = setup();
  try {
    const row = rows()[10],
      control = row.querySelector("select");
    control.focus();
    const first = a.state.roster[0];
    a.state.roster = a.state.roster.map((p) =>
      p === first
        ? { ...p, username: "A new name", session: "new-session" }
        : p,
    );
    a.ui.render();
    assert.equal(rowFor(row.dataset.facPerson), row);
    assert.equal(document.activeElement, control);
    const search = document.querySelector("#fac-people-search");
    search.focus();
    searchFor(a, "Alex");
    a.state.roster = a.state.roster.map((p) =>
      p.user === first.user
        ? { ...p, username: "Alex rejoined", guest: true }
        : p,
    );
    a.ui.render();
    assert.equal(document.activeElement, search);
    assert.equal(search.value, "Alex");
  } finally {
    a.close();
  }
});

for (const role of ["owner", "facilitator", "editor", "commenter", "viewer"])
  test(`${role} keeps existing participant permissions across search and pages`, () => {
    const a = setup({ role });
    try {
      const first = a.state.roster[0];
      a.state.roster.push(
        {
          user: sample.owner.uuid,
          username: sample.owner.username,
          role,
          session: "self",
        },
        {
          user: "board-owner",
          username: "Board Owner",
          role: "owner",
          session: "board-owner",
        },
        {
          user: "peer-facilitator",
          username: "Peer Facilitator",
          role: "facilitator",
          session: "peer-facilitator",
        },
      );
      a.ui.render();
      searchFor(a, sample.owner.username);
      assert.equal(
        rowFor(sample.owner.uuid).querySelectorAll("select,button").length,
        0,
      );
      searchFor(a, "Board Owner");
      assert.equal(
        rowFor("board-owner").querySelectorAll('select,[data-fac="remove"]')
          .length,
        0,
      );
      searchFor(a, "Peer Facilitator");
      assert.equal(
        !!rowFor("peer-facilitator").querySelector("select"),
        role === "owner",
      );
      searchFor(a, first.username);
      const select = rowFor(first.user).querySelector("select");
      const managing = role === "owner" || role === "facilitator";
      assert.equal(!!select, managing);
      assert.equal(
        rowFor(first.user).querySelectorAll('[data-fac="follow"]').length,
        managing ? 1 : 0,
      );
      const bring = document.querySelector('[data-fac="bring"]');
      assert.equal(bring.parentElement.hidden, !managing);
      if (managing) {
        assert.equal(
          [...select.options].some((o) => o.value === "facilitator"),
          role === "owner",
        );
        bring.click();
        assert.equal(a.state.bring, 1);
        a.state.canParticipate = false;
        a.ui.render();
        assert.equal(rows()[0].querySelectorAll("select,button").length, 0);
        assert.ok(
          document.querySelector('[data-fac="bring"]').parentElement.hidden,
        );
      }
    } finally {
      a.close();
    }
  });

for (const failing of [false, true])
  test(`pending role ${failing ? "failure" : "success"} remains bounded, visible and disabled across navigation`, async () => {
    const a = setup(),
      wait = deferred();
    try {
      a.state.requestHook = () => wait.promise;
      const first = a.state.roster[0],
        select = rowFor(first.user).querySelector("select");
      select.focus();
      select.value = "viewer";
      select.dispatchEvent(new a.dom.window.Event("change", { bubbles: true }));
      assert.equal(a.state.requests.length, 1);
      document.querySelector("#fac-people-next").click();
      document.querySelector("#fac-people-prev").click();
      const revisited = rowFor(first.user).querySelector("select");
      assert.equal(revisited.value, "viewer");
      assert.ok(revisited.disabled);
      assert.ok(
        rowFor(first.user).querySelector('[data-fac="remove"]').disabled,
      );
      revisited.dispatchEvent(
        new a.dom.window.Event("change", { bubbles: true }),
      );
      assert.equal(a.state.requests.length, 1);
      const search = document.querySelector("#fac-people-search");
      search.focus();
      searchFor(a, a.state.roster.at(-1).username);
      if (failing) wait.reject(Error("role request failed"));
      else wait.resolve();
      await settle();
      assert.equal(document.activeElement, search);
      assert.equal(rows().length, 1);
      assert.equal(a.state.heartbeat, failing ? 0 : 1);
      assert.deepEqual(a.state.toasts, failing ? ["role request failed"] : []);
      searchFor(a, first.username);
      assert.equal(
        rowFor(first.user).querySelector("select").value,
        failing ? "editor" : "viewer",
      );
      assert.ok(!rowFor(first.user).querySelector("select").disabled);
    } finally {
      wait.resolve();
      a.close();
    }
  });

test("removing the sole participant on the final page clamps the page and preserves paging focus", async () => {
  const a = setup();
  try {
    a.state.roster.push({
      user: "last",
      username: "𐐀 Last participant",
      role: "editor",
      session: "last",
    });
    a.ui.render();
    const next = document.querySelector("#fac-people-next");
    next.focus();
    for (let n = 0; n < 10; n++) next.click();
    assert.equal(rows().length, 1);
    const id = rows()[0].dataset.facPerson;
    remove(id);
    const previous = document.querySelector("#fac-people-prev");
    previous.focus();
    await settle();
    assert.equal(rows().length, 50);
    assert.ok(!a.state.roster.some((p) => p.user === id));
    assert.equal(
      document.querySelector("#fac-people-count").textContent,
      "Showing participants 451–500 of 500.",
    );
    assert.equal(document.activeElement, previous);
  } finally {
    a.close();
  }
});

for (const change of ["board", "session", "detach"])
  test(`a pending role reply cannot change the view after a ${change} change`, async () => {
    const a = setup(),
      wait = deferred();
    try {
      a.state.requestHook = () => wait.promise;
      const first = a.state.roster[0];
      searchFor(a, first.username);
      const select = rowFor(first.user).querySelector("select");
      select.value = "viewer";
      select.dispatchEvent(new a.dom.window.Event("change", { bubbles: true }));
      if (change === "board") {
        a.state.board = { ...a.state.board, id: "different-board" };
        a.ui.render();
        a.ui.open("people");
        assert.equal(document.querySelector("#fac-people-search").value, "");
      } else if (change === "session") {
        a.state.session = { session: "new-owner-session" };
        a.ui.render();
        assert.equal(
          document.querySelector("#fac-people-search").value,
          first.username,
        );
      } else {
        a.ui.detach();
        a.ui.bind(document.querySelector(".canvas-wrap"));
        a.ui.open("people");
      }
      const search = document.querySelector("#fac-people-search");
      search.focus();
      wait.resolve();
      await settle();
      assert.equal(a.state.heartbeat, 0);
      assert.equal(document.activeElement, search);
      assert.equal(rowFor(first.user).querySelector("select").value, "editor");
      assert.ok(!rowFor(first.user).querySelector("select").disabled);
      assert.equal(
        document.querySelector("#facilitation-live").textContent,
        "",
      );
    } finally {
      wait.resolve();
      a.close();
    }
  });

test("closing and reopening the panel retains paging while sharing/session availability updates immediately", () => {
  const a = setup();
  try {
    document.querySelector("#fac-people-next").click();
    const ids = rows().map((r) => r.dataset.facPerson);
    a.ui.close();
    a.ui.open("people");
    assert.deepEqual(
      rows().map((r) => r.dataset.facPerson),
      ids,
    );
    a.state.session = null;
    a.ui.render();
    assert.equal(rows().length, 0);
    assert.match(
      document.querySelector("#fac-tabpanel").textContent,
      /Share this board/,
    );
    a.state.session = { session: "restored" };
    a.ui.render();
    assert.equal(rows().length, 50);
    a.state.board = { ...a.state.board, shared: null };
    a.ui.render();
    assert.equal(rows().length, 0);
    a.state.board = { ...a.state.board, shared: { room: "sample-room" } };
    a.ui.render();
    assert.equal(rows().length, 50);
  } finally {
    a.close();
  }
});

test("a completing role edit preserves another participant control and rejected removal can be retried", async () => {
  const a = setup(),
    wait = deferred();
  try {
    a.state.requestHook = () => wait.promise;
    const first = rows()[0],
      id = first.dataset.facPerson;
    remove(id);
    assert.ok(rowFor(id).querySelector("select").disabled);
    const other = rows()[1].querySelector("select");
    other.focus();
    wait.reject(Error("removal failed"));
    await settle();
    assert.equal(document.activeElement, other);
    assert.ok(!rowFor(id).querySelector('[data-fac="remove"]').disabled);
    assert.equal(rowFor(id).querySelector("select").value, "editor");
    a.state.requestHook = undefined;
    remove(id);
    await settle();
    assert.ok(!a.state.roster.some((p) => p.user === id));
    assert.equal(document.activeElement, other);
    assert.equal(a.state.requests.length, 2);
  } finally {
    wait.resolve();
    a.close();
  }
});

test("removing a participant from People takes a confirming second click", async () => {
  const a = setup();
  try {
    const id = rows()[0].dataset.facPerson;
    const button = () => rowFor(id).querySelector('[data-fac="remove"]');
    button().focus();
    button().click();
    assert.equal(a.state.requests.length, 0, "Nothing is sent yet");
    assert.equal(button().textContent, "Confirm remove");
    assert.match(button().getAttribute("aria-label"), /^Confirm remove /);
    assert.ok(button().classList.contains("danger"));
    assert.equal(document.activeElement, button(), "Focus stays on it");
    // Moving on puts Remove back.
    const other = rows()[1].querySelector("select");
    other.focus();
    await settle();
    assert.equal(button().textContent, "Remove");
    assert.equal(document.activeElement, other);
    remove(id);
    await settle();
    assert.equal(a.state.requests.length, 1);
    assert.ok(!a.state.roster.some((p) => p.user === id));
  } finally {
    a.close();
  }
});

test("participant navigation and actions have accessible names in both interface languages", async () => {
  const a = setup();
  try {
    a.dom.window.eval(axe.source);
    for (const lang of ["en", "fr"]) {
      setLanguage(lang);
      a.ui.render();
      const result = await a.dom.window.axe.run(
        document.querySelector("#fac-people-view"),
        {
          rules: { "color-contrast": { enabled: false } },
        },
      );
      assert.equal(
        result.violations.length,
        0,
        JSON.stringify(
          result.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.html),
          })),
        ),
      );
    }
    const search = document.querySelector("#fac-people-search");
    search.focus();
    a.state.session = null;
    a.ui.render();
    assert.equal(
      document.activeElement,
      document.querySelector("#fac-tabpanel"),
    );
  } finally {
    a.close();
  }
});
