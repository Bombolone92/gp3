import { describe, expect, it } from "vitest";
import native from "./data/diagram-sibling-height-retry-native.json";
import {
  parseXml,
  serializeFragment,
  textContent,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { reflowDiagramLayout } from "../lib/pptx/src/internal/diagram/reflow.ts";

describe("parent retry with fitting headers and overflowing siblings", () => {
  it.each(native.cases)("matches native retry geometry: $name", (row) => {
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
    for (const [i, node] of root.children
      .flatMap((n) => n.children)
      .entries()) {
      const actual = result.bounds.get(node),
        state = result.drawing.get(node),
        expected = row.expected[i];
      expect(state.values.get("primFontSz")).toBe(
        Math.round(Number(expected.font[0]) / 100),
      );
      for (const key of ["x", "y", "w", "h"])
        expect(
          Math.abs(Math.trunc(actual[key] * 36000) - expected.bounds[key]),
          `${node.name}.${key}`,
        ).toBeLessThanOrEqual(1);
      for (const side of ["l", "r", "t", "b"])
        expect(
          Math.abs(
            Math.round(state.values.get(`${side}Marg`) * 12700) -
              Number(expected.margins[`${side}Ins`]),
          ),
          `${node.name}.${side}Marg`,
        ).toBeLessThanOrEqual(1);
    }
    expect(serializeFragment(root.definition)).toBe(before);
  });
});
