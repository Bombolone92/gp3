import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { createCanvas } from "./canvas.js";
import { mkdir, writeFile } from "node:fs/promises";
import { fromTemplate } from "../src/templates.js";
import { exportRegions, tileRegion, exportPDF } from "../src/export.js";
import { drawObject } from "../src/render.js";
import { frameItems } from "../src/scene.js";
import { board, item } from "../src/model.js";

test("selected regions exclude unrelated objects from editable exports", () => {
  const b = board();
  const inside = item("note", 20, 20, { w: 40, h: 40 });
  const crossing = item("arrow", 120, 40, { w: -100, h: 0 });
  const outside = item("note", 500, 500);
  b.items = [inside, crossing, outside];
  const [region] = exportRegions(b, {
    scope: "selection",
    region: { x: 0, y: 0, w: 100, h: 100 },
  });
  assert.deepEqual(
    region.items.map((i) => i.id),
    [inside.id, crossing.id],
  );
});

const fixture = fromTemplate("journey", "fr");
async function rasterizer(b, rect, { scale, maxSize }) {
  const s = Math.min(scale, maxSize / Math.max(rect.w, rect.h)),
    canvas = createCanvas(
      Math.max(1, Math.ceil(rect.w * s)),
      Math.max(1, Math.ceil(rect.h * s)),
    ),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(s, s);
  ctx.translate(-rect.x, -rect.y);
  b.items.forEach((i) => drawObject(ctx, i, "#30342f", () => {}));
  return canvas;
}
test("scope isolation exports the entire board, selected objects, exact regions, and frame membership", () => {
  const all = exportRegions(fixture);
  assert.equal(all[0].items.length, fixture.items.length);
  const frame = fixture.items.find((i) => i.type === "frame"),
    one = exportRegions(fixture, { scope: "frames", frameIds: [frame.id] });
  assert.equal(one.length, 1);
  assert.equal(one[0].frameId, frame.id);
  assert.equal(one[0].items.length, frameItems(fixture.items, frame.id).size);
  assert.equal(one[0].rect.w, frame.w);
  const selected = exportRegions(fixture, {
    scope: "selection",
    selection: new Set([frame.id]),
  });
  assert.equal(selected[0].items.length, 1);
  const rect = { x: 20, y: 30, w: 200, h: 300 };
  assert.deepEqual(
    exportRegions(fixture, { scope: "selection", region: rect })[0].rect,
    rect,
  );
  assert.throws(
    () => exportRegions(fixture, { scope: "selection" }),
    /Select objects/,
  );
});
test("detail tiling covers the exact region without downscaling its content", () => {
  const rect = { x: -20, y: -40, w: 2500, h: 900 },
    tiles = tileRegion(rect);
  assert.equal(tiles.length, 6);
  assert.equal(
    tiles.reduce((sum, t) => sum + t.w * t.h, 0),
    rect.w * rect.h,
  );
  assert.equal(Math.max(...tiles.map((t) => t.x + t.w)), 2480);
  assert.equal(Math.max(...tiles.map((t) => t.y + t.h)), 860);
  assert.throws(() => tileRegion({ x: 0, y: 0, w: 1e6, h: 1e6 }), /too large/);
});
test("PDF export creates valid bilingual whole-board, region, and multi-frame documents", async () => {
  const frame = fixture.items.find((i) => i.type === "frame");
  for (const [name, options] of [
    ["whole", { scope: "board" }],
    [
      "selection",
      {
        scope: "selection",
        region: { x: frame.x, y: frame.y, w: frame.w, h: frame.h },
      },
    ],
    ["frames", { scope: "frames" }],
  ]) {
    const regions = exportRegions(fixture, options),
      blob = await exportPDF(fixture, regions, "fr", rasterizer),
      bytes = new Uint8Array(await blob.arrayBuffer()),
      pdf = await PDFDocument.load(bytes);
    assert.equal(blob.type, "application/pdf");
    assert.equal(pdf.getTitle(), fixture.title);
    // Large regions add an overview page before their readable detail tiles.
    const pages = regions.map((r) => tileRegion(r.rect).length);
    assert.equal(regions.length, name === "frames" ? 5 : 1);
    assert.ok(name !== "whole" || pages[0] > 1);
    assert.equal(
      pdf.getPageCount(),
      pages.reduce((sum, n) => sum + (n > 1 ? n + 1 : 1), 0),
    );
    assert.ok(
      pdf
        .getPages()
        .every((p) => p.getWidth() === 842 && p.getHeight() === 595),
    );
    if (process.env.WHITEBOARD_PDF_QA) {
      await mkdir("tmp/pdfs", { recursive: true });
      await writeFile(`tmp/pdfs/${name}.pdf`, bytes);
    }
  }
});
test("frame regions are gathered in linear time on large boards", () => {
  const b = board("Large");
  const frames = Array.from({ length: 20 }, (_, n) =>
    item("frame", n * 1000, 0, { w: 900, h: 900, text: `Frame ${n}` }),
  );
  b.items = [
    ...frames,
    ...Array.from({ length: 4980 }, (_, n) =>
      item("note", (n % 20) * 1000 + 10, 10, {
        w: 50,
        h: 50,
        parentId: frames[n % 20].id,
      }),
    ),
  ];
  const started = performance.now();
  const regions = exportRegions(b, { scope: "frames" });
  assert.equal(regions.length, 20);
  assert.equal(regions[0].items.length, 250);
  assert.ok(performance.now() - started < 2000);
});
