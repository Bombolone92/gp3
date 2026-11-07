import { describe, it, expect } from "vitest";
import {
  P,
  createDeck,
  parseDeck,
  slideBounds,
  tableLayout,
} from "../src/model.js";
import {
  getTableLayout,
  renderSlideToSvg,
} from "../lib/pptx-preview/src/index.ts";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

const pt = (n) => n * 12700;
const measureText = (text, f) => ({
  widthPx: ([...text].length * f.sizePx) / 2,
  ascentPx: f.sizePx * 0.8,
  descentPx: f.sizePx * 0.2,
  lineGapPx: 0,
});
const options = {
  textLayout: "svg",
  measureText,
  resolveFontFamily: () => "Arial",
};
function fixture(size = 18, lines = 3, minimum = 7.2, margin = 3.6) {
  const pres = createDeck("blank"),
    slide = P.getSlides(pres)[0];
  const table = P.addSlideTable(slide, {
    x: P.inches(1),
    y: P.inches(1),
    w: P.inches(5),
    h: pt(minimum * 2),
    rows: [
      [Array(lines).fill("Sample").join("\n"), "Peer"],
      ["Last", "Peer"],
    ],
  });
  for (const row of P.getTableCells(table))
    for (const cell of row) {
      P.setTableCellTextFormat(cell, { size: 6, font: "Arial" });
      P.setTableCellMargins(cell, {
        left: 0,
        right: 0,
        top: pt(margin),
        bottom: pt(margin),
      });
    }
  P.setTableCellTextFormat(P.getTableCell(table, 0, 0), { size });
  P.setTableCellFill(P.getTableCell(table, 0, 0), "#123ABC");
  return { pres, slide, table };
}
const heightsPt = (pres, table) =>
  getTableLayout(pres, table, options).rowHeights.map((h) => h / 12700);
