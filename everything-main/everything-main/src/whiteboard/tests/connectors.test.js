import test from "node:test";
import assert from "node:assert/strict";
import { item, board, validateBoard, bounds, hitTest } from "../src/model.js";
import {
  updateConnectors,
  moveItems,
  duplicateItems,
  alignItems,
} from "../src/scene.js";
import {
  connectorPath,
  connectorSegments,
  connectorLabel,
  connectorEndpointHit,
  setConnectorEnd,
} from "../src/connectors.js";
import { selectionFragment } from "../src/transfer.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { drawObject } from "../src/render.js";
import { createCanvas } from "./canvas.js";

test("straight, elbow and curved paths hit their visible geometry in every direction", () => {
  for (const w of [-400, 0, 400])
    for (const h of [-240, 0, 240]) {
      for (const lineType of ["straight", "elbow", "curved"]) {
        const i = item("arrow", 500, 400, { w, h, lineType });
        const points = connectorSegments(i, 0.2);
        for (const p of points) assert.equal(hitTest([i], p, 0.5), i);
        assert.ok(points.length <= 4097);
        assert.equal(hitTest([i], { x: 2000, y: 2000 }), null);
      }
    }
  const elbow = item("arrow", 0, 0, { w: 400, h: 240, lineType: "elbow" });
  assert.equal(hitTest([elbow], { x: 100, y: 0 }), elbow);
  assert.equal(
    hitTest([elbow], { x: 100, y: 60 }),
    null,
    "old diagonal is no longer clickable",
  );
  const curve = { ...elbow, lineType: "curved" };
  // Exact cubic at t=1/4: [0,0], [200,0], [200,240], [400,240].
  assert.equal(hitTest([curve], { x: 118.75, y: 37.5 }, 0.2), curve);
  assert.equal(hitTest([curve], { x: 100, y: 60 }, 1), null);
  assert.ok(
    connectorSegments({ ...curve, w: 1e6, h: 1e6 }, 0.01).length <= 4097,
  );
});

test("a line attached at one end moves whole when it moves with its object", () => {
  const make = () => {
    const a = item("rect", 0, 0, { w: 100, h: 80 }),
      far = item("rect", 600, 400, { w: 100, h: 80 }),
      line = item("arrow", 50, 40, { w: 250, h: 0, startId: a.id }),
      items = [a, far, line];
    updateConnectors(items);
    return { a, far, line, items };
  };
  const end = (line) => [line.x + line.w, line.y + line.h];
  // Moved together (dragged, nudged or moved as a group), the loose end
  // keeps its place relative to the object.
  let { a, far, line, items } = make();
  const free = end(line);
  moveItems(items, new Set([a.id, line.id]), 40, 160);
  assert.deepEqual(end(line), [free[0] + 40, free[1] + 160]);
  assert.equal(line.startId, a.id);
  assert.equal(line.x, a.x + a.w);
  // Aligned with another object, it follows its object's offset.
  ({ a, far, line, items } = make());
  alignItems(items, new Set([a.id, line.id, far.id]), "bottom");
  assert.equal(a.y, 400);
  assert.deepEqual(end(line), [free[0], free[1] + 400]);
  // Left behind, its loose end stays where it was.
  ({ a, far, line, items } = make());
  moveItems(items, new Set([a.id]), 40, 160);
  assert.deepEqual(end(line), free);
  // A line joining two objects is still redrawn from both.
  ({ a, far, line, items } = make());
  line.endId = far.id;
  updateConnectors(items);
  moveItems(items, new Set([a.id, line.id]), 0, 200);
  const [x, y] = end(line);
  assert.ok(
    x >= far.x && x <= far.x + far.w && y >= far.y && y <= far.y + far.h,
  );
  assert.ok(
    [far.x, far.x + far.w].includes(x) || [far.y, far.y + far.h].includes(y),
    "the end stays on the far object's edge",
  );
});

test("elbow and curved lines between a staircase of boxes stay outside both", () => {
  // The boxes overlap across but are clear of each other up and down, so
  // the line goes down from one to the other rather than across through
  // both.
  const a = item("rect", 100, 100, { w: 300, h: 80 }),
    b = item("rect", 320, 260, { w: 300, h: 80 });
  const inside = (p, o) =>
    p.x > o.x + 0.5 &&
    p.x < o.x + o.w - 0.5 &&
    p.y > o.y + 0.5 &&
    p.y < o.y + o.h - 0.5;
  for (const lineType of ["elbow", "curved"]) {
    const line = item("arrow", 0, 0, { startId: a.id, endId: b.id, lineType });
    updateConnectors([a, b, line]);
    assert.equal(line.routeAxis, "y");
    assert.deepEqual([line.x, line.y], [a.x + a.w / 2, a.y + a.h]);
    assert.deepEqual([line.x + line.w, line.y + line.h], [b.x + b.w / 2, b.y]);
    const points = connectorSegments(line, 0.5);
    for (let n = 1; n < points.length; n++)
      for (let t = 0; t <= 1; t += 0.05) {
        const p = {
          x: points[n - 1].x + (points[n].x - points[n - 1].x) * t,
          y: points[n - 1].y + (points[n].y - points[n - 1].y) * t,
        };
        assert.ok(
          !inside(p, a) && !inside(p, b),
          `${lineType} at ${p.x},${p.y}`,
        );
      }
  }
  // Boxes clear of each other both ways still take the longer way.
  const c = item("rect", 600, 0, { w: 100, h: 80 });
  const across = item("arrow", 0, 0, {
    startId: a.id,
    endId: c.id,
    lineType: "elbow",
  });
  updateConnectors([a, c, across]);
  assert.equal(across.routeAxis, "x");
});

