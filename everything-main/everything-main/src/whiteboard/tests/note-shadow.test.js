import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCanvas } from "./canvas.js";
import { item } from "../src/model.js";
import { paint, NOTE_SHADOW } from "../src/render.js";

// Paints one object on a native canvas and returns the shadow settings in
// force for each fill, plus a pixel reader.
function painted(object, view) {
  const dom = new JSDOM(`<html><canvas></canvas></html>`, {
    pretendToBeVisual: true,
  });
  const w = dom.window;
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    devicePixelRatio: 1,
  });
  const fills = [];
  let native;
  w.HTMLCanvasElement.prototype.getContext = function () {
    if (!native) {
      native = createCanvas(400, 300).getContext("2d");
      const fill = native.fill.bind(native);
      native.fill = (...args) => {
        fills.push({
          blur: native.shadowBlur,
          offsetY: native.shadowOffsetY,
          color: native.shadowColor,
          style: native.fillStyle,
        });
        fill(...args);
      };
    }
    return native;
  };
  try {
    paint(w.document.querySelector("canvas"), [object], view, {
      width: 400,
      height: 300,
      background: "#ffffff",
    });
    return {
      fills,
      pixel: (x, y) => [...native.getImageData(x, y, 1, 1).data],
    };
  } finally {
    w.close();
    for (const key of [
      "window",
      "document",
      "getComputedStyle",
      "devicePixelRatio",
    ])
      delete globalThis[key];
  }
}

test("a sticky note casts a soft shadow below its paper and nothing else does", () => {
  const note = item("note", 100, 60, { w: 120, h: 100, text: "Idea" });
  const { fills, pixel } = painted(note, { x: 0, y: 0, z: 1 });
  const paper = fills.find((f) => f.style === (note.color || "#f6e7a4"));
  assert.ok(paper, "The note's paper is filled");
  assert.equal(paper.blur, NOTE_SHADOW.blur);
  assert.equal(paper.offsetY, NOTE_SHADOW.offset);
  assert.ok(
    fills
      .filter((f) => f !== paper)
      .every((f) => f.blur === 0 && f.offsetY === 0),
    "Only the paper casts a shadow",
  );
  // Just under the bottom edge the background is darkened by the shadow;
  // well away from the note it is untouched white.
  const under = pixel(160, 164),
    far = pixel(20, 280);
  assert.deepEqual(far, [255, 255, 255, 255]);
  assert.ok(under[0] < 250 && under[2] < 250, `Shadow pixel ${under}`);
});

test("the note shadow follows the zoom and is skipped when it would be under a pixel", () => {
  const note = item("note", 100, 60, { w: 120, h: 100, text: "" });
  const zoomed = painted(note, { x: 0, y: 0, z: 2 }).fills.find(
    (f) => f.blur > 0,
  );
  assert.ok(zoomed, "A zoomed-in note still casts a shadow");
  assert.equal(zoomed.blur, NOTE_SHADOW.blur * 2);
  assert.equal(zoomed.offsetY, NOTE_SHADOW.offset * 2);
  const tiny = painted(note, { x: 0, y: 0, z: 0.05 }).fills;
  assert.ok(tiny.length > 0);
  assert.ok(
    tiny.every((f) => f.blur === 0),
    "Far out, a shadow under a pixel is not drawn",
  );
});

test("rectangles and other shapes cast no shadow", () => {
  for (const type of ["rect", "ellipse", "frame"]) {
    const { fills } = painted(item(type, 100, 60, { w: 120, h: 100 }), {
      x: 0,
      y: 0,
      z: 1,
    });
    assert.ok(
      fills.every((f) => f.blur === 0 && f.offsetY === 0),
      `${type} has no shadow`,
    );
  }
});

