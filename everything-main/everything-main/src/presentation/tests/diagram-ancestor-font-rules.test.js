import { describe, expect, it } from "vitest";
import native from "./data/diagram-ancestor-font-rules-native.json";
import { unzipSync } from "fflate";
import { P, createDeck } from "../src/model.js";
import { diagramAncestorFontDeck } from "./diagram-ancestor-font-fixture.js";
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

describe("ordered ancestor font rules over direct text leaves", () => {
  for (const row of native.cases) {
    it(`matches native control: ${row.name}`, () => {
      const { root, data, document } = create(row),
        before = [serializeXml(data), serializeXml(document)],
        run = () =>
          reflowDiagramLayout(root, row.available, { textFits: measure(row) });
      if (row.unsupported) {
        expect(run).toThrow(row.unsupported);
      } else {
        const result = run();
        expect(result.fits).toBe(row.fits);
        for (const [i, node] of root.children.entries()) {
          const expected = row.expected[i];
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
          for (const [key, value] of Object.entries(expected.margins ?? {}))
            expect(
              Math.abs(
                Math.trunc(result.drawing.get(node).values.get(key) * 12700) -
                  value,
              ),
              `${node.name}.${key}`,
            ).toBeLessThanOrEqual(1);
        }
        expect(run().bounds).toEqual(result.bounds);
      }
      expect([serializeXml(data), serializeXml(document)]).toEqual(before);
    });
  }
  it("budgets ancestor glyph probes and leaves input XML unchanged on failure", () => {
    const row = native.cases[0],
      { root, document, data } = create(row),
      before = [serializeXml(data), serializeXml(document)];
    expect(() =>
      reflowDiagramLayout(root, row.available, {
        textFits: () => {
          throw new Error("measurement interrupted");
        },
      }),
    ).toThrow("measurement interrupted");
    expect(() =>
      reflowDiagramLayout(root, row.available, {
        textFits: measure(row),
        maxOperations: 6,
      }),
    ).toThrow("diagram reflow operation budget exceeded");
    expect([serializeXml(data), serializeXml(document)]).toEqual(before);
  });
  it("is independent of data identifiers and layout names", () => {
    const original = native.cases[0],
      rename = (s) =>
        s
          .replaceAll('"a"', '"first-label"')
          .replaceAll('"b"', '"peer-label"')
          .replaceAll('"1"', '"53"'),
      row = {
        ...original,
        data: original.data
          .replace('modelId="1"', 'modelId="53"')
          .replace('destId="1"', 'destId="53"'),
        layout: original.layout
          .replaceAll('"a"', '"first-label"')
          .replaceAll('"b"', '"peer-label"'),
        measurements: Object.fromEntries(
          Object.entries(original.measurements).map(([key, value]) => [
            rename(key),
            value,
          ]),
        ),
      },
      { root } = create(row),
      result = reflowDiagramLayout(root, row.available, {
        textFits: measure(row),
      });
    expect(result.fits).toBe(true);
    expect(
      root.children.map((n) => result.drawing.get(n).values.get("primFontSz")),
    ).toEqual(original.expected.map((e) => e.font));
  });
});

it.each(
  [19, 20, 24, 28, 35, 38, 40, 42].flatMap((index) =>
    ["svg", "foreignObject"].map((mode) => [index, mode]),
  ),
)(
  "preserves customized ancestor fonts through %i/%s edit, bidirectional copy and save",
  async (index, mode) => {
    const { p, frame } = await diagramAncestorFontDeck(index),
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
