import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import native from "./data/diagram-composite-height-allocation-native.json";
import execution from "./data/diagram-composite-execution-native.json";
import { P, createDeck } from "../src/model.js";
import { diagramCompositeHeightAllocationDeck } from "./diagram-composite-canvas-fixture.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  childElements,
  getAttrValue,
  parseXml,
  qname,
  serializeFragment,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { reflowDiagramLayout } from "../lib/pptx/src/internal/diagram/reflow.ts";

const measure = (row) => (node, state) => {
  const key = JSON.stringify([
    node.name,
    node.context.point.id,
    state.size.w,
    state.size.h,
    ...["primFontSz", "secFontSz", "lMarg", "rMarg", "tMarg", "bMarg"].map(
      (type) => state.values.get(type),
    ),
  ]);
  const measurement = row.measurements[key];
  if (!measurement) throw new Error(`Unrecorded glyph measurement ${key}`);
  const heightFits = state.size.h >= measurement.requiredHeight;
  return { heightFits, fits: heightFits && measurement.wordFits };
};

describe("COMPOSITE local height allocation", () => {
  it.each([
    ...[0, 3, 4, 7, 8, 11, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31].map(
      (index) => native.cases[index],
    ),
    { ...execution.cases[1], expectedContentFit: false },
    { ...execution.cases[3], expectedContentFit: false },
  ])("matches native geometry and reports content fit: $name", (row) => {
    const data = parseXml(row.data),
      layout = parseXml(row.layout),
      before = [serializeXml(data), serializeXml(layout)],
      root = expandDiagramLayout(
        layout.root,
        readDiagramHierarchy(readDiagramDataModel(data.root)),
      ),
      run = () =>
        reflowDiagramLayout(root, row.available, { textFits: measure(row) }),
      result = run(),
      leaves = [...result.bounds.keys()].filter(
        (node) => !node.children.length,
      );
    // Native keeps the physical boxes when the body text overflows. Geometry
    // agreement must not imply that overflowing content has become fitted.
    expect(result.fits).toBe(row.expectedContentFit);
    expect(leaves.map((node) => node.name)).toEqual(
      row.expected.map((node) => node.name),
    );
    for (const [index, node] of leaves.entries()) {
      const expected = row.expected[index];
      for (const key of ["x", "y", "w", "h"])
        expect(
          Math.abs(
            Math.trunc(result.bounds.get(node)[key] * 36000) -
              expected.bounds[key],
          ),
          `${node.name}.${key}`,
        ).toBeLessThanOrEqual(1);
      expect(result.drawing.get(node).values.get("primFontSz")).toBe(
        expected.font,
      );
    }
    const repeated = run();
    expect(repeated.bounds).toEqual(result.bounds);
    expect(repeated.fits).toBe(result.fits);
    expect([serializeXml(data), serializeXml(layout)]).toEqual(before);
  });
});

it.each(
  [0, 3, 8, 11, 16, 24].flatMap((index) =>
    ["svg", "foreignObject"].map((mode) => [index, mode]),
  ),
)(
  "preserves height allocation through %i/%s edit, bidirectional copy and save",
  async (index, mode) => {
    const { p, frame } = await diagramCompositeHeightAllocationDeck(index),
      render = (pres, slide = P.getSlides(pres)[0]) =>
        renderSlideToSvg(pres, slide, {
          textLayout: mode,
          stableDefinitionIds: true,
        }),
      diagram = (svg) =>
        serializeFragment(
          [...childElements(parseXml(svg).root)].find((element) =>
            getAttrValue(element, qname("", "data-pptx-diagram", "")),
          ),
        ),
      before = unzipSync(await P.savePresentation(p)),
      original = render(p),
      entries = P.getShapeDiagramTextEntries(frame);
    expect(original).toContain('data-pptx-diagram="semantic-layout"');
    expect(original).not.toContain("data-pptx-diagram-issues");
    expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    P.replaceShapeDiagramText(frame, [
      { modelId: entries[0].modelId, text: "OK" },
    ]);
    expect(render(p)).toContain("OK");
    P.replaceShapeDiagramText(frame, [
      { modelId: entries[0].modelId, text: entries[0].text },
    ]);
    expect(diagram(render(p))).toBe(diagram(original));
    const local = P.addSlide(p, { layout: P.getSlideLayouts(p)[0] });
    P.copyShape(local, frame);
    expect(diagram(render(p, local))).toBe(diagram(original));
    const target = createDeck("blank"),
      blank = P.getSlides(target)[0];
    P.importSlide(target, local, P.getSlideLayouts(target)[0]);
    P.removeSlide(target, blank);
    const transferred = render(target),
      reopened = await P.loadPresentation(await P.savePresentation(target));
    expect(render(reopened)).toBe(transferred);
    expect(P.validatePresentation(reopened)).toEqual([]);
    const copied = P.getSlideShapes(P.getSlides(reopened)[0]).find(
      P.isDiagramShape,
    );
    expect(
      P.getShapeDiagramTextEntries(copied).map(({ text, depth }) => ({
        text,
        depth,
      })),
    ).toEqual(entries.map(({ text, depth }) => ({ text, depth })));
    const back = P.importSlide(
      p,
      P.getSlides(reopened)[0],
      P.getSlideLayouts(p)[0],
    );
    expect(diagram(render(p, back))).toBe(diagram(original));
  },
);
