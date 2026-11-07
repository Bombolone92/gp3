import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { P, createDeck } from "../src/model.js";
import { semanticTextGroupDeck } from "./diagram-text-group-fixture.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { isDiagramShape } from "../lib/pptx/src/api/fn/diagram-read.ts";
import native from "./data/diagram-composite-resize-equality-native.json";
import {
  parseXml,
  childElements,
  serializeFragment,
  textContent,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { evaluateDiagramInitialConstraints as evaluate } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
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
  return !m.collapsed && m.wordFits && state.size.h >= m.requiredHeight;
};
describe("resizing independent composite canvases and local ruler bindings", () => {
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
