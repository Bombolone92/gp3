import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  buildSvgTextInput,
  resolveTextBodyModel,
} from "../lib/pptx-preview/src/render-slide.ts";
import { layoutCore } from "../lib/pptx-preview/src/text-layout.ts";

const measure = (text, spec) => ({
  widthPx: ([...text].length * spec.sizePx) / 2,
  ascentPx: spec.sizePx * 0.9,
  descentPx: spec.sizePx * 0.2,
  lineGapPx: spec.sizePx * 0.05,
});
async function fixture({
  fontScale = 50000,
  reduction = 10000,
  spacing = '<a:spcPct val="150000"/>',
  height = 300,
  margins = true,
  fontSize = 30,
  font = "Arial",
  autofit = true,
  bullet = "",
  compatibleLineSpacing = true,
} = {}) {
  const p = createDeck(),
    s = P.getSlides(p)[0];
  const sh = P.addSlideTextBox(s, {
    x: 914400,
    y: 609600,
    w: 3657600,
    h: height * 9525,
    text: "Hgp\nAnother",
  });
  P.setShapeTextFormat(sh, { size: fontSize, font });
  const files = unzipSync(await P.savePresentation(p));
  files["ppt/slides/slide1.xml"] = strToU8(
    strFromU8(files["ppt/slides/slide1.xml"])
      .replace(
        /<a:bodyPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:bodyPr>)/,
        `<a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0" spcFirstLastPara="1" compatLnSpc="${compatibleLineSpacing ? 1 : 0}">${autofit ? `<a:normAutofit${fontScale === null ? "" : ` fontScale="${fontScale}"`} lnSpcReduction="${reduction}"/>` : "<a:noAutofit/>"}</a:bodyPr>`,
      )
      .replace(/<a:pPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:pPr>)/g, "")
      .replace(
        /<a:p>/g,
        `<a:p><a:pPr marL="457200" marR="274320" indent="228600"><a:lnSpc>${spacing}</a:lnSpc><a:spcBef><a:spcPts val="${margins ? 1200 : 0}"/></a:spcBef><a:spcAft><a:spcPts val="${margins ? 800 : 0}"/></a:spcAft>${bullet}</a:pPr>`,
      ),
  );
  return parseDeck(zipSync(files));
}
function input(p) {
  const s = P.getSlides(p)[0],
    shape = P.getSlideShapes(s)[0],
    theme = P.getPresentationTheme(p);
  const model = resolveTextBodyModel(
    p,
    shape,
    P.getShapeBoundsResolved(p, shape),
    theme,
    null,
    measure,
    "#000000",
    () => "Arial",
  );
  return {
    model,
    shape,
    value: buildSvgTextInput({
      pres: p,
      shape,
      theme,
      ...model,
      defaultColor: "#000000",
      wrap: true,
      measure,
      vert: "none",
      columns: null,
      includeOuterSpacing: true,
      resolveFamily: () => "Arial",
    }),
  };
}
const render = (p, textLayout = "svg") =>
  renderSlideToSvg(p, P.getSlides(p)[0], {
    textLayout,
    measureText: measure,
    resolveFontFamily: () => "Arial",
  });

