import test from "node:test";
import assert from "node:assert/strict";
import { board, item, validateBoard, hitTest } from "../src/model.js";
import {
  CUSTOM_SHAPES,
  SHAPES,
  shapeAnchor,
  shapeContains,
  shapeDefaults,
  shapeTextBox,
  switchShape,
} from "../src/shapes.js";
import { shapeTextLayout, textStyle } from "../src/text.js";
import { drawObject } from "../src/render.js";
import { updateConnectors, moveItems, duplicateItems } from "../src/scene.js";
import { createResizePlan, applyResize } from "../src/resize.js";
import { selectionFragment } from "../src/transfer.js";
import { SharedDocument } from "../src/collaboration/document.js";
import { createSearchIndex, searchIndex } from "../src/board-search.js";
import { createCanvas } from "./canvas.js";
import { hasBorder } from "../src/shape-specs.js";

test("custom shapes validate and only hit their visible silhouette", () => {
  const background = item("rect", 0, 0, { w: 200, h: 160 });
  for (const shape of CUSTOM_SHAPES) {
    const i = item("rect", 0, 0, { w: 200, h: 160, shape });
    validateBoard({ ...board(), items: [i] });
    assert.equal(hitTest([background, i], { x: 100, y: 80 }), i, shape);
    assert.equal(hitTest([background, i], { x: 1, y: 1 }), background, shape);
    assert.equal(hitTest([i], { x: 201, y: 80 }), null);
  }
  for (const shape of ["unknown", "rectangle", "ellipse", {}, 4]) {
    assert.throws(
      () => validateBoard({ ...board(), items: [{ ...background, shape }] }),
      /Invalid shape/,
    );
  }
  assert.throws(
    () =>
      validateBoard({
        ...board(),
        items: [{ ...background, type: "note", shape: "diamond" }],
      }),
    /Invalid shape/,
  );
  const items = [
    background,
    { ...background, id: "diamond", shape: "diamond" },
    item("ellipse", 0, 0),
    item("note", 0, 0),
  ];
  const index = createSearchIndex(items);
  assert.equal(searchIndex(index, "", "shape").length, 3);
  assert.deepEqual(
    searchIndex(index, "", "rect").map((e) => e.item.id),
    [background.id],
  );
});

test("connector anchors reach each silhouette in every direction and aspect ratio", () => {
  for (const shape of CUSTOM_SHAPES) {
    for (const [w, h] of [
      [200, 160],
      [30, 900],
      [900, 30],
      [1e6, 1],
    ]) {
      const i = item("rect", -300, 50, { w, h, shape });
      for (let n = 0; n < 72; n++) {
        const angle = (n * Math.PI) / 36;
        const cx = i.x + w / 2,
          cy = i.y + h / 2;
        const p = shapeAnchor(i, {
          x: cx + Math.cos(angle) * w,
          y: cy + Math.sin(angle) * h,
        });
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), shape);
        const dx = p.x - cx,
          dy = p.y - cy;
        assert.ok(
          shapeContains(i, w / 2 + dx * 0.99999, h / 2 + dy * 0.99999),
          `${shape} inside ${n}`,
        );
        assert.equal(
          shapeContains(i, w / 2 + dx * 1.00001, h / 2 + dy * 1.00001),
          false,
          `${shape} outside ${n}`,
        );
      }
    }
    const tiny = item("rect", -100, -100, { w: 200, h: 200, shape });
    const p = shapeAnchor(tiny, { x: 1e-30, y: -1e-30 });
    assert.ok(
      Number.isFinite(p.x) && Number.isFinite(p.y),
      "Near-coincident centers remain finite",
    );
    assert.deepEqual(shapeAnchor(tiny, { x: 0, y: 0 }), { x: 0, y: 0 });
  }
});

