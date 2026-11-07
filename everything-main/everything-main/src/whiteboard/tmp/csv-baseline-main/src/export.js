import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { bounds } from "./model.js";
import { mindVisibility } from "./mind-visibility.js";
import { mindLines } from "./mind-map.js";
import { orderedFrames, framesItems } from "./scene.js";
import { rasterRegion } from "./render.js";
import { measureContext } from "./export-layout.js";
import { createVectorContext, drawVectorRegion } from "./export-pdf-vector.js";
import { addTranslations, t } from "./i18n.js";

export function exportRegions(b, options = {}) {
  const scene = mindVisibility(b.items, b.comments);
  return regionPlans(
    { ...b, items: options.includeHidden ? b.items : scene.visible },
    options,
  ).map((r) => (scene.counts.size ? { ...r, mindCounts: scene.counts } : r));
}
function regionPlans(
  b,
  { scope = "board", selection = new Set(), region = null, frameIds = [] } = {},
) {
  if (scope === "selection") {
    if (region && region.w > 1 && region.h > 1)
      return [
        {
          name: t("Selected region"),
          rect: region,
          items: b.items.filter((i) => {
            const box = bounds([i]);
            return (
              box.x <= region.x + region.w &&
              box.x + box.w >= region.x &&
              box.y <= region.y + region.h &&
              box.y + box.h >= region.y
            );
          }),
        },
      ];
    const items = b.items.filter((i) => selection.has(i.id));
    if (!items.length) throw Error("Select objects or draw a region first.");
    const a = bounds(items);
    return [
      {
        name: t("Selected objects"),
        rect: { x: a.x - 20, y: a.y - 20, w: a.w + 40, h: a.h + 40 },
        items,
      },
    ];
  }
  if (scope === "frames") {
    const frames = orderedFrames(b.items).filter(
      (f) => !frameIds.length || frameIds.includes(f.id),
    );
    if (!frames.length) throw Error("Add a frame before exporting sections.");
    const byId = new Map(b.items.map((i) => [i.id, i])),
      contents = framesItems(
        b.items,
        frames.map((f) => f.id),
      );
    return frames.map((f) => ({
      name: f.text || t("Frame"),
      frameId: f.id,
      rect: { x: f.x, y: f.y, w: f.w, h: f.h },
      items: [...contents.get(f.id)].map((id) => byId.get(id)),
    }));
  }
  const a = bounds(b.items);
  return [
    {
      name: b.title,
      rect: { x: a.x - 30, y: a.y - 30, w: a.w + 60, h: a.h + 60 },
      items: b.items,
    },
  ];
}
export function tileRegion(rect, maxW = 1040, maxH = 680) {
  const columns = Math.max(1, Math.ceil(rect.w / maxW - 1e-9)),
    rows = Math.max(1, Math.ceil(rect.h / maxH - 1e-9));
  if (rows * columns > 150)
    throw Error(
      "This area is too large for a readable PDF. Export smaller frames or a selected region.",
    );
  const tiles = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < columns; col++)
      tiles.push({
        x: rect.x + col * maxW,
        y: rect.y + row * maxH,
        w: Math.min(maxW, rect.w - col * maxW),
        h: Math.min(maxH, rect.h - row * maxH),
        row: row + 1,
        col: col + 1,
        rows,
        columns,
      });
  return tiles;
}

// Portrait sizes in points. A4 and A3 are rounded to whole points.
export const PAGE_SIZES = {
  letter: [612, 792],
  legal: [612, 1008],
  tabloid: [792, 1224],
  a4: [595, 842],
  a3: [842, 1191],
};
export const PDF_MARGINS = { narrow: 18, normal: 28, wide: 48 };
// Defaults reproduce the original export: A4 landscape, readable detail tiles.
const PDF_DEFAULTS = {
  pageSize: "a4",
  orientation: "landscape",
  scale: "auto",
  margin: "normal",
  markers: true,
  mode: "raster",
};
const FRENCH = {
  "Page {page} of {total}": "Page {page} sur {total}",
  ", row {row} column {column}": ", ligne {row}, colonne {column}",
  "Overview; details on the following pages":
    "Vue d’ensemble; détails sur les pages suivantes",
  "Page {page}": "Page {page}",
  "Too many PDF pages. Export fewer frames at a time.":
    "Trop de pages PDF. Exportez moins de cadres à la fois.",
  "This area is too large for a readable PDF. Export smaller frames or a selected region.":
    "Cette zone est trop grande pour un PDF lisible. Exportez des cadres plus petits ou une région sélectionnée.",
};
addTranslations(FRENCH);
const phrase = (lang, text, values = {}) =>
  (lang === "fr" ? FRENCH[text] || text : text).replace(
    /\{(\w+)\}/g,
    (_, key) => values[key],
  );

