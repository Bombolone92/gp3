import { describe, expect, it } from "vitest";
import native from "./data/diagram-composite-canvas-native.json";
import execution from "./data/diagram-composite-execution-native.json";
import { unzipSync } from "fflate";
import { P, createDeck } from "../src/model.js";
import { diagramCompositeCanvasDeck } from "./diagram-composite-canvas-fixture.js";
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
import { fitDiagramCompositeCanvas } from "../lib/pptx/src/internal/diagram/composite-canvas.ts";

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

describe("COMPOSITE reference canvas fitting", () => {
  it.each([
    ...native.cases,
    ...execution.cases.filter(
      (row) => row.matrix === "positions" || row.matrix === "projection",
    ),
  ])("matches native fitting: $name", (row) => {
    const { root, data, document } = create(row),
      before = [serializeXml(data), serializeXml(document)],
      run = () =>
        reflowDiagramLayout(root, row.available, {
          textFits: measure(row),
        }),
      result = run();
    expect(result.fits).toBe(true);
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
      if (
        node.algorithm &&
        getAttrValue(node.algorithm, qname("", "type", "")) === "tx" &&
        expected.font !== null
      )
        expect(result.drawing.get(node).values.get("primFontSz")).toBe(
          expected.font,
        );
    }
    expect(run().bounds).toEqual(result.bounds);
    expect([serializeXml(data), serializeXml(document)]).toEqual(before);
  });
});

it.each([44, 46, 50, 56])(
  "reserves only an actively aspect-fitted automatic coordinate span: %i",
  (index) => {
    const row = native.cases[index],
      { root } = create(row),
      query = root.children[0],
      axis = row.axis,
      leading = axis === "w" ? "l" : "t",
      options = { constrainTextAspect: true },
      state = evaluate(root, row.available, options).get(query),
      trial = (value) => ({
        owner: query,
        property: {
          type: axis,
          selector: { relationship: "self", pointType: "all", name: "" },
        },
        value,
      });
    expect(state.aspectReservation).toEqual({
      [axis]: state.coordinates[axis],
    });
    expect(state.coordinates[axis]).toBeGreaterThan(state.size[axis]);
    for (const key of ["changes", "adjustments"])
      expect(
        evaluate(root, row.available, { ...options, [key]: [trial(0)] }).get(
          query,
        ).aspectReservation,
      ).toBeUndefined();
    const unpositioned = create({
      ...row,
      layout: row.layout.replace(
        new RegExp(
          `<d:constr type="${leading}" for="ch" forName="query" val="[^"]*"/>`,
        ),
        "",
      ),
    }).root;
    expect(
      evaluate(unpositioned, row.available, options).get(
        unpositioned.children[0],
      ).aspectReservation,
    ).toBeUndefined();
    expect(state.aspectReservation[axis]).toBe(state.coordinates[axis]);
  },
);

it("retains local expression and ordered rule trials only when requested", () => {
  const row = native.cases[0],
    { root } = create(row),
    query = root.children[0],
    self = (node, type, value) => ({
      owner: node,
      property: {
        type,
        selector: { relationship: "self", pointType: "all", name: "" },
      },
      value,
    }),
    states = evaluate(root, row.available, {
      changes: [self(query, "primFontSz", 12)],
      adjustments: [self(query, "primFontSz", 10)],
    }),
    state = states.get(root),
    trial = { changes: [self(root, "h", 400)] };
  expect(states.get(query).values.get("primFontSz")).toBe(10);
  expect(state.evaluateScope(trial).get(query).values.get("primFontSz")).toBe(
    evaluate(root, row.available).get(query).values.get("primFontSz"),
  );
  expect(
    state
      .evaluateScope({ ...trial, retainLocalTrials: true })
      .get(query)
      .values.get("primFontSz"),
  ).toBe(10);
  expect(
    state
      .evaluateScope({
        ...trial,
        retainLocalTrials: true,
        adjustments: [self(query, "primFontSz", 9)],
      })
      .get(query)
      .values.get("primFontSz"),
  ).toBe(9);
  expect(states.get(query).values.get("primFontSz")).toBe(10);
});

it("charges divergent reference canvases to the caller's operation budget", () => {
  let probes = 0;
  expect(() =>
    fitDiagramCompositeCanvas(100, 300, (ruler) => {
      if (++probes > 32) throw Error("operation budget exceeded");
      return ruler + 200;
    }),
  ).toThrow("operation budget exceeded");
  expect(probes).toBe(33);
});

it("rejects invalid or unbounded reference geometry", () => {
  expect(() => fitDiagramCompositeCanvas(100, 300, () => NaN)).toThrow(
    "invalid diagram composite reference extent",
  );
  expect(() =>
    fitDiagramCompositeCanvas(Number.MAX_VALUE, Infinity, () => 1),
  ).toThrow("unbounded diagram composite reference canvas");
});

it.each(
  [0, 1, 6, 7, 44, 45, 46, 47, 50, 56, 60, 61, 70, 72, 74, 75, 84, 86].flatMap(
    (index) => ["svg", "foreignObject"].map((mode) => [index, mode]),
  ),
)(
  "preserves native reference canvases through %i/%s edit, bidirectional copy and save",
  async (index, mode) => {
    const { p, frame } = await diagramCompositeCanvasDeck(index),
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
