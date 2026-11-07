import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCanvas } from "./canvas.js";
import { item } from "../src/model.js";
import { paint } from "../src/render.js";

// Paints objects on a native canvas and returns the text written.
function written(items, options = {}) {
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
  const texts = [];
  let native;
  w.HTMLCanvasElement.prototype.getContext = function () {
    if (!native) {
      native = createCanvas(600, 400).getContext("2d");
      const fillText = native.fillText.bind(native);
      native.fillText = (text, x, y, ...rest) => {
        texts.push({ text, x, y, alpha: native.globalAlpha });
        fillText(text, x, y, ...rest);
      };
    }
    return native;
  };
  try {
    paint(
      w.document.querySelector("canvas"),
      items,
      { x: 0, y: 0, z: 1 },
      {
        width: 600,
        height: 400,
        dpr: 1,
        ...options,
      },
    );
  } finally {
    w.close();
  }
  return texts;
}

test("sticky notes show who added them on the board, only when asked", () => {
  const note = item("note", 20, 20, { w: 200, h: 200, text: "Idea" }),
    long = item("note", 260, 20, { w: 200, h: 200, text: "Other" }),
    shape = item("rect", 20, 240, { w: 190, h: 120, text: "Box" });
  const authors = new Map([
    [note.id, "Alice"],
    [long.id, "A very long display name that cannot fit on one note"],
    [shape.id, "Bob"],
  ]);
  // Exports and previews paint without authors.
  assert.ok(!written([note, long, shape]).some((t) => t.text === "Alice"));
  const texts = written([note, long, shape], { authors });
  const alice = texts.find((t) => t.text === "Alice");
  assert.ok(alice, "The author is written");
  // In the note's bottom padding, under its text, and quieter than it
  // (drawn in the note's own coordinates).
  assert.ok(alice.y > 200 - 16 && alice.y < 200, `${alice.y}`);
  assert.equal(alice.x, 16);
  assert.ok(alice.alpha < 1);
  // A name too long for the note is shortened, not drawn past its edge.
  assert.ok(texts.some((t) => /^A very long.*…$/.test(t.text)));
  // Only sticky notes are labelled.
  assert.ok(!texts.some((t) => t.text === "Bob"));
});
