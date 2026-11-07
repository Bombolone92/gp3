import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCommentsUI } from "../src/comments-ui.js";
import { board, item } from "../src/model.js";
import { commentThread } from "../src/comments.js";

function setup({ now } = {}) {
  const dom = new JSDOM(
    '<button data-action="comments"></button><div><canvas tabindex="0"></canvas><div id="pins"></div></div>',
    { url: "https://whiteboard.test" },
  );
  const previous = Object.fromEntries(
    ["document", "localStorage", "NodeFilter"].map((k) => [k, globalThis[k]]),
  );
  for (const key of Object.keys(previous)) globalThis[key] = dom.window[key];
  const s = {
    board: board(),
    view: { x: 0, y: 0, z: 1 },
    readOnly: false,
    author: { id: "alice", name: "Alice" },
  };
  const canvas = document.querySelector("canvas");
  canvas.getBoundingClientRect = () => ({ width: 1200, height: 900 });
  const harness = { s, dom, saves: 0, fail: false };
  const ui = createCommentsUI({
    state: () => s,
    canvas: () => canvas,
    icon: () => "",
    prepare() {},
    focus() {},
    add() {},
    toast() {},
    draw: () => ui.render(),
    anchor: () => null,
    now,
    save(comments) {
      if (harness.fail) throw Error("Save unavailable");
      s.board.comments = comments;
      harness.saves++;
    },
  });
  ui.bind(document.querySelector("#pins"));
  return {
    ...harness,
    ui,
    doc: document,
    submit() {
      document
        .querySelector("#comment-form")
        .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    },
    setFail(value) {
      harness.fail = value;
    },
    saves: () => harness.saves,
    close() {
      ui.close(false);
      dom.window.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    },
  };
}

test("comment authors can identify a French passage without changing the interface language", () => {
  const a = setup();
  try {
    a.ui.compose({ x: 10, y: 20 });
    const box = a.doc.querySelector("#comment-text");
    box.value = "Welcome. Bonjour à tous.";
    box.setSelectionRange(9, box.value.length);
    assert.ok(
      a.doc.querySelector("#comment-language-options"),
      "comment passages have a language control",
    );
    a.doc.querySelector("#comment-language-options").click();
    a.doc.querySelector("#comment-language-tag").value = "fr-CA";
    a.doc.querySelector("#comment-language-save").click();
    a.submit();
    assert.equal(
      a.doc.querySelector('.comment-message [lang="fr-CA"]').textContent,
      "Bonjour à tous.",
    );
    assert.equal(
      a.doc.querySelector('.comment-summary [lang="fr-CA"]').textContent,
      "Bonjour à tous.",
    );
    assert.deepEqual(a.s.board.comments[0].messages[0].textRuns, [
      { start: 9, end: 24, style: { lang: "fr-CA" } },
    ]);
    assert.equal(a.doc.documentElement.lang, "en");
    assert.equal(
      a.doc.querySelector('#pins [lang="fr-CA"]').textContent,
      "Bonjour à tous.",
    );
  } finally {
    a.close();
  }
});

test("comment language drafts retain trimmed ranges, failures, cancellation and stale-edit protection", () => {
  const a = setup();
  try {
    a.ui.compose({ x: 10, y: 20 });
    const box = a.doc.querySelector("#comment-text");
    box.value = "  Hello bonjour  ";
    box.setSelectionRange(8, 15);
    a.doc.querySelector("#comment-language-options").click();
    a.doc.querySelector("#comment-language-tag").value = "fr";
    a.doc.querySelector("#comment-language-save").click();
    a.setFail(true);
    a.submit();
    assert.equal(box.value, "  Hello bonjour  ");
    a.ui.close(false);
    a.ui.compose({ x: 30, y: 40 });
    assert.equal(
      a.doc.querySelector("#comment-text").value,
      "  Hello bonjour  ",
    );
    a.setFail(false);
    a.submit();
    const message = a.s.board.comments[0].messages[0];
    assert.equal(message.text, "Hello bonjour");
    assert.deepEqual(message.textRuns, [
      { start: 6, end: 13, style: { lang: "fr" } },
    ]);
    a.doc.querySelector("[data-edit-comment]").click();
    a.doc.querySelector("#comment-text").setSelectionRange(0, 0);
    a.doc.querySelector("#comment-language-options").click();
    a.doc.querySelector("#comment-language-tag").value = "bad_tag";
    a.doc.querySelector("#comment-language-save").click();
    assert.match(
      a.doc.querySelector("#comment-language-error").textContent,
      /valid language tag/,
    );
    a.doc.querySelector("#comment-language-tag").value = "en";
    a.doc.querySelector("#comment-language-save").click();
    message.lang = "es";
    a.submit();
    assert.match(a.doc.querySelector("#comment-error").textContent, /changed/);
    assert.equal(message.lang, "es");
    a.doc.querySelector("#comment-edit-cancel").click();
    a.doc.querySelector("[data-edit-comment]").click();
    a.doc.querySelector("#comment-language-options").click();
    assert.equal(a.doc.querySelector("#comment-language-tag").value, "es");
    a.doc.querySelector("#comment-language-tag").value = "de";
    a.doc.querySelector("#comment-language-cancel").click();
    a.submit();
    assert.equal(a.s.board.comments[0].messages[0].lang, "es");
  } finally {
    a.close();
  }
});