test("shape pixels agree with hit geometry and text stays inside the safe region", () => {
  for (const shape of CUSTOM_SHAPES) {
    const i = item("rect", 10, 10, { w: 240, h: 180, shape, color: "#ffffff" });
    const canvas = createCanvas(260, 200),
      ctx = canvas.getContext("2d");
    drawObject(ctx, i, "#30342f", () => {});
    for (let y = 3; y < i.h - 3; y += 9)
      for (let x = 3; x < i.w - 3; x += 9) {
        // Skip antialiasing on the boundary; compare fully opaque fill and empty pixels.
        const alpha = ctx.getImageData(i.x + x, i.y + y, 1, 1).data[3];
        const corners = [
          [x - 1, y - 1],
          [x + 1, y - 1],
          [x - 1, y + 1],
          [x + 1, y + 1],
        ].map(([a, b]) => shapeContains(i, a, b));
        if (corners.every(Boolean))
          assert.ok(alpha > 0, `${shape} missing fill ${x},${y}`);
        if (corners.every((v) => !v))
          assert.ok(alpha < 255, `${shape} outside fill ${x},${y}`);
      }
    const box = shapeTextBox(i);
    for (const x of [box.x + 1, box.x + box.w - 1])
      for (const y of [box.y + 1, box.y + box.h - 1]) {
        assert.ok(shapeContains(i, x, y), `${shape} text region`);
      }
    i.text = "A long label\n".repeat(20);
    i.textColor = "#ff0000";
    drawObject(ctx, i, "#30342f", () => {});
    const pixels = ctx.getImageData(0, 0, 260, 200).data;
    let red = 0;
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 260; x++) {
        const n = (y * 260 + x) * 4;
        if (pixels[n] > 180 && pixels[n + 1] < 90 && pixels[n + 2] < 90) {
          red++;
          assert.ok(
            x >= i.x + box.x - 1 &&
              x <= i.x + box.x + box.w + 1 &&
              y >= i.y + box.y - 1 &&
              y <= i.y + box.y + box.h + 1,
            `${shape} escaped text`,
          );
        }
      }
    assert.ok(red > 0, shape);
    const layout = shapeTextLayout({ ...i, text: "A" }, ctx);
    assert.ok(layout.top >= textStyle(i).padding);
    assert.equal(layout.lines.length, 1);
  }
});

test("shape text with a fixed size stays above a task's footer row", async () => {
  const { tagFooter } = await import("../src/tags.js");
  const ctx = createCanvas(10, 10).getContext("2d");
  for (const shape of ["hexagon", "bpmn-task", "wf-card", "document"]) {
    const i = item("rect", 0, 0, {
      shape,
      w: 200,
      h: 120,
      text: "One\nTwo\nThree",
      task: { status: "in-progress", assignee: "Ada", due: "2026-10-01" },
    });
    const { box } = shapeTextLayout(i, ctx);
    assert.ok(tagFooter(i) > 0, shape);
    assert.ok(box.y + box.h <= i.h - tagFooter(i) + 1e-9, shape);
  }
});

test("conversion, resize, move, duplicate and clipboard preserve content and attached connectors", () => {
  const a = item("note", 0, 0, {
    text: "Decision",
    bold: true,
    color: "#dce5f7",
    fontSize: 22,
    groupId: "group",
  });
  const b = item("rect", 400, 240, { shape: "cylinder" });
  const line = item("arrow", 0, 0, { startId: a.id, endId: b.id });
  const before = structuredClone(a),
    items = [a, b, line];
  switchShape(a, "diamond");
  assert.deepEqual(a, {
    ...before,
    type: "rect",
    shape: "diamond",
    textAlign: "left",
  });
  updateConnectors(items);
  assert.equal(line.startId, a.id);
  assert.ok(line.x < a.w, "Diamond attaches before the bounding-box corner");
  const plan = createResizePlan(items, new Set([a.id]));
  applyResize(items, plan, a.w * 2, a.h * 2);
  moveItems(items, new Set([b.id]), 100, -30);
  const fragment = selectionFragment(items, new Set(items.map((i) => i.id)));
  assert.deepEqual(
    fragment.map((i) => i.shape),
    ["diamond", "cylinder", undefined],
  );
  const ids = duplicateItems(items, new Set(items.map((i) => i.id)));
  const copies = items.filter((i) => ids.has(i.id));
  assert.equal(copies[2].startId, copies[0].id);
  assert.equal(copies[2].endId, copies[1].id);
  assert.equal(copies[0].shape, "diamond");
  switchShape(a, "ellipse");
  assert.equal(a.shape, undefined);
  switchShape(a, "text");
  assert.equal(a.text, before.text);
  assert.equal(a.bold, true);
  assert.equal(textStyle(a).size, before.fontSize);
  assert.equal(textStyle(a).align, "left");
  const text = item("text", 0, 0, { text: "Keep the default size" });
  switchShape(text, "triangle");
  assert.equal(textStyle(text).size, 28);
  validateBoard({ ...board(), items });
});

test("shape changes merge with collaborative text and concurrent type conversions remain valid", () => {
  const initial = {
    ...board(),
    items: [item("rect", 0, 0, { text: "Hello", shape: "diamond" })],
  };
  const seed = new SharedDocument();
  seed.commit(initial);
  const a = new SharedDocument(seed.update()),
    b = new SharedDocument(seed.update());
  try {
    const changed = a.snapshot();
    switchShape(changed.items[0], "cylinder");
    a.commit(changed);
    b.text(initial.items[0].id, "Hello team");
    const one = a.update(),
      two = b.update();
    a.apply(two);
    b.apply(one);
    a.validate();
    b.validate();
    assert.deepEqual(a.snapshot(), b.snapshot());
    assert.equal(a.snapshot().items[0].shape, "cylinder");
    assert.equal(a.snapshot().items[0].text, "Hello team");
    const left = a.snapshot(),
      right = b.snapshot();
    switchShape(left.items[0], "note");
    switchShape(right.items[0], "star");
    a.commit(left);
    b.commit(right);
    const au = a.update(),
      bu = b.update();
    a.apply(bu);
    b.apply(au);
    a.validate();
    b.validate();
    assert.deepEqual(a.snapshot(), b.snapshot());
    assert.equal(a.snapshot().items[0].type, "note");
    assert.equal(a.snapshot().items[0].shape, undefined);
    b.items.get(initial.items[0].id).set("shape", "malformed");
    assert.throws(() => b.validate(), /Invalid shape/);
  } finally {
    for (const d of [seed, a, b]) d.destroy();
  }
});

