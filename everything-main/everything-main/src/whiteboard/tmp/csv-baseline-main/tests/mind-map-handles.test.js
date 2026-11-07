import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createMindMapHandles } from "../src/mind-map-handles.js";

function setup() {
  const dom = new JSDOM(
    '<main><canvas tabindex="0"></canvas><div id="ports"></div></main>',
  );
  const root = dom.window.document.querySelector("#ports");
  const state = {
    board: {},
    view: { x: 10, y: 20, z: 2 },
    size: { width: 1200, height: 900 },
    source: {
      id: "root",
      x: 100,
      y: 100,
      w: 220,
      h: 90,
      mindMap: { parent: null, direction: "right", auto: true, line: "curved" },
    },
  };
  const added = [];
  const ui = createMindMapHandles({
    state: () => state,
    add: (direction) => added.push(direction),
    focus: () => dom.window.document.querySelector("canvas").focus(),
  });
  ui.bind(root);
  ui.render();
  const button = (dir) => root.querySelector(`[data-mind-direction="${dir}"]`);
  const pointer = (type, options = {}) => {
    const e = new dom.window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: 680,
      clientY: 310,
      ...options,
    });
    Object.defineProperty(e, "pointerId", { value: 1 });
    button("right").dispatchEvent(e);
  };
  const click = () =>
    button("right").dispatchEvent(
      new dom.window.MouseEvent("click", { detail: 1 }),
    );
  return { dom, root, state, ui, added, button, pointer, click };
}

test("mind map handles cancel interrupted, dragged, stale and lost-capture presses without creating branches", () => {
  const { dom, state, ui, added, pointer, click } = setup();
  try {
    for (const end of ["pointercancel", "lostpointercapture"]) {
      pointer("pointerdown");
      pointer(end);
      pointer("pointerup");
      click();
      assert.deepEqual(added, []);
    }
    pointer("pointerdown");
    pointer("pointermove", { clientX: 710 });
    pointer("pointerup");
    click();
    assert.deepEqual(added, []);
    pointer("pointerdown");
    state.source.mindMap.direction = "down";
    pointer("pointerup");
    click();
    assert.deepEqual(added, []);
    pointer("pointerdown");
    ui.cancel();
    pointer("pointerup");
    click();
    assert.deepEqual(added, []);
    pointer("pointerdown");
    state.board = {};
    ui.render();
    pointer("pointerup");
    click();
    assert.deepEqual(added, []);
    pointer("pointerdown");
    pointer("pointerup");
    pointer("lostpointercapture");
    click();
    assert.deepEqual(added, ["right"]);
  } finally {
    dom.window.close();
  }
});

test("mind map handles stay bounded, track zoom, expose the branch direction and retain keyboard navigation", () => {
  const { dom, root, state, ui, added, button } = setup();
  try {
    assert.equal(root.querySelectorAll("button:not([hidden])").length, 4);
    assert.equal(button("right").style.left, "680px");
    assert.equal(button("right").style.top, "310px");
    const original = button("right");
    state.view.z = 1;
    ui.render();
    assert.equal(button("right"), original);
    assert.equal(original.style.left, "360px");
    button("up").focus();
    button("up").dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
      }),
    );
    assert.equal(dom.window.document.activeElement, button("right"));
    button("right").click();
    assert.deepEqual(added, ["right"]);
    button("right").dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    assert.equal(dom.window.document.activeElement.tagName, "CANVAS");
    state.source.mindMap.parent = "parent";
    state.source.mindMap.direction = "up";
    ui.render();
    assert.equal(root.querySelectorAll("button:not([hidden])").length, 1);
    assert.equal(button("up").hidden, false);
    button("right").click();
    assert.deepEqual(added, ["right"]);
    state.view.y = -1000;
    ui.render();
    assert.equal(root.querySelectorAll("button:not([hidden])").length, 0);
    state.source = null;
    ui.render();
    assert.equal(root.hidden, true);
  } finally {
    dom.window.close();
  }
});