test("comment language controls reject changed text and preserve focus and drafts after access is revoked", () => {
  const a = setup();
  try {
    a.ui.compose({ x: 10, y: 20 });
    const box = a.doc.querySelector("#comment-text");
    box.value = "Hello bonjour";
    box.setSelectionRange(6, 13);
    a.doc.querySelector("#comment-language-options").click();
    const tag = a.doc.querySelector("#comment-language-tag");
    tag.value = "fr";
    box.value = "Short";
    a.doc.querySelector("#comment-language-save").click();
    assert.match(
      a.doc.querySelector("#comment-language-error").textContent,
      /text changed/,
    );
    tag.focus();
    a.s.readOnly = true;
    a.ui.render();
    assert.equal(a.doc.activeElement.id, "comment-search");
    assert.equal(
      a.doc.querySelector("#comment-language-controls").hidden,
      true,
    );
    a.s.readOnly = false;
    a.ui.render();
    assert.equal(box.value, "Short");
    a.submit();
    assert.equal(a.s.board.comments[0].messages[0].textRuns, undefined);
  } finally {
    a.close();
  }
});

test("comment pagination keeps focus usable when remote discussions disappear", () => {
  const a = setup();
  try {
    const comments = Array.from({ length: 101 }, (_, n) =>
      commentThread(
        { x: n, y: 0 },
        a.s.author,
        `Discussion ${n}`,
        undefined,
        1000 + n,
      ),
    );
    a.s.board.comments = comments;
    a.ui.toggle();
    const previous = a.doc.querySelector("#comments-previous"),
      next = a.doc.querySelector("#comments-next"),
      search = a.doc.querySelector("#comment-search");
    next.focus();
    next.click();
    next.focus();
    a.s.board.comments = comments.slice(0, 51);
    a.ui.render();
    assert.equal(next.disabled, true);
    assert.equal(a.doc.activeElement, previous);
    a.s.board.comments = comments.slice(0, 50);
    a.ui.render();
    assert.equal(a.doc.querySelector(".comment-pages").hidden, true);
    assert.equal(a.doc.activeElement, search);
    a.s.board.comments = comments.slice(0, 51);
    a.ui.render();
    next.focus();
    next.click();
    assert.equal(a.doc.activeElement, previous);
    previous.click();
    assert.equal(a.doc.activeElement, next);
    search.focus();
    a.s.board.comments = comments.slice(0, 50);
    a.ui.render();
    assert.equal(a.doc.activeElement, search);
    assert.equal(a.saves(), 0);
  } finally {
    a.close();
  }
});

test("losing comment access restores usable focus while preserving the reply draft", () => {
  const a = setup();
  try {
    const thread = commentThread({ x: 40, y: 50 }, a.s.author, "Original");
    a.s.board.comments = [thread];
    a.ui.show(thread.id);
    const field = a.doc.querySelector("textarea"),
      search = a.doc.querySelector("#comment-search");
    field.value = "Keep my pending reply";
    field.dispatchEvent(new a.dom.window.Event("input", { bubbles: true }));
    field.focus();
    a.s.readOnly = true;
    a.ui.render();
    assert.equal(a.doc.querySelector("#comment-form").hidden, true);
    assert.equal(a.doc.activeElement, search);
    assert.equal(field.value, "Keep my pending reply");
    a.submit();
    assert.equal(a.saves(), 0);
    assert.equal(thread.messages.length, 1);
    a.s.readOnly = false;
    a.ui.render();
    assert.equal(a.doc.activeElement, search);
    assert.equal(a.doc.querySelector("#comment-form").hidden, false);
    assert.equal(field.value, "Keep my pending reply");
    field.focus();
    a.ui.render();
    assert.equal(a.doc.activeElement, field);
    a.submit();
    assert.equal(a.saves(), 1);
    assert.equal(
      a.s.board.comments[0].messages.at(-1).text,
      "Keep my pending reply",
    );
  } finally {
    a.close();
  }
});

