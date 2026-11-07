import { describe, expect, it } from "vitest";
import native from "./data/diagram-composite-height-rules-native.json";
import { parseXml, serializeXml } from "../lib/pptx/src/internal/xml/index.ts";
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

describe("unbounded composite height preferences precede parent arrangement", () => {
  it.each(native.cases)("matches native control: $name", (row) => {
    const { data, document, root } = create(row),
      before = [serializeXml(data), serializeXml(document)],
      run = () =>
        reflowDiagramLayout(root, row.available, { textFits: measure(row) });
    if (row.unsupported) {
      expect(run).toThrow(row.unsupported);
    } else {
      const result = run(),
        box = root.children[0];
      expect(result.fits).toBe(true);
      expect(box.children).toHaveLength(row.expected.length);
      for (const [i, node] of box.children.entries()) {
        const expected = row.expected[i];
        expect([node.name, node.context.point.id]).toEqual([
          expected.name,
          expected.context,
        ]);
        for (const key of ["x", "y", "w", "h"])
          expect(
            Math.abs(
              Math.trunc(result.bounds.get(node)[key] * 36000) -
                expected.bounds[key],
            ),
            `${node.name}.${key}`,
          ).toBeLessThanOrEqual(1);
        if (node.name === "label")
          expect(result.drawing.get(node).values.get("primFontSz")).toBe(
            expected.font,
          );
      }
      expect(run().bounds).toEqual(result.bounds);
      expect(result.allocation.get(root).size).toEqual(row.available);
    }
    expect([serializeXml(data), serializeXml(document)]).toEqual(before);
  });

  it("counts preference work against the shared operation budget", () => {
    const row = native.cases[0],
      { root } = create(row);
    expect(() =>
      reflowDiagramLayout(root, row.available, {
        textFits: measure(row),
        maxOperations: 2,
      }),
    ).toThrow("diagram reflow operation budget exceeded");
  });

  it("does not select behavior from layout names or data identifiers", () => {
    const original = native.cases[0],
      rename = (value) =>
        value
          .replaceAll('"box"', '"container-alias"')
          .replaceAll('"label"', '"text-alias"')
          .replaceAll('"marker"', '"observer-alias"')
          .replaceAll('"1"', '"42"'),
      row = {
        ...original,
        data: original.data
          .replace('modelId="1"', 'modelId="42"')
          .replace('destId="1"', 'destId="42"'),
        layout: original.layout
          .replaceAll('"box"', '"container-alias"')
          .replaceAll('"label"', '"text-alias"')
          .replaceAll('"marker"', '"observer-alias"'),
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
    for (const [i, node] of root.children[0].children.entries())
      for (const key of ["x", "y", "w", "h"])
        expect(Math.round(result.bounds.get(node)[key] * 36000)).toBe(
          original.expected[i].bounds[key],
        );
  });

  it.each(['val="25"', 'max="50"', 'fact="2"'])(
    "keeps finite/relative container retry explicit: %s",
    (mode) => {
      const row = native.cases[0],
        { root } = create({
          ...row,
          layout: row.layout.replace('val="INF"', mode),
        });
      expect(() =>
        reflowDiagramLayout(root, row.available, { textFits: measure(row) }),
      ).toThrow("unsupported diagram container adjustment rules");
    },
  );
});
