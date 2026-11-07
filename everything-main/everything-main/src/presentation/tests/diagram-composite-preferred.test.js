import { describe, expect, it } from "vitest";
import native from "./data/diagram-composite-preferred-native.json";
import {
  parseXml,
  serializeFragment,
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
const run = (root, available) =>
  reflowDiagramLayout(root, available, { textFits: () => true });
describe("unbounded composite drawing and parent fitting", () => {
  it.each(native.cases)("matches native completed geometry: $name", (row) => {
    const root = layout(row),
      before = serializeFragment(root.definition),
      result = run(root, row.available);
    const drawn = [...result.bounds].filter(([node, rect]) => {
      for (const value of Object.values(rect))
        expect(Number.isFinite(value)).toBe(true);
      expect(rect.w).toBeGreaterThanOrEqual(0);
      expect(rect.h).toBeGreaterThanOrEqual(0);
      const type =
        node.shape && getAttrValue(node.shape, qname("", "type", ""));
      return type && type !== "none" && (rect.w !== 0 || rect.h !== 0);
    });
    expect(drawn).toHaveLength(row.expected.length);
    for (const [i, [node, rect]] of drawn.entries()) {
      expect(node.name).toBe(row.expected[i].name);
      for (const key of ["x", "y", "w", "h"])
        expect(
          Math.abs(Math.trunc(rect[key] * 36000) - row.expected[i].bounds[key]),
          `${node.name}.${key}`,
        ).toBeLessThanOrEqual(1);
    }
    expect(run(root, row.available).bounds).toEqual(result.bounds);
    expect(serializeFragment(root.definition)).toBe(before);
  });
  it("retains zero constraint values and semantic nodes until a parent retry supplies a canvas", () => {
    const row = native.cases.find((r) => r.name === "mixed fixed and relative"),
      root = layout(row),
      result = run(root, row.available),
      group = root.children[0],
      relative = group.children[1];
    expect(result.bounds.size).toBe(4);
    expect(result.allocation.get(group).size).toEqual({ w: 0, h: 0 });
    expect(result.drawing.get(group).values.get("w")).toBe(0);
    expect(result.drawing.get(group).values.get("h")).toBe(0);
    expect(result.bounds.get(group)).toMatchObject({ w: 40, h: 20 });
    expect(result.bounds.get(relative)).toMatchObject({ w: 0, h: 0 });
    const resized = run(root, { w: 30, h: 25 });
    expect(resized.bounds.get(relative).w).toBeGreaterThan(0);
    expect(resized.bounds.get(relative).h).toBeGreaterThan(0);
    expect(run(root, row.available).bounds).toEqual(result.bounds);
  });
});