test("zoomed far out, notes a few pixels across are drawn as blocks of their colour", () => {
  const dom = new JSDOM(`<html><canvas></canvas></html>`, {
    pretendToBeVisual: true,
  });
  const w = dom.window;
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    devicePixelRatio: 1,
  });
  let native,
    saves = 0;
  w.HTMLCanvasElement.prototype.getContext = function () {
    if (!native) {
      native = createCanvas(400, 300).getContext("2d");
      const save = native.save.bind(native);
      native.save = () => (saves++, save());
    }
    return native;
  };
  try {
    const notes = Array.from({ length: 2000 }, (_, n) =>
      item("note", (n % 50) * 240, Math.floor(n / 50) * 210, {
        text: "Idea " + n,
        color: "#d9e9d2",
      }),
    );
    const turned = item("note", 0, 9000, { rotation: 20 });
    const canvas = w.document.querySelector("canvas");
    const options = { width: 400, height: 300, background: "#ffffff" };
    // 2.5%: each note is under five pixels across.
    paint(
      canvas,
      [...notes, turned],
      { x: 0, y: 0, z: 0.025 },
      {
        ...options,
        coarse: true,
      },
    );
    const blocked = saves;
    assert.ok(blocked < 50, `${blocked} saves`);
    assert.deepEqual(
      [...native.getImageData(2, 2, 1, 1).data],
      [0xd9, 0xe9, 0xd2, 255],
    );
    // Exports and closer views draw every note in full.
    saves = 0;
    paint(canvas, notes, { x: 0, y: 0, z: 0.025 }, options);
    assert.ok(saves >= 2000, `${saves} saves`);
  } finally {
    w.close();
    for (const key of [
      "window",
      "document",
      "getComputedStyle",
      "devicePixelRatio",
    ])
      delete globalThis[key];
  }
});

test("under twelve pixels across, notes and ellipses whose details cannot be seen are drawn as shapes of their colour", () => {
  const dom = new JSDOM(`<html><canvas></canvas></html>`, {
    pretendToBeVisual: true,
  });
  const w = dom.window;
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    devicePixelRatio: 1,
  });
  let native,
    saves = 0;
  w.HTMLCanvasElement.prototype.getContext = function () {
    if (!native) {
      native = createCanvas(400, 300).getContext("2d");
      const save = native.save.bind(native);
      native.save = () => (saves++, save());
    }
    return native;
  };
  try {
    const canvas = w.document.querySelector("canvas");
    const options = {
      width: 400,
      height: 300,
      background: "#ffffff",
      coarse: true,
    };
    const shapes = Array.from({ length: 2000 }, (_, n) =>
      item(
        n % 4 ? "note" : "ellipse",
        (n % 50) * 240,
        Math.floor(n / 50) * 210,
        {
          w: 200,
          h: 200,
          text: n % 4 ? "Idea " + n : "",
          color: "#d9e9d2",
        },
      ),
    );
    // 5%: each is ten pixels across, its text a pixel tall and its shadow
    // and outline under a pixel.
    const view = { x: 0, y: 0, z: 0.05 };
    paint(canvas, shapes, view, options);
    assert.ok(saves < 50, `${saves} saves`);
    // An ellipse keeps its round outline.
    assert.deepEqual(
      [...native.getImageData(5, 5, 1, 1).data],
      [0xd9, 0xe9, 0xd2, 255],
    );
    assert.deepEqual(
      [...native.getImageData(0, 0, 1, 1).data],
      [255, 255, 255, 255],
    );
    // Text that can still be made out, tags, and a note small enough on
    // the board to still cast a visible shadow are drawn in full.
    const detailed = [
      item("note", 0, 0, { w: 200, h: 200, text: "Big", fontSize: 100 }),
      item("note", 300, 0, { w: 200, h: 200, tagIds: ["t"] }),
    ];
    saves = 0;
    paint(canvas, detailed, view, {
      ...options,
      tags: [{ id: "t", name: "Tag", color: "#ffd02f" }],
    });
    assert.ok(saves >= 2, `${saves} saves`);
    saves = 0;
    paint(
      canvas,
      [item("note", 0, 0, { w: 60, h: 60 })],
      { x: 0, y: 0, z: 0.14 },
      options,
    );
    assert.ok(saves >= 1, "a note eight pixels across still casts a shadow");
  } finally {
    w.close();
    for (const key of [
      "window",
      "document",
      "getComputedStyle",
      "devicePixelRatio",
    ])
      delete globalThis[key];
  }
});
