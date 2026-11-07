import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCanvas } from "./canvas.js";
import { item } from "../src/model.js";
import { paint } from "../src/render.js";

function luminance(hex) {
  if (/^#[\da-f]{3}$/i.test(hex))
    hex = `#${[...hex.slice(1)].map((c) => c + c).join("")}`;
  return hex
    .match(/[\da-f]{2}/gi)
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, n) => sum + v * [0.2126, 0.7152, 0.0722][n], 0);
}
function contrast(a, b) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// The theme's --accent and --surface, as style.css sets them.
for (const [theme, accent, surface] of [
  ["light", "#0869d6", "#ffffff"],
  ["dark", "#7cbbff", "#202732"],
])
  test(`the rotation angle reads clearly on its label in the ${theme} theme`, () => {
    const dom = new JSDOM(
      `<html style="--accent: ${accent}; --surface: ${surface}"><canvas></canvas></html>`,
      { pretendToBeVisual: true },
    );
    const w = dom.window;
    Object.assign(globalThis, {
      window: w,
      document: w.document,
      getComputedStyle: w.getComputedStyle.bind(w),
      devicePixelRatio: 1,
    });
    const drawn = [];
    w.HTMLCanvasElement.prototype.getContext = function () {
      if (!this._native) {
        const ctx = createCanvas(400, 300).getContext("2d");
        const fillRect = ctx.fillRect.bind(ctx),
          fillText = ctx.fillText.bind(ctx);
        ctx.fillRect = (...args) => {
          drawn.push({ rect: ctx.fillStyle });
          fillRect(...args);
        };
        ctx.fillText = (text, ...args) => {
          drawn.push({ text, color: ctx.fillStyle });
          fillText(text, ...args);
        };
        this._native = ctx;
      }
      return this._native;
    };
    try {
      const note = item("rect", 100, 100, { text: "" });
      paint(
        w.document.querySelector("canvas"),
        [note],
        { x: 0, y: 0, z: 1 },
        {
          width: 400,
          height: 300,
          selection: new Set([note.id]),
          rotationAngle: 12.5,
        },
      );
      const at = drawn.findIndex((d) => d.text === "12.5°");
      assert.ok(at > 0, "The angle is drawn");
      const label = drawn[at],
        box = drawn.slice(0, at).findLast((d) => d.rect);
      assert.equal(label.color, accent);
      assert.ok(
        contrast(label.color, box.rect) >= 4.5,
        `${label.color} on ${box.rect} is ${contrast(label.color, box.rect).toFixed(2)}`,
      );
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
