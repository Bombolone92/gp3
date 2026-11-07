import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck } from "../src/model.js";
import {
  NS,
  parseXml,
  serializeFragment,
} from "../lib/pptx/src/internal/xml/index.ts";
import {
  resolveDrawingColor,
  resolveDrawingColorRgb,
} from "../lib/pptx/src/api/fn/shape-color.ts";

// Exact full-coverage text colors from native reference PNG exports. The
// near-gray controls deliberately differ by less than one sRGB byte: rounding
// before saturation destroys their hue and produces the same orange for all.
const controls = [
  [
    '<a:hslClr hue="0" sat="0" lum="50000"><a:satOff val="20000"/></a:hslClr>',
    "#996600",
  ],
  [
    '<a:hslClr hue="0" sat="0" lum="50000"><a:satOff val="60000"/></a:hslClr>',
    "#CC3300",
  ],
  [
    '<a:scrgbClr r="50000" g="50001" b="50000"><a:satOff val="20000"/></a:scrgbClr>',
    "#AEC9AE",
  ],
  [
    '<a:scrgbClr r="50000" g="50000" b="50001"><a:satOff val="20000"/></a:scrgbClr>',
    "#AEAEC9",
  ],
  [
    '<a:scrgbClr r="50001" g="50000" b="50000"><a:satOff val="20000"/></a:scrgbClr>',
    "#C9AEAE",
  ],
  [
    '<a:hslClr hue="7200000" sat="1" lum="50000"><a:satOff val="20000"/></a:hslClr>',
    "#669966",
  ],
  [
    '<a:hslClr hue="0" sat="0" lum="50000"><a:satOff val="-20000"/></a:hslClr>',
    "#6699FF",
  ],
  [
    '<a:scrgbClr r="50000" g="0" b="0"><a:shade val="50000"/></a:scrgbClr>',
    "#890000",
  ],
];
const color = (xml) =>
  parseXml(`<a:solidFill xmlns:a="${NS.dml}">${xml}</a:solidFill>`).root
    .children[0];

describe("DrawingML color precision", () => {
  it.each(controls)(
    "matches native color after all transforms: %s",
    (xml, expected) => {
      const node = color(xml),
        before = serializeFragment(node);
      expect(resolveDrawingColor(node, null)).toBe(expected);
      expect(serializeFragment(node)).toBe(before);
    },
  );

  it("retains fractional RGB components for subsequent color calculations", () => {
    const node = color('<a:hslClr hue="7200000" sat="0" lum="50000"/>');
    expect(resolveDrawingColorRgb(node, null)).toEqual([0.5, 0.5, 0.5]);
    expect(
      resolveDrawingColorRgb(color('<a:srgbClr val="bad"/>'), null),
    ).toBeNull();
    expect(
      resolveDrawingColorRgb(color('<a:schemeClr val="accent1"/>'), null),
    ).toBeNull();
  });

  it("preserves HSL and scRGB XML through editing, shape copying and slide transfer", async () => {
    const p = createDeck("blank"),
      slide = P.getSlides(p)[0];
    for (let i = 0; i < controls.length; i++)
      P.addSlideTextBox(slide, {
        x: 0,
        y: i * 500000,
        w: 3000000,
        h: 500000,
        text: `Color ${i}`,
      });
    const parts = unzipSync(await P.savePresentation(p));
    const name = P.getSlidePartName(slide).slice(1);
    let i = 0;
    parts[name] = strToU8(
      strFromU8(parts[name]).replace(
        /<p:spPr>([\s\S]*?)<\/p:spPr>/g,
        (_, body) =>
          `<p:spPr>${body}<a:solidFill>${controls[i++][0]}</a:solidFill></p:spPr>`,
      ),
    );
    expect(i).toBe(controls.length);
    const loaded = await parseDeck(zipSync(parts)),
      source = P.getSlides(loaded)[0];
    const check = (deck, s) => {
      for (const [i, shape] of P.getSlideShapes(s)
        .slice(0, controls.length)
        .entries())
        expect(P.getShapeFillColorResolved(deck, shape)).toBe(controls[i][1]);
    };
    check(loaded, source);
    const before = unzipSync(await P.savePresentation(loaded));
    for (const [i, shape] of P.getSlideShapes(source).entries()) {
      const copy = P.copyShape(source, shape);
      expect(P.getShapeFillColorResolved(loaded, copy)).toBe(controls[i][1]);
    }
    const target = createDeck("blank"),
      imported = P.importSlide(target, source, P.getSlideLayouts(target)[0]);
    P.setShapeText(P.getSlideShapes(imported)[0], "Edited");
    check(target, imported);
    const back = P.importSlide(loaded, imported, P.getSlideLayout(source));
    check(loaded, back);
    const reopened = await parseDeck(await P.savePresentation(loaded));
    check(reopened, P.getSlides(reopened).at(-1));
    expect(unzipSync(await P.savePresentation(reopened))[name]).toEqual(
      unzipSync(await P.savePresentation(loaded))[name],
    );
    // Reads alone preserve the original imported part byte-for-byte.
    expect(before[name]).toEqual(parts[name]);
  });
});
