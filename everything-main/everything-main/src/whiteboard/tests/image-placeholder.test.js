import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCanvas } from "./canvas.js";
import { item } from "../src/model.js";
import {
  paint,
  imageFor,
  IMAGE_PLACEHOLDER,
  IMAGE_RETRY_MS,
} from "../src/render.js";

// Paints objects on a native canvas and records every rectangle fill.
function painted(objects) {
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
      const fillRect = native.fillRect.bind(native);
      native.fillRect = (...args) => {
        fills.push({ style: native.fillStyle, args });
        fillRect(...args);
      };
    }
    return native;
  };
  try {
    paint(
      w.document.querySelector("canvas"),
      objects,
      { x: 0, y: 0, z: 1 },
      {
        width: 400,
        height: 300,
        background: "#ffffff",
      },
    );
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

test("an image that has not loaded is painted as a plate, not left invisible", () => {
  const picture = item("image", 40, 30, {
    w: 120,
    h: 80,
    src: "https://assets.test/missing.png",
  });
  const { fills, pixel } = painted([picture]);
  assert.ok(
    fills.some((f) => f.style === IMAGE_PLACEHOLDER.fill && f.args[2] === 120),
    "the image box is filled with the placeholder colour",
  );
  assert.notDeepEqual(pixel(100, 70).slice(0, 3), [255, 255, 255]);
});

test("a failed image is tried again after a while", () => {
  const dom = new JSDOM("", { pretendToBeVisual: true });
  globalThis.window = dom.window;
  try {
    const src = "https://assets.test/retry.png";
    const first = imageFor(src);
    first.failed = performance.now() - IMAGE_RETRY_MS - 1;
    const second = imageFor(src);
    assert.notEqual(second, first, "a fresh load begins");
    assert.equal(second.failed, undefined);
    second.failed = performance.now();
    assert.equal(imageFor(src), second, "a recent failure is not retried yet");
  } finally {
    dom.window.close();
    delete globalThis.window;
  }
});