// Content area below the title band and above the footer labels, in PDF
// coordinates (origin at the bottom left).
const contentBox = ([width, height], m) => ({
  x: m,
  y: m + 17,
  w: width - m * 2,
  h: height - m * 2 - 30,
});
const centered = (box, rect, scale) => ({
  x: box.x + (box.w - rect.w * scale) / 2,
  y: box.y + box.h - (box.h - rect.h * scale) / 2,
});

// Page plan for regions. `scale` is "auto" (readable detail tiles), "fit"
// (one page per region), or a percentage where 100% prints one board pixel
// as one CSS pixel (0.75 pt), splitting large regions over several pages.
export function pdfPlan(regions, options = {}) {
  const o = { ...PDF_DEFAULTS, ...options };
  const m = PDF_MARGINS[o.margin] ?? PDF_MARGINS.normal,
    percent = Number(o.scale),
    fixed = Number.isFinite(percent) && percent > 0,
    pages = [];
  for (const region of regions) {
    const rect = region.rect;
    const single = (size, box, scale) =>
      pages.push({
        region,
        kind: "page",
        rect,
        size,
        box,
        scale,
        placement: centered(box, rect, scale),
        row: 1,
        col: 1,
        rows: 1,
        columns: 1,
      });
    if (o.pageSize === "fit") {
      // Fit to content: each region gets its own page at the chosen scale,
      // within the PDF limit of 200 inches per side.
      const limit = 14400 - m * 2 - 30;
      const scale = Math.min(
        fixed ? (0.75 * percent) / 100 : 0.75,
        limit / rect.w,
        limit / rect.h,
      );
      const size = [
        Math.max(300, Math.ceil(rect.w * scale + m * 2)),
        Math.max(200, Math.ceil(rect.h * scale + m * 2 + 30)),
      ];
      single(size, contentBox(size, m), scale);
      continue;
    }
    const base = PAGE_SIZES[o.pageSize] || PAGE_SIZES.a4;
    const landscape =
      o.orientation === "landscape" ||
      (o.orientation !== "portrait" && rect.w >= rect.h);
    const size = landscape ? [base[1], base[0]] : [...base],
      box = contentBox(size, m),
      fit = Math.min(box.w / rect.w, box.h / rect.h);
    if (o.scale === "fit") {
      single(size, box, fit);
      continue;
    }
    const scale = fixed
      ? (0.75 * percent) / 100
      : Math.min(786 / 1040, 509 / 680);
    const tiles = fixed
      ? tileRegion(rect, box.w / scale, box.h / scale)
      : tileRegion(rect, (1040 * box.w) / 786, (680 * box.h) / 509);
    if (tiles.length === 1) {
      single(size, box, fixed ? scale : fit);
      continue;
    }
    const overview = {
      region,
      kind: "overview",
      rect,
      size,
      box,
      scale: fit,
      placement: centered(box, rect, fit),
      tiles,
      rows: tiles[0].rows,
      columns: tiles[0].columns,
    };
    pages.push(overview);
    for (const tile of tiles)
      pages.push({
        region,
        kind: "detail",
        rect: tile,
        size,
        box,
        scale,
        placement: { x: box.x, y: box.y + box.h },
        row: tile.row,
        col: tile.col,
        rows: tile.rows,
        columns: tile.columns,
        overview,
      });
  }
  if (pages.length > 180)
    throw Error("Too many PDF pages. Export fewer frames at a time.");
  pages.forEach((page, n) => {
    page.index = n + 1;
    page.total = pages.length;
  });
  // Page numbers of neighboring tiles, for boundary labels and the overview.
  for (const page of pages) {
    if (page.kind !== "detail") continue;
    const at = (row, col) =>
      row < 1 || col < 1 || row > page.rows || col > page.columns
        ? null
        : page.overview.index + (row - 1) * page.columns + col;
    page.neighbors = {
      up: at(page.row - 1, page.col),
      down: at(page.row + 1, page.col),
      left: at(page.row, page.col - 1),
      right: at(page.row, page.col + 1),
    };
  }
  return pages;
}

