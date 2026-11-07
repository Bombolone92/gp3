import { describe, expect, it } from "vitest";
import native from "./data/diagram-composite-reference-publication-native.json";
import {
  parseXml,
  serializeFragment,
  textContent,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { reflowDiagramLayout } from "../lib/pptx/src/internal/diagram/reflow.ts";
const layout = (row) =>
  expandDiagramLayout(
    parseXml(row.layout).root,
    readDiagramHierarchy(readDiagramDataModel(parseXml(row.data).root)),
  );
const type = (node) =>
  node.shape && getAttrValue(node.shape, qname("", "type", ""));
const measure = (row) => (node, state) => {
  const key = JSON.stringify([
    node.name,
    node.contributors.map((c) => textContent(c.point.text)).join("\n"),
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
describe("publishing fitted references into projected composite geometry", () => {
  it.each(native.cases)(
    "matches complete native fitting and geometry: $name",
    (row) => {
      const root = layout(row),
        before = serializeFragment(root.definition),
        run = () =>
          reflowDiagramLayout(root, row.available, { textFits: measure(row) }),
        result = run();
      const drawn = [...result.bounds.keys()].filter(
        (n) => type(n) && type(n) !== "none",
      );
      expect(drawn).toHaveLength(row.expected.length);
      expect(result.fits).toBe(row.fits);
      for (const [i, n] of drawn.entries()) {
        expect(n.name).toBe(row.expected[i].name);
        for (const k of ["x", "y", "w", "h"])
          expect(
            Math.abs(
              Math.trunc(result.bounds.get(n)[k] * 36000) -
                row.expected[i].bounds[k],
            ),
            `${n.name}.${k}`,
          ).toBeLessThanOrEqual(1);
        if (row.expected[i].font.length)
          expect(result.drawing.get(n).values.get("primFontSz")).toBe(
            Number(row.expected[i].font[0]) / 100,
          );
      }
      // Allocation retains the frame canvas; a LIN drawing uses its child union.
      expect(result.allocation.get(root).size).toEqual(row.available);
      expect(run().bounds).toEqual(result.bounds);
      expect(serializeFragment(root.definition)).toBe(before);
    },
  );
});

// The absolute geometry of some nested scopes still has separate compatibility
// gaps. This invariant isolates which fitted variable reaches the outer scope:
// both markers receive the same horizontal projection. Native XML truncates
// each width to whole EMUs, so compare the ratio within those exact intervals.
describe("fitted reference ownership across intermediate canvases", () => {
  it.each(native.scopeCases)(
    "keeps the native reference ratio: $name",
    (row) => {
      const result = reflowDiagramLayout(layout(row), row.available, {
        textFits: measure(row),
      });
      const nodes = [...result.bounds.keys()];
      const a = nodes.find((n) => n.name === "referenceProbe");
      const b = nodes.find((n) => n.name === "constantProbe");
      const actual = result.bounds.get(a).w / result.bounds.get(b).w;
      const expectedA = row.expected.find((n) => n.name === "referenceProbe")
        .bounds.w;
      const expectedB = row.expected.find((n) => n.name === "constantProbe")
        .bounds.w;
      expect(actual).toBeGreaterThanOrEqual(expectedA / (expectedB + 1));
      expect(actual).toBeLessThanOrEqual((expectedA + 1) / expectedB);
    },
  );
});
