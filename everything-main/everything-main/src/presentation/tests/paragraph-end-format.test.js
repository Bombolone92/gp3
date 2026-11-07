import { describe, it, expect } from "vitest";
import { P, createDeck, parseDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
const rpr = (tag, size, font, color, attrs = "") =>
  `<a:${tag} sz="${size * 100}" ${attrs}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${font}"/></a:${tag}>`;
const defaults = rpr("defRPr", 17, "Arial", "336699", 'lang="de-DE"');
const ending = rpr(
  "endParaRPr",
  39,
  "Courier New",
  "FF0000",
  'b="1" i="1" lang="ja-JP"',
);
const run = (text, format = "") => `<a:r>${format}<a:t>${text}</a:t></a:r>`;
const field =
  '<a:fld id="{F86A757A-64A7-4A2B-B179-820EA26B7AC3}" type="slidenum"><a:t>1</a:t></a:fld>';
async function fixture(inline, local = true) {
  const pres = createDeck("blank"),
    slide = P.getSlides(pres)[0];
  P.addSlideTextBox(slide, {
    x: 0,
    y: 0,
    w: P.inches(6),
    h: P.inches(3),
    text: "seed",
  });
  const files = unzipSync(await P.savePresentation(pres));
  const xml = `<p:txBody><a:bodyPr/><a:lstStyle>${local ? "" : `<a:lvl1pPr>${defaults}</a:lvl1pPr>`}</a:lstStyle><a:p>${local ? `<a:pPr>${defaults}</a:pPr>` : ""}${inline}${ending}</a:p></p:txBody>`;
  files["ppt/slides/slide1.xml"] = strToU8(
    strFromU8(files["ppt/slides/slide1.xml"]).replace(
      /<p:txBody>[\s\S]*?<\/p:txBody>/,
      xml,
    ),
  );
  const p = await parseDeck(zipSync(files)),
    s = P.getSlides(p)[0],
    shape = P.getSlideShapes(s)[0];
  return { p, s, shape };
}
const expected = {
  size: 17,
  font: "Arial",
  color: "#336699",
  language: "de-DE",
};
describe("paragraph end character formatting", () => {
  it.each([true, false])(
    "does not apply insertion formatting to the last existing run (local defaults: %s)",
    async (local) => {
      const { p, s, shape } = await fixture(run("First ") + run("Last"), local);
      for (let i = 0; i < 2; i++) {
        const fmt = P.getShapeRunFormatEffective(p, shape, 0, i);
        expect(fmt).toMatchObject(expected);
        expect(fmt.bold).not.toBe(true);
        expect(fmt.italic).not.toBe(true);
      }
      const svg = renderSlideToSvg(p, s, { textLayout: "svg" });
      expect(svg).not.toContain("Courier New");
      expect(svg).not.toContain("#FF0000");
    },
  );
  it("uses the same existing-text cascade for fields and for runs preceding a trailing break", async () => {
    for (const inline of [
      field,
      run("Before ") + field,
      field + run("After"),
      run("Before break") + "<a:br/>",
    ]) {
      const { p, shape } = await fixture(inline);
      if (inline.includes("a:fld"))
        expect(P.getShapeFieldFormatEffective(p, shape, 0, 0)).toMatchObject(
          expected,
        );
      if (inline.includes("a:r>"))
        expect(P.getShapeRunFormatEffective(p, shape, 0, 0)).toMatchObject(
          expected,
        );
    }
  });
  it("preserves insertion-point formatting and mapped colors for an empty paragraph", async () => {
    const { p, shape } = await fixture("");
    expect(P.getShapeRunFormatEffective(p, shape, 0, 0)).toMatchObject({
      size: 39,
      font: "Courier New",
      color: "#FF0000",
      language: "ja-JP",
      bold: true,
      italic: true,
    });
    const files = unzipSync(await P.savePresentation(p));
    files["ppt/slides/slide1.xml"] = strToU8(
      strFromU8(files["ppt/slides/slide1.xml"]).replace(
        '<a:srgbClr val="FF0000"/>',
        '<a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr>',
      ),
    );
    const reload = await parseDeck(zipSync(files));
    P.setPresentationTheme(reload, { accent1: "#FFFFFF" });
    expect(
      P.getShapeRunFormatEffective(
        reload,
        P.getSlideShapes(P.getSlides(reload)[0])[0],
        0,
        0,
      ).color,
    ).toBe("#808080");
  });
  it("retains authored overrides and paragraph-end XML through reads, copying and export", async () => {
    const { p, s, shape } = await fixture(
      run("First ") + run("Last", rpr("rPr", 25, "Georgia", "00AA00", 'b="0"')),
    );
    const before = unzipSync(await P.savePresentation(p));
    expect(P.getShapeRunFormatEffective(p, shape, 0, 1)).toMatchObject({
      size: 25,
      font: "Georgia",
      color: "#00AA00",
      bold: false,
      language: "de-DE",
    });
    renderSlideToSvg(p, s, { textLayout: "svg" });
    expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    let source = s;
    for (let i = 0; i < 2; i++) {
      const dest = createDeck("blank");
      P.importSlide(dest, source, P.getSlideLayouts(dest)[0]);
      const reload = await parseDeck(await P.savePresentation(dest));
      source = P.getSlides(reload).at(-1);
      const copy = P.getSlideShapes(source)[0];
      expect(P.getShapeRunFormatEffective(reload, copy, 0, 0)).toMatchObject(
        expected,
      );
      expect(P.getShapeRunFormatEffective(reload, copy, 0, 1)).toMatchObject({
        size: 25,
        font: "Georgia",
        color: "#00AA00",
        bold: false,
      });
      const files = unzipSync(await P.savePresentation(reload));
      expect(strFromU8(files[P.getSlidePartName(source).slice(1)])).toContain(
        "endParaRPr",
      );
    }
    expect(unzipSync(await P.savePresentation(p))).toEqual(before);
  });
});