describe("DrawingML normal autofit units", () => {
  // Independently authored controls opened in the native reference: the font
  // field, PNG output and PDF export agree on these reduced run sizes.
  it.each([
    [18, 92500, 17],
    [18, 91300, 16],
    [60, 92500, 56],
    [13, 50000, 7],
    [15, 50000, 8],
    [10.49, 99999, 10],
    [10.5, 99999, 10],
    [10.51, 99999, 11],
    [18.75, 99999, 19],
    [1, 1000, 1],
    [49, 1000, 1],
    [50, 1000, 1],
  ])("renders %s pt at %s as %s pt", async (fontSize, fontScale, expected) => {
    for (const font of ["Arial", "Georgia", "Courier New"]) {
      for (const compatibleLineSpacing of [true, false]) {
        const p = await fixture({
          fontSize,
          fontScale,
          font,
          compatibleLineSpacing,
        });
        const { value } = input(p);
        expect(value.paragraphs[0].pieces[0].sizePx).toBeCloseTo(
          (expected * 4) / 3,
        );
        expect(render(p, "foreignObject")).toContain(
          `font-size:${((expected * 4) / 3).toFixed(2)}px`,
        );
      }
    }
  });
  it.each([10.49, 10.5, 10.51, 18.75])(
    "preserves an unscaled %s pt font",
    async (fontSize) => {
      for (const options of [
        { fontScale: 100000 },
        { fontScale: null },
        { autofit: false },
      ]) {
        const p = await fixture({ ...options, fontSize });
        expect(input(p).value.paragraphs[0].pieces[0].sizePx).toBeCloseTo(
          (fontSize * 4) / 3,
        );
      }
    },
  );
  it.each([
    ["", 17],
    ['<a:buSzPct val="100000"/>', 17],
    ['<a:buSzPct val="75000"/>', 12.75],
    ['<a:buSzPts val="1250"/>', 12.5],
  ])(
    "sizes bullets after autofit while preserving point units: %s",
    async (size, expected) => {
      const p = await fixture({
        fontSize: 18,
        fontScale: 92500,
        bullet: `${size}<a:buFont typeface="Arial"/><a:buChar char="H"/>`,
      });
      expect(input(p).value.paragraphs[0].bullet.sizePx).toBeCloseTo(
        (expected * 4) / 3,
      );
      expect(render(p, "foreignObject")).toContain(
        `font-size:${((expected * 4) / 3).toFixed(2)}px`,
      );
    },
  );
  it.each([50000, 80000, 100000])(
    "scales fonts but preserves absolute paragraph geometry at %s",
    async (fontScale) => {
      const p = await fixture({ fontScale }),
        { value } = input(p),
        para = value.paragraphs[0];
      expect(para.pieces[0].sizePx).toBeCloseTo((40 * fontScale) / 100000);
      expect(para.marLpx).toBe(48);
      expect(para.marRpx).toBeCloseTo(28.8);
      expect(para.firstIndentPx).toBe(24);
      expect(para.spcBefPx).toBe(16);
      expect(para.spcAftPx).toBeCloseTo(32 / 3);
      const result = layoutCore(value, measure);
      expect(result.placements[0].line.anchorX).toBe(168);
      expect(render(p)).toMatch(/<text x="168" /);
      expect(
        result.placements[1].baselineY - result.placements[0].baselineY,
      ).toBeCloseTo(((48 * fontScale) / 100000) * 1.4 + 80 / 3);
      const html = render(p, "foreignObject");
      expect(html).toContain("margin-top:16.00px");
      expect(html).toContain("margin-bottom:10.67px");
      expect(html).toContain("padding-left:48.00px");
      expect(html).toContain("padding-right:28.80px");
      expect(html).toContain("text-indent:24.00px");
      expect(html).toContain("line-height:1.400");
    },
  );
  it.each([0, 10000, 20000])(
    "does not reduce exact point spacing when lnSpcReduction is %s",
    async (reduction) => {
      for (const fontScale of [50000, 92500, 100000]) {
        const p = await fixture({
            fontScale,
            reduction,
            spacing: '<a:spcPts val="2400"/>',
            margins: false,
          }),
          { value } = input(p);
        const result = layoutCore(value, measure);
        expect(
          result.placements[1].baselineY - result.placements[0].baselineY,
        ).toBeCloseTo(32);
        expect(render(p, "foreignObject")).toContain("line-height:32.00px");
      }
    },
  );
  it("uses 100% for an omitted or explicit scale even when text overflows", async () => {
    const explicit = await fixture({ fontScale: 100000, height: 36 }),
      bare = await fixture({ fontScale: null, height: 36 });
    expect(input(explicit).model.autoFitScale).toBe(1);
    expect(input(bare).model.autoFitScale).toBe(1);
    expect(P.getShapeTextAutoFitParams(input(explicit).shape)).toEqual({
      fontScale: 1,
      lnSpcReduction: 0.1,
      hasFontScale: true,
    });
    expect(P.getShapeTextAutoFitParams(input(bare).shape)).toEqual({
      fontScale: 1,
      lnSpcReduction: 0.1,
      hasFontScale: false,
    });
  });
  // Native noAutofit, bare normAutofit and explicit 100% controls display
  // the same unscaled glyphs even when their lines extend below the box.
  it.each([93, 84, 12])(
    "preserves authored font sizes in an overflowing %s px body",
    async (height) => {
      const p = await fixture({
        fontScale: null,
        height,
        margins: false,
        reduction: 0,
        spacing: '<a:spcPct val="100000"/>',
      });
      const { model, value } = input(p);
      expect(model.autoFitScale).toBe(1);
      expect(value.paragraphs[0].pieces[0].sizePx).toBe(40);
      expect(layoutCore(value, measure).requiredH).toBeGreaterThan(height);
      const explicit = await fixture({
        fontScale: 100000,
        height,
        margins: false,
        reduction: 0,
        spacing: '<a:spcPct val="100000"/>',
      });
      for (const mode of ["svg", "foreignObject"])
        expect(render(p, mode)).toEqual(render(explicit, mode));
    },
  );
  it("preserves an omitted scale through reads, imports and export", async () => {
    const p = await fixture({ fontScale: null, height: 12 }),
      before = unzipSync(await P.savePresentation(p));
    render(p);
    render(p, "foreignObject");
    expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    let source = P.getSlides(p)[0];
    for (let i = 0; i < 2; i++) {
      const dest = createDeck();
      P.importSlide(dest, source, P.getSlideLayouts(dest)[0]);
      P.removeSlide(dest, P.getSlides(dest)[0]);
      const reload = await parseDeck(await P.savePresentation(dest));
      source = P.getSlides(reload)[0];
      expect(input(reload).model.autoFitScale).toBe(1);
      expect(
        P.getShapeTextAutoFitParams(input(reload).shape).hasFontScale,
      ).toBe(false);
      expect(input(reload).value.paragraphs[0].pieces[0].sizePx).toBe(40);
    }
  });
  it("retains font scaling and fixed spacing through import, clipboard, editing and export", async () => {
    const p = await fixture({
        fontScale: 92500,
        fontSize: 18,
        reduction: 20000,
      }),
      before = unzipSync(await P.savePresentation(p));
    render(p);
    expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    const clip = createDeck(),
      dest = createDeck();
    const copied = P.importSlide(
      clip,
      P.getSlides(p)[0],
      P.getSlideLayouts(clip)[0],
    );
    P.importSlide(dest, copied, P.getSlideLayouts(dest)[0]);
    P.removeSlide(dest, P.getSlides(dest)[0]);
    P.setShapeText(
      P.getSlideShapes(P.getSlides(dest)[0])[0],
      "Edited\nContent",
    );
    const loaded = await parseDeck(await P.savePresentation(dest)),
      { shape, value } = input(loaded);
    expect(P.getShapeTextAutoFitParams(shape)).toEqual({
      fontScale: 0.925,
      lnSpcReduction: 0.2,
      hasFontScale: true,
    });
    expect(P.getShapeText(shape)).toBe("Edited\nContent");
    expect(value.paragraphs[0].pieces[0].sizePx).toBeCloseTo((17 * 4) / 3);
    expect(P.getShapeRunFormat(shape, 0, 0).size).toBe(18);
    expect(value.paragraphs[0].marLpx).toBe(48);
    expect(value.paragraphs[0].spcBefPx).toBe(16);
    expect(value.paragraphs[0].lineSpacing).toEqual({
      kind: "pct",
      value: 1.5,
    });
  });
});
