import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { createCanvas } from "./canvas.js";
import { mkdir, writeFile } from "node:fs/promises";
import { fromTemplate } from "../src/templates.js";
import {
  exportRegions,
  tileRegion,
  exportPDF,
  pdfPlan,
} from "../src/export.js";
import { drawObject } from "../src/render.js";
import { frameItems } from "../src/scene.js";
import { board, item, bounds } from "../src/model.js";

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

test("a frame exports the frames drawn inside it and the lines leading from it", () => {
  const b = board();
  const outer = item("frame", 0, 0, { w: 1200, h: 800, text: "Outer" }),
    inner = item("frame", 100, 100, { w: 400, h: 300, text: "Inner" }),
    other = item("frame", 1400, 0, { w: 600, h: 400, text: "Other" }),
    nested = item("note", 150, 150, { text: "in inner", parentId: inner.id }),
    own = item("note", 800, 400, { text: "in outer", parentId: outer.id }),
    far = item("note", 1600, 100, { text: "in other", parentId: other.id }),
    across = item("arrow", 900, 480, {
      w: 700,
      h: -300,
      startId: own.id,
      endId: far.id,
      text: "SQL",
      parentId: other.id,
    }),
    loose = item("arrow", 1500, 300, { w: 50, h: 0, parentId: other.id });
  b.items = [outer, inner, other, nested, own, far, across, loose];
  const regions = exportRegions(b, { scope: "frames" }),
    ids = (r) => r.items.map((i) => i.text || i.type);
  assert.deepEqual(
    regions.map((r) => r.name),
    ["Outer", "Inner", "Other"],
  );
  // Board order is kept, so what is drawn on top stays on top.
  assert.deepEqual(ids(regions[0]), [
    "Outer",
    "Inner",
    "in inner",
    "in outer",
    "SQL",
  ]);
  assert.deepEqual(ids(regions[1]), ["Inner", "in inner"]);
  assert.deepEqual(ids(regions[2]), ["Other", "in other", "SQL", "arrow"]);
});

test("readable detail prints a board too large for its pages smaller instead of refusing it", () => {
  const region = (w, h) => ({ name: "Board", rect: { x: 0, y: 0, w, h } });
  const readable = pdfPlan([region(8000, 5000)], { pageSize: "letter" }),
    detail = (plan) => plan.filter((p) => p.kind === "detail");
  for (const [w, h, reduce] of [
    [12000, 8000, 0.75],
    [20000, 10000, 0.5],
    [30000, 20000, 0.25],
    [1e6, 4e5, 1 / 128],
  ]) {
    const plan = pdfPlan([region(w, h)], { pageSize: "letter" });
    assert.ok(plan.length <= 151, `${w}×${h}: ${plan.length} pages`);
    assert.equal(plan[0].kind, "overview");
    assert.ok(
      Math.abs(detail(plan)[0].scale - detail(readable)[0].scale * reduce) <
        1e-3,
      `${w}×${h} prints at ${reduce}`,
    );
  }
  // A chosen scale is kept, and the message names the way out.
  assert.throws(
    () => pdfPlan([region(30000, 20000)], { pageSize: "letter", scale: "50" }),
    /at this scale\. Choose a smaller scale/,
  );
});

test("a PDF of a board whose groups lie far apart leaves out pages with nothing on them", () => {
  const b = board("Spread");
  for (const [x0, y0] of [
    [0, 0],
    [15000, 9000],
  ])
    for (let n = 0; n < 6; n++)
      b.items.push(
        item("note", x0 + (n % 3) * 220, y0 + Math.floor(n / 3) * 200, {
          text: `N${n}`,
        }),
      );
  const plan = pdfPlan(exportRegions(b), { pageSize: "letter" }),
    [overview, ...details] = plan,
    readable = pdfPlan(
      [{ name: "R", rect: { x: 0, y: 0, w: 3000, h: 2000 } }],
      {
        pageSize: "letter",
      },
    )[1].scale;
  assert.equal(overview.kind, "overview");
  assert.ok(plan.length < 10, `${plan.length} pages`);
  // Every detail page shows an object, at the readable scale rather than
  // one shrunk to fit blank pages under the page limit.
  for (const page of details) {
    assert.ok(
      b.items.some((i) => {
        const box = bounds([i]),
          r = page.rect;
        return (
          box.x < r.x + r.w &&
          box.x + box.w > r.x &&
          box.y < r.y + r.h &&
          box.y + box.h > r.y
        );
      }),
      `page ${page.index} is blank`,
    );
    assert.ok(Math.abs(page.scale - readable) < 0.01, `${page.scale}`);
  }
  // The overview marks one area for each page, and pages name only
  // neighbours that are printed, beside them in the grid.
  assert.equal(overview.tiles.length, details.length);
  const at = new Map(details.map((p) => [`${p.row} ${p.col}`, p.index]));
  for (const page of details) {
    assert.ok(page.row <= page.rows && page.col <= page.columns);
    assert.deepEqual(page.neighbors, {
      up: at.get(`${page.row - 1} ${page.col}`) ?? null,
      down: at.get(`${page.row + 1} ${page.col}`) ?? null,
      left: at.get(`${page.row} ${page.col - 1}`) ?? null,
      right: at.get(`${page.row} ${page.col + 1}`) ?? null,
    });
  }
  // A region with no objects keeps its whole grid.
  const empty = pdfPlan([{ name: "R", rect: plan[0].rect, items: [] }], {
    pageSize: "letter",
  });
  assert.ok(empty.length > 100);
});

