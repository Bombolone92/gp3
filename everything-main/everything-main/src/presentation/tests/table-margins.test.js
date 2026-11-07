import { describe, it, expect } from "vitest";
import { P, createDeck, parseDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

// ECMA-376 CT_TableCellProperties defaults, in EMU (not display pixels).
const defaults = { left: 91440, right: 91440, top: 45720, bottom: 45720 };
const norm = (svg) => svg.replace(/pkdef-[a-z0-9]+/g, "definition");
const render = (pres, textLayout) =>
  norm(renderSlideToSvg(pres, P.getSlides(pres)[0], { textLayout }));
function fixture(anchor = "top", merged = false) {
  const p = createDeck(),
    s = P.getSlides(p)[0];
  const table = P.addSlideTable(s, {
    x: P.inches(1.13),
    y: P.inches(0.87),
    w: P.inches(5.2),
    h: P.inches(2.4),
    rows: [
      ["A line that wraps inside the cell", "Short"],
      ["Another paragraph\nSecond line", "Last cell"],
    ],
  });
  for (const row of P.getTableCells(table))
    for (const cell of row) {
      P.setTableCellMargins(cell, null);
      P.setTableCellAnchor(cell, anchor);
      P.setTableCellTextFormat(cell, { size: 21, font: "Arial" });
    }
  if (merged)
    P.mergeTableCells(table, { row: 0, col: 0, rowSpan: 1, colSpan: 2 });
  return { p, s, table };
}
for (const mode of ["svg", "foreignObject"])
  describe(`table cell insets (${mode})`, () => {
    it.each(["top", "center", "bottom"])(
      "renders omitted margins exactly like authored schema defaults at %s anchor",
      async (anchor) => {
        const { p, table } = fixture(anchor, anchor === "center");
        const before = unzipSync(await P.savePresentation(p));
        const omitted = render(p, mode);
        expect(unzipSync(await P.savePresentation(p))).toEqual(before);
        for (const row of P.getTableCells(table))
          for (const cell of row) P.setTableCellMargins(cell, defaults);
        expect(omitted).toBe(render(p, mode));
      },
    );
    it("resolves missing sides independently while respecting explicit zero and asymmetric insets", () => {
      const { p, table } = fixture();
      const partial = [
        { left: 0, bottom: 100000 },
        { right: 0, top: 27000 },
        { top: 0, bottom: 0 },
        { left: 190500, right: 38100 },
      ];
      const cells = P.getTableCells(table).flat();
      cells.forEach((c, i) => P.setTableCellMargins(c, partial[i]));
      const omitted = render(p, mode);
      cells.forEach((c, i) =>
        P.setTableCellMargins(c, { ...defaults, ...partial[i] }),
      );
      expect(omitted).toBe(render(p, mode));
      cells.forEach((c) =>
        P.setTableCellMargins(c, { left: 0, right: 0, top: 0, bottom: 0 }),
      );
      expect(render(p, mode)).not.toBe(omitted);
    });
    it("uses defaults when tcPr is absent and preserves omission through copy and export", async () => {
      const { p } = fixture();
      const files = unzipSync(await P.savePresentation(p));
      files["ppt/slides/slide1.xml"] = strToU8(
        strFromU8(files["ppt/slides/slide1.xml"]).replace(
          /<a:tcPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:tcPr>)/g,
          "",
        ),
      );
      const imported = await parseDeck(zipSync(files)),
        copy = createDeck();
      const copied = P.importSlide(
        copy,
        P.getSlides(imported)[0],
        P.getSlideLayouts(copy)[0],
      );
      P.removeSlide(copy, P.getSlides(copy)[0]);
      const loaded = await parseDeck(await P.savePresentation(copy));
      const shape = P.getSlideTables(P.getSlides(loaded)[0])[0];
      expect(P.getShapeXmlString(shape)).not.toContain("<a:tcPr");
      for (const row of P.getTableCells(shape))
        for (const cell of row)
          expect(P.getTableCellMargins(cell)).toEqual({
            left: null,
            right: null,
            top: null,
            bottom: null,
          });
      const before = render(loaded, mode);
      for (const row of P.getTableCells(shape))
        for (const cell of row) P.setTableCellMargins(cell, defaults);
      expect(before).toBe(render(loaded, mode));
      expect(P.getSlideTables(copied)).toHaveLength(1);
    });
  });