test("partial attachments follow their node, retain their free end and anchor to ellipse boundaries", () => {
  const a = item("ellipse", 0, 0, { w: 100, h: 80 });
  const b = item("rect", 400, 280, { w: 100, h: 80 });
  const line = item("arrow", 50, 40, { w: 400, h: 280, startId: a.id });
  const items = [a, b, line];
  updateConnectors(items);
  assert.ok(
    Math.abs(((line.x - 50) / 50) ** 2 + ((line.y - 40) / 40) ** 2 - 1) < 1e-9,
  );
  const free = [line.x + line.w, line.y + line.h];
  moveItems(items, new Set([a.id]), 25, 30);
  assert.deepEqual([line.x + line.w, line.y + line.h], free);
  setConnectorEnd(line, "end", { x: 450, y: 320 }, b);
  line.lineType = "elbow";
  updateConnectors(items);
  assert.equal(line.routeAxis, "x");
  assert.equal(line.x, a.x + a.w);
  assert.equal(line.y, a.y + a.h / 2);
  assert.equal(connectorPath(line)[1].y, line.y);
  const before = structuredClone(line);
  setConnectorEnd(line, "start", { x: -100, y: -50 }, null);
  updateConnectors(items);
  assert.equal(line.startId, undefined);
  assert.equal(line.endId, b.id);
  assert.equal(line.x, -100);
  assert.equal(line.y, -50);
  assert.notEqual(line.w, before.w);
  const file = { ...board(), items };
  assert.equal(validateBoard(file), file);
  for (const zoom of [0.15, 1, 3]) {
    assert.equal(
      connectorEndpointHit(line, { x: line.x + 8 / zoom, y: line.y }, zoom),
      "start",
    );
    assert.equal(
      connectorEndpointHit(line, { x: line.x + 12 / zoom, y: line.y }, zoom),
      null,
    );
  }
});

test("line styles and partial connections survive clipboard, duplication and shared document round trips", () => {
  const a = item("rect", 0, 0);
  const line = item("arrow", 190, 80, {
    w: 200,
    h: 100,
    startId: a.id,
    lineType: "curved",
    lineStyle: "dashed",
    lineWidth: 6,
    startCap: "circle",
    endCap: "none",
    text: "Approved\nNext step",
  });
  const items = [a, line];
  updateConnectors(items);
  assert.equal(
    selectionFragment(items, new Set([line.id]))[0].startId,
    undefined,
  );
  assert.equal(
    selectionFragment(items, new Set([a.id, line.id]))[1].startId,
    a.id,
  );
  const ids = duplicateItems(items, new Set([a.id, line.id]));
  const copies = items.filter((i) => ids.has(i.id));
  assert.equal(copies[1].startId, copies[0].id);
  const file = { ...board(), items };
  validateBoard(file);
  const shared = new SharedDocument();
  shared.commit(file);
  const remote = new SharedDocument(shared.update());
  try {
    remote.validate();
    assert.deepEqual(remote.snapshot().items, items);
    const changed = remote.snapshot();
    changed.items[1].lineType = "elbow";
    changed.items[1].startCap = "arrow";
    remote.commit(changed);
    assert.equal(remote.snapshot().items[1].lineType, "elbow");
    remote.undo.undo();
    assert.equal(remote.snapshot().items[1].lineType, "curved");
  } finally {
    shared.destroy();
    remote.destroy();
  }
});

