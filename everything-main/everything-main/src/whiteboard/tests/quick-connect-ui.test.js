import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { board, item, validateBoard } from "../src/model.js";
import { createQuickConnectUI } from "../src/quick-connect-ui.js";
import { language, setLanguage } from "../src/i18n.js";

function setup(target, lang = "en", skip) {
  const dom = new JSDOM(
    `<html lang="${lang}"><body><canvas tabindex="0"></canvas><div id="quick"></div></body></html>`,
  );
  const oldDocument = globalThis.document,
    oldLanguage = language;
  globalThis.document = dom.window.document;
  setLanguage(lang);
  const source = item("rect", 0, 0, { w: 100, h: 100, text: "Start" });
  const b = { ...board(), items: [source, target] };
  validateBoard(b);
  const root = dom.window.document.querySelector("#quick");
  root.getBoundingClientRect = () => ({ width: 320, height: 400 });
  const calls = {
    activated: [],
    started: [],
    moved: [],
    ended: 0,
    cancelled: 0,
  };
  let ui;
  const api = {
    state: () => ({
      board: b,
      source,
      view: { x: 0, y: 0, z: 1 },
      ...(skip ? { skip: () => skip } : {}),
    }),
    draw: () => ui.render(),
    activate: (...args) => calls.activated.push(args),
    start: (...args) => (calls.started.push(args), true),
    cancel: () => calls.cancelled++,
    move: (event) => calls.moved.push(event),
    end: () => calls.ended++,
    focusCanvas: () => dom.window.document.querySelector("canvas").focus(),
  };
  ui = createQuickConnectUI(api);
  ui.bind(root);
  ui.render();
  return {
    dom,
    root,
    b,
    ui,
    source,
    calls,
    button: root.querySelector('[data-quick-direction="right"]'),
    close() {
      ui.bind(dom.window.document.createElement("div"));
      setLanguage(oldLanguage);
      if (oldDocument === undefined) delete globalThis.document;
      else globalThis.document = oldDocument;
      dom.window.close();
    },
  };
}

test("a Quick connect press keeps its pointer through other presses, moves and clicks", () => {
  const a = setup(item("ellipse", 200, 0, { w: 100, h: 100 }));
  const pointer = (node, type, id, x) => {
    const event = new a.dom.window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: 50,
    });
    Object.defineProperties(event, {
      pointerId: { value: id },
      pointerType: { value: "touch" },
    });
    node.dispatchEvent(event);
  };
  try {
    const other = a.root.querySelector('[data-quick-direction="left"]');
    pointer(a.button, "pointerdown", 41, 100);
    pointer(other, "pointerdown", 42, 200);
    other.click();
    assert.deepEqual(
      a.calls.activated,
      [],
      "Another press cannot activate a connection",
    );
    pointer(other, "pointermove", 42, 250);
    assert.equal(
      a.calls.started.length,
      0,
      "Another pointer cannot start the drag",
    );
    pointer(a.button, "pointermove", 41, 150);
    assert.equal(a.calls.started.length, 1);
    assert.equal(a.calls.started[0][1].pointerId, 41);
    assert.deepEqual(
      a.calls.moved.map((event) => event.pointerId),
      [41],
    );
    pointer(other, "pointermove", 42, 300);
    assert.deepEqual(
      a.calls.moved.map((event) => event.pointerId),
      [41],
      "Only the owner's movement changes the endpoint",
    );
    pointer(a.button, "pointerup", 41, 200);
    assert.equal(a.calls.ended, 1);
    assert.equal(a.calls.cancelled, 0);
    assert.deepEqual(
      a.calls.moved.map((event) => event.pointerId),
      [41, 41],
    );
  } finally {
    a.close();
  }
});

