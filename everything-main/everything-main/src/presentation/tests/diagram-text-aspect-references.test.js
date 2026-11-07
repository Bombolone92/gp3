import { describe, expect, it } from "vitest";
import native from "./data/diagram-text-aspect-references-native.json";
import { unzipSync } from "fflate";
import { P, createDeck } from "../src/model.js";
import { diagramAspectReferenceDeck } from "./diagram-text-aspect-reference-fixture.js";
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
import { evaluateDiagramInitialConstraints as evaluate } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import { reflowDiagramLayout } from "../lib/pptx/src/internal/diagram/reflow.ts";

const create = (row) => {
  const data = parseXml(row.data),
    document = parseXml(row.layout);
  return {
    data,
    document,
    root: expandDiagramLayout(
      document.root,
      readDiagramHierarchy(readDiagramDataModel(data.root)),
    ),
  };
};
const nearEMU = (value, expected, name) =>
  expect(
    Math.abs(Math.trunc(value * 36000) - expected),
    name,
  ).toBeLessThanOrEqual(1);
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

describe("completed TX aspect geometry in COMPOSITE references", () => {
  it.each(native.cases)("matches native fitting: $name", (row) => {
    const { root, data, document } = create(row),
      before = [serializeXml(data), serializeXml(document)],
      run = () =>
        reflowDiagramLayout(root, row.available, {
          textFits: measure(row),
        }),
      result = run();
    expect(result.fits).toBe(row.fits);
    const leaves = [...result.bounds.keys()].filter((n) => !n.children.length);
    expect(leaves.map((n) => n.name)).toEqual(row.expected.map((e) => e.name));
    for (const [i, node] of leaves.entries()) {
      const expected = row.expected[i];
      for (const key of ["x", "y", "w", "h"])
        nearEMU(
          result.bounds.get(node)[key],
          expected.bounds[key],
          `${node.name}.${key}`,
        );
      if (expected.font !== null)
        expect(result.drawing.get(node).values.get("primFontSz")).toBe(
          expected.font,
        );
    }
    expect(run().bounds).toEqual(result.bounds);
    expect([serializeXml(data), serializeXml(document)]).toEqual(before);
  });

  it.each(native.cases.filter((r) => r.coordinateReferences))(
    "publishes the native dimension and edge references before arrangement: $name",
    (row) => {
      const { root } = create(row),
        states = evaluate(root, row.available, {
          quantizeFonts: true,
          constrainTextAspect: true,
        }),
        group = root.children[0],
        query = group.children[0],
        probe = group.children[1],
        expected = row.expected[1],
        state = states.get(probe);
      nearEMU(state.coordinates.l, expected.bounds.x, "probe.l");
      nearEMU(state.coordinates.t, expected.bounds.y, "probe.t");
      nearEMU(state.size.w, expected.bounds.w, "probe.w");
      nearEMU(state.size.h, expected.bounds.h, "probe.h");
      const replay = states.get(group).evaluateScope();
      expect(replay.get(query).coordinates).toEqual(
        states.get(query).coordinates,
      );
      expect(replay.get(probe).size).toEqual(state.size);
      expect(replay.get(probe).coordinates).toEqual(state.coordinates);
    },
  );
});

it.each(
  [0, 8, 12, 16].flatMap((index) =>
    ["svg", "foreignObject"].map((mode) => [index, mode]),
  ),
)(
  "preserves native aspect references through %i/%s edit, bidirectional copy and save",
  async (index, mode) => {
    const { p, frame } = await diagramAspectReferenceDeck(index),
      render = (pres, slide = P.getSlides(pres)[0]) =>
        renderSlideToSvg(pres, slide, {
          textLayout: mode,
          stableDefinitionIds: true,
        }),
      diagram = (svg) =>
        serializeFragment(
          [...childElements(parseXml(svg).root)].find((e) =>
            getAttrValue(e, qname("", "data-pptx-diagram", "")),
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
