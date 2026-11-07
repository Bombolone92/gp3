import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import native from "./data/diagram-height-search-native.json";
import { P, createDeck } from "../src/model.js";
import { semanticTextGroupDeck } from "./diagram-text-group-fixture.js";
import { reflowShapeDiagram } from "../lib/pptx/src/api/fn/diagram-reflow.ts";
import { buildDiagramDrawing } from "../lib/pptx/src/api/fn/diagram-build.ts";
import { isDiagramShape } from "../lib/pptx/src/api/fn/diagram-read.ts";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { SHAPE_ELEMENT } from "../lib/pptx/src/api/_internal-symbols.ts";
import {
  NS,
  getAttrValue,
  qname,
  firstChildElement,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
const attr = (e, n) => e && getAttrValue(e, qname("", n, ""));
const child = (e, n) => e && firstChildElement(e, qname("", n, NS.dml));
const rect = (e) =>
  e
    ? {
        x: Number(attr(child(e, "off"), "x")),
        y: Number(attr(child(e, "off"), "y")),
        w: Number(attr(child(e, "ext"), "cx")),
        h: Number(attr(child(e, "ext"), "cy")),
      }
    : null;
const measure = (row) => (shape, state, node) => {
  // Zero outer extents must bypass the measurement callback entirely. This
  // also protects against treating a sub-EMU extent or collapsed inset as zero.
  expect(state.size.w).not.toBe(0);
  expect(state.size.h).not.toBe(0);
  const key = JSON.stringify([
    node.name,
    P.getShapeText(shape),
    state.size.w,
    state.size.h,
    ...["primFontSz", "secFontSz", "lMarg", "rMarg", "tMarg", "bMarg"].map(
      (k) => state.values.get(k),
    ),
  ]);
  const m = row.measurements[key];
  if (!m) throw Error(`Unrecorded glyph measurement ${key}`);
  const heightFits = !m.collapsed && state.size.h >= m.requiredHeight;
  return { heightFits, fits: heightFits && m.wordFits };
};
const draw = (frame, row) => {
  const result = reflowShapeDiagram(frame, { textFits: measure(row) }),
    drawing = buildDiagramDrawing(frame, result);
  const shapes = P.getGroupChildren(drawing.root).map((shape) => {
    const font = [];
    walkElements(shape[SHAPE_ELEMENT], (e) => {
      if (e.name.localName === "rPr") font.push(attr(e, "sz"));
    });
    return {
      name: P.getShapeName(shape),
      text: P.getShapeText(shape),
      font,
      bounds: P.getShapeBounds(shape),
      textBounds: rect(drawing.information(shape)?.textTransform),
    };
  });
  return { result, shapes };
};
describe("SmartArt height search", () => {
  it.each(native.cases)(
    "matches native geometry and independent text projection: $name",
    async (row) => {
      const { p, frame } = await semanticTextGroupDeck(row),
        before = unzipSync(await P.savePresentation(p)),
        { result, shapes } = draw(frame, row);
      expect(result.fits).toBe(row.fits);
      expect(shapes).toHaveLength(row.expected.length);
      for (const [i, shape] of shapes.entries()) {
        const expected = row.expected[i];
        for (const k of ["name", "text", "font"])
          expect(shape[k], `${i}.${k}`).toEqual(expected[k]);
        for (const field of ["bounds", "textBounds"]) {
          if (expected[field] === null) expect(shape[field]).toBeNull();
          else
            for (const k of ["x", "y", "w", "h"]) {
              // Do not let the usual native EMU rounding tolerance mask zero
              // geometry becoming one EMU, or a zero text rectangle losing text.
              if ((k === "w" || k === "h") && expected[field][k] <= 1)
                expect(shape[field][k], `${i}.${field}.${k}`).toBe(
                  expected[field][k],
                );
              else
                expect(
                  Math.abs(shape[field][k] - expected[field][k]),
                  `${i}.${field}.${k}`,
                ).toBeLessThanOrEqual(1);
            }
        }
      }
      expect(draw(frame, row).shapes).toEqual(shapes);
      expect(unzipSync(await P.savePresentation(p))).toEqual(before);
      const reopened = await P.loadPresentation(await P.savePresentation(p));
      expect(
        draw(
          P.getSlideShapes(P.getSlides(reopened)[0]).find(isDiagramShape),
          row,
        ).shapes,
      ).toEqual(shapes);
    },
  );
});

it.each(
  ["svg", "foreignObject"].flatMap((mode) =>
    [
      "search-holdout / end h0.1 limit25.9 font32",
      "expansion / h0.000001 font32 limitINF",
      "exhaustion / width 20 fontRule true",
    ].map((name) => ({ mode, name })),
  ),
)(
  "preserves height fitting through $mode rendering and bidirectional copy/export: $name",
  async ({ mode, name }) => {
    const row = native.cases.find((r) => r.name === name),
      { p, frame } = await semanticTextGroupDeck(row),
      render = (pres, slide = P.getSlides(pres)[0]) =>
        renderSlideToSvg(pres, slide, {
          textLayout: mode,
          stableDefinitionIds: true,
        }),
      before = unzipSync(await P.savePresentation(p)),
      expected = draw(frame, row).shapes,
      svg = render(p);
    expect(svg).toContain('data-pptx-diagram="semantic-layout"');
    expect(svg).not.toContain("data-pptx-diagram-issues");
    expect(svg).toContain("Alpha");
    expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    const local = P.addSlide(p, { layout: P.getSlideLayouts(p)[0] });
    expect(draw(P.copyShape(local, frame), row).shapes).toEqual(expected);
    const target = createDeck("blank"),
      blank = P.getSlides(target)[0];
    P.importSlide(target, local, P.getSlideLayouts(target)[0]);
    P.removeSlide(target, blank);
    const transferred = render(target),
      reopened = await P.loadPresentation(await P.savePresentation(target));
    expect(render(reopened)).toBe(transferred);
    expect(transferred).toContain("Alpha");
    expect(
      draw(P.getSlideShapes(P.getSlides(reopened)[0]).find(isDiagramShape), row)
        .shapes,
    ).toEqual(expected);
    const returned = P.importSlide(
      p,
      P.getSlides(reopened)[0],
      P.getSlideLayouts(p)[0],
    );
    expect(
      draw(P.getSlideShapes(returned).find(isDiagramShape), row).shapes,
    ).toEqual(expected);
    expect(render(p, returned)).toContain("Alpha");
  },
);
