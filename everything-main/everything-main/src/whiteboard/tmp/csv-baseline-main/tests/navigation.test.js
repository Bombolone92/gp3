import test from "node:test";
import assert from "node:assert/strict";
import {
  createCanvasNavigation,
  createWheelNavigation,
  navigationMode,
  pinchView,
} from "../src/navigation.js";
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} ≈ ${b}`);
const base = { x: 90, y: 75, z: 1 };
const size = { width: 1000, height: 700, point: { x: 300, y: 200 } };
const scroll = (extra = {}) => ({
  deltaX: 0,
  deltaY: 40,
  deltaMode: 0,
  ...extra,
});

test("wheel modes normalize units, keep pinch anchors, and distinguish smooth scroll bursts from discrete wheels", () => {
  const wheel = createWheelNavigation();
  assert.deepEqual(
    wheel(base, scroll({ deltaX: 12, deltaY: 7 }), size, "auto", 0),
    { x: 78, y: 68, z: 1 },
  );
  assert.deepEqual(
    wheel(base, scroll({ deltaY: 100 }), size, "auto", 50),
    { x: 90, y: -25, z: 1 },
    "One burst stays trackpad",
  );
  const zoom = wheel(base, scroll({ deltaY: 100 }), size, "auto", 500);
  assert.ok(zoom.z < 1);
  near((size.point.x - zoom.x) / zoom.z, size.point.x - base.x);
  near((size.point.y - zoom.y) / zoom.z, size.point.y - base.y);
  assert.deepEqual(
    wheel(base, scroll({ deltaY: 3, deltaMode: 1 }), size, "trackpad"),
    { x: 90, y: 27, z: 1 },
  );
  assert.deepEqual(
    wheel(base, scroll({ deltaY: 1, deltaMode: 2 }), size, "trackpad"),
    { x: 90, y: -625, z: 1 },
  );
  assert.deepEqual(
    wheel(base, scroll({ deltaY: 10, shiftKey: true }), size, "mouse"),
    { x: 80, y: 75, z: 1 },
  );
  assert.ok(
    wheel(base, scroll({ ctrlKey: true, deltaY: -20 }), size, "trackpad").z > 1,
  );
  assert.ok(
    wheel(base, scroll({ metaKey: true, deltaY: -20 }), size, "trackpad").z > 1,
  );
  assert.equal(
    wheel(base, scroll({ ctrlKey: true, deltaY: -1e9 }), size, "mouse").z,
    3,
  );
  assert.equal(
    wheel(base, scroll({ ctrlKey: true, deltaY: 1e9 }), size, "mouse").z,
    0.15,
  );
  assert.equal(wheel(base, scroll({ deltaY: NaN }), size), base);
  assert.equal(navigationMode("anything"), "auto");
});

test("pinch geometry keeps the starting world point under the moving midpoint at both zoom limits", () => {
  const start = { center: { x: 200, y: 300 }, distance: 100 };
  for (const distance of [0, 50, 100, 250, 100000]) {
    const next = { center: { x: 250, y: 260 }, distance };
    const result = pinchView(base, start, next);
    near(
      (next.center.x - result.x) / result.z,
      (start.center.x - base.x) / base.z,
    );
    near(
      (next.center.y - result.y) / result.z,
      (start.center.y - base.y) / base.z,
    );
    assert.ok(result.z >= 0.15 && result.z <= 3);
  }
});

function setup(tool = "select") {
  const canvas = new EventTarget();
  canvas.getBoundingClientRect = () => ({
    left: 10,
    top: 20,
    width: 1000,
    height: 700,
  });
  const captures = new Set();
  canvas.setPointerCapture = (id) => captures.add(id);
  canvas.hasPointerCapture = (id) => captures.has(id);
  canvas.releasePointerCapture = (id) => captures.delete(id);
  const state = { board: {}, view: { ...base }, tool };
  let selected = ["kept"],
    editable = false,
    marquee = false,
    deferred = false;
  const calls = [];
  const nav = createCanvasNavigation({
    state: () => state,
    prepare() {},
    selection: () => [...selected],
    restoreSelection(value) {
      selected = [...value];
    },
    touchEdit: () => editable,
    canMarquee: () => marquee,
    deferTap: () => deferred,
    resetTap() {},
    begin(e, options) {
      calls.push(["begin", options]);
      selected = ["new"];
    },
    move() {
      calls.push(["move"]);
    },
    end() {
      calls.push(["end"]);
    },
    cancel() {
      calls.push(["cancel"]);
    },
    navigate(view) {
      state.view = view;
    },
  });
  nav.bind(canvas);
  const event = (type, id = 1, x = 100, y = 100, extra = {}) => {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, {
      pointerId: id,
      pointerType: "touch",
      clientX: x,
      clientY: y,
      button: 0,
      ...extra,
    });
    canvas.dispatchEvent(e);
    return e;
  };
  return {
    nav,
    state,
    event,
    calls,
    captures,
    canvas,
    selected: () => selected,
    edit: () => (editable = true),
    allowMarquee: (value = true) => (marquee = value),
    defer: (value = true) => (deferred = value),
  };
}

test("mouse and pen point tools begin only on their owned release", () => {
  for (const pointerType of ["mouse", "pen"])
    for (const tool of [
      "note",
      "text",
      "rect",
      "ellipse",
      "frame",
      "comment",
    ]) {
      const app = setup(tool);
      app.defer();
      app.event("pointerdown", 4, 100, 100, { pointerType });
      app.event("pointermove", 4, 140, 140, { pointerType });
      app.event("pointerup", 8, 140, 140, { pointerType });
      assert.deepEqual(app.calls, []);
      assert.deepEqual(app.selected(), ["kept"]);
      app.event("pointerup", 4, 140, 140, { pointerType });
      assert.deepEqual(
        app.calls.map((c) => c[0]),
        ["begin", "end"],
      );
      assert.equal(app.captures.size, 0);
      app.event("pointerup", 4, 140, 140, { pointerType });
      assert.equal(
        app.calls.length,
        2,
        "A delayed release cannot activate twice",
      );
    }
});

test("deferred point activation is discarded on cancellation and context changes", () => {
  for (const pointerType of ["mouse", "pen"])
    for (const abort of [
      (app) => app.event("pointercancel", 4),
      (app) => app.event("lostpointercapture", 4),
      (app) => app.nav.cancel(),
      (app) => app.nav.finish(),
      (app) => app.nav.detach(),
      (app) => {
        app.state.board = {};
      },
      (app) => {
        app.state.tool = "select";
      },
      (app) => app.defer(false),
      (app) => app.event("wheel", 4, 100, 100, scroll()),
    ]) {
      const app = setup("note");
      app.defer();
      app.event("pointerdown", 4, 100, 100, { pointerType });
      abort(app);
      const beforeRelease = app.calls.slice();
      app.event("pointerup", 4, 100, 100, { pointerType });
      assert.ok(beforeRelease.every((c) => c[0] === "end"));
      assert.deepEqual(
        app.calls,
        beforeRelease,
        "Release must not activate an aborted press",
      );
      assert.deepEqual(app.selected(), ["kept"]);
      assert.equal(app.captures.size, 0);
    }
});

test("point activation can leave and reenter the canvas but aborts an outside release", () => {
  for (const pointerType of ["mouse", "pen", "touch"])
    for (const [x, y] of [
      [9, 100],
      [1010, 100],
      [100, 19],
      [100, 720],
    ]) {
      const app = setup("note");
      app.defer();
      app.event("pointerdown", 4, 100, 100, { pointerType });
      app.event("pointerup", 4, x, y, { pointerType });
      assert.deepEqual(app.calls, [], `${pointerType} outside ${x},${y}`);
      assert.deepEqual(app.selected(), ["kept"]);
      assert.equal(app.captures.size, 0);
    }
  for (const pointerType of ["mouse", "pen"]) {
    const app = setup("note");
    app.defer();
    app.event("pointerdown", 4, 100, 100, { pointerType });
    app.event("pointermove", 4, 1100, 100, { pointerType });
    assert.deepEqual(app.calls, []);
    app.event("pointermove", 4, 100, 100, { pointerType });
    app.event("pointerup", 4, 100, 100, { pointerType });
    assert.deepEqual(
      app.calls.map((c) => c[0]),
      ["begin", "end"],
    );
  }
});

test("touch pan and pinch preserve content and selection across finger replacement and cancellation", () => {
  const app = setup();
  app.event("pointerdown");
  app.event("pointermove", 1, 130, 140);
  assert.deepEqual(app.state.view, { x: 120, y: 115, z: 1 });
  app.event("pointerdown", 2, 230, 140);
  const before = { ...app.state.view };
  app.event("pointermove", 2, 330, 140);
  assert.equal(app.state.view.z, 2);
  app.event("pointerdown", 3, 600, 600);
  const zoomed = { ...app.state.view };
  app.event("pointermove", 3, 610, 610);
  assert.deepEqual(
    app.state.view,
    zoomed,
    "A third pointer does not jump the camera",
  );
  app.event("pointerup", 1, 130, 140);
  const rebased = { ...app.state.view };
  app.event("pointermove", 2, 330, 140);
  assert.deepEqual(app.state.view, rebased);
  app.event("pointerup", 3, 610, 610);
  app.event("pointermove", 2, 350, 150);
  near(app.state.view.x, rebased.x + 20);
  near(app.state.view.y, rebased.y + 10);
  app.event("pointercancel", 2, 350, 150);
  assert.deepEqual(app.state.view, base);
  assert.deepEqual(app.selected(), ["kept"]);
  assert.deepEqual(app.calls, []);
  assert.equal(app.captures.size, 0);
  assert.notDeepEqual(before, base);
});

test("touch taps dispatch once, selected dragging can become a pinch, and long press starts selection", async () => {
  const app = setup();
  app.event("pointerdown");
  assert.deepEqual(app.calls, []);
  app.event("pointerup");
  assert.deepEqual(
    app.calls.map((x) => x[0]),
    ["begin", "end"],
  );
  app.calls.length = 0;
  app.edit();
  app.event("pointerdown");
  app.event("pointermove", 1, 120, 130);
  assert.deepEqual(
    app.calls.map((x) => x[0]),
    ["begin", "move"],
  );
  app.event("pointerdown", 2, 300, 200);
  assert.equal(app.calls.at(-1)[0], "cancel");
  app.event("pointerup", 2, 300, 200);
  app.event("pointerup", 1, 120, 130);
  app.calls.length = 0;
  app.event("pointerdown");
  await new Promise((resolve) => setTimeout(resolve, 530));
  assert.deepEqual(app.calls, [["begin", { marquee: true, precise: true }]]);
  app.event("pointermove", 1, 400, 300);
  app.event("pointerup", 1, 400, 300);
  assert.deepEqual(
    app.calls.map((x) => x[0]),
    ["begin", "move", "end"],
  );
});

test("creation tools defer taps for pinching and cancelled drawing never finishes", () => {
  for (const tool of [
    "note",
    "rect",
    "text",
    "ellipse",
    "frame",
    "pen",
    "arrow",
  ]) {
    const app = setup(tool);
    app.event("pointerdown");
    app.event("pointerdown", 2, 300, 300);
    app.event("pointermove", 2, 350, 350);
    app.event("pointerup", 2, 350, 350);
    app.event("pointerup");
    assert.ok(!app.calls.some((x) => x[0] === "end"));
    if (["pen", "arrow"].includes(tool))
      assert.deepEqual(
        app.calls.map((x) => x[0]),
        ["begin", "cancel"],
      );
    else assert.deepEqual(app.calls, []);
    assert.deepEqual(app.selected(), ["kept"]);
  }
});

test("pointer ownership ignores palm touches and unrelated cancellation; stale board events cannot restore an old camera", () => {
  const app = setup("pen");
  app.event("pointerdown", 4, 100, 100, { pointerType: "pen" });
  app.event("pointerdown", 2, 200, 200);
  app.event("pointermove", 2, 250, 250);
  app.event("pointercancel", 2, 250, 250);
  app.event("pointermove", 4, 130, 130, { pointerType: "pen" });
  assert.deepEqual(
    app.calls.map((x) => x[0]),
    ["begin", "move"],
  );
  app.event("lostpointercapture", 4, 130, 130, { pointerType: "pen" });
  assert.equal(app.calls.at(-1)[0], "cancel");
  app.state.tool = "select";
  app.event("pointerdown");
  app.event("pointermove", 1, 200, 200);
  app.state.board = {};
  app.state.view = { x: 500, y: 400, z: 2 };
  app.event("pointercancel");
  assert.deepEqual(app.state.view, { x: 500, y: 400, z: 2 });
  app.nav.detach();
  app.event("pointerdown");
  app.event("wheel", 1, 300, 300, scroll({ ctrlKey: true }));
  assert.deepEqual(
    app.state.view,
    { x: 500, y: 400, z: 2 },
    "Detached surfaces ignore delayed input",
  );
});

test("Safari gesture zoom suppresses duplicate wheel zoom and handles missing pointer coordinates", () => {
  const app = setup();
  app.event("gesturestart", 1, undefined, undefined, {
    clientX: undefined,
    clientY: undefined,
    scale: 1,
  });
  app.event("gesturechange", 1, undefined, undefined, { scale: 2 });
  assert.equal(app.state.view.z, 2);
  const before = { ...app.state.view };
  app.event("wheel", 1, 300, 300, scroll({ deltaY: -20, ctrlKey: true }));
  assert.deepEqual(app.state.view, before);
  app.nav.cancel();
  assert.deepEqual(app.state.view, base);
  app.nav.storage({ key: "whiteboard-navigation", newValue: "mouse" });
  assert.equal(app.nav.mode(), "mouse");
  app.nav.storage({ key: "whiteboard-navigation", newValue: "garbage" });
  assert.equal(app.nav.mode(), "auto");
});

test("mouse holds enter precise selection only while stationary, eligible and owned by the same gesture", (ctx) => {
  ctx.mock.timers.enable({ apis: ["setTimeout"] });
  const app = setup();
  app.allowMarquee();
  const mouse = (type, x = 100, y = 100, extra = {}) =>
    app.event(type, 1, x, y, { pointerType: "mouse", ...extra });
  mouse("pointerdown");
  ctx.mock.timers.tick(499);
  assert.equal(app.calls.length, 1);
  ctx.mock.timers.tick(1);
  assert.deepEqual(app.calls.at(-1), [
    "begin",
    { marquee: true, precise: true },
  ]);
  mouse("pointerup");
  for (const cancel of [
    () => mouse("pointermove", 104, 100),
    () => mouse("pointerup"),
    () => mouse("pointercancel"),
    () => app.allowMarquee(false),
    () => {
      app.state.board = {};
    },
    () => app.nav.finish(),
  ]) {
    app.allowMarquee();
    app.calls.length = 0;
    mouse("pointerdown");
    cancel();
    ctx.mock.timers.tick(600);
    assert.ok(!app.calls.some((c) => c[1]?.precise));
    app.nav.cancel();
  }
  for (const extra of [{ altKey: true }, { button: 1 }, { button: 2 }]) {
    app.calls.length = 0;
    mouse("pointerdown", 100, 100, extra);
    ctx.mock.timers.tick(600);
    assert.ok(!app.calls.some((c) => c[1]?.precise));
    app.nav.cancel();
  }
  app.nav.detach();
});

test("the minimap zooms with the wheel at the canvas's rates", async () => {
  const { wheelZoom, createWheelNavigation } =
    await import("../src/navigation.js");
  const view = { x: 0, y: 0, z: 1 },
    point = { x: 500, y: 400 },
    size = { width: 1000, height: 800, point };
  for (const event of [
    { deltaY: 100, deltaX: 0, deltaMode: 0 },
    { deltaY: 3, deltaX: 0, deltaMode: 1 },
    { deltaY: 1, deltaX: 0, deltaMode: 2 },
    { deltaY: 12, deltaX: 0, deltaMode: 0, ctrlKey: true },
  ]) {
    const canvas = createWheelNavigation()(view, event, size, "mouse");
    const map = wheelZoom(view, event, point, size.height);
    assert.ok(Math.abs(map.z - canvas.z) < 1e-9, JSON.stringify(event));
  }
  assert.equal(wheelZoom(view, { deltaY: 0 }, point, 800), view);
  assert.equal(wheelZoom(view, { deltaY: NaN }, point, 800), view);
});