test("a PDF leaves out pages that would show only a stretch of a frame's border", () => {
  const b = board("Frames");
  const frames = ["Alpha", "Beta", "Gamma"].map((text, n) =>
    item("frame", n * 1200, 0, { w: 1000, h: 700, text }),
  );
  b.items = [
    ...frames,
    item("note", 50, 100, { text: "A", parentId: frames[0].id }),
    item("note", 1250, 100, { text: "B", parentId: frames[1].id }),
    item("image", 2450, 100, {
      w: 400,
      h: 300,
      parentId: frames[2].id,
      src: "data:image/png;base64,iVBORw0KGgo=",
    }),
    item("note", 600, 900, { text: "Outside any frame" }),
  ];
  const plan = pdfPlan(exportRegions(b, { scope: "board" }), {
    pageSize: "letter",
  });
  assert.deepEqual(
    plan.map((p) => (p.kind === "detail" ? [p.row, p.col] : p.kind)),
    ["overview", [1, 1], [1, 2], [1, 3], [2, 1]],
  );
  // An empty frame still prints the page with its title.
  b.items = [item("frame", 0, 0, { w: 4000, h: 2000, text: "Empty" })];
  const empty = pdfPlan(exportRegions(b, { scope: "board" }), {
    pageSize: "letter",
  });
  assert.deepEqual(
    empty.map((p) => (p.kind === "detail" ? [p.row, p.col] : p.kind)),
    ["overview", [1, 1]],
  );
});

test("too many PDF pages for frames names the scale that prints each on one page", () => {
  const b = board("Slides");
  // Content reaches every corner of each frame, so each needs every page
  // of its grid.
  b.items = Array.from({ length: 40 }, (_, n) => {
    const frame = item("frame", n * 2000, 0, {
      w: 1920,
      h: 1080,
      text: `Slide ${n + 1}`,
    });
    return [
      frame,
      ...[
        [0, 0],
        [1730, 0],
        [0, 920],
        [1730, 920],
      ].map(([x, y]) =>
        item("note", n * 2000 + x, y, { text: "Idea", parentId: frame.id }),
      ),
    ];
  }).flat();
  const regions = exportRegions(b, { scope: "frames" });
  assert.throws(
    () => pdfPlan(regions, { pageSize: "letter" }),
    /^Error: Too many PDF pages\. Fit each area on one page, or export fewer frames/,
  );
  assert.equal(
    pdfPlan(regions, { pageSize: "letter", scale: "fit" }).length,
    40,
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
test("a region a few pixels wider than a page prints on that page, not on a nearly blank extra one", () => {
  const rect = { x: 0, y: 0, w: 1041, h: 100 };
  const tiles = tileRegion(rect);
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].w, 1041, "The tile covers the whole region");
  const wide = tileRegion({ x: 0, y: 0, w: 2100, h: 690 });
  assert.deepEqual(
    wide.map((t) => [t.col, t.row, t.w, t.h]),
    [
      [1, 1, 1050, 690],
      [2, 1, 1050, 690],
    ],
    "A small remainder is spread over the tiles beside it",
  );
  // Well past the slack, the remainder still gets its own page.
  assert.equal(tileRegion({ x: 0, y: 0, w: 1100, h: 100 }).length, 2);
  // Letter landscape with normal margins fits 973.8 board pixels per page.
  const plan = pdfPlan(
    [{ name: "A", rect: { x: 0, y: 0, w: 980, h: 100 }, items: [] }],
    {
      pageSize: "letter",
      orientation: "landscape",
      margin: "normal",
      scale: "readable",
    },
  );
  assert.equal(plan.length, 1, "One page, with no overview");
  assert.ok(
    plan[0].rect.w * plan[0].scale <= plan[0].box.w + 1e-6,
    "The content stays inside the page box",
  );
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

test("exporting selected objects keeps the connectors joining them, as copying does", () => {
  const b = board("Links");
  const a = item("note", 0, 0, { text: "A" }),
    c = item("note", 600, 0, { text: "B" }),
    other = item("note", 0, 600, { text: "C" }),
    joined = item("arrow", 190, 80, {
      w: 410,
      h: 0,
      startId: a.id,
      endId: c.id,
    }),
    leaving = item("arrow", 95, 160, {
      w: 0,
      h: 440,
      startId: a.id,
      endId: other.id,
    });
  b.items = [a, c, other, joined, leaving];
  const [region] = exportRegions(b, {
    scope: "selection",
    selection: new Set([a.id, c.id]),
  });
  assert.deepEqual(
    region.items.map((i) => i.id).sort(),
    [a.id, c.id, joined.id].sort(),
  );
});

test("a current selection is exported over an earlier region, which keeps its own scope", () => {
  const b = board("Both");
  const chosen = item("note", 0, 0, { text: "Selected" }),
    far = item("note", 5000, 5000, { text: "Far away" });
  b.items = [chosen, far];
  const region = { x: 4900, y: 4900, w: 400, h: 400 };
  const [selected] = exportRegions(b, {
    scope: "selection",
    selection: new Set([chosen.id]),
    region,
  });
  assert.deepEqual(
    selected.items.map((i) => i.text),
    ["Selected"],
  );
  const [drawn] = exportRegions(b, {
    scope: "region",
    selection: new Set([chosen.id]),
    region,
  });
  assert.deepEqual(
    drawn.items.map((i) => i.text),
    ["Far away"],
  );
  assert.deepEqual(drawn.rect, region);
  // Without a selection, the selection scope still falls back to the region.
  const [fallback] = exportRegions(b, { scope: "selection", region });
  assert.deepEqual(
    fallback.items.map((i) => i.text),
    ["Far away"],
  );
});
