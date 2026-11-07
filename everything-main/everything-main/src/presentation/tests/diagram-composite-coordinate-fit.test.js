import { describe, expect, it } from "vitest";
import native from "./data/diagram-composite-coordinate-fit-native.json";
import { P, createDeck } from "../src/model.js";
import { semanticTextGroupDeck } from "./diagram-text-group-fixture.js";
import { reflowShapeDiagram } from "../lib/pptx/src/api/fn/diagram-reflow.ts";
import { buildDiagramDrawing } from "../lib/pptx/src/api/fn/diagram-build.ts";
import { isDiagramShape } from "../lib/pptx/src/api/fn/diagram-read.ts";
import { unzipSync } from "fflate";
const input = (row) => ({
  ...row,
  data: native.models[row.model],
  layout: native.layouts[row.layout],
});
const expectDrawing = (frame, row) => {
  const result = reflowShapeDiagram(frame, {
    textFits: () => {
      throw new Error("Geometry controls must not depend on text fitting");
    },
  });
  const drawing = buildDiagramDrawing(frame, result);
  const actual = P.getGroupChildren(drawing.root).map((shape) => ({
    name: P.getShapeName(shape),
    bounds: P.getShapeBounds(shape),
    text: P.getShapeText(shape),
  }));
  expect(actual.map((x) => x.name)).toEqual(row.expected.map((x) => x.name));
  for (const [i, a] of actual.entries()) {
    expect(a.text).toBe(row.expected[i].text);
    for (const k of ["x", "y", "w", "h"])
      expect(
        Math.abs(a.bounds[k] - row.expected[i].bounds[k]),
        a.name + "." + k,
      ).toBeLessThanOrEqual(1);
  }
};
describe("composite fitted coordinates and reference publication", () => {
  it.each(native.cases)("matches native geometry: $name", async (row) => {
    const { p, frame } = await semanticTextGroupDeck(input(row));
    const before = unzipSync(await P.savePresentation(p));
    expectDrawing(frame, row);
    expectDrawing(frame, row);
    expect(unzipSync(await P.savePresentation(p))).toEqual(before);
  });
  it.each([
    "x available100 center rulers",
    "y available100 end rulers",
    "automatic x available100 start rulers",
    "y automatic-default rulers",
    "x live-after rulers",
    "y nested rulers",
  ])("preserves %s through copy, export, and return import", async (name) => {
    const row = native.cases.find((x) => x.name === name);
    const { p, frame } = await semanticTextGroupDeck(input(row));
    expectDrawing(frame, row);
    const target = createDeck("blank");
    const staging = P.importSlide(
      target,
      P.getSlides(p)[0],
      P.getSlideLayouts(target)[0],
    );
    P.copyShape(
      P.getSlides(target)[0],
      P.getSlideShapes(staging).find(isDiagramShape),
    );
    P.removeSlide(target, staging);
    P.compactPackage(target);
    const reopened = await P.loadPresentation(await P.savePresentation(target));
    const slide = P.getSlides(reopened)[0];
    expectDrawing(P.getSlideShapes(slide).find(isDiagramShape), row);
    const returned = P.importSlide(p, slide, P.getSlideLayouts(p)[0]);
    expectDrawing(P.getSlideShapes(returned).find(isDiagramShape), row);
  });
});
