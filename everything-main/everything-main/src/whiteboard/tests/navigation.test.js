import test from "node:test";
import assert from "node:assert/strict";
import {
  createCanvasNavigation,
  createWheelNavigation,
  navigationMode,
  pinchView,
  wheelZoom,
  busiestPart,
} from "../src/navigation.js";
import { MIN_ZOOM } from "../src/model.js";
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
  // A notch set to scroll by a page zooms by one step, not by the whole
  // height of the canvas.
  near(
    wheel(base, scroll({ deltaY: 1, deltaMode: 2 }), size, "mouse").z,
    Math.exp(-120 * 0.002),
  );
  near(
    wheelZoom(base, scroll({ deltaY: 1, deltaMode: 2 }), size.point, 700).z,
    Math.exp(-120 * 0.002),
  );
  near(
    wheelZoom(base, scroll({ deltaY: 3, deltaMode: 1 }), size.point, 700).z,
    Math.exp(-48 * 0.002),
    "Lines keep their finer steps",
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
    MIN_ZOOM,
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
    assert.ok(result.z >= MIN_ZOOM && result.z <= 3);
  }
});

function setup(tool = "select", { sizes = false } = {}) {
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
    deferred = false,
    continuing = false,
    navigations = 0,
    prepared = 0,
    penNotices = 0,
    penOnly = true;
  const calls = [];
  const nav = createCanvasNavigation({
    state: () => state,
    prepare() {
      prepared++;
    },
    penOnly: () => penOnly,
    penStarted() {
      penNotices++;
    },
    selection: () => [...selected],
    restoreSelection(value) {
      selected = [...value];
    },
    touchEdit: () => editable,
    pressesSelection: () => editable,
    // As the app answers: tools that draw an object at a dragged size.
    ...(sizes
      ? {
          sizes: () =>
            ["note", "text", "rect", "ellipse", "frame"].includes(tool),
        }
      : {}),
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
    continues: () => continuing,
    navigate(view) {
      navigations++;
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
    // As in browsers, capture is already gone when its loss is announced.
    if (type === "lostpointercapture") captures.delete(id);
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
    edit: (value = true) => (editable = value),
    allowMarquee: (value = true) => (marquee = value),
    defer: (value = true) => (deferred = value),
    continues: (value = true) => (continuing = value),
    navigations: () => navigations,
    prepared: () => prepared,
    penNotices: () => penNotices,
    penOnly: (value = true) => (penOnly = value),
  };
}

test("a wheel during a mouse drag moves the view under the drag, which goes on to its release", () => {
  for (const pointerType of ["mouse", "pen"]) {
    const app = setup();
    app.continues();
    app.event("pointerdown", 4, 100, 100, { pointerType });
    app.event("pointermove", 4, 140, 140, { pointerType });
    app.event("wheel", 4, 140, 140, scroll({ deltaY: 30 }));
    assert.equal(app.navigations(), 1);
    assert.deepEqual(app.calls, [["begin", undefined], ["move"]]);
    app.event("pointermove", 4, 150, 150, { pointerType });
    app.event("pointerup", 4, 150, 150, { pointerType });
    assert.deepEqual(app.calls, [
      ["begin", undefined],
      ["move"],
      ["move"],
      ["end"],
    ]);
  }
  // A gesture without a pointer to follow, such as a pen stroke, finishes.
  const app = setup();
  app.event("pointerdown", 4, 100, 100, { pointerType: "mouse" });
  app.event("wheel", 4, 100, 100, scroll({ deltaY: 30 }));
  assert.deepEqual(app.calls[0], ["begin", undefined]);
  assert.ok(app.calls.slice(1).every((c) => c[0] === "end"));
  assert.equal(app.navigations(), 1);
  // Touch drags are not continued by a wheel.
  const touch = setup();
  touch.continues();
  touch.edit();
  touch.event("pointerdown", 4, 100, 100);
  touch.event("pointermove", 4, 140, 140);
  touch.event("wheel", 4, 140, 140, scroll({ deltaY: 30 }));
  assert.equal(touch.calls.at(-1)[0], "move");
  assert.equal(touch.navigations(), 0);
});

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
  // A long press on the selection waits for a drag that moves it.
  app.event("pointerdown");
  await new Promise((resolve) => setTimeout(resolve, 530));
  assert.deepEqual(app.calls, []);
  app.event("pointercancel");
  app.edit(false);
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

test("a pen landing after a palm takes over from the finger, whose stroke is dropped", () => {
  const app = setup("pen");
  // The palm began a stroke with the pen tool; the pen then lands.
  app.event("pointerdown", 2, 200, 200);
  app.event("pointermove", 2, 203, 202);
  assert.deepEqual(
    app.calls.map((x) => x[0]),
    ["begin", "move"],
  );
  app.event("pointerdown", 4, 100, 100, { pointerType: "pen" });
  app.event("pointermove", 4, 130, 130, { pointerType: "pen" });
  assert.deepEqual(
    app.calls.map((x) => x[0]),
    ["begin", "move", "cancel", "begin", "move"],
  );
  // The palm's own movement and release no longer reach the board.
  app.event("pointermove", 2, 260, 260);
  app.event("pointerup", 2, 260, 260);
  assert.deepEqual(
    app.calls.slice(3).map((x) => x[0]),
    ["begin", "move"],
  );
  app.event("pointerup", 4, 140, 140, { pointerType: "pen" });
  assert.equal(app.calls.at(-1)[0], "end");
});

test("after a pen, a finger or palm only moves the view: it draws, selects, places and closes nothing", () => {
  for (const tool of ["pen", "select", "rect"]) {
    const app = setup(tool, { sizes: true });
    app.edit();
    app.allowMarquee();
    app.defer(tool === "rect");
    const pen = { pointerType: "pen" };
    app.event("pointerdown", 4, 100, 100, pen);
    app.event("pointerup", 4, 100, 100, pen);
    assert.equal(app.penNotices(), 1, "The change is announced");
    const before = app.calls.length,
      prepared = app.prepared();
    // A palm resting between strokes, wobbling a little, then lifted.
    app.event("pointerdown", 2, 300, 300);
    app.event("pointermove", 2, 303, 302);
    app.event("pointerup", 2, 303, 302);
    assert.deepEqual(app.calls.slice(before), [], tool);
    assert.equal(app.prepared(), prepared, "Nothing open is closed");
    assert.deepEqual(app.state.view, base);
    // A finger moved on pans, as on empty board.
    app.event("pointerdown", 3, 300, 300);
    app.event("pointermove", 3, 340, 320);
    app.event("pointerup", 3, 340, 320);
    assert.deepEqual(app.calls.slice(before), [], tool);
    assert.deepEqual(app.state.view, {
      ...base,
      x: base.x + 40,
      y: base.y + 20,
    });
    assert.equal(app.prepared(), prepared + 1);
    // Two fingers still zoom.
    app.event("pointerdown", 5, 300, 300);
    app.event("pointerdown", 6, 400, 300);
    app.event("pointermove", 6, 500, 300);
    assert.ok(app.state.view.z > 1);
    app.event("pointerup", 6, 500, 300);
    app.event("pointerup", 5, 300, 300);
    // A palm that drifted far enough to pan is put back when the pen lands.
    const view = { ...app.state.view };
    app.event("pointerdown", 2, 300, 300);
    app.event("pointermove", 2, 330, 330);
    assert.notDeepEqual(app.state.view, view);
    app.event("pointerdown", 4, 120, 120, pen);
    assert.deepEqual(app.state.view, view);
    app.event("pointerup", 4, 120, 120, pen);
    assert.ok(app.calls.slice(before).some(([call]) => call === "begin"));
    assert.equal(app.penNotices(), 1, "once");
  }
});

test("with fingers left to draw after a pen, a finger draws as before; turning it back on takes effect at once", () => {
  const app = setup("pen");
  app.penOnly(false);
  const pen = { pointerType: "pen" };
  app.event("pointerdown", 4, 100, 100, pen);
  app.event("pointerup", 4, 100, 100, pen);
  assert.equal(app.penNotices(), 0, "Nothing to announce");
  app.calls.length = 0;
  app.event("pointerdown", 2, 300, 300);
  app.event("pointermove", 2, 310, 310);
  app.event("pointerup", 2, 310, 310);
  assert.deepEqual(
    app.calls.map(([call]) => call),
    ["begin", "move", "end"],
  );
  app.penOnly(true);
  app.calls.length = 0;
  app.event("pointerdown", 2, 300, 300);
  app.event("pointermove", 2, 303, 302);
  app.event("pointerup", 2, 303, 302);
  assert.deepEqual(app.calls, []);
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
  // Capture lost during a pen or mouse gesture ends it, keeping what was
  // drawn; WebKit delivers no release to the canvas for one made outside it.
  app.event("lostpointercapture", 4, 130, 130, { pointerType: "pen" });
  assert.equal(app.calls.at(-1)[0], "end");
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
  // A press on the current selection drags it after any pause.
  app.edit();
  app.calls.length = 0;
  mouse("pointerdown");
  ctx.mock.timers.tick(600);
  assert.ok(!app.calls.some((c) => c[1]?.precise));
  app.nav.cancel();
  app.edit(false);
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

test("a finger dragged with a note, text, shape or frame tool draws it; other tools and two fingers pan", () => {
  for (const tool of ["note", "text", "rect", "ellipse", "frame"]) {
    const app = setup(tool, { sizes: true });
    app.event("pointerdown", 1, 100, 100);
    app.event("pointermove", 1, 104, 103);
    assert.deepEqual(app.calls, [], "a wobble draws nothing yet");
    app.event("pointermove", 1, 180, 160);
    app.event("pointerup", 1, 180, 160);
    assert.deepEqual(app.calls, [["begin", { size: true }], ["move"], ["end"]]);
    assert.equal(app.navigations(), 0);
  }
  const hand = setup("hand", { sizes: true });
  hand.event("pointerdown", 1, 100, 100);
  hand.event("pointermove", 1, 180, 160);
  assert.equal(hand.navigations(), 1);
  assert.deepEqual(hand.calls, []);
  // A second finger landing before the first moves far pinches instead.
  const pinch = setup("note", { sizes: true });
  pinch.event("pointerdown", 1, 100, 100);
  pinch.event("pointerdown", 2, 300, 100);
  pinch.event("pointermove", 2, 340, 100);
  assert.deepEqual(pinch.calls, []);
  assert.ok(pinch.navigations() > 0);
});

test("the busiest part of a spread-out board is the block of view-sized cells holding the most objects", () => {
  const at = (x, y) => ({ x, y, w: 100, h: 100 });
  const west = [at(-400000, 0)],
    // Either side of a cell edge, still one view apart at most.
    east = [at(399000, 0), at(401000, 0), at(400000, 30000)];
  assert.deepEqual(busiestPart([...west, ...east], 100000, 60000), east);
  // A tie goes to the part met first.
  assert.deepEqual(
    busiestPart([at(-400000, 0), at(400000, 0)], 100000, 60000),
    [at(-400000, 0)],
  );
  assert.deepEqual(busiestPart([], 100000, 60000), []);
});
