import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { PDFDocument } from "pdf-lib";
import { createCanvas } from "../tests/canvas.js";
import { board, validateBoard } from "../src/model.js";
import { fromTemplate } from "../src/templates.js";
import { drawObject } from "../src/render.js";
import { exportRegions } from "../src/export.js";
import { exportSVG } from "../src/export-svg.js";
import {
  createVectorContext,
  drawVectorRegion,
} from "../src/export-pdf-vector.js";

const canvasColors = [...readFileSync(new URL("../src/style.css", import.meta.url), "utf8")
  .matchAll(/--canvas:\s*(#[\da-f]{6})/gi)].map((m) => m[1]);
assert.equal(canvasColors.length, 2);
function channels(hex) {
  return hex.match(/[\da-f]{2}/gi).map((v) => parseInt(v, 16) / 255);
}
function luminance(rgb) {
  return rgb.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, n) => sum + v * [0.2126, 0.7152, 0.0722][n], 0);
}
function ratio(a, b) {
  const x = luminance(Array.isArray(a) ? a : channels(a)),
    y = luminance(channels(b));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const bpmn = fromTemplate("bpmn-process", "en"),
  dfd = fromTemplate("data-flow", "en");
const targets = [
  ["Task", bpmn.items.find((i) => i.shape === "bpmn-task" && i.text === "")],
  ["External entity", dfd.items.find((i) => i.type === "rect" && !i.shape && i.text === "")],
  ["Process (numbered)", dfd.items.find((i) => i.type === "ellipse" && i.text === "")],
];
for (const [label, i] of targets) {
  assert.ok(i, label);
  // These are the actual blank graphical keys, with their explanatory caption
  // outside the contour. Their pale fill alone also falls below 3:1.
  const template = label === "Task" ? bpmn : dfd;
  assert.ok(template.items.some((caption) => caption.type === "text" && caption.text === label));
  assert.equal(i.text, "");
  assert.ok(ratio(i.color, canvasColors[0]) < 3, label);
}
for (const [name, b, crop] of [
  ["bpmn", bpmn, { x: 0, y: 1030, w: 2320, h: 240 }],
  ["data-flow", dfd, { x: 1860, y: 150, w: 440, h: 410 }],
]) {
  const canvas = createCanvas(crop.w, crop.h), ctx = canvas.getContext("2d");
  ctx.fillStyle = canvasColors[0];
  ctx.fillRect(0, 0, crop.w, crop.h);
  ctx.translate(-crop.x, -crop.y);
  for (const i of b.items) drawObject(ctx, i, "#30342f", () => {});
  writeFileSync(`/tmp/whiteboard-shape-contrast-${process.env.WCAG_CONTRAST_ARTIFACT || "before"}-${name}.png`, canvas.toBuffer("image/png"));
}
function single(i) {
  const b = { ...board(), items: [{ ...i, x: 20, y: 20 }] };
  delete b.items[0].parentId;
  validateBoard(b);
  return b;
}
function canvasStrokes(i) {
  const ctx = createCanvas(200, 160).getContext("2d"), strokes = [],
    original = ctx.stroke.bind(ctx);
  ctx.stroke = (...args) => {
    strokes.push({ color: ctx.strokeStyle, width: ctx.lineWidth });
    return original(...args);
  };
  drawObject(ctx, { ...i, x: 20, y: 20 }, "#30342f", () => {});
  return strokes;
}
test("actual blank notation keys have a contrasting canvas contour", () => {
  const records = targets.map(([label, i]) => {
    const strokes = canvasStrokes(i);
    assert.equal(strokes.length, 1, label);
    return { label, fill: i.color, ...strokes[0],
      againstFill: ratio(strokes[0].color, i.color),
      againstLightCanvas: ratio(strokes[0].color, canvasColors[0]) };
  });
  console.log("Actual canvas strokes", records);
  for (const r of records) {
    assert.ok(r.againstFill >= 3, `${r.label}: outline/fill ${r.againstFill}`);
    assert.ok(r.againstLightCanvas >= 3, `${r.label}: outline/canvas ${r.againstLightCanvas}`);
  }
});
test("actual SVG exports preserve contrasting notation contours", () => {
  const records = targets.map(([label, i]) => {
    const b = single(i), ctx = createCanvas(200, 160).getContext("2d"),
      doc = new JSDOM(exportSVG(b, exportRegions(b), { ctx }), { contentType: "image/svg+xml" }).window.document,
      paths = [...doc.querySelectorAll("path[stroke]")].filter((p) => p.getAttribute("stroke") !== "none");
    assert.equal(paths.length, 1, label);
    const color = paths[0].getAttribute("stroke");
    return { label, color, fill: i.color, ratio: ratio(color, i.color) };
  });
  console.log("Actual SVG strokes", records);
  for (const r of records) assert.ok(r.ratio >= 3, `${r.label}: SVG outline/fill ${r.ratio}`);
});
test("actual vector PDF exports preserve contrasting notation contours", async () => {
  const records = [];
  for (const [label, i] of targets) {
    const b = single(i), pdf = await PDFDocument.create(), page = pdf.addPage([300, 240]),
      borders = [], original = page.drawSvgPath.bind(page);
    page.drawSvgPath = (path, options) => {
      if (options.borderColor && options.borderWidth > 0) borders.push(options.borderColor);
      return original(path, options);
    };
    const ctx = createCanvas(200, 160).getContext("2d"), region = exportRegions(b)[0],
      context = createVectorContext(pdf, b, { ctx, rasterFallback: () => { throw new Error("Unexpected raster fallback"); } });
    const fallbacks = await drawVectorRegion(page, region, region.rect, { x: 20, y: 220 }, 1, context);
    assert.equal(fallbacks.length, 0);
    assert.equal(borders.length, 1, label);
    const color = borders[0];
    assert.equal(color.type, "RGB");
    const bytes = await pdf.save();
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
    records.push({ label, color, fill: i.color, ratio: ratio([color.red, color.green, color.blue], i.color) });
  }
  console.log("Actual PDF strokes", records);
  for (const r of records) assert.ok(r.ratio >= 3, `${r.label}: PDF outline/fill ${r.ratio}`);
});
