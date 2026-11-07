import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCanvas } from "./canvas.js";
import {
  minimapScene,
  visibleWorld,
  minimapLayout,
  mapPoint,
  mapRect,
  centerView,
  paintMinimapScene,
  paintMinimapViewport,
} from "../src/minimap.js";
import { createMinimap } from "../src/minimap-ui.js";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} ≈ ${b}`);
const colors = {
  background: "#ffffff",
  object: "#f6e7a4",
  media: "#8090f0",
  outline: "#555555",
  viewport: "#0869d6",
  viewportFill: "#0869d630",
};

test("minimap fits content and the current viewport, including empty, negative and distant geometry", () => {
  for (const items of [
    [],
    [{ type: "rect", x: 1e6, y: -1e6, w: 0, h: 0 }],
    [{ type: "arrow", x: 500, y: 600, w: -2000, h: -1300 }],
    [
      { type: "frame", x: -1e6, y: -1e6, w: 1e6, h: 1e6 },
      { type: "rect", x: 1e6, y: 1e6, w: 1e6, h: 1e6 },
    ],
  ]) {
    const scene = minimapScene(items),
      view = { x: 10000, y: -10000, z: 0.15 },
      size = { width: 1000, height: 700 };
    const visible = visibleWorld(view, size),
      layout = minimapLayout(scene.box, visible, 220, 148);
    for (const box of [visible, ...(scene.box ? [scene.box] : [])]) {
      const r = mapRect(layout, box);
      assert.ok(r.x >= 9.999 && r.y >= 9.999);
      assert.ok(r.x + r.w <= 210.001 && r.y + r.h <= 138.001);
    }
    const world = { x: -312.5, y: 941.25 },
      p = {
        x: world.x * layout.scale + layout.x,
        y: world.y * layout.scale + layout.y,
      };
    const restored = mapPoint(layout, p);
    near(restored.x, world.x);
    near(restored.y, world.y);
    const next = centerView(view, size, world);
    near((size.width / 2 - next.x) / next.z, world.x);
    near((size.height / 2 - next.y) / next.z, world.y);
    assert.equal(next.z, view.z);
  }
});

test("minimap paints ordered silhouettes and a readable viewport without accessing content or assets", () => {
  const guarded = (i) =>
    new Proxy(i, {
      get(target, key) {
        if (
          ["text", "src", "data", "cells", "points", "fontSize"].includes(key)
        )
          throw Error(`Overview read ${key}`);
        return target[key];
      },
    });
  const items = [
    guarded({ type: "note", x: 30, y: 30, w: 30, h: 30, color: "#ff0000" }),
    guarded({ type: "frame", x: 10, y: 10, w: 100, h: 100 }),
    guarded({
      type: "image",
      x: 70,
      y: 70,
      w: 30,
      h: 30,
      crop: { mask: "ellipse" },
    }),
    guarded({ type: "pen", x: 120, y: 20, w: 0, h: 0 }),
    guarded({
      type: "arrow",
      x: 30,
      y: 130,
      w: 100,
      h: -15,
      lineType: "curved",
    }),
  ];
  const scene = minimapScene(items);
  assert.equal(scene.entries[0].type, "frame");
  const canvas = createCanvas(160, 160),
    ctx = canvas.getContext("2d"),
    layout = { x: 0, y: 0, scale: 1, width: 160, height: 160 };
  paintMinimapScene(ctx, scene, layout, colors);
  assert.deepEqual([...ctx.getImageData(40, 40, 1, 1).data], [255, 0, 0, 255]);
  assert.deepEqual(
    [...ctx.getImageData(71, 71, 1, 1).data],
    [255, 255, 255, 255],
  );
  assert.deepEqual(
    [...ctx.getImageData(85, 85, 1, 1).data],
    [128, 144, 240, 255],
  );
  const target = paintMinimapViewport(
    ctx,
    { x: 140, y: 140, w: 0.01, h: 0.01 },
    colors,
  );
  assert.equal(target.w, 4);
  assert.equal(target.h, 4);
  assert.notDeepEqual(
    [...ctx.getImageData(140, 140, 1, 1).data],
    [255, 255, 255, 255],
  );
});

function overview(items) {
  const dom = new JSDOM(
    '<button data-action="minimap"></button><canvas id="canvas"></canvas><section id="minimap"></section>',
    { url: "https://whiteboard.test", pretendToBeVisual: true },
  );
  const w = dom.window,
    originals = Object.fromEntries(
      ["window", "document", "getComputedStyle", "localStorage"].map((k) => [
        k,
        globalThis[k],
      ]),
    );
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage,
  });
  let fills = 0;
  w.HTMLCanvasElement.prototype.getContext = function () {
    if (
      !this._native ||
      this._native.width !== this.width ||
      this._native.height !== this.height
    )
      this._native = createCanvas(this.width, this.height);
    const ctx = this._native.getContext("2d");
    if (!ctx.adapted) {
      const draw = ctx.drawImage,
        fill = ctx.fillRect;
      ctx.drawImage = function (image, ...args) {
        return draw.call(this, image._native || image, ...args);
      };
      ctx.fillRect = function (...args) {
        fills++;
        return fill.apply(this, args);
      };
      ctx.adapted = true;
    }
    return ctx;
  };
  let state = {
    board: { items },
    view: { x: 0, y: 0, z: 1 },
    narrowSearch: false,
  };
  const main = w.document.querySelector("#canvas");
  main.getBoundingClientRect = () => ({ width: 1000, height: 700 });
  let map;
  const draw = () => map.render(state.board.items);
  map = createMinimap({
    state: () => state,
    canvas: () => main,
    prepare() {},
    draw,
    fit() {},
    navigate(view) {
      state.view = view;
      draw();
    },
  });
  map.bind(w.document.querySelector("#minimap"));
  const canvas = w.document.querySelector("#minimap-canvas");
  canvas.getBoundingClientRect = () => ({
    left: 20,
    top: 30,
    width: 220,
    height: 148,
  });
  return {
    w,
    map,
    canvas,
    draw,
    state,
    fills: () => fills,
    close() {
      dom.window.close();
      Object.assign(globalThis, originals);
    },
  };
}

test("a 5,000-object overview is cached during camera movement and does no scene work when hidden", () => {
  let reads = 0;
  const items = Array.from(
    { length: 5000 },
    (_, n) =>
      new Proxy(
        {
          type: "rect",
          x: (n % 100) * 1000,
          y: Math.floor(n / 100) * 1000,
          w: 100,
          h: 100,
          color: "#f6e7a4",
        },
        {
          get(target, key) {
            reads++;
            if (["text", "src", "points", "cells"].includes(key))
              throw Error("Heavy overview access");
            return target[key];
          },
        },
      ),
  );
  const app = overview(items);
  try {
    app.draw();
    assert.equal(reads, 0);
    app.map.toggle();
    assert.ok(reads < 100000);
    assert.equal(app.canvas.width, 220);
    assert.equal(app.canvas.height, 148);
    const baseline = reads,
      painted = app.fills();
    for (let n = 0; n < 100; n++) {
      app.state.view.x -= 1;
      app.draw();
    }
    assert.equal(reads, baseline, "Panning reuses scene geometry");
    assert.equal(
      app.fills() - painted,
      100,
      "Only the viewport fill is repainted",
    );
    app.w.devicePixelRatio = 3;
    app.draw();
    assert.equal(app.canvas.width, 440, "Backing scale is capped at 2x");
    assert.equal(app.canvas.height, 296);
    assert.equal(reads, baseline, "Display scaling reuses scene geometry");
    app.w.document.documentElement.style.setProperty("--surface", "#101820");
    app.w.document.documentElement.dataset.theme = "dark";
    app.draw();
    assert.deepEqual(
      [...app.canvas.getContext("2d").getImageData(0, 0, 1, 1).data],
      [16, 24, 32, 255],
    );
    assert.equal(reads, baseline, "Theme changes reuse scene geometry");
    items[0].x = -5000;
    app.map.invalidate();
    app.draw();
    assert.ok(reads > baseline);
    app.map.toggle();
    const hidden = reads;
    app.draw();
    assert.equal(reads, hidden);
  } finally {
    app.close();
  }
});

test("minimap drags use a stable map, preserve zoom, and cancel back to the starting camera", () => {
  const app = overview([{ type: "rect", x: 0, y: 0, w: 5000, h: 3000 }]);
  try {
    app.map.toggle();
    const start = { ...app.state.view };
    const pointer = (type, x, y, pointerId = 1) => {
      const event = new app.w.MouseEvent(type, {
        clientX: x,
        clientY: y,
        bubbles: true,
        button: 0,
        cancelable: true,
      });
      Object.defineProperty(event, "pointerId", { value: pointerId });
      app.canvas.dispatchEvent(event);
    };
    pointer("pointerdown", 200, 130);
    const jumped = { ...app.state.view };
    assert.notDeepEqual(jumped, start);
    assert.equal(jumped.z, start.z);
    pointer("pointermove", 50, 50, 2);
    pointer("pointercancel", 50, 50, 2);
    assert.deepEqual(
      app.state.view,
      jumped,
      "Other pointers do not hijack a drag",
    );
    pointer("pointermove", 210, 140);
    const moved = { ...app.state.view };
    pointer("pointermove", 200, 130);
    near(app.state.view.x, jumped.x);
    near(app.state.view.y, jumped.y);
    pointer("pointercancel", 200, 130);
    assert.deepEqual(app.state.view, start);
    pointer("pointerdown", 200, 130);
    pointer("pointermove", 210, 140);
    pointer("pointerup", 210, 140);
    assert.deepEqual(app.state.view, moved);
    const saved = { ...app.state.view };
    app.state.narrowSearch = true;
    app.draw();
    assert.equal(app.w.document.querySelector("#minimap").hidden, true);
    app.state.narrowSearch = false;
    app.draw();
    assert.equal(app.w.document.querySelector("#minimap").hidden, false);
    assert.deepEqual(app.state.view, saved);
    pointer("pointerdown", 200, 130);
    pointer("pointermove", 50, 50);
    pointer("lostpointercapture", 50, 50);
    assert.deepEqual(app.state.view, saved);
    pointer("pointerdown", 200, 130);
    pointer("pointermove", 50, 50);
    app.state.board = { items: [] };
    app.state.view = { x: 100, y: 200, z: 0.5 };
    app.map.detach();
    pointer("pointercancel", 50, 50);
    assert.deepEqual(
      app.state.view,
      { x: 100, y: 200, z: 0.5 },
      "A stale gesture cannot restore another board's camera",
    );
  } finally {
    app.close();
  }
});

test("board shortcuts and clipboard events pass through a focused minimap; its own keys do not", () => {
  const a = overview([{ type: "rect", x: 0, y: 0, w: 100, h: 100 }]);
  try {
    const { w, canvas } = a;
    let reached = 0;
    w.document.addEventListener("keydown", () => reached++);
    w.document.addEventListener("copy", () => reached++);
    const key = (init) =>
      canvas.dispatchEvent(
        new w.KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    key({ key: "z", metaKey: true });
    assert.equal(reached, 1, "Undo reaches the board");
    key({ key: "Delete" });
    assert.equal(reached, 2, "Delete reaches the board");
    key({ key: "v" });
    assert.equal(reached, 3, "A tool letter reaches the board");
    canvas.dispatchEvent(new w.Event("copy", { bubbles: true }));
    assert.equal(reached, 4, "Copy reaches the board");
    key({ key: "ArrowLeft" });
    key({ key: "+" });
    key({ key: "Escape" });
    assert.equal(
      reached,
      4,
      "Panning, zooming and closing stay in the minimap",
    );
  } finally {
    a.close();
  }
});