test("comment drafts survive save failures and reject resumed edits after a remote change", () => {
  const a = setup();
  try {
    const thread = commentThread({ x: 40, y: 50 }, a.s.author, "Original");
    a.s.board.comments = [thread];
    a.ui.show(thread.id);
    a.doc.querySelector("textarea").value = "Keep my reply";
    a.setFail(true);
    a.submit();
    assert.equal(a.doc.querySelector("textarea").value, "Keep my reply");
    assert.equal(a.doc.querySelector("#comment-error").hidden, false);
    assert.equal(a.s.board.comments[0].messages.length, 1);
    a.setFail(false);
    a.submit();
    assert.equal(a.s.board.comments[0].messages.length, 2);
    a.doc.querySelector("[data-edit-comment]").click();
    a.doc.querySelector("textarea").value = "An unfinished edit";
    a.doc
      .querySelector("textarea")
      .dispatchEvent(new a.dom.window.Event("input"));
    a.ui.close();
    a.s.board.comments = structuredClone(a.s.board.comments);
    a.s.board.comments[0].messages[0].text = "Changed in another tab";
    a.ui.show(thread.id);
    a.doc.querySelector("[data-edit-comment]").click();
    assert.equal(a.doc.querySelector("textarea").value, "An unfinished edit");
    a.submit();
    assert.match(a.doc.querySelector("#comment-error").textContent, /changed/);
    assert.equal(
      a.s.board.comments[0].messages[0].text,
      "Changed in another tab",
    );
    a.doc.querySelector("#comment-edit-cancel").click();
    a.doc.querySelector("[data-edit-comment]").click();
    assert.equal(
      a.doc.querySelector("textarea").value,
      "Changed in another tab",
    );
  } finally {
    a.close();
  }
});

test("Escape during composition leaves the comment draft open", () => {
  const a = setup();
  try {
    a.ui.compose({ x: 40, y: 50 });
    const input = a.doc.querySelector("textarea");
    input.value = "Draft in progress";
    for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
      const event = new a.dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
        ...extra,
      });
      input.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false);
      assert.equal(a.doc.querySelector("textarea"), input);
      assert.equal(input.value, "Draft in progress");
    }
    assert.equal(a.saves(), 0);
    input.dispatchEvent(
      new a.dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(a.doc.querySelector("#comments-panel"), null);
  } finally {
    a.close();
  }
});

test("comment pin gestures cancel without writes, commit once, allow keyboard movement and reject viewers", () => {
  const a = setup();
  try {
    const c = commentThread({ x: 40, y: 50 }, a.s.author, "Review");
    a.s.board.comments = [c];
    a.ui.render();
    const pin = a.doc.querySelector("[data-comment]");
    const event = (type, x, y) => {
      const e = new a.dom.window.MouseEvent(type, {
        button: 0,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(e, "pointerId", { value: 1 });
      pin.dispatchEvent(e);
    };
    event("pointerdown", 40, 50);
    event("pointermove", 140, 150);
    assert.equal(pin.style.left, "140px");
    assert.equal(a.saves(), 0);
    event("pointercancel", 140, 150);
    assert.equal(pin.style.left, "40px");
    assert.equal(a.saves(), 0);
    event("pointerdown", 40, 50);
    event("pointermove", 140, 150);
    event("pointerup", 140, 150);
    assert.equal(a.saves(), 1);
    assert.equal(a.s.board.comments[0].x, 140);
    pin.dispatchEvent(
      new a.dom.window.KeyboardEvent("keydown", {
        key: "ArrowRight",
        shiftKey: true,
        bubbles: true,
      }),
    );
    assert.equal(a.s.board.comments[0].x, 150);
    a.s.readOnly = true;
    a.ui.render();
    pin.dispatchEvent(
      new a.dom.window.KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
      }),
    );
    event("pointerdown", 150, 150);
    event("pointermove", 250, 250);
    event("pointerup", 250, 250);
    assert.equal(a.s.board.comments[0].x, 150);
    assert.equal(a.saves(), 2);
  } finally {
    a.close();
  }
});