test("specialist shape families insert at their usual size and older boards still load", () => {
  assert.ok(CUSTOM_SHAPES.size >= 60);
  for (const s of SHAPES.slice(9)) {
    const defaults = shapeDefaults(s.key);
    assert.ok(defaults.w > 0 && defaults.h > 0, s.key);
    const i = item("rect", 0, 0, { ...defaults, shape: s.key });
    validateBoard({ ...board(), items: [i] });
    const box = shapeTextBox(i);
    assert.ok(box.w > 0 && box.h > 0, s.key);
    assert.ok(shapeContains(i, box.x + box.w / 2, box.y + box.h / 2), s.key);
  }
  // Basic shapes keep the original insertion size and style.
  for (const key of ["rectangle", "diamond", "cylinder", "star"])
    assert.deepEqual(shapeDefaults(key), {});
  const legacy = {
    version: 1,
    id: "legacy",
    title: "Saved before shape families",
    items: [
      item("rect", 0, 0, { shape: "diamond", text: "Old" }),
      item("rect", 300, 0, { shape: "terminator" }),
      item("ellipse", 600, 0),
    ],
  };
  assert.equal(validateBoard(legacy), legacy);
  assert.throws(
    () =>
      validateBoard({
        ...board(),
        items: [item("rect", 0, 0, { shape: "wf-unknown" })],
      }),
    /Invalid shape/,
  );
});

test("shape outlines stay cached for a board with thousands of shapes", async () => {
  const { shapeOutline } = await import("../src/shape-specs.js");
  const sizes = Array.from({ length: 3000 }, (_, n) => [100 + n, 80 + (n % 7)]);
  const first = sizes.map(([w, h]) => shapeOutline("cloud", w, h));
  // A second pass, as the next frame draws, reuses every outline.
  assert.ok(
    sizes.every(([w, h], n) => shapeOutline("cloud", w, h) === first[n]),
  );
});

test("every specialist shape fits a short label at its default size", async () => {
  const { fitTextLayout } = await import("../src/text.js");
  const ctx = createCanvas(10, 10).getContext("2d");
  for (const s of SHAPES.slice(9)) {
    const i = item("rect", 0, 0, {
      ...shapeDefaults(s.key),
      shape: s.key,
      text: "Yes",
    });
    assert.equal(fitTextLayout(i, ctx).overflow, false, s.key);
  }
});

test("stacked documents attach connectors to the outer silhouette and details stay inside", () => {
  const stack = item("rect", 0, 0, { w: 220, h: 140, shape: "multi-document" });
  // Toward the upper right, the rear page is the outer edge.
  const p = shapeAnchor(stack, { x: 1000, y: -1000 });
  assert.ok(p.x > 150 && p.y < 20, JSON.stringify(p));
  assert.equal(
    shapeContains(stack, p.x + (p.x - 110) * 0.001, p.y + (p.y - 70) * 0.001),
    false,
  );
  // Bare controls fill their box but draw only the control and label.
  const canvas = createCanvas(240, 60),
    ctx = canvas.getContext("2d");
  drawObject(
    ctx,
    item("rect", 10, 10, {
      w: 200,
      h: 36,
      shape: "wf-checkbox",
      color: "#ffffff",
    }),
    "#30342f",
    () => {},
  );
  const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
  assert.deepEqual(pixel(200, 12), [255, 255, 255, 255], "No outer outline");
  let ink = 0;
  for (let x = 12; x < 40; x++)
    for (let y = 14; y < 42; y++) if (pixel(x, y)[0] < 120) ink++;
  assert.ok(ink > 20, "The checkbox square and tick are drawn");
});