export function pageLabel(page, lang = "en") {
  let label = phrase(lang, "Page {page} of {total}", {
    page: page.index,
    total: page.total,
  });
  if (page.kind === "detail")
    label += phrase(lang, ", row {row} column {column}", {
      row: page.row,
      column: page.col,
    });
  if (page.kind === "overview")
    label += `. ${phrase(lang, "Overview; details on the following pages")}`;
  return label;
}

// The objects that can reach a detail page. Rendering every object of a
// large region for each page laid out all of its text again every time;
// the renderer draws only what is on the page, so the page is unchanged.
// A mind map line crossing the page keeps both of its nodes.
function pageItems(region, rect, cache) {
  let scene = cache.get(region);
  if (!scene) {
    const byId = new Map(region.items.map((i) => [i.id, i]));
    scene = {
      items: region.items.map((i) => ({ i, box: bounds([i]) })),
      lines: mindLines(region.items).map((line) => {
        const child = byId.get(line.id.slice("mind-line:".length));
        return { box: bounds([line]), ids: [child.id, child.mindMap.parent] };
      }),
    };
    cache.set(region, scene);
  }
  const margin = 30,
    near = (box) =>
      box.x <= rect.x + rect.w + margin &&
      box.y <= rect.y + rect.h + margin &&
      box.x + box.w >= rect.x - margin &&
      box.y + box.h >= rect.y - margin;
  const keep = new Set();
  for (const line of scene.lines)
    if (near(line.box)) line.ids.forEach((id) => keep.add(id));
  return scene.items
    .filter(({ i, box }) => keep.has(i.id) || near(box))
    .map(({ i }) => i);
}

