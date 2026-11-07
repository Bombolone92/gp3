import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createMindCollapse } from "../src/mind-collapse.js";
import { mindVisibility } from "../src/mind-visibility.js";

function setup() {
  const dom = new JSDOM(
    '<canvas tabindex="0"></canvas><div id="controls"></div>',
  );
  const root = dom.window.document.querySelector("#controls");
  const node = {
    id: "root",
    x: 100,
    y: 150,
    w: 220,
    h: 90,
    mindMap: { parent: null, direction: "right" },
  };
  const child = {
    ...node,
    id: "child",
    mindMap: { parent: "root", direction: "right" },
  };
  const state = {
    enabled: true,
    board: {},
    view: { x: 0, y: 0, z: 1 },
    size: { width: 1200, height: 900 },
    selected: "root",
    scene: mindVisibility([node, child]),
  };
  const toggled = [];
  const ui = createMindCollapse({
    state: () => state,
    toggle: (id) => toggled.push(id),
    focus: () => dom.window.document.querySelector("canvas").focus(),
  });
  ui.bind(root);
  ui.render();
  const button = () => root.querySelector("button");
  const pointer = (type, options = {}) => {
    const e = new dom.window.MouseEvent(type, {
      clientX: 350,
      clientY: 120,
      cancelable: true,
      ...options,
    });
    Object.defineProperty(e, "pointerId", { value: 4 });
    button().dispatchEvent(e);
  };
  const click = () =>
    button().dispatchEvent(new dom.window.MouseEvent("click", { detail: 1 }));
  return { dom, root, state, node, child, ui, toggled, button, pointer, click };
}

test("collapse controls cancel interrupted, dragged and stale gestures and support keyboard activation", () => {
  const s = setup();
  try {
    for (const ending of ["pointercancel", "lostpointercapture"]) {
      s.pointer("pointerdown");
      s.pointer(ending);
      s.pointer("pointerup");
      s.click();
      assert.deepEqual(s.toggled, []);
    }
    s.pointer("pointerdown");
    s.pointer("pointermove", { clientX: 370 });
    s.pointer("pointerup");
    s.click();
    assert.deepEqual(s.toggled, []);
    s.pointer("pointerdown");
    s.state.board = {};
    s.pointer("pointerup");
    s.click();
    assert.deepEqual(s.toggled, []);
    s.pointer("pointerdown");
    s.node.mindMap.direction = "up";
    s.pointer("pointerup");
    s.click();
    assert.deepEqual(s.toggled, []);
    s.pointer("pointerdown");
    s.node.mindCollapsed = true;
    s.pointer("pointerup");
    s.click();
    assert.deepEqual(s.toggled, []);
    s.state.scene = mindVisibility([s.node, s.child]);
    s.ui.render();
    assert.equal(s.button().textContent, "1");
    assert.equal(s.button().getAttribute("aria-expanded"), "false");
    assert.match(
      s.button().getAttribute("aria-label"),
      /1 hidden node, 0 hidden comments/,
    );
    s.button().click();
    assert.deepEqual(s.toggled, ["root"]);
    s.pointer("pointerdown");
    s.pointer("pointerup");
    s.click();
    assert.deepEqual(s.toggled, ["root", "root"]);
    s.button().dispatchEvent(
      new s.dom.window.KeyboardEvent("keydown", { key: "Escape" }),
    );
    assert.equal(s.dom.window.document.activeElement.tagName, "CANVAS");
    s.state.enabled = false;
    s.ui.render();
    assert.equal(s.root.hidden, true);
    assert.equal(s.root.children.length, 0);
  } finally {
    s.dom.window.close();
  }
});

test("collapse overlay bounds dense boards, keeps selected controls and separates small-node plus targets", () => {
  const s = setup();
  try {
    const items = [];
    for (let n = 0; n < 2000; n++) {
      const parent = { ...s.node, id: `parent-${n}`, mindCollapsed: true };
      items.push(parent, {
        ...s.child,
        id: `child-${n}`,
        mindMap: { ...s.child.mindMap, parent: parent.id },
      });
    }
    s.state.scene = mindVisibility(items);
    s.state.selected = "parent-1999";
    s.ui.render();
    assert.equal(s.root.children.length, 400);
    assert.ok(s.root.querySelector('[data-mind-collapse="parent-1999"]'));
    s.state.view.z = 0.15;
    s.state.view.y = 100;
    s.ui.render();
    const button = s.root.querySelector('[data-mind-collapse="parent-1999"]');
    const cx = (s.node.x + s.node.w / 2) * 0.15;
    const cy = 100 + (s.node.y + s.node.h / 2) * 0.15;
    assert.ok(Number.parseFloat(button.style.left) - cx >= 44);
    assert.ok(cy - Number.parseFloat(button.style.top) >= 44);
    s.state.view.x = 5000;
    s.ui.render();
    assert.equal(s.root.children.length, 0);
  } finally {
    s.dom.window.close();
  }
});