test("radio buttons are drawn unselected, so a group never shows two chosen", () => {
  const canvas = createCanvas(240, 60),
    ctx = canvas.getContext("2d");
  const radio = item("rect", 10, 10, {
    w: 200,
    h: 36,
    shape: "wf-radio",
    color: "#ffffff",
  });
  drawObject(ctx, radio, "#30342f", () => {});
  const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
  // The control is a circle at the left of the box: its ring is drawn and
  // its middle stays empty.
  const size = Math.min(36 * 0.6, 200 * 0.22),
    cx = 10 + Math.min((36 - size) / 2, 10) + size / 2,
    cy = 10 + 18;
  assert.deepEqual(pixel(Math.round(cx), cy), [255, 255, 255, 255]);
  let ring = 0;
  for (let x = 12; x < 40; x++)
    for (let y = 14; y < 42; y++) if (pixel(x, y)[0] < 120) ring++;
  assert.ok(ring > 20, "The radio circle is drawn");
  // The chosen option in a group has its own shape, with the dot.
  const chosen = createCanvas(240, 60).getContext("2d");
  drawObject(
    chosen,
    { ...radio, shape: "wf-radio-selected" },
    "#30342f",
    () => {},
  );
  assert.ok(chosen.getImageData(Math.round(cx), cy, 1, 1).data[0] < 120);
});

test("recorded quadratic curves are exact cubic curves, which PDF draws", async () => {
  const { shapeDrawing } = await import("../src/shape-art.js");
  const ops = shapeDrawing("emotion-high", 200, 200, {}, "#ffffff");
  const smile = ops.find((o) => /C/.test(o.d || ""));
  assert.ok(smile, "The smile is a cubic curve");
  assert.ok(ops.every((o) => !/Q/.test(o.d || "")));
  const [x0, y0, ...curve] = smile.d.match(/-?[\d.]+/g).map(Number);
  const [c1x, c1y, c2x, c2y, x1, y1] = curve;
  // The midpoint of the curve is the quadratic's: 0.25 p0 + 0.5 q + 0.25 p1.
  const mid = (a, b, c, d) => (a + 3 * b + 3 * c + d) / 8;
  const y = 100,
    bend = 1 * 200 * 0.07;
  assert.deepEqual([x0, y0, x1, y1], [68, y, 132, y]);
  assert.ok(Math.abs(mid(x0, c1x, c2x, x1) - 100) < 0.02);
  assert.ok(Math.abs(mid(y0, c1y, c2y, y1) - (y + bend)) < 0.02);
});

test("a shape's border can be thicker, dashed or dotted, growing inward from its usual outline", () => {
  const ink = (ctx, x, y) => {
    const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
    return a > 200 && r < 200 && g < 200 && b < 200;
  };
  const paint = (i) => {
    const ctx = createCanvas(260, 200).getContext("2d");
    drawObject(ctx, i, "#30342f", () => {});
    return ctx;
  };
  for (const shape of [null, "ellipse", "diamond", "document", "browser"]) {
    const plain = item(shape === "ellipse" ? "ellipse" : "rect", 20, 20, {
      w: 200,
      h: 150,
      color: "#ffffff",
      ...(shape && shape !== "ellipse" ? { shape } : {}),
    });
    const mid = 20 + 75;
    // The usual border is one pixel; set again, it draws the same.
    const usual = paint(plain);
    assert.equal(ink(usual, 25, mid), false, `${shape} usual border`);
    assert.deepEqual(
      [...usual.getImageData(0, 0, 260, 200).data],
      [
        ...paint({ ...plain, lineWidth: 1, lineStyle: "solid" }).getImageData(
          0,
          0,
          260,
          200,
        ).data,
      ],
      `${shape} usual border set`,
    );
    // A thick border covers the inside of the edge and nothing outside it,
    // so the shape's bounds and connector ends are where they were.
    const thick = paint({ ...plain, lineWidth: 12 });
    assert.equal(ink(thick, 25, mid), true, `${shape} thick border`);
    assert.equal(
      thick.getImageData(17, mid, 1, 1).data[3],
      0,
      `${shape} grows inward`,
    );
    if (shape === "ellipse" || shape === "diamond") continue;
    // Along a straight side, a dashed or dotted border leaves gaps.
    const marks = (ctx) => {
      const found = [];
      for (let y = 50; y < 140; y++) found.push(ink(ctx, 21, y));
      return found;
    };
    assert.ok(marks(paint({ ...plain, lineWidth: 4 })).every(Boolean), shape);
    for (const lineStyle of ["dashed", "dotted"]) {
      const found = marks(paint({ ...plain, lineWidth: 4, lineStyle }));
      assert.ok(found.some(Boolean) && !found.every(Boolean), lineStyle);
    }
  }
  // Wireframe controls draw no outline, so they have no border to set.
  const bare = item("rect", 20, 20, {
    w: 200,
    h: 40,
    shape: "wf-checkbox",
    color: "#ffffff",
  });
  assert.equal(hasBorder(bare), false);
  assert.ok(
    ["rect", "ellipse"].every((type) => hasBorder(item(type, 0, 0))) &&
      hasBorder({ ...bare, shape: "browser" }),
  );
  assert.equal(hasBorder(item("note", 0, 0)), false);
});