for (const lang of ["en", "fr"])
  test(`quick-connect destination descriptions retain whole-text and passage languages in ${lang}`, () => {
    const target = item("ellipse", 200, 0, {
      w: 100,
      h: 100,
      text: 'Hello. Bonjour à tous. <img src="bad"> ' + "word ".repeat(40),
      lang: "en-CA",
      textRuns: [{ start: 7, end: 22, style: { lang: "fr-CA" } }],
    });
    const a = setup(target, lang);
    try {
      a.button.focus();
      const description = a.root.querySelector('[lang="fr-CA"]');
      assert.equal(description?.textContent, "Bonjour à tous.");
      const tip = description.closest('[role="tooltip"]');
      assert.equal(tip.hidden, false);
      assert.equal(tip.querySelector("[data-user-content]").lang, "en-CA");
      assert.equal(
        tip.querySelector("[data-user-content]").textContent.length,
        160 - (lang === "fr" ? "ellipse : " : "Ellipse: ").length,
      );
      assert.equal(tip.querySelector("img"), null);
      assert.equal(a.button.title, "");
      assert.ok(
        a.button.getAttribute("aria-describedby").split(/\s+/).includes(tip.id),
      );
      assert.ok(
        a.button
          .getAttribute("aria-describedby")
          .includes("quick-connect-hint"),
      );
      assert.match(
        tip.textContent,
        lang === "en" ? /^Connect to Ellipse: / : /^Connecter à ellipse : /,
      );
      assert.equal(
        a.button.getAttribute("aria-label"),
        lang === "en" ? "Quick connect right" : "Connexion rapide à droite",
      );
      target.lang = "en-GB";
      target.textRuns[0].style.lang = "fr";
      a.ui.render();
      assert.equal(tip.querySelector("[data-user-content]").lang, "en-GB");
      assert.equal(
        tip.querySelector('[lang="fr"]').textContent,
        "Bonjour à tous.",
      );
      assert.equal(a.dom.window.document.activeElement, a.button);
      a.button.click();
      assert.deepEqual(a.calls.activated, [[a.source.id, "right"]]);
    } finally {
      a.close();
    }
  });

