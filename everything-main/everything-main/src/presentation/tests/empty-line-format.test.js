import { describe, it, expect } from "vitest";
import { P, createDeck, parseDeck } from "../src/model.js";
import {
  getTableLayout,
  renderSlideToSvg,
} from "../lib/pptx-preview/src/index.ts";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
const props = (size, extra = "") =>
  `<a:rPr${size ? ` sz="${size * 100}"` : ""}>${extra}</a:rPr>`;
const run = (size = 20) => `<a:r>${props(size)}<a:t>Alpha</a:t></a:r>`;
const br = (size) => `<a:br>${props(size)}</a:br>`;
const end = (size, extra = "") =>
  `<a:endParaRPr${size ? ` sz="${size * 100}"` : ""}>${extra}</a:endParaRPr>`;
const measureText = (text, font) => ({
  widthPx: text.length * font.sizePx * 0.4,
  ascentPx: font.sizePx * 0.9,
  descentPx: font.sizePx * 0.2,
  lineGapPx: 0,
});
async function fixture(inline = "", ending = "", defaults = 12) {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  P.setPresentationFonts(p, { minorLatin: "Arial" });
  P.addSlideTextBox(s, {
    x: 0,
    y: 0,
    w: P.inches(4),
    h: P.inches(5),
    text: "Seed",
  });
  P.addSlideTable(s, {
    x: P.inches(5),
    y: 0,
    w: P.inches(4),
    h: P.inches(0.01),
    rows: [["Seed"]],
  });
  const files = unzipSync(await P.savePresentation(p));
  const body = `<a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0"/><a:lstStyle/><a:p><a:pPr marL="0" indent="0"><a:buNone/><a:defRPr sz="${defaults * 100}"><a:latin typeface="Arial"/></a:defRPr></a:pPr>${inline}${ending}</a:p><a:p><a:pPr marL="0" indent="0"><a:buNone/></a:pPr><a:r>${props(16)}<a:t>Next</a:t></a:r></a:p>`;
  files["ppt/slides/slide1.xml"] = strToU8(
    strFromU8(files["ppt/slides/slide1.xml"])
      .replace(/<p:txBody>[\s\S]*?<\/p:txBody>/, `<p:txBody>${body}</p:txBody>`)
      .replace(/<a:txBody>[\s\S]*?<\/a:txBody>/, `<a:txBody>${body}</a:txBody>`)
      .replace(
        /<a:tcPr\b[^>]*>/,
        (m) =>
          `<a:tcPr marL="0" marR="0" marT="0" marB="0"${m.endsWith("/>") ? "/>" : ">"}`,
      ),
  );
  const pres = await parseDeck(zipSync(files)),
    slide = P.getSlides(pres)[0];
  return {
    pres,
    slide,
    shape: P.getSlideShapes(slide)[0],
    table: P.getSlideTables(slide)[0],
  };
}
const height = (f) =>
  getTableLayout(f.pres, f.table, { measureText }).height / 12700;
const nextY = (f) => {
  const svg = renderSlideToSvg(f.pres, f.slide, {
    textLayout: "svg",
    measureText,
  });
  return Number(
    [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)]
      .find((m) => m[2].includes(">Next<"))[1]
      .match(/\by="([^"]+)"/)[1],
  );
};
describe("empty DrawingML line formatting", () => {
  // Native reference controls: glyph lines ignore br size; empty lines use
  // their terminating break, and the final empty line uses insertion format.
  it.each([
    ["empty paragraph inherits defaults", "", "", [12]],
    ["empty paragraph uses its end", "", end(48), [48]],
    ["trailing line inherits an unsized break", run() + br(), "", [20, 12]],
    ["trailing line inherits a sized break", run() + br(40), "", [20, 40]],
    ["end overrides a large break", run() + br(40), end(8), [20, 8]],
    ["break-only paragraph", br(40), end(8), [40, 8]],
    ["consecutive breaks", run() + br(40) + br(12), end(8), [20, 12, 8]],
    [
      "break size does not enlarge glyph lines",
      run() + br(40) + run(),
      "",
      [20, 20],
    ],
    [
      "trailing field line",
      `<a:fld id="{08BE19D0-77ED-46FD-97C4-A57BBEB7F907}" type="slidenum">${props(20)}<a:t>7</a:t></a:fld>` +
        br(),
      end(48),
      [20, 48],
    ],
  ])("%s", async (_name, inline, ending, sizes) => {
    const f = await fixture(inline, ending),
      base = await fixture(run());
    const advance = sizes.reduce((sum, n) => sum + n * 1.2, 0);
    expect(height(f)).toBeCloseTo(advance + 16 * 1.2, 5);
    expect(nextY(f) - nextY(base)).toBeCloseTo(((advance - 24) * 4) / 3, 1);
  });
  it("resolves end overrides, theme fonts and mapped colors without restyling text", async () => {
    const f = await fixture(
      run() + br(40),
      end(
        8,
        '<a:latin typeface="+mn-lt"/><a:solidFill><a:schemeClr val="accent1"/></a:solidFill>',
      ),
    );
    expect(P.getShapeBreakFormatEffective(f.pres, f.shape, 0, 0).size).toBe(40);
    expect(
      P.getShapeParagraphEndFormatEffective(f.pres, f.shape, 0, {
        accent1: "accent2",
      }),
    ).toMatchObject({
      size: 8,
      font: "Arial",
      color: P.getPresentationTheme(f.pres).accent2,
    });
    expect(P.getShapeRunFormatEffective(f.pres, f.shape, 0, 0).size).toBe(20);
    expect(() => P.getShapeBreakFormatEffective(f.pres, f.shape, 0, 1)).toThrow(
      RangeError,
    );
  });
  it("preserves parts through rendering, two imports, and save/reload", async () => {
    const f = await fixture(run() + br(40), end(8)),
      before = unzipSync(await P.savePresentation(f.pres));
    for (const textLayout of ["svg", "foreignObject"])
      renderSlideToSvg(f.pres, f.slide, { textLayout, measureText });
    expect(unzipSync(await P.savePresentation(f.pres))).toEqual(before);
    let source = f.slide;
    for (let i = 0; i < 2; i++) {
      const dest = createDeck("blank");
      P.importSlide(dest, source, P.getSlideLayouts(dest)[0]);
      const pres = await parseDeck(await P.savePresentation(dest));
      source = P.getSlides(pres).at(-1);
      const copy = {
        pres,
        slide: source,
        shape: P.getSlideShapes(source)[0],
        table: P.getSlideTables(source)[0],
      };
      expect(height(copy)).toBeCloseTo(52.8, 5);
      expect(
        P.getShapeParagraphEndFormatEffective(pres, copy.shape, 0).size,
      ).toBe(8);
      expect(nextY(copy)).toBeCloseTo(nextY(f), 5);
    }
    expect(unzipSync(await P.savePresentation(f.pres))).toEqual(before);
  });
});
