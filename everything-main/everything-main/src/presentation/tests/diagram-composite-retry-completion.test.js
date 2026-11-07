import { describe, expect, it } from "vitest";
import native from "./data/diagram-composite-retry-completion-native.json";
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
describe("completed child retries preserve their height and reference scopes", () => {
  it.each(native.cases)(
    "matches native geometry and text margins: $name",
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
        if (row.expected[i].font.length) {
          expectMargin(result, n, row.expected[i]);
          expect(result.drawing.get(n).values.get("primFontSz")).toBe(
            Number(row.expected[i].font[0]) / 100,
          );
        }
      }
      // Allocation retains the frame canvas; a LIN drawing uses its child union.
      expect(result.allocation.get(root).size).toEqual(row.available);
      expect(run().bounds).toEqual(result.bounds);
      expect(serializeFragment(root.definition)).toBe(before);
    },
  );
});

const expectMargin = (result, node, expected) => {
  const body = parseXml(expected.textXml).root.children.find(
    (n) => n.kind === "element" && n.name.localName === "bodyPr",
  );
  const nativeMargin = Number(getAttrValue(body, qname("", "lIns", "")));
  expect(
    Math.round(result.drawing.get(node).values.get("lMarg") * 12700),
    node.name,
  ).toBe(nativeMargin);
};