test("quick-connect tagged tooltips are hoverable, dismissible, and do not activate a connection", () => {
  const a = setup(
    item("ellipse", 200, 0, {
      w: 100,
      h: 100,
      text: "Bonjour à tous.",
      lang: "fr-CA",
    }),
  );
  const event = (node, type, options = {}) =>
    node.dispatchEvent(
      new a.dom.window.MouseEvent(type, {
        bubbles: true,
        button: 0,
        ...options,
      }),
    );
  try {
    event(a.button, "pointerenter");
    const tip = a.button.querySelector('[role="tooltip"]');
    assert.ok(tip);
    assert.equal(tip.hidden, false);
    assert.equal(
      tip.querySelector('[lang="fr-CA"]').textContent,
      "Bonjour à tous.",
    );
    event(tip, "pointerenter");
    assert.equal(tip.hidden, false);
    event(tip, "pointerdown");
    event(tip, "click");
    assert.deepEqual(a.calls.activated, []);
    assert.deepEqual(a.calls.started, []);
    a.button.focus();
    a.button.dispatchEvent(
      new a.dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(tip.hidden, true);
    assert.equal(a.dom.window.document.activeElement, a.button);
    a.ui.render();
    assert.equal(
      tip.hidden,
      true,
      "A redraw does not immediately reopen a dismissed tooltip",
    );
    event(a.button, "click", { detail: 1 });
    assert.deepEqual(
      a.calls.activated,
      [[a.source.id, "right"]],
      "Dismissing a tooltip does not suppress the next pointer click",
    );
    event(a.button, "pointerleave");
    event(a.button, "pointerenter");
    assert.equal(tip.hidden, false);
    a.dom.window.document.querySelector("canvas").focus();
    event(a.button, "pointerenter");
    a.dom.window.document.querySelector("canvas").dispatchEvent(
      new a.dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(
      tip.hidden,
      true,
      "Escape also dismisses a pointer-triggered tooltip",
    );
    event(a.button, "pointerenter");
    event(a.button, "pointerleave");
    assert.equal(tip.hidden, true);
    event(a.button, "pointerenter");
    a.root.remove();
    const detachedEscape = new a.dom.window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    a.dom.window.document.dispatchEvent(detachedEscape);
    assert.equal(
      detachedEscape.defaultPrevented,
      false,
      "An old editor does not consume library keys",
    );
  } finally {
    a.close();
  }
});

test("overflowing Quick connect descriptions scroll in both directions without activation", () => {
  const a = setup(
    item("ellipse", 200, 0, {
      w: 100,
      h: 100,
      text: "A long destination description. ".repeat(6),
      lang: "en",
    }),
  );
  const key = (options) => {
    const event = new a.dom.window.KeyboardEvent("keydown", {
      ...options,
      bubbles: true,
      cancelable: true,
    });
    a.button.dispatchEvent(event);
    return event;
  };
  try {
    a.button.focus();
    const tip = a.button.querySelector('[role="tooltip"]');
    Object.defineProperties(tip, {
      clientHeight: { value: 100, configurable: true },
      scrollHeight: { value: 300, configurable: true },
    });
    tip.scrollTop = 200;
    assert.equal(key({ key: "Home" }).defaultPrevented, true);
    assert.equal(tip.scrollTop, 0);
    key({ key: "ArrowDown" });
    assert.ok(tip.scrollTop > 0 && tip.scrollTop < 200);
    key({ key: "ArrowUp" });
    assert.equal(tip.scrollTop, 0);
    key({ key: "PageDown" });
    assert.equal(tip.scrollTop, 100);
    key({ key: "PageUp" });
    assert.equal(tip.scrollTop, 0);
    key({ key: "End" });
    assert.equal(tip.scrollTop, 200);
    key({ key: "ArrowDown" });
    assert.equal(tip.scrollTop, 200);
    for (const options of [
      { key: "Tab" },
      { key: "Enter" },
      { key: " " },
      { key: "Home", ctrlKey: true },
      { key: "Home", altKey: true },
      { key: "Home", metaKey: true },
      { key: "Home", shiftKey: true },
      { key: "Home", isComposing: true },
      { key: "Home", keyCode: 229 },
    ]) {
      assert.equal(key(options).defaultPrevented, false);
      assert.equal(tip.scrollTop, 200);
    }
    assert.equal(a.dom.window.document.activeElement, a.button);
    assert.deepEqual(a.calls.activated, []);
    assert.deepEqual(a.calls.started, []);
    key({ key: "Escape" });
    assert.equal(tip.hidden, true);
    assert.equal(key({ key: "Home" }).defaultPrevented, false);
    a.dom.window.document.querySelector("canvas").focus();
    a.button.focus();
    assert.equal(tip.hidden, false);
    Object.defineProperty(tip, "scrollHeight", { value: 100 });
    assert.equal(key({ key: "Home" }).defaultPrevented, false);
    a.button.click();
    assert.deepEqual(a.calls.activated, [[a.source.id, "right"]]);
  } finally {
    a.close();
  }
});

test("the Quick connect preview neither names nor outlines content hidden from this person", () => {
  const hidden = new Set();
  const secret = item("note", 200, 0, {
    w: 100,
    h: 100,
    text: "Secret: layoffs in Q3",
  });
  hidden.add(secret.id);
  const a = setup(secret, "en", hidden);
  try {
    a.button.dispatchEvent(new a.dom.window.MouseEvent("pointerenter"));
    const tip = a.button.querySelector('[role="tooltip"]');
    assert.equal(tip.textContent, "Add connected object");
    assert.doesNotMatch(tip.textContent, /Secret/);
    const plan = a.ui.render();
    assert.ok(plan.node);
    assert.equal(plan.node.x, 180, "placed as if nothing were there");
    // Once revealed, the same preview connects to it.
    hidden.delete(secret.id);
    assert.equal(a.ui.render().target.id, secret.id);
    assert.match(tip.textContent, /Connect to Sticky note: Secret/);
  } finally {
    a.close();
  }
});
