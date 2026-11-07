import { describe, expect, it } from "vitest";
import native from "./data/diagram-composite-shared-height-retry.json";
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
describe("shared text height survives physical canvas replacement", () => {
  it.each(native.cases)(
    "keeps every member fitted after resize: $name",
    (row) => {
      const root = layout(row),
        before = serializeFragment(root.definition);
      const result = reflowDiagramLayout(root, row.available, {
        textFits: measure(row),
      });
      const members = [...result.bounds.keys()].filter(
        (n) => type(n) === "rect" && n.contributors.length,
      );
      expect(members).toHaveLength(2);
      expect(result.fits).toBe(true);
      for (const states of [result.allocation, result.drawing]) {
        const first = states.get(members[0]).size.h;
        for (const member of members) {
          const state = states.get(member);
          expect(state.size.h).toBeCloseTo(first, 10);
          expect(measure(row)(member, state).fits).toBe(true);
        }
      }
      expect(result.allocation.get(root).size).toEqual(row.available);
      expect(serializeFragment(root.definition)).toBe(before);
    },
  );
});
