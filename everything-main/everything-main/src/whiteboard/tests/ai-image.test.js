import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCanvas, Image as NativeImage } from "@napi-rs/canvas";
import { downscaleDataURL } from "../src/ai/ai-ui.js";

async function raster(src, max, crop) {
  const dom = new JSDOM("");
  const descriptors = Object.fromEntries(
    ["document", "Image"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  Object.defineProperty(globalThis, "document", {
    value: dom.window.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, "Image", {
    value: class extends NativeImage {
      set src(value) {
        // The native decoder needs bytes; read the actual temporary Blob
        // rather than substituting the fixture source for every image.
        fetch(value)
          .then((response) => response.arrayBuffer())
          .then((bytes) => {
            super.src = Buffer.from(bytes);
          })
          .catch((error) => this.onerror(error));
      }
      get src() {
        return super.src;
      }
    },
    configurable: true,
  });
  dom.window.HTMLCanvasElement.prototype.getContext = function () {
    this.native ||= createCanvas(this.width, this.height);
    return this.native.getContext("2d");
  };
  dom.window.HTMLCanvasElement.prototype.toDataURL = function (...args) {
    return this.native.toDataURL(...args);
  };
  try {
    const jpeg = await downscaleDataURL(src, max, crop);
    assert.match(jpeg, /^data:image\/jpeg;base64,/);
    const decoded = await new Promise((resolve, reject) => {
      const image = new NativeImage();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = jpeg;
    });
    const canvas = createCanvas(decoded.width, decoded.height),
      ctx = canvas.getContext("2d");
    ctx.drawImage(decoded, 0, 0);
    return {
      size: [decoded.width, decoded.height],
      pixel: (x, y) => [...ctx.getImageData(x, y, 1, 1).data],
    };
  } finally {
    dom.window.close();
    for (const [key, descriptor] of Object.entries(descriptors))
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
  }
}

function halves(w = 64, h = 64) {
  const canvas = createCanvas(w, h),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "red";
  ctx.fillRect(0, 0, w, h / 2);
  ctx.fillStyle = "blue";
  ctx.fillRect(0, h / 2, w, h / 2);
  return canvas.toDataURL();
}

function near(actual, expected) {
  assert.equal(actual[3], 255);
  assert.ok(
    // Lossy JPEG chroma near a mask edge can shift a channel slightly.
    expected.every((channel, n) => Math.abs(channel - actual[n]) <= 16),
    `Expected ${actual} to be close to ${expected} after JPEG compression.`,
  );
}

for (const mask of [undefined, "ellipse"])
  for (const y of [0, 0.5])
    test(`AI image uses the ${y ? "bottom" : "top"} crop with ${mask || "no"} mask`, async () => {
      const crop = { x: 0, y, w: 1, h: 0.5 };
      if (mask) crop.mask = mask;
      const out = await raster(halves(), undefined, crop),
        color = y ? [0, 0, 255] : [255, 0, 0];
      assert.deepEqual(out.size, [64, 32]);
      near(out.pixel(32, 16), color);
      near(out.pixel(2, 2), mask ? [255, 255, 255] : color);
      near(out.pixel(61, 29), mask ? [255, 255, 255] : color);
    });

test("uncropped AI images retain both source halves", async () => {
  const out = await raster(halves());
  assert.deepEqual(out.size, [64, 64]);
  near(out.pixel(32, 16), [255, 0, 0]);
  near(out.pixel(32, 48), [0, 0, 255]);
});

test("a full-image ellipse excludes corners without cutting visible content", async () => {
  const out = await raster(halves(), undefined, {
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    mask: "ellipse",
  });
  assert.deepEqual(out.size, [64, 64]);
  near(out.pixel(32, 16), [255, 0, 0]);
  near(out.pixel(32, 48), [0, 0, 255]);
  near(out.pixel(2, 2), [255, 255, 255]);
  near(out.pixel(61, 61), [255, 255, 255]);
});

test("cropped and uncropped transparent images keep dark content on white", async () => {
  const canvas = createCanvas(64, 64),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "black";
  ctx.fillRect(16, 16, 32, 32);
  for (const crop of [undefined, { x: 0.25, y: 0, w: 0.5, h: 1 }]) {
    const out = await raster(canvas.toDataURL(), undefined, crop),
      x = out.size[0] / 2;
    near(out.pixel(x, 4), [255, 255, 255]);
    near(out.pixel(x, 32), [0, 0, 0]);
  }
});

test("AI scaling applies the pixel limit to visible content and preserves custom limits", async () => {
  const src = halves(3200, 1600);
  assert.deepEqual((await raster(src)).size, [1600, 800]);
  assert.deepEqual((await raster(src, 320)).size, [320, 160]);
  const top = await raster(src, undefined, { x: 0, y: 0, w: 1, h: 0.5 });
  assert.deepEqual(top.size, [1600, 400]);
  near(top.pixel(800, 200), [255, 0, 0]);
  const narrow = await raster(src, undefined, { x: 0, y: 0, w: 0.01, h: 1 });
  assert.deepEqual(narrow.size, [32, 1600]);
  near(narrow.pixel(16, 400), [255, 0, 0]);
  near(narrow.pixel(16, 1200), [0, 0, 255]);
});

test("a tiny valid crop still produces a decodable image", async () => {
  const out = await raster(halves(), undefined, {
    x: 0,
    y: 0,
    w: 1e-12,
    h: 1e-12,
  });
  assert.deepEqual(out.size, [1, 1]);
});
