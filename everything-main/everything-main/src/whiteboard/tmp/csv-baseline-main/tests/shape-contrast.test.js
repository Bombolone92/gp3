import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { PDFDocument } from "pdf-lib";
import { createCanvas } from "./canvas.js";
import { board, item, COLORS, validateBoard } from "../src/model.js";
import { PALETTE } from "../src/template-library/kit.js";
import { fromTemplate } from "../src/templates.js";
import { drawObject } from "../src/render.js";
import { exportRegions } from "../src/export.js";
import { exportSVG } from "../src/export-svg.js";
import {
  createVectorContext,
  drawVectorRegion,
} from "../src/export-pdf-vector.js";

// Compare the actual configured colors, rather than antialiased edge pixels.
const canvasColors = [
  ...readFileSync(
    new URL("../src/style.css", import.meta.url),
    "utf8",
  ).matchAll(/--canvas:\s*(#[\da-f]{6})/gi),
].map((m) => m[1]);
assert.equal(canvasColors.length, 2);
function channels(hex) {
  return hex.match(/[\da-f]{2}/gi).map((v) => parseInt(v, 16) / 255);
}
function luminance(rgb) {
  return rgb
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, n) => sum + v * [0.2126, 0.7152, 0.0722][n], 0);
}
function contrast(a, b) {
  const x = luminance(Array.isArray(a) ? a : channels(a)),
    y = luminance(channels(b));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function contrastingContour(color, i, label) {
  for (const adjacent of [i.color, ...canvasColors, "#ffffff"])
    assert.ok(
      contrast(color, adjacent) >= 3,
      `${label}: ${String(color)} against ${adjacent} is ${contrast(color, adjacent)}`,
    );
}
function notationKeys() {
  const bpmn = fromTemplate("bpmn-process", "en"),
    dfd = fromTemplate("data-flow", "en"),
    keys = [
      ["Task", bpmn, (i) => i.shape === "bpmn-task"],
      ["External entity", dfd, (i) => i.type === "rect" && !i.shape],
      ["Process (numbered)", dfd, (i) => i.type === "ellipse"],
    ];
  return keys.map(([label, b, match]) => {
    const i = b.items.find((i) => match(i) && i.text === "");
    assert.ok(i, label);
    assert.ok(
      b.items.some(
        (caption) => caption.type === "text" && caption.text === label,
      ),
      label,
    );
    // The outside caption explains this graphical key. The blank shape's
    // pale fill cannot communicate its silhouette at 3:1 by itself.
    assert.ok(contrast(i.color, canvasColors[0]) < 3, label);
    return [label, i];
  });
}
function single(i) {
  const b = { ...board(), items: [{ ...i, x: 20, y: 20 }] };
  delete b.items[0].parentId;
  validateBoard(b);
  return b;
}
function canvasContour(i) {
  const ctx = createCanvas(200, 160).getContext("2d"),
    strokes = [],
    original = ctx.stroke.bind(ctx);
  ctx.stroke = (...args) => {
    strokes.push({ color: ctx.strokeStyle, width: ctx.lineWidth });
    return original(...args);
  };
  drawObject(ctx, { ...i, x: 20, y: 20 }, "#30342f", () => {});
  assert.equal(strokes.length, 1);
  assert.equal(strokes[0].width, 1);
  return strokes[0].color;
}
function svgContour(i) {
  const b = single(i),
    ctx = createCanvas(200, 160).getContext("2d"),
    doc = new JSDOM(exportSVG(b, exportRegions(b), { ctx }), {
      contentType: "image/svg+xml",
    }).window.document,
    paths = [...doc.querySelectorAll("path[stroke]")].filter(
      (p) => p.getAttribute("stroke") !== "none",
    );
  assert.equal(paths.length, 1);
  assert.equal(paths[0].getAttribute("stroke-width"), "1");
  return paths[0].getAttribute("stroke");
}
async function pdfContour(i) {
  const b = single(i),
    pdf = await PDFDocument.create(),
    page = pdf.addPage([300, 240]),
    borders = [],
    original = page.drawSvgPath.bind(page);
  page.drawSvgPath = (path, options) => {
    if (options.borderColor && options.borderWidth > 0)
      borders.push({ color: options.borderColor, width: options.borderWidth });
    return original(path, options);
  };
  const ctx = createCanvas(200, 160).getContext("2d"),
    region = exportRegions(b)[0],
    context = createVectorContext(pdf, b, {
      ctx,
      rasterFallback: () => {
        throw new Error("Unexpected raster fallback");
      },
    }),
    fallbacks = await drawVectorRegion(
      page,
      region,
      region.rect,
      { x: 20, y: 220 },
      1,
      context,
    );
  assert.equal(fallbacks.length, 0);
  assert.equal(borders.length, 1);
  assert.equal(borders[0].width, 1);
  const color = borders[0].color;
  assert.equal(color.type, "RGB");
  const bytes = await pdf.save();
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  return [color.red, color.green, color.blue];
}

test("blank template notation keys have contrasting canvas contours", () => {
  for (const [label, i] of notationKeys())
    contrastingContour(canvasContour(i), i, label);
});
test("SVG exports retain contrasting template notation contours", () => {
  for (const [label, i] of notationKeys()) {
    const color = svgContour(i);
    contrastingContour(color, i, label);
    assert.equal(color, canvasContour(i));
  }
});
test("vector PDF exports retain contrasting template notation contours", async () => {
  for (const [label, i] of notationKeys()) {
    const color = await pdfContour(i);
    contrastingContour(color, i, label);
    assert.deepEqual(color, channels(canvasContour(i)));
  }
});
test("native, legacy and library contours agree across formats on standard fills", async () => {
  for (const color of [...COLORS, PALETTE.grey])
    for (const [type, shape] of [
      ["rect", undefined],
      ["ellipse", undefined],
      ["rect", "diamond"],
      ["rect", "bpmn-task"],
    ]) {
      const i = item(type, 20, 20, {
          w: 120,
          h: 80,
          color,
          ...(shape && { shape }),
        }),
        label = `${shape || type} on ${color}`,
        canvas = canvasContour(i),
        svg = svgContour(i),
        pdf = await pdfContour(i);
      contrastingContour(canvas, i, label);
      contrastingContour(svg, i, label);
      contrastingContour(pdf, i, label);
      assert.equal(svg, canvas, label);
      assert.deepEqual(pdf, channels(canvas), label);
    }
});
