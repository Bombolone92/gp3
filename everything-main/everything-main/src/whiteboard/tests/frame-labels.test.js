import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "./canvas.js";
import { item } from "../src/model.js";

// paint reads the page's theme colours; a bare stand-in is enough here.
globalThis.document ??= {
  documentElement: {},
  createElement: () => createCanvas(10, 10),
};
globalThis.getComputedStyle ??= () => ({ getPropertyValue: () => "" });
const { paint, frameLabels, frameLabelAt } = await import("../src/render.js");

const canvas = () => {
  const c = createCanvas(1200, 800);
  c.getBoundingClientRect = () => ({ width: 1200, height: 800 });
  return c;
};

test("zoomed out, frames are named above their corner at a readable size", () => {
  const ctx = createCanvas(10, 10).getContext("2d");
  const frames = [
    item("frame", 0, 0, { w: 2000, h: 1500, text: "Discovery\nnotes" }),
    item("frame", 2400, 0, {
      w: 600,
      h: 1500,
      text: "A very long section title that cannot fit",
    }),
    item("frame", 4000, 0, { w: 100, h: 100, text: "Tiny" }),
    item("frame", 6000, 0, { w: 2000, h: 1500, text: "" }),
  ];
  // Close enough to read the frames' own titles: no names above them.
  assert.deepEqual(
    frameLabels(frames, { x: 0, y: 100, z: 1 }, 1200, 800, ctx),
    [],
  );
  const view = { x: 20, y: 100, z: 0.1 },
    labels = frameLabels(frames, view, 1200, 800, ctx);
  // The tiny frame is too narrow on screen to name, and an untitled one
  // has no name.
  assert.deepEqual(
    labels.map((l) => l.id),
    [frames[0].id, frames[1].id],
  );
  const [first, second] = labels;
  assert.equal(first.text, "Discovery", "The first line of the title");
  assert.equal(first.x, 20);
  assert.ok(first.y + first.h <= 100, "Above the frame's top edge");
  assert.ok(second.text.endsWith("…"));
  assert.ok(second.w <= 600 * 0.1, "Cut to the frame's width");
});

test("the main canvas draws frame names in place of unreadable titles, and a press on one finds its frame", () => {
  const frame = item("frame", 0, 0, { w: 4000, h: 3000, text: "Ideas" }),
    note = item("note", 100, 100, { text: "Inside", parentId: frame.id });
  const view = { x: 100, y: 200, z: 0.1 };
  paint(canvas(), [frame, note], view, {
    dpr: 1,
    coarse: true,
    frameLabels: true,
  });
  assert.equal(frameLabelAt(105, 190), frame.id);
  assert.equal(
    frameLabelAt(105, 260),
    null,
    "Inside the frame is not its name",
  );
  // Other canvases (exports, previews) neither draw nor answer for names.
  paint(canvas(), [frame, note], view, { dpr: 1 });
  assert.equal(frameLabelAt(105, 190), frame.id, "Kept from the main canvas");
  paint(
    canvas(),
    [frame, note],
    { ...view, z: 1 },
    {
      dpr: 1,
      coarse: true,
      frameLabels: true,
    },
  );
  assert.equal(frameLabelAt(105, 190), null, "Readable again: no name above");
});

test("a nested frame's name never overprints the name of the frame around it", () => {
  const ctx = createCanvas(10, 10).getContext("2d");
  const outer = item("frame", 0, 0, {
      w: 4000,
      h: 3000,
      text: "Workstream 5",
    }),
    corner = item("frame", 20, 20, { w: 1500, h: 1000, text: "Research" }),
    lower = item("frame", 200, 1400, { w: 1500, h: 1000, text: "Delivery" });
  // The nested frames come first in the board's order.
  const frames = [corner, lower, outer],
    view = { x: 100, y: 200, z: 0.13 },
    labels = frameLabels(frames, view, 1200, 800, ctx);
  // The outer frame keeps its name; one that would cover it is left out,
  // and one clear of it is still named.
  assert.deepEqual(
    labels.map((l) => l.id),
    [lower.id, outer.id],
  );
  for (const a of labels)
    for (const b of labels)
      assert.ok(
        a === b ||
          a.x + a.w <= b.x ||
          b.x + b.w <= a.x ||
          a.y + a.h <= b.y ||
          b.y + b.h <= a.y,
        "No two names overlap",
      );
  // A press on the shown name finds the frame it names.
  paint(canvas(), frames, view, { dpr: 1, coarse: true, frameLabels: true });
  assert.equal(frameLabelAt(110, 190), outer.id);
});
