import { describe, expect, it } from "vitest";
import native from "./data/diagram-composite-drawing-native.json";
import {
  getAttrValue,
  qname,
  parseXml,
  serializeFragment,
  textContent,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { reflowDiagramLayout } from "../lib/pptx/src/internal/diagram/reflow.ts";

describe("composite allocation and drawing phases", () => {
  it.each(native.cases)("matches native composite drawing: $name", (row) => {
    const root = expandDiagramLayout(
        parseXml(row.layout).root,
        readDiagramHierarchy(readDiagramDataModel(parseXml(row.data).root)),
      ),
      before = serializeFragment(root.definition);
    const run = () =>
      reflowDiagramLayout(root, row.available, {
        textFits: (node, state) => {
          const key = JSON.stringify([
              node.name,
              node.contributors
                .map((c) => textContent(c.point.text))
                .join("\n"),
              state.size.w,
              state.size.h,
              ...[
                "primFontSz",
                "secFontSz",
                "lMarg",
                "rMarg",
                "tMarg",
                "bMarg",
              ].map((k) => state.values.get(k)),
            ]),
            m = row.measurements[key];
          if (!m) throw Error(`Unrecorded glyph measurement ${key}`);
          return !m.collapsed && m.wordFits && state.size.h >= m.requiredHeight;
        },
      });
    const result = run();
    const drawable = [...result.bounds.keys()].filter((node) => {
      const type =
        node.shape && getAttrValue(node.shape, qname("", "type", ""));
      return type && type !== "none";
    });
    expect(drawable).toHaveLength(row.expected.length);
    for (const [i, node] of drawable.entries()) {
      const actual = result.bounds.get(node),
        state = result.drawing.get(node),
        expected = row.expected[i];
      if (
        getAttrValue(node.algorithm, qname("", "type", "")) === "tx" &&
        expected.font?.length
      )
        expect(state.values.get("primFontSz")).toBe(
          Math.round(Number(expected.font[0]) / 100),
        );
      for (const key of ["x", "y", "w", "h"])
        expect(
          Math.abs(Math.trunc(actual[key] * 36000) - expected.bounds[key]),
          `${node.name}.${key}`,
        ).toBeLessThanOrEqual(1);
      for (const side of ["l", "r", "t", "b"])
        if (
          getAttrValue(node.algorithm, qname("", "type", "")) === "tx" &&
          expected.margins?.[`${side}Ins`] != null
        )
          expect(
            Math.abs(
              Math.round(state.values.get(`${side}Marg`) * 12700) -
                Number(expected.margins[`${side}Ins`]),
            ),
            `${node.name}.${side}Marg`,
          ).toBeLessThanOrEqual(1);
    }
    expect(run().bounds).toEqual(result.bounds);
    expect(serializeFragment(root.definition)).toBe(before);
  });
});