test("comment pins can be repositioned with clicks and numeric fields instead of dragging", () => {
  const a = setup();
  try {
    const anchor = item("note", 100, 200);
    a.s.board.items = [anchor];
    const c = commentThread({ x: 140, y: 250 }, a.s.author, "Review", anchor);
    a.s.board.comments = [c];
    a.ui.show(c.id);
    const move = a.doc.querySelector("#comment-move");
    assert.ok(
      move,
      "A click-based alternative to dragging the pin is available",
    );
    move.click();
    const form = a.doc.querySelector("#comment-position"),
      x = a.doc.querySelector("#comment-x"),
      y = a.doc.querySelector("#comment-y");
    const submit = () =>
      form.dispatchEvent(
        new a.dom.window.Event("submit", { cancelable: true }),
      );
    assert.equal(x.value, "140");
    assert.equal(y.value, "250");
    assert.equal(a.doc.activeElement, x);
    x.value = "1000001";
    submit();
    assert.equal(a.saves(), 0);
    assert.equal(form.hidden, false);
    a.doc.querySelector("#comment-move-cancel").click();
    assert.equal(form.hidden, true);
    assert.equal(a.doc.activeElement, move);
    move.click();
    x.value = "-12.5";
    y.value = "23.75";
    submit();
    assert.equal(a.saves(), 1);
    assert.equal(a.s.board.comments[0].x, -12.5);
    assert.equal(a.s.board.comments[0].y, 23.75);
    assert.equal(a.s.board.comments[0].anchorId, undefined);
    assert.equal(form.hidden, true);
    assert.equal(a.doc.activeElement, move);
    assert.equal(a.doc.querySelector("[data-comment]").style.left, "-12.5px");
  } finally {
    a.close();
  }
});

test("pin position fields preserve drafts and reject save failures, stale geometry and lost access", () => {
  const a = setup();
  try {
    const anchor = item("note", 100, 200);
    a.s.board.items = [anchor];
    const c = commentThread({ x: 140, y: 250 }, a.s.author, "Review", anchor);
    a.s.board.comments = [c];
    a.ui.show(c.id);
    const move = a.doc.querySelector("#comment-move"),
      form = a.doc.querySelector("#comment-position"),
      x = a.doc.querySelector("#comment-x"),
      reply = a.doc.querySelector("#comment-text"),
      error = a.doc.querySelector("#comment-position-error");
    const submit = () =>
      form.dispatchEvent(
        new a.dom.window.Event("submit", { cancelable: true }),
      );
    reply.value = "Unsent reply";
    reply.dispatchEvent(new a.dom.window.Event("input"));
    move.click();
    x.value = "150";
    a.setFail(true);
    submit();
    assert.equal(error.hidden, false);
    assert.equal(error.textContent, "Save unavailable");
    assert.equal(form.hidden, false);
    assert.equal(a.saves(), 0);
    a.setFail(false);
    anchor.x += 10;
    submit();
    assert.match(error.textContent, /This pin moved/);
    assert.equal(a.saves(), 0);
    a.doc.querySelector("#comment-move-cancel").click();
    move.click();
    assert.equal(x.value, "150");
    a.s.readOnly = true;
    a.ui.render();
    submit();
    assert.equal(move.disabled, true);
    assert.equal(form.hidden, true);
    assert.equal(a.doc.activeElement.id, "comment-search");
    assert.equal(a.saves(), 0);
    a.s.readOnly = false;
    a.ui.render();
    assert.equal(reply.value, "Unsent reply");
    move.click();
    a.s.concealed = new Set([anchor.id]);
    a.ui.render();
    assert.equal(move.disabled, true);
    assert.equal(form.hidden, true);
    assert.equal(a.doc.activeElement.id, "comment-search");
    a.s.concealed = new Set();
    a.ui.render();
    move.click();
    a.s.board.comments = [];
    a.ui.render();
    assert.equal(form.hidden, true);
    assert.equal(a.doc.activeElement.id, "comment-search");
    assert.equal(a.saves(), 0);
  } finally {
    a.close();
  }
});