test("a shared board lists the connectors on an object and their other ends as they change", () => {
  const at = (id, type, extra) => ({ ...item(type, 0, 0, extra), id });
  const file = {
    ...board(),
    items: [
      at("a", "rect"),
      at("b", "rect"),
      at("e", "rect"),
      at("c", "arrow", { startId: "a", endId: "b" }),
      at("d", "arrow", { endId: "a" }),
    ],
  };
  const shared = new SharedDocument(),
    remote = new SharedDocument();
  const related = (id, room = 100) => {
    const out = new Array(room);
    return out.slice(0, shared.related(id, out, 0)).sort();
  };
  try {
    shared.commit(file);
    assert.deepEqual(related("a"), ["b", "c", "d"]);
    assert.deepEqual(related("b"), ["a", "c"]);
    assert.deepEqual(related("c"), []);
    assert.equal(related("a", 2).length, 2, "No more than there is room for");
    // A connector moved to another object, here by someone else.
    remote.apply(shared.update());
    const next = remote.snapshot();
    next.items.find((i) => i.id === "c").endId = "e";
    remote.commit(next);
    shared.apply(remote.update());
    assert.deepEqual(related("b"), []);
    assert.deepEqual(related("e"), ["a", "c"]);
    const fewer = shared.snapshot();
    fewer.items = fewer.items.filter((i) => i.id !== "d");
    shared.commit(fewer);
    assert.deepEqual(related("a"), ["c", "e"]);
  } finally {
    shared.destroy();
    remote.destroy();
  }
});

test("line validation rejects unsafe style fields and invalid attachment targets", () => {
  for (const extra of [
    { lineWidth: 0 },
    { lineWidth: 99 },
    { lineWidth: NaN },
    { lineType: "url(x)" },
    { lineStyle: "unknown" },
    { startCap: {} },
    { endCap: "bad" },
    { routeAxis: "z" },
    { startId: "missing" },
  ]) {
    assert.throws(() =>
      validateBoard({ ...board(), items: [item("arrow", 0, 0, extra)] }),
    );
  }
});

test("renderer paints routed strokes, independent caps, multiline labels and exports their full bounds", () => {
  const canvas = createCanvas(640, 480),
    ctx = canvas.getContext("2d");
  const i = item("arrow", 60, 100, {
    w: 400,
    h: 180,
    lineType: "elbow",
    lineWidth: 6,
    lineStyle: "solid",
    color: "#cc2244",
    endCap: "none",
  });
  drawObject(ctx, i, "#30342f", () => {});
  assert.ok(ctx.getImageData(100, 100, 1, 1).data[3] > 0);
  assert.equal(ctx.getImageData(100, 118, 1, 1).data[3], 0);
  ctx.clearRect(0, 0, 640, 480);
  i.lineStyle = "dashed";
  i.startCap = "circle";
  drawObject(ctx, i, "#30342f", () => {});
  assert.ok(ctx.getImageData(60, 104, 1, 1).data[3] > 0);
  assert.equal(ctx.getImageData(90, 100, 1, 1).data[3], 0);
  i.text = "Approved\nNext step";
  i.textColor = "#2244cc";
  i.h = 0;
  drawObject(ctx, i, "#30342f", () => {});
  const label = connectorLabel(i),
    b = bounds([i]);
  assert.ok(b.y < i.y && b.y + b.h > i.y);
  assert.equal(hitTest([i], { x: label.x + 2, y: label.y + 2 }), i);
  const pixels = ctx.getImageData(label.x, label.y, label.w, label.h).data;
  let blue = 0;
  for (let n = 0; n < pixels.length; n += 4)
    if (pixels[n + 2] > pixels[n] + 30 && pixels[n + 2] > pixels[n + 1] + 30)
      blue++;
  assert.ok(blue > 20, "label text appears on the actual canvas");
});

test("formatted connector labels are measured once, not on every repaint", () => {
  const ctx = createCanvas(800, 600).getContext("2d");
  const measure = ctx.measureText.bind(ctx);
  let calls = 0;
  ctx.measureText = (text) => (calls++, measure(text));
  const text = "Depends on the quarterly review and budget approval";
  const arrow = item("arrow", 0, 0, {
    w: 400,
    h: 0,
    text,
    textRuns: [{ start: 0, end: 7, style: { bold: true } }],
  });
  drawObject(ctx, arrow, "#30342f");
  calls = 0;
  drawObject(ctx, arrow, "#30342f");
  assert.equal(calls, 0);
  // A changed label is measured again.
  arrow.text = "Depends on the review";
  drawObject(ctx, arrow, "#30342f");
  assert.ok(calls > 0);
});

test("connector endpoints reach further for a finger than for a pointer", () => {
  const line = item("arrow", 100, 100, { w: 200, h: 0 });
  for (const zoom of [0.5, 1, 2]) {
    const p = { x: line.x + 18 / zoom, y: line.y };
    assert.equal(connectorEndpointHit(line, p, zoom), null);
    assert.equal(connectorEndpointHit(line, p, zoom, true), "start");
    const end = { x: line.x + line.w - 18 / zoom, y: line.y + line.h };
    assert.equal(connectorEndpointHit(line, end, zoom, true), "end");
    assert.equal(
      connectorEndpointHit(
        line,
        { x: line.x + 24 / zoom, y: line.y },
        zoom,
        true,
      ),
      null,
    );
  }
});
