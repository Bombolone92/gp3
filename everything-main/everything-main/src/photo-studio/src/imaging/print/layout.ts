// Page layout for contact sheets and presentations: a grid of cells on a
// page with margins, spacing and an optional caption band under each image.

export type Box = { x: number; y: number; width: number; height: number };
export type SheetLayout = {
  pageWidth: number;
  pageHeight: number;
  columns: number;
  rows: number;
  margin: number;
  spacing: number;
  // Height reserved under each image for its caption (0 = none).
  caption: number;
};
export type Cell = { page: number; index: number; cell: Box; image: Box; caption: Box | null };

/** Fit an image of iw×ih inside a box, keeping its aspect ratio, centered. */
export function fitBox(iw: number, ih: number, box: Box, enlarge = true): Box {
  let s = Math.min(box.width / iw, box.height / ih);
  if (!enlarge) s = Math.min(1, s);
  const width = iw * s,
    height = ih * s;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

/** Cells for `count` images (row by row, page by page). Images keep their
 * aspect ratio inside their cell; `sizes` gives each image's pixel size.
 * Without `enlarge`, small images keep their size, centered in the cell. */
export function sheetCells(layout: SheetLayout, sizes: { width: number; height: number }[], enlarge = true): Cell[] {
  const cols = Math.max(1, Math.floor(layout.columns)),
    rows = Math.max(1, Math.floor(layout.rows));
  const innerW = layout.pageWidth - 2 * layout.margin,
    innerH = layout.pageHeight - 2 * layout.margin;
  const cw = Math.max(1, (innerW - (cols - 1) * layout.spacing) / cols),
    ch = Math.max(1, (innerH - (rows - 1) * layout.spacing) / rows);
  const perPage = cols * rows;
  return sizes.map((size, index) => {
    const page = Math.floor(index / perPage),
      k = index % perPage;
    const col = k % cols,
      row = Math.floor(k / cols);
    const cell: Box = { x: layout.margin + col * (cw + layout.spacing), y: layout.margin + row * (ch + layout.spacing), width: cw, height: ch };
    const capH = Math.min(layout.caption, ch * 0.4);
    const area: Box = { ...cell, height: Math.max(1, ch - capH) };
    const image = fitBox(size.width, size.height, area, enlarge);
    // Captions sit just under their image.
    const capY = Math.min(image.y + image.height + capH * 0.15, cell.y + ch - capH);
    return { page, index, cell, image, caption: capH > 0 ? { x: cell.x, y: capY, width: cw, height: capH } : null };
  });
}

/** Number of pages a layout needs. */
export const sheetPages = (layout: SheetLayout, count: number) => Math.max(1, Math.ceil(count / Math.max(1, Math.floor(layout.columns) * Math.floor(layout.rows))));

/** Size that fits within maxW×maxH keeping aspect ratio (Fit Image). */
export function fitWithin(w: number, h: number, maxW: number, maxH: number, enlarge: boolean): [number, number] {
  let s = Math.min(maxW / w, maxH / h);
  if (!enlarge) s = Math.min(1, s);
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}