async function modifyFirstBody(pres, fn) {
  const files = unzipSync(await P.savePresentation(pres));
  files["ppt/slides/slide1.xml"] = strToU8(
    strFromU8(files["ppt/slides/slide1.xml"]).replace(
      /<a:txBody>[\s\S]*?<\/a:txBody>/,
      fn,
    ),
  );
  const loaded = await parseDeck(zipSync(files));
  return {
    pres: loaded,
    table: P.getSlideShapes(P.getSlides(loaded)[0]).find(P.isTableShape),
  };
}
describe("table content minimum heights", () => {
  it.each([
    [12, 3, 36, 3.6, 50.4],
    [18, 3, 36, 3.6, 72],
    [24, 3, 36, 3.6, 93.6],
    [18, 1, 7.2, 3.6, 28.8],
    [18, 2, 7.2, 3.6, 50.4],
    [18, 3, 36, 10.8, 86.4],
    [18, 2, 72, 3.6, 72],
  ])(
    "grows %spt × %s lines from %spt with %spt margins to %spt",
    (size, lines, minimum, margin, expected) => {
      const { pres, table } = fixture(size, lines, minimum, margin);
      const h = heightsPt(pres, table);
      expect(h[0]).toBeCloseTo(expected, 5);
      expect(h[1]).toBeCloseTo(Math.max(minimum, 7.2 + 2 * margin), 5);
      expect(P.getTableRowHeights(table)).toEqual([pt(minimum), pt(minimum)]);
      for (const textLayout of ["svg", "foreignObject"]) {
        const svg = renderSlideToSvg(pres, P.getSlides(pres)[0], {
          ...options,
          textLayout,
        });
        const cell = svg.match(/<rect[^>]*height="([^"]+)"[^>]*fill="#123ABC"/);
        expect(cell).not.toBeNull();
        expect(Number(cell[1]) * 0.75).toBeCloseTo(expected, 2);
      }
    },
  );
  it("uses the widest merged cell for wrapping and the final spanned row for a height deficit", () => {
    const { pres, table } = fixture(18, 4);
    P.mergeTableCells(table, { row: 0, col: 0, rowSpan: 2, colSpan: 1 });
    expect(heightsPt(pres, table)[0]).toBeCloseTo(14.4, 5);
    expect(heightsPt(pres, table)[1]).toBeCloseTo(79.2, 5);
    const horizontal = fixture(18, 1);
    P.setTableCellText(
      P.getTableCell(horizontal.table, 0, 0),
      "Alpha beta gamma delta epsilon",
    );
    P.setTableColumnWidth(horizontal.table, 0, pt(90));
    P.setTableColumnWidth(horizontal.table, 1, pt(90));
    const before = heightsPt(horizontal.pres, horizontal.table)[0];
    P.mergeTableCells(horizontal.table, {
      row: 0,
      col: 0,
      rowSpan: 1,
      colSpan: 2,
    });
    expect(heightsPt(horizontal.pres, horizontal.table)[0]).toBeLessThan(
      before,
    );
  });
  it("includes paragraph spacing between paragraphs and resolves list-level defaults", async () => {
    const f = fixture(18, 2);
    const { pres, table } = await modifyFirstBody(f.pres, (xml) =>
      xml.replace(
        /<a:lstStyle\s*\/>/,
        '<a:lstStyle><a:lvl1pPr><a:spcBef><a:spcPts val="600"/></a:spcBef><a:spcAft><a:spcPts val="800"/></a:spcAft></a:lvl1pPr></a:lstStyle>',
      ),
    );
    expect(heightsPt(pres, table)[0]).toBeCloseTo(64.4, 5);
    const nativeSwitches = await modifyFirstBody(pres, (xml) =>
      xml.replace(
        /<a:bodyPr[^>]*\/>/,
        '<a:bodyPr compatLnSpc="0" spcFirstLastPara="1"/>',
      ),
    );
    expect(heightsPt(nativeSwitches.pres, nativeSwitches.table)[0]).toBeCloseTo(
      64.4,
      5,
    );
  });
  it("uses an empty paragraph's explicit font size without emitting placeholder text", async () => {
    const f = fixture(18, 1);
    const { pres, table } = await modifyFirstBody(f.pres, (xml) =>
      xml.replace(
        /<a:p>[\s\S]*?<\/a:p>/,
        '<a:p><a:pPr><a:defRPr sz="1800"/></a:pPr><a:endParaRPr sz="3600"/></a:p>',
      ),
    );
    expect(heightsPt(pres, table)[0]).toBeCloseTo(50.4, 5);
    const svg = renderSlideToSvg(pres, P.getSlides(pres)[0], options);
    expect(svg).not.toContain("Sample");
  });
  it("measures mixed runs and explicit line spacing with the same text engine used for rendering", async () => {
    const f = fixture(18, 1);
    const { pres, table } = await modifyFirstBody(f.pres, (xml) =>
      xml.replace(
        /<a:p>[\s\S]*?<\/a:p>/,
        '<a:p><a:pPr><a:lnSpc><a:spcPts val="3000"/></a:lnSpc></a:pPr><a:r><a:rPr sz="1200"/><a:t>Small</a:t></a:r><a:r><a:rPr sz="3000"/><a:t>Large</a:t></a:r><a:br/><a:r><a:rPr sz="1800"/><a:t>Second</a:t></a:r></a:p>',
      ),
    );
    // Two 30pt advances, with the final baseline at 75% of that advance
    // plus the compatible Arial test font's 4.32pt descent, and 7.2pt margins.
    expect(heightsPt(pres, table)[0]).toBeCloseTo(64.02, 5);
    expect(renderSlideToSvg(pres, P.getSlides(pres)[0], options)).toContain(
      "Large",
    );
  });
  it("keeps measured selection bounds and grouped cell geometry consistent", () => {
    const { pres, slide, table } = fixture();
    const grid = tableLayout(pres, table);
    expect(slideBounds(pres, table).h).toBeCloseTo(grid.height);
    const sibling = P.addSlideShape(slide, {
      preset: "rect",
      x: 0,
      y: 0,
      w: pt(10),
      h: pt(10),
    });
    const group = P.groupShapes([table, sibling]),
      b = P.getShapeBounds(group);
    P.setShapeBounds(group, { ...b, w: b.w * 2, h: b.h * 3 });
    expect(slideBounds(pres, table).h).toBeCloseTo(grid.height * 3);
  });
  it("does not mutate authored minimums and recomputes after edit, copy, and export", async () => {
    const { pres, slide, table } = fixture();
    const before = unzipSync(await P.savePresentation(pres));
    heightsPt(pres, table);
    renderSlideToSvg(pres, slide, options);
    expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
    P.setTableCellText(P.getTableCell(table, 0, 0), "Short");
    expect(heightsPt(pres, table)[0]).toBeCloseTo(28.8, 5);
    const target = createDeck("blank");
    const imported = P.importSlide(target, slide, P.getSlideLayouts(target)[0]);
    const restored = await parseDeck(await P.savePresentation(target));
    const t = P.getSlideShapes(P.getSlides(restored).at(-1)).find(
      P.isTableShape,
    );
    expect(heightsPt(restored, t)[0]).toBeCloseTo(28.8, 5);
    expect(P.getTableRowHeights(t)).toEqual([pt(7.2), pt(7.2)]);
    const copy = P.copyShape(P.addBlankSlide(restored), t);
    expect(heightsPt(restored, copy)).toEqual(heightsPt(restored, t));
    expect(imported).toBeDefined();
  });
});