test("large comment lists page at fifty and unchanged navigation avoids rebuilding messages or the item index", () => {
  const a = setup();
  try {
    a.s.board.items = Array.from({ length: 5000 }, (_, i) =>
      item("note", i * 200, 0),
    );
    a.s.board.comments = Array.from({ length: 500 }, (_, i) =>
      commentThread(
        { x: i * 200, y: 50 },
        a.s.author,
        `Review ${i}`,
        a.s.board.items[i],
      ),
    );
    a.ui.toggle();
    assert.equal(a.doc.querySelectorAll("[data-thread]").length, 50);
    assert.ok(a.doc.querySelectorAll("[data-comment]").length <= 7);
    a.ui.show(a.s.board.comments[0].id);
    const message = a.doc.querySelector(".comment-message");
    let reads = 0;
    for (const i of a.s.board.items) {
      const id = i.id;
      Object.defineProperty(i, "id", {
        get() {
          reads++;
          return id;
        },
      });
    }
    for (let i = 0; i < 20; i++) {
      a.s.view.x -= 1;
      a.ui.render();
    }
    assert.equal(reads, 0, "Panning uses the cached object index");
    assert.equal(
      a.doc.querySelector(".comment-message"),
      message,
      "Panning retains rendered discussions",
    );
    a.doc.querySelector("#comments-next").click();
    assert.equal(a.doc.querySelectorAll("[data-thread]").length, 50);
  } finally {
    a.close();
  }
});
test("searching comments says how many discussions match", () => {
  const a = setup();
  try {
    a.s.board.comments = ["Budget review", "Budget risks", "Hiring"].map(
      (text, n) => commentThread({ x: n * 100, y: 0 }, a.s.author, text),
    );
    a.ui.toggle();
    const status = a.doc.querySelector("#comments-results");
    assert.equal(status.getAttribute("role"), "status");
    assert.equal(status.textContent, "3 discussions");
    const search = a.doc.querySelector("#comment-search");
    for (const [query, expected] of [
      ["budget", "2 discussions"],
      ["hiring", "1 discussion"],
      ["nothing", "0 discussions"],
    ]) {
      search.value = query;
      search.dispatchEvent(new a.dom.window.Event("input"));
      assert.equal(status.textContent, expected);
    }
  } finally {
    a.close();
  }
});
test("typing saves drafts shortly after, and a full list lets go of the least recently written", async () => {
  const a = setup();
  try {
    const threads = Array.from({ length: 21 }, (_, n) =>
      commentThread({ x: n * 10, y: 0 }, a.s.author, `Thread ${n}`),
    );
    a.s.board.comments = threads;
    const type = (text) => {
      const box = a.doc.querySelector("textarea");
      box.value = text;
      box.dispatchEvent(new a.dom.window.Event("input"));
    };
    const stored = () =>
      a.dom.window.localStorage.getItem("whiteboard-comment-drafts");
    a.ui.show(threads[0].id);
    for (const text of ["K", "Ke", "Kee", "Keep"]) type(text);
    assert.equal(stored(), null, "Keystrokes are not each written to storage");
    await new Promise((r) => setTimeout(r, 600));
    assert.match(stored(), /Keep/);
    for (let n = 1; n < 20; n++) {
      a.ui.show(threads[n].id);
      type(`Draft ${n}`);
    }
    // The first draft is written to again, then one more is started.
    a.ui.show(threads[0].id);
    type("Keep this");
    a.ui.show(threads[20].id);
    type("Newest");
    a.ui.show(threads[1].id);
    const saved = new Map(
      JSON.parse(
        a.dom.window.localStorage.getItem("whiteboard-comment-drafts"),
      ),
    );
    assert.equal(saved.size, 20);
    const texts = [...saved.values()].map((d) => d.text);
    assert.ok(texts.includes("Keep this"));
    assert.ok(texts.includes("Newest"));
    assert.ok(!texts.includes("Draft 1"));
  } finally {
    a.close();
  }
});
test("deleting and restoring a comment does not mark it edited", () => {
  const a = setup();
  try {
    const thread = commentThread({ x: 40, y: 50 }, a.s.author, "Hello");
    a.s.board.comments = [thread];
    a.ui.show(thread.id);
    a.doc.querySelector("[data-delete-comment]").click();
    assert.equal(a.s.board.comments[0].messages[0].deleted, true);
    a.doc.querySelector("[data-delete-comment]").click();
    const [message] = a.s.board.comments[0].messages;
    assert.equal(message.deleted, false);
    assert.equal(message.editedAt, undefined);
    assert.doesNotMatch(
      a.doc.querySelector(".comment-message").textContent,
      /Edited/,
    );
  } finally {
    a.close();
  }
});
test("a new comment uses the chosen place even when an earlier draft exists", () => {
  const a = setup();
  try {
    const note = item("note", 0, 0, { w: 100, h: 100 });
    a.s.board.items = [note];
    a.ui.compose({ x: 20, y: 30 }, note);
    a.doc.querySelector("textarea").value = "Unsent idea";
    a.doc
      .querySelector("textarea")
      .dispatchEvent(new a.dom.window.Event("input"));
    a.ui.close();
    a.ui.compose({ x: 500, y: 600 });
    assert.equal(a.doc.querySelector("textarea").value, "Unsent idea");
    a.submit();
    const [thread] = a.s.board.comments;
    assert.equal(thread.x, 500);
    assert.equal(thread.y, 600);
    assert.equal(thread.anchorId, undefined);
  } finally {
    a.close();
  }
});

