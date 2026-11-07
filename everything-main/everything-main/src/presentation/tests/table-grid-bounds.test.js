import { describe, it, expect } from "vitest";
import { P, createDeck, parseDeck, slideBounds } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { unzipSync } from "fflate";

const norm = (svg) => svg.replace(/pkdef-[a-z0-9]+/g, "definition");
const render = (p, mode = "svg") =>
  norm(renderSlideToSvg(p, P.getSlides(p)[0], { textLayout: mode }));
function fixture() {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  const bounds = {
    x: P.inches(1.13),
    y: P.inches(0.87),
    w: P.inches(5),
    h: P.inches(1.7),
  };
  const table = P.addSlideTable(s, {
    ...bounds,
    rows: [
      ["One", "Two"],
      ["Three", "Four"],
    ],
  });
  P.setTableColumnWidth(table, 0, P.inches(1.8));
  P.setTableColumnWidth(table, 1, P.inches(3.2));
  P.setTableRowHeight(table, 0, P.inches(0.7));
  P.setTableRowHeight(table, 1, P.inches(1));
  return { p, s, table, bounds };
}
// Native reference controls keep identical cell rectangles with larger or
// smaller frames. a:gridCol@w and a:tr@h are EMU extents, not weights.
describe("table grid bounds", () => {
  it.each([
    [1, 2],
    [1, 0.5],
    [2, 1],
    [0.5, 1],
    [2, 2],
    [0.5, 0.5],
    [1.7, 0.6],
    [0.6, 1.7],
    [0, 0],
  ])("uses the grid when frame factors are %s × %s", async (wf, hf) => {
    const { p, table, bounds } = fixture();
    const expected = [render(p), render(p, "foreignObject")];
    const frame = {
      ...bounds,
      w: Math.round(bounds.w * wf),
      h: Math.round(bounds.h * hf),
    };
    P.setShapeBounds(table, frame);
    const before = unzipSync(await P.savePresentation(p));
    expect(P.getShapeBounds(table)).toEqual(frame);
    expect(P.getShapeBoundsResolved(p, table)).toEqual(bounds);
    expect(slideBounds(p, table)).toEqual(bounds);
    expect([render(p), render(p, "foreignObject")]).toEqual(expected);
    expect(unzipSync(await P.savePresentation(p))).toEqual(before);
  });
  it("keeps merged cells and rotated tables on the same grid", () => {
    const { p, table, bounds } = fixture();
    P.mergeTableCells(table, { row: 0, col: 0, rowSpan: 1, colSpan: 2 });
    P.setShapeRotation(table, 37);
    const expected = render(p);
    P.setShapeBounds(table, { ...bounds, w: bounds.w * 1.5, h: bounds.h * 2 });
    expect(render(p)).toBe(expected);
  });
  it("maps grid bounds through a scaled group", () => {
    const { p, s, table, bounds } = fixture();
    const other = P.addSlideShape(s, {
      preset: "rect",
      x: 0,
      y: 0,
      w: P.inches(1),
      h: P.inches(1),
    });
    const group = P.groupShapes([table, other]);
    const g = P.getShapeBounds(group);
    P.setShapeBounds(group, { ...g, w: g.w * 2, h: g.h * 3 });
    const expected = slideBounds(p, table);
    const current = P.getShapeBounds(table);
    P.setShapeBounds(table, { ...current, w: bounds.w * 0.5, h: bounds.h * 2 });
    expect(slideBounds(p, table)).toEqual(expected);
    expect(expected.w).toBeCloseTo(bounds.w * 2);
    expect(expected.h).toBeCloseTo(bounds.h * 3);
  });
  it("preserves frame and grid independently through copy, import, edit, and export", async () => {
    const { p, s, table, bounds } = fixture();
    const frame = { ...bounds, w: bounds.w * 2, h: bounds.h * 0.5 };
    P.setShapeBounds(table, frame);
    const other = P.addBlankSlide(p);
    const copy = P.copyShape(other, table);
    expect(P.getShapeBounds(copy)).toEqual(frame);
    expect(P.getShapeBoundsResolved(p, copy)).toEqual(bounds);
    const target = createDeck("blank");
    const imported = P.importSlide(target, s, P.getSlideLayouts(target)[0]);
    const importedTable = P.getSlideShapes(imported).find(P.isTableShape);
    P.setTableCellText(P.getTableCell(importedTable, 1, 1), "Edited cell");
    const loaded = await parseDeck(await P.savePresentation(target));
    const restored = P.getSlideShapes(P.getSlides(loaded).at(-1)).find(
      P.isTableShape,
    );
    expect(P.getShapeBounds(restored)).toEqual(frame);
    expect(P.getShapeBoundsResolved(loaded, restored)).toEqual(bounds);
    expect(P.getTableCellText(P.getTableCell(restored, 1, 1))).toBe(
      "Edited cell",
    );
    P.setTableRowHeight(restored, 1, P.inches(1.3));
    expect(P.getShapeBoundsResolved(loaded, restored).h).toBe(P.inches(2));
    expect(P.getShapeBounds(restored)).toEqual(frame);
  });
});
