import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";

async function fixture(slideProps = "", layoutProps = "", masterProps = "") {
  const pres = createDeck(),
    slide = P.getSlides(pres)[0];
  const box = P.addSlideTextBox(slide, {
    x: P.inches(0.7),
    y: P.inches(0.4),
    w: P.inches(5),
    h: P.inches(3),
    text: "First paragraph\nSecond paragraph",
  });
  P.setShapeTextFormat(box, { size: 27 });
  const files = unzipSync(await P.savePresentation(pres));
  const name = P.getSlidePartName(slide).slice(1),
    layoutName = P.getSlideLayoutPartName(P.getSlideLayout(slide)).slice(1),
    masterName = P.getSlideMasterPartName(slide).slice(1);
  let xml = strFromU8(files[name]);
  const original = xml.match(/<p:sp\b[\s\S]*?<\/p:sp>/)[0];
  const placeholder = original.replace(
    /<p:nvPr\s*\/>/,
    '<p:nvPr><p:ph type="body" idx="42"/></p:nvPr>',
  );
  const withProps = (props) =>
    placeholder.replace(
      /<a:bodyPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:bodyPr>)/,
      `<a:bodyPr ${props}><a:noAutofit/></a:bodyPr>`,
    );
  files[name] = strToU8(xml.replace(original, withProps(slideProps)));
  for (const [part, props] of [
    [layoutName, layoutProps],
    [masterName, masterProps],
  ])
    files[part] = strToU8(
      strFromU8(files[part])
        .replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, (sp) =>
          part === masterName && sp.includes('type="body"') ? "" : sp,
        )
        .replace("</p:spTree>", withProps(props) + "</p:spTree>"),
    );
  return parseDeck(zipSync(files));
}
const shape = (p) => P.getSlideShapes(P.getSlides(p)[0])[0];
const read = (p) => {
  const { compatibleLineSpacing, includeOuterSpacing } =
    P.getShapeBodyPrEffective(p, shape(p));
  return { compatibleLineSpacing, includeOuterSpacing };
};
const render = (p) =>
  renderSlideToSvg(p, P.getSlides(p)[0], {
    textLayout: "svg",
    measureText: (text, spec) => ({
      widthPx: text.length * spec.sizePx * 0.5,
      ascentPx: spec.sizePx * 0.9,
      descentPx: spec.sizePx * 0.2,
      lineGapPx: 0,
    }),
  }).replace(/pkdef-[a-z0-9]+/g, "def");

describe("DrawingML body spacing properties", () => {
  it.each([
    ["", "", "", { compatibleLineSpacing: null, includeOuterSpacing: null }],
    [
      "",
      "",
      'compatLnSpc="1" spcFirstLastPara="0"',
      { compatibleLineSpacing: true, includeOuterSpacing: false },
    ],
    [
      "",
      'compatLnSpc="false"',
      'compatLnSpc="true" spcFirstLastPara="1"',
      { compatibleLineSpacing: false, includeOuterSpacing: true },
    ],
    [
      'compatLnSpc="0" spcFirstLastPara="false"',
      'compatLnSpc="true" spcFirstLastPara="true"',
      "",
      { compatibleLineSpacing: false, includeOuterSpacing: false },
    ],
    [
      'compatLnSpc="bad" spcFirstLastPara="bad"',
      'compatLnSpc="true" spcFirstLastPara="false"',
      "",
      { compatibleLineSpacing: true, includeOuterSpacing: false },
    ],
  ])(
    "inherits each switch independently and preserves explicit false (%s)",
    async (slide, layout, master, expected) => {
      expect(read(await fixture(slide, layout, master))).toEqual(expected);
    },
  );
  it("renders omitted compatibility with the compatible-spacing default", async () => {
    expect(render(await fixture())).toBe(
      render(await fixture('compatLnSpc="1" spcFirstLastPara="0"')),
    );
    expect(render(await fixture('compatLnSpc="0"'))).not.toBe(
      render(await fixture()),
    );
  });
  it("preserves both explicit switches through clipboard imports, editing and PPTX export", async () => {
    const original = await fixture('compatLnSpc="0" spcFirstLastPara="1"');
    const before = unzipSync(await P.savePresentation(original));
    render(original);
    expect(unzipSync(await P.savePresentation(original))).toEqual(before);
    const clip = createDeck(),
      dest = createDeck();
    const copied = P.importSlide(
      clip,
      P.getSlides(original)[0],
      P.getSlideLayouts(clip)[0],
    );
    const pasted = P.importSlide(dest, copied, P.getSlideLayouts(dest)[0]);
    P.removeSlide(dest, P.getSlides(dest)[0]);
    const pastedShape = P.getSlideShapes(pasted)[0];
    P.setShapeText(pastedShape, "Edited text");
    const loaded = await parseDeck(await P.savePresentation(dest));
    expect(read(loaded)).toEqual({
      compatibleLineSpacing: false,
      includeOuterSpacing: true,
    });
    expect(P.getShapeText(shape(loaded))).toBe("Edited text");
  });
  it("reads cell body switches without interpreting tcPr as text-body properties", async () => {
    const p = createDeck(),
      s = P.getSlides(p)[0];
    P.addSlideTable(s, {
      x: 0,
      y: 0,
      w: P.inches(5),
      h: P.inches(2),
      rows: [["Table text"]],
    });
    const files = unzipSync(await P.savePresentation(p));
    files["ppt/slides/slide1.xml"] = strToU8(
      strFromU8(files["ppt/slides/slide1.xml"]).replace(
        /<a:bodyPr\b[^>]*\/>/,
        '<a:bodyPr compatLnSpc="false" spcFirstLastPara="true"/>',
      ),
    );
    const loaded = await parseDeck(zipSync(files));
    const cell = P.getTableCells(
      P.getSlideTables(P.getSlides(loaded)[0])[0],
    )[0][0];
    expect(P.getTableCellTextSpacing(cell)).toEqual({
      compatibleLineSpacing: false,
      includeOuterSpacing: true,
    });
    const svg = render(loaded);
    expect(svg).toContain("Table text");
    expect(unzipSync(await P.savePresentation(loaded))).toEqual(files);
  });
});