// Raster mode (the default) embeds the canvas rendering, matching the board
// exactly. Vector mode draws text and shapes as PDF content so they stay
// sharp and selectable, using standard PDF fonts. Large regions are tiled at
// a constant scale; an overview page shows the page grid.
export async function exportPDF(
  b,
  regions,
  lang = "en",
  rasterizer = rasterRegion,
  options = {},
) {
  const o = { ...PDF_DEFAULTS, ...options };
  const plan = pdfPlan(regions, o);
  const pdf = await PDFDocument.create();
  pdf.setTitle(b.title);
  pdf.setCreator("Whiteboard");
  pdf.setLanguage(lang === "fr" ? "fr-CA" : "en-CA");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const chars = new Set(font.getCharacterSet());
  const safe = (text, max = 110) =>
    Array.from(String(text ?? "").normalize("NFC"))
      .map((c) => (chars.has(c.codePointAt(0)) ? c : " "))
      .join("")
      .slice(0, max);
  const ink = rgb(0.18, 0.21, 0.18),
    muted = rgb(0.35, 0.4, 0.35),
    line = rgb(0.64, 0.67, 0.63),
    accent = rgb(0.03, 0.41, 0.84);
  const vector =
    o.mode === "vector"
      ? createVectorContext(pdf, b, {
          ctx: o.measure || measureContext(),
          // Large objects, such as a frame whose title needs a font the
          // PDF lacks, stay about as sharp as on a detailed page.
          rasterFallback: (i, area) =>
            rasterizer({ ...b, items: [i] }, area, {
              scale: 3,
              maxSize: 4096,
              transparent: true,
            }),
        })
      : null;
  const scenes = new WeakMap();
  const chip = (page, text, cx, cy, size = 7, color = muted) => {
    const width = font.widthOfTextAtSize(text, size) + 8,
      height = size + 5;
    page.drawRectangle({
      x: cx - width / 2,
      y: cy - height / 2,
      width,
      height,
      color: rgb(1, 1, 1),
      borderColor: color,
      borderWidth: 0.5,
    });
    page.drawText(text, {
      x: cx - width / 2 + 4,
      y: cy - size * 0.35,
      size,
      font,
      color,
    });
  };
  for (const entry of plan) {
    const page = pdf.addPage(entry.size),
      [width, height] = entry.size,
      { rect, scale, placement } = entry,
      m = entry.box.x;
    const drawn = {
      x: placement.x,
      y: placement.y - rect.h * scale,
      w: rect.w * scale,
      h: rect.h * scale,
    };
    if (vector)
      await drawVectorRegion(
        page,
        entry.region,
        rect,
        placement,
        scale,
        vector,
      );
    else {
      const canvas = await rasterizer(
        {
          ...b,
          items:
            entry.kind === "detail"
              ? pageItems(entry.region, rect, scenes)
              : entry.region.items,
        },
        rect,
        {
          scale: Math.min(4, Math.max(2, (scale * 200) / 72)),
          maxSize: entry.kind === "overview" ? 2400 : 4096,
          mindCounts: entry.region.mindCounts,
        },
      );
      const png = await pdf.embedPng(canvas.toDataURL("image/png"));
      page.drawImage(png, {
        x: drawn.x,
        y: drawn.y,
        width: drawn.w,
        height: drawn.h,
      });
    }
    if (o.markers && entry.kind === "detail") {
      page.drawRectangle({
        x: drawn.x,
        y: drawn.y,
        width: drawn.w,
        height: drawn.h,
        borderColor: line,
        borderWidth: 0.5,
      });
      // Corner marks show where to trim and join adjacent pages.
      for (const [x, y, dx, dy] of [
        [drawn.x, drawn.y + drawn.h, -1, 1],
        [drawn.x + drawn.w, drawn.y + drawn.h, 1, 1],
        [drawn.x, drawn.y, -1, -1],
        [drawn.x + drawn.w, drawn.y, 1, -1],
      ]) {
        page.drawLine({
          start: { x: x + dx * 2, y },
          end: { x: x + dx * 10, y },
          thickness: 0.5,
          color: ink,
        });
        page.drawLine({
          start: { x, y: y + dy * 2 },
          end: { x, y: y + dy * 10 },
          thickness: 0.5,
          color: ink,
        });
      }
      const n = entry.neighbors,
        label = (index) => phrase(lang, "Page {page}", { page: index });
      if (n.up)
        chip(page, label(n.up), drawn.x + drawn.w / 2, drawn.y + drawn.h - 8);
      if (n.down) chip(page, label(n.down), drawn.x + drawn.w / 2, drawn.y + 8);
      if (n.left)
        chip(page, label(n.left), drawn.x + 24, drawn.y + drawn.h / 2);
      if (n.right)
        chip(
          page,
          label(n.right),
          drawn.x + drawn.w - 24,
          drawn.y + drawn.h / 2,
        );
    }
    if (o.markers && entry.kind === "overview")
      entry.tiles.forEach((tile, n) => {
        const x = drawn.x + (tile.x - rect.x) * scale,
          y = drawn.y + drawn.h - (tile.y - rect.y + tile.h) * scale,
          w = tile.w * scale,
          h = tile.h * scale;
        page.drawRectangle({
          x,
          y,
          width: w,
          height: h,
          borderColor: accent,
          borderWidth: 0.75,
          borderDashArray: [4, 2],
        });
        const index = entry.index + n + 1,
          text = phrase(lang, "Page {page}", { page: index });
        chip(
          page,
          font.widthOfTextAtSize(text, 8) + 12 < w ? text : String(index),
          x + w / 2,
          y + h / 2,
          8,
          accent,
        );
      });
    // The frame or board name is shortened to fit across the page.
    let name = safe(entry.region.name);
    while (name && font.widthOfTextAtSize(name, 11) > width - 2 * m)
      name = name.length > 2 ? name.slice(0, -2).trimEnd() + "…" : "";
    page.drawText(name, {
      x: m,
      y: height - m + 3,
      size: 11,
      font,
      color: ink,
    });
    const label = safe(pageLabel(entry, lang), 160);
    page.drawText(label, {
      x: m,
      y: m - 6,
      size: 9,
      font,
      color: muted,
    });
    // The board title shares the footer; on narrow pages it is shortened,
    // or left out, rather than drawn over the page label.
    let title = safe(b.title, 60);
    const room = width - 2 * m - font.widthOfTextAtSize(label, 9) - 12;
    while (title && font.widthOfTextAtSize(title, 9) > room)
      title = title.length > 2 ? title.slice(0, -2).trimEnd() + "…" : "";
    if (title && entry.region.name !== b.title)
      page.drawText(title, {
        x: width - m - font.widthOfTextAtSize(title, 9),
        y: m - 6,
        size: 9,
        font,
        color: muted,
      });
  }
  return new Blob([await pdf.save()], { type: "application/pdf" });
}
