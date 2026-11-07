import {
  TABLE_AXES,
  tableTracks,
  tableLayout,
  remapTableTracks,
  sumTracks,
} from "./table-layout.js";
import { wrapText } from "./text.js";
import { fontStack, fontFamily } from "./fonts.js";

// A table's size, family, weight, slant and alignment apply to every cell.
export const tableFontSize = (i) => i.fontSize || 15;
export const tableFont = (i, size = tableFontSize(i)) =>
  `${i.italic ? "italic " : ""}${i.bold ? 600 : 400} ${size}px ${fontStack(fontFamily(i))}`;
export const tableTextAlign = (i) => i.textAlign || "left";

export function tableContentSizes(i, ctx) {
  const columns = tableTracks(i, "column"),
    size = tableFontSize(i);
  ctx.font = tableFont(i);
  return i.cells.map((row) =>
    Math.max(
      24,
      ...row.map(
        (text, c) =>
          18 +
          wrapText(ctx, text, Math.max(1, columns[c] - 18)).length *
            size *
            1.35,
      ),
    ),
  );
}
// Rows grow to fit text set larger, bolder or in a wider family, keeping
// their height otherwise, as rows do for edited cells.
export function grownTableRows(i, ctx) {
  const rows = tableTracks(i, "row"),
    needed = tableContentSizes(i, ctx);
  if (rows.every((height, r) => height >= needed[r])) return null;
  const rowHeights = rows.map((height, r) => Math.max(height, needed[r])),
    h = sumTracks(rowHeights);
  return h > 1e6 ? null : { rowHeights, h };
}
export function fitTableTracks(i, axis, indices, ctx) {
  const { key, dimension, minimum } = TABLE_AXES[axis],
    values = tableTracks(i, axis);
  if (axis === "row") {
    const needed = tableContentSizes(i, ctx);
    for (const n of indices) values[n] = needed[n];
  } else {
    ctx.font = tableFont(i);
    for (const n of indices)
      values[n] = Math.max(
        minimum,
        ...i.cells.flatMap((row) =>
          row[n].split("\n").map((line) => ctx.measureText(line).width + 18),
        ),
      );
  }
  const total = sumTracks(values);
  if (total > 1e6) throw Error("This size exceeds the board limits.");
  return { [key]: values, [dimension]: total };
}
export function sizedTableCells(i, cells, ctx, structure) {
  const patch = { ...remapTableTracks(i, cells, structure), cells };
  const needed = tableContentSizes({ ...i, ...patch }, ctx);
  // Grow edited rows to keep new text readable, retaining manually sized rows
  // that were not edited. Structural changes can alter wrapping in every row.
  patch.rowHeights = patch.rowHeights.map((height, r) =>
    structure || JSON.stringify(cells[r]) !== JSON.stringify(i.cells[r])
      ? Math.max(height, needed[r])
      : height,
  );
  patch.h = sumTracks(patch.rowHeights);
  if (patch.w > 1e6 || patch.h > 1e6)
    throw Error("This size exceeds the board limits.");
  return patch;
}
export function tableBorderAt(i, point, tolerance) {
  const layout = tableLayout(i);
  if (
    point.x < i.x ||
    point.y < i.y ||
    point.x > i.x + i.w + tolerance ||
    point.y > i.y + i.h + tolerance
  )
    return null;
  let best = null;
  for (const [axis, boundaries, value] of [
    ["column", layout.x, point.x - i.x],
    ["row", layout.y, point.y - i.y],
  ]) {
    for (let n = 1; n < boundaries.length; n++) {
      const distance = Math.abs(value - boundaries[n]);
      if (distance <= tolerance && (!best || distance < best.distance))
        best = { axis, index: n - 1, distance };
    }
  }
  return best;
}
