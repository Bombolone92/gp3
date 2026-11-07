import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createCanvas } from "./canvas.js";
import { item } from "../src/model.js";
import { preview, paintPreviews } from "../src/render.js";

const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

// Mounts preview canvases of `boards` at `width`×`height` CSS pixels, paints
// them, and returns the native canvases plus the fill colours set while
// painting each one.
function painted(boards, { width = 300, height = 150, theme = "" } = {}) {
  const dom = new JSDOM(`<html><body></body></html>`, {
    pretendToBeVisual: true,
  });
  const w = dom.window;
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    devicePixelRatio: 1,
  });
  if (theme) {
    w.document.documentElement.dataset.theme = theme;
    w.document.documentElement.style.setProperty("--text", "#e6edf8");
  }
  const natives = new Map(),
    fills = new Map();
  w.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
    width,
    height,
    left: 0,
    top: 0,
  });
  w.HTMLCanvasElement.prototype.getContext = function () {
    if (!natives.has(this)) {
      const native = createCanvas(width, height).getContext("2d");
      const seen = [];
      fills.set(this, seen);
      const fillText = native.fillText.bind(native);
      native.fillText = (...args) => {
        seen.push(String(native.fillStyle));
        fillText(...args);
      };
      natives.set(this, native);
    }
    return natives.get(this);
  };
  try {
    w.document.body.innerHTML = boards.map((b) => preview(b.board, b)).join("");
    paintPreviews();
    const canvases = [...w.document.querySelectorAll("canvas")];
    return canvases.map((c) => ({
      pixel: (x, y) => [...natives.get(c).getImageData(x, y, 1, 1).data],
      textFills: fills.get(c),
    }));
  } finally {
    for (const key of ["window", "document", "getComputedStyle"])
      delete globalThis[key];
    w.close();
  }
}

test("a preview keeps its margin inside the bitmap, not in CSS padding that squashes it", () => {
  // The canvas bitmap takes the element's full size, and the stylesheet
  // adds no padding: padding shrank the displayed box below the bitmap and
  // drew every preview squashed, with circles as ellipses.
  for (const selector of [
    ".template-art canvas {",
    ".board-preview > canvas {",
  ]) {
    const at = css.indexOf(selector);
    assert.ok(at >= 0, `${selector} has a rule`);
    const open = css.indexOf("{", at);
    const rule = css.slice(open + 1, css.indexOf("}", open));
    assert.doesNotMatch(rule, /padding/, `${selector} has no padding`);
  }
  const wide = item("rect", 0, 0, { w: 1000, h: 100, color: "#ff0000" });
  const [{ pixel }] = painted([
    { board: { id: "wide", updated: 1, items: [wide] } },
  ]);
  // 1000 wide board units in a 300 pixel canvas: the shape spans most of the
  // width yet leaves a margin of at least 15 pixels on each side.
  assert.equal(pixel(10, 75)[3], 0, "the margin stays clear");
  assert.equal(pixel(289, 75)[3], 0, "the margin stays clear");
  assert.deepEqual(
    pixel(40, 75).slice(0, 3),
    [255, 0, 0],
    "the shape fills the width",
  );
  assert.deepEqual(
    pixel(259, 75).slice(0, 3),
    [255, 0, 0],
    "the shape fills the width",
  );
});

test("a template preview on fixed light art keeps dark ink in the dark theme", () => {
  // The home template cards sit on light art backgrounds that do not change
  // with the theme, so their text takes the ink of that art rather than the
  // theme's near-white text colour.
  const text = item("text", 0, 0, { w: 200, h: 40, text: "Brainstorming" });
  const [art, card] = painted(
    [
      { board: { id: "art", updated: 1, items: [text] }, ink: "#30342f" },
      { board: { id: "card", updated: 1, items: [text] } },
    ],
    { theme: "dark" },
  );
  assert.ok(art.textFills.length, "the title is painted");
  assert.ok(
    art.textFills.every((fill) => fill === "#30342f"),
    `template ink: ${art.textFills.join(", ")}`,
  );
  assert.ok(
    card.textFills.every((fill) => fill !== "#30342f"),
    `board card ink follows the theme: ${card.textFills.join(", ")}`,
  );
});

test("a list-view thumbnail shows the board at a readable size, not a speck", () => {
  // The 15 pixel margin suits a card; in the list's 54×38 thumbnail it left
  // 24×8 pixels for the board.
  const wide = item("rect", 0, 0, { w: 1000, h: 100, color: "#ff0000" });
  const [{ pixel }] = painted(
    [{ board: { id: "thumb", updated: 1, items: [wide] } }],
    { width: 54, height: 38 },
  );
  assert.deepEqual(pixel(10, 19).slice(0, 3), [255, 0, 0]);
  assert.deepEqual(pixel(43, 19).slice(0, 3), [255, 0, 0]);
  assert.equal(pixel(1, 19)[3], 0, "a margin stays clear");
  assert.equal(pixel(52, 19)[3], 0, "a margin stays clear");
});

test("a preview leaves out text under a pixel tall, and draws the rest", () => {
  // A large board's preview laid out every line of its notes for text that
  // showed as a faint tint; a small board's text is drawn as before.
  const note = (x, extra) =>
    item("note", x, 0, { text: "Plan launch", ...extra });
  const [small, large] = painted([
    { board: { id: "small", updated: 1, items: [note(0), note(230)] } },
    {
      board: {
        id: "large",
        updated: 1,
        items: [
          note(0),
          note(20000),
          note(10000, { text: "Go", fontSize: 100 }),
        ],
      },
    },
  ]);
  assert.equal(small.textFills.length, 2, "both notes' text is drawn");
  // 20,000 board units across 270 pixels: 19 pixel text is a quarter pixel
  // tall, and only the note with 100 pixel text shows it.
  assert.equal(large.textFills.length, 1);
});
