import { describe, it, expect } from "vitest";
import { P, createDeck, parseDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

const id = "{4A724BE7-CAB5-4BDD-8656-778F8D8C5632}";
const solid = (color) =>
  `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
const borderStyle = (
  line,
  sides = ["left", "right", "top", "bottom", "insideH", "insideV"],
) =>
  `<a:tcStyle><a:tcBdr>${sides.map((side) => `<a:${side}>${line}</a:${side}>`).join("")}</a:tcBdr></a:tcStyle>`;
async function fixture({ own, whole, firstRow, reference = "custom" } = {}) {
  const pres = createDeck("blank"),
    slide = P.getSlides(pres)[0];
  P.addSlideTable(slide, {
    x: P.inches(1),
    y: P.inches(1),
    w: P.inches(5),
    h: P.inches(2),
    rows: [
      ["A", "B"],
      ["C", "D"],
    ],
  });
  const files = unzipSync(await P.savePresentation(pres));
  const xml = strFromU8(files["ppt/slides/slide1.xml"])
    .replace(
      /<a:tblPr\b[^>]*>[\s\S]*?<\/a:tblPr>/,
      `<a:tblPr${firstRow === undefined ? "" : ' firstRow="1"'}>${reference === "omitted" ? "" : `<a:tableStyleId>${reference === "custom" ? id : reference}</a:tableStyleId>`}</a:tblPr>`,
    )
    .replace(
      /<a:tcPr\b[^>]*\/>/g,
      `<a:tcPr>${own === undefined ? "" : ["lnL", "lnR", "lnT", "lnB"].map((side) => `<a:${side}${own.attrs || ""}>${own.content || ""}</a:${side}>`).join("")}</a:tcPr>`,
    );
  files["ppt/slides/slide1.xml"] = strToU8(xml);
  files["ppt/tableStyles.xml"] = strToU8(
    `<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="${id}"><a:tblStyle styleId="${id}" styleName="Border tests">${whole === undefined ? "" : `<a:wholeTbl>${whole}</a:wholeTbl>`}${firstRow === undefined ? "" : `<a:firstRow>${firstRow}</a:firstRow>`}</a:tblStyle></a:tblStyleLst>`,
  );
  const p = await parseDeck(zipSync(files));
  const s = P.getSlides(p)[0],
    table = P.getSlideShapes(s).find(P.isTableShape);
  return { pres: p, slide: s, table };
}
const cellStyle = (f, row = 0, col = 0) =>
  P.getTableStyleResolver(f.pres, f.table).cell(
    P.getTableCell(f.table, row, col),
  );
const svg = (f) => renderSlideToSvg(f.pres, f.slide, { textLayout: "svg" });
const lines = (f) => [...svg(f).matchAll(/<line\b[^>]*>/g)].map((m) => m[0]);
const redWide = borderStyle(
  `<a:ln w="38100">${solid("FF0000")}<a:prstDash val="dash"/></a:ln>`,
);

describe("table border defaults and replacement", () => {
  it.each([
    "omitted",
    "{00000000-0000-0000-0000-000000000000}",
    "{217CC688-0709-421C-B6CE-762131B16689}",
  ])(
    "uses a black 1pt grid for %s style, without applying the insertion default",
    async (reference) => {
      const f = await fixture({ reference, whole: redWide });
      const style = cellStyle(f);
      for (const side of ["left", "right", "top", "bottom"])
        expect(style.borders[side]).toMatchObject({
          color: "#000000",
          widthEmu: 12700,
          priority: -1,
        });
      expect(style.borders.tlToBr).toBeUndefined();
      expect(style.borders.blToTr).toBeUndefined();
      expect(lines(f)).toHaveLength(12);
      expect(
        lines(f).every(
          (s) =>
            s.includes('stroke="#000000"') && s.includes('stroke-width="1.33"'),
        ),
      ).toBe(true);
    },
  );
  it.each([
    {},
    { attrs: ' w="38100"' },
    { content: "<a:noFill/>" },
    { content: '<a:prstDash val="dash"/>' },
  ])(
    "a present unpainted line suppresses the style and default grid (%j)",
    async (own) => {
      const f = await fixture({ own, whole: redWide });
      expect(cellStyle(f).borders.left.noFill).toBe(true);
      expect(lines(f)).toHaveLength(0);
    },
  );
  it("a color-only direct border replaces inherited width, dash, and opacity", async () => {
    const f = await fixture({
      whole: redWide.replace(
        /<a:srgbClr val="FF0000"\/>/g,
        '<a:srgbClr val="FF0000"><a:alpha val="20000"/></a:srgbClr>',
      ),
      own: { content: solid("0000FF") },
    });
    expect(cellStyle(f).borders.left).toEqual({
      color: "#0000FF",
      widthEmu: 9525,
      dash: null,
      opacity: 1,
      priority: 100,
    });
    expect(lines(f)).toHaveLength(12);
    expect(
      lines(f).every(
        (s) =>
          s.includes('stroke="#0000FF"') &&
          s.includes('stroke-width="1.00"') &&
          !s.includes("stroke-dasharray") &&
          !s.includes("stroke-opacity"),
      ),
    ).toBe(true);
  });
  it("style-region borders also replace entire lower-priority lines", async () => {
    const f = await fixture({
      whole: redWide,
      firstRow: borderStyle(`<a:ln>${solid("0000FF")}</a:ln>`),
    });
    expect(cellStyle(f).borders.top).toMatchObject({
      color: "#0000FF",
      widthEmu: 9525,
      dash: null,
    });
    expect(cellStyle(f, 1, 0).borders.bottom).toMatchObject({
      color: "#FF0000",
      widthEmu: 38100,
      dash: "dash",
    });
    const empty = await fixture({
      whole: redWide,
      firstRow: borderStyle("<a:ln/>"),
    });
    expect(cellStyle(empty).borders.top.noFill).toBe(true);
    expect(cellStyle(empty, 1, 0).borders.bottom.color).toBe("#FF0000");
  });
  it("keeps defaults on sides omitted from a partial style", async () => {
    const f = await fixture({
      whole: borderStyle(`<a:ln w="25400">${solid("00CC00")}</a:ln>`, ["top"]),
    });
    expect(cellStyle(f).borders.top).toMatchObject({
      color: "#00CC00",
      widthEmu: 25400,
    });
    expect(cellStyle(f).borders.left).toMatchObject({
      color: "#000000",
      widthEmu: 12700,
    });
  });
  it("does not thicken explicitly thin or zero-width borders", async () => {
    const thin = await fixture({
      own: { attrs: ' w="1270"', content: solid("0000FF") },
    });
    expect(lines(thin)).toHaveLength(12);
    expect(lines(thin).every((s) => s.includes('stroke-width="0.13"'))).toBe(
      true,
    );
    const zero = await fixture({
      own: { attrs: ' w="0"', content: solid("0000FF") },
    });
    expect(cellStyle(zero).borders.left.widthEmu).toBe(0);
    expect(lines(zero)).toHaveLength(0);
  });
  it("keeps implicit borders out of XML through rendering, copy and export", async () => {
    const f = await fixture({ reference: "omitted" });
    const before = unzipSync(await P.savePresentation(f.pres));
    const expected = cellStyle(f).borders;
    svg(f);
    expect(unzipSync(await P.savePresentation(f.pres))).toEqual(before);
    const copied = P.copyShape(P.addBlankSlide(f.pres), f.table);
    expect(
      P.getTableStyleResolver(f.pres, copied).cell(P.getTableCell(copied, 0, 0))
        .borders,
    ).toEqual(expected);
    const loaded = await parseDeck(await P.savePresentation(f.pres));
    const s = P.getSlides(loaded)[0],
      table = P.getSlideShapes(s).find(P.isTableShape);
    expect(cellStyle({ pres: loaded, table })).toMatchObject({
      borders: expected,
    });
    expect(
      P.getTableCellBorders(loaded, P.getTableCell(table, 0, 0)).left,
    ).toBeNull();
  });
});