test("rebuilding the comments panel keeps keyboard focus in place", () => {
  const h = setup();
  try {
    const thread = commentThread({ x: 40, y: 50 }, h.s.author, "Hello");
    h.s.board.comments = [thread];
    h.ui.show(thread.id);
    h.doc.querySelector("[data-edit-comment]").focus();
    // Another participant's vote replaces the workshop and redraws the panel.
    h.s.board.workshop = { note: 1 };
    h.ui.render();
    assert.equal(
      h.doc.activeElement.dataset.editComment,
      thread.messages[0].id,
    );
    h.doc.querySelector(`[data-thread="${thread.id}"]`).focus();
    h.s.board.workshop = { note: 2 };
    h.ui.render();
    assert.equal(h.doc.activeElement.dataset.thread, thread.id);
  } finally {
    h.close();
  }
});

test("comments are dated by the board's shared clock, not a fast device clock", () => {
  const server = Date.now() - 2 * 86_400_000;
  const a = setup({ now: () => server + 0.4 });
  try {
    a.ui.compose({ x: 10, y: 10 });
    a.doc.querySelector("textarea").value = "Started";
    a.submit();
    const [thread] = a.s.board.comments;
    assert.equal(thread.messages[0].createdAt, server);
    a.doc.querySelector("textarea").value = "Reply";
    a.submit();
    const saved = a.s.board.comments[0].messages;
    assert.deepEqual(
      saved.map((m) => m.createdAt),
      [server, server + 1],
    );
  } finally {
    a.close();
  }
});

test("the comment list names this person's own discussions as theirs", () => {
  const a = setup();
  try {
    a.s.board.comments = [
      commentThread({ x: 0, y: 0 }, a.s.author, "Mine"),
      commentThread({ x: 50, y: 0 }, { id: "bob", name: "Bob" }, "Theirs"),
    ];
    a.ui.toggle();
    const names = [...a.doc.querySelectorAll(".comment-summary strong")].map(
      (el) => el.textContent,
    );
    assert.deepEqual(names.sort(), ["Bob", "You"]);
  } finally {
    a.close();
  }
});

test("focus stays in the comment list when someone else resolves the focused discussion", () => {
  const a = setup();
  try {
    const threads = ["One", "Two", "Three"].map((text, n) =>
      commentThread({ x: n * 60, y: 0 }, a.s.author, text),
    );
    a.s.board.comments = threads;
    a.ui.toggle();
    const summaries = () => [
      ...a.doc.querySelectorAll("#comment-list [data-thread]"),
    ];
    const focused = summaries()[1];
    focused.focus();
    const id = focused.dataset.thread;
    // Someone else resolves it; the Open list no longer shows it.
    a.s.board.comments = threads.map((c) =>
      c.id === id ? { ...c, resolved: true } : c,
    );
    a.ui.render();
    assert.equal(summaries().length, 2);
    assert.ok(
      a.doc.querySelector("#comment-list").contains(a.doc.activeElement),
      "focus moves to the discussion now in its place",
    );
  } finally {
    a.close();
  }
});
