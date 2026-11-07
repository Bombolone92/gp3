import { describe, expect, it } from "vitest";
import native from "./data/diagram-allocation-geometry-native.json";
import {
  NS,
  parseXml,
  serializeXml,
  serializeFragment,
} from "../lib/pptx/src/internal/xml/index.ts";
import { sample } from "./diagram-layout-fixture.js";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { evaluateDiagramInitialConstraints } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import {
  arrangeDiagramChildren,
  readDiagramArrangement,
} from "../lib/pptx/src/internal/diagram/arrange.ts";
import { reflowDiagramLayout } from "../lib/pptx/src/internal/diagram/reflow.ts";

const prepare = (row) => {
  const data = parseXml(native.models[row.model]),
    layout = parseXml(native.layouts[row.layout]);
  return {
    data,
    layout,
    root: expandDiagramLayout(
      layout.root,
      readDiagramHierarchy(readDiagramDataModel(data.root)),
    ),
  };
};
describe("semantic diagram reflow coordinator", () => {
  const simple = (content, algorithm = "lin") =>
    expandDiagramLayout(
      parseXml(
        `<d:layoutNode xmlns:d="${NS.diagram}" name="root"><d:alg type="${algorithm}"><d:param type="horzAlign" val="none"/><d:param type="vertAlign" val="none"/></d:alg>${content}</d:layoutNode>`,
      ).root,
      sample().tree,
    );
  it.each(["lin", "composite"])(
    "completes deep drawings under %s within a bounded amount of work",
    (algorithm) => {
      const depth = 400;
      let content =
        '<d:layoutNode name="text"><d:alg type="tx"/><d:constrLst><d:constr type="w" val="3"/><d:constr type="h" val="4"/></d:constrLst></d:layoutNode>';
      for (let i = 0; i < depth; i++)
        content = `<d:layoutNode name="group${i}"><d:alg type="lin"><d:param type="horzAlign" val="none"/><d:param type="vertAlign" val="none"/></d:alg><d:constrLst><d:constr type="w" val="100"/><d:constr type="h" val="100"/></d:constrLst>${content}</d:layoutNode>`;
      const root = simple(content, algorithm),
        before = serializeFragment(root.definition);
      const result = reflowDiagramLayout(
        root,
        { w: 100, h: 100 },
        {
          textFits: () => true,
          // Repeatedly rebuilding every descendant at every ancestor exhausts
          // this linear work allowance long before completing the drawing.
          maxOperations: 20 * depth,
        },
      );
      expect(result.fits).toBe(true);
      expect(result.bounds.size).toBe(depth + 2);
      for (const bounds of result.bounds.values())
        expect(bounds).toEqual({ x: 0, y: 0, w: 3, h: 4 });
      expect(result.allocation.get(root).size).toEqual({ w: 100, h: 100 });
      expect(serializeFragment(root.definition)).toBe(before);
    },
  );

  it("runs a shared height prefix and rejects an active unsupported font replay", () => {
    const root = simple(
      `<d:constrLst><d:constr type="h" for="ch" val="2" op="equ"/></d:constrLst>${[1, 2].map((i) => `<d:layoutNode name="text${i}"><d:alg type="tx"/><d:constrLst><d:constr type="w" val="30"/></d:constrLst><d:ruleLst><d:rule type="h" val="15"/><d:rule type="primFontSz" val="5"/></d:ruleLst></d:layoutNode>`).join("")}`,
    );
    const before = serializeFragment(root.definition);
    const fitted = reflowDiagramLayout(
      root,
      { w: 100, h: 100 },
      { textFits: (_n, s) => s.size.h >= 8 },
    );
    expect(fitted.fits).toBe(true);
    expect(fitted.drawing.get(root.children[0]).size.h).toBe(
      fitted.drawing.get(root.children[1]).size.h,
    );
    expect(() =>
      reflowDiagramLayout(root, { w: 100, h: 100 }, { textFits: () => false }),
    ).toThrow("shared ordered diagram text rules");
    expect(serializeFragment(root.definition)).toBe(before);
  });
  it("does not execute a shared font rule after content already fits", () => {
    const root = simple(
      `<d:constrLst><d:constr type="primFontSz" for="ch" val="20" op="equ"/></d:constrLst>${[1, 2].map((i) => `<d:layoutNode name="text${i}"><d:alg type="tx"/><d:constrLst><d:constr type="w" val="30"/><d:constr type="h" val="30"/></d:constrLst><d:ruleLst><d:rule type="primFontSz" val="5"/></d:ruleLst></d:layoutNode>`).join("")}`,
    );
    expect(
      reflowDiagramLayout(root, { w: 100, h: 100 }, { textFits: () => true })
        .fits,
    ).toBe(true);
    const exhausted = reflowDiagramLayout(
      root,
      { w: 100, h: 100 },
      { textFits: () => false },
    );
    expect(exhausted.fits).toBe(false);
    for (const node of root.children)
      expect(exhausted.drawing.get(node).values.get("primFontSz")).toBe(5);
  });
  it("rearranges nested composite descendants after parent fallback", () => {
    const root = simple(
      `<d:layoutNode name="container"><d:alg type="composite"><d:param type="horzAlign" val="r"/><d:param type="vertAlign" val="none"/></d:alg><d:constrLst><d:constr type="w" val="100"/><d:constr type="h" val="40"/></d:constrLst><d:layoutNode name="text"><d:alg type="tx"/><d:constrLst><d:constr type="w" val="20"/><d:constr type="h" val="10"/></d:constrLst><d:ruleLst><d:rule type="h" val="10"/></d:ruleLst></d:layoutNode></d:layoutNode>`,
    );
    const result = reflowDiagramLayout(
        root,
        { w: 100, h: 50 },
        { textFits: () => false },
      ),
      container = result.bounds.get(root.children[0]),
      text = result.bounds.get(root.children[0].children[0]);
    expect(result.fits).toBe(false);
    expect(container.w).toBeLessThan(100);
    expect(text.x + text.w).toBe(container.x + container.w);
  });
  it.each(native.cases)("arranges and fits native geometry: $name", (row) => {
    const { data, layout, root } = prepare(row),
      before = [serializeXml(data), serializeXml(layout)];
    const initial = evaluateDiagramInitialConstraints(root, row.available, {
      quantizeFonts: true,
    });
    const arrangement = readDiagramArrangement(root.algorithm);
    const narrow = arrangeDiagramChildren(
      row.available,
      root.children.map((n) => ({ x: 0, y: 0, ...initial.get(n).size })),
      arrangement,
    );
    const retry = arrangeDiagramChildren(row.available, narrow, arrangement, {
      childrenFit: false,
    });
    const widths = [
      initial.get(root.children[0]).size.w,
      narrow[0].w,
      retry[0].w,
    ];
    const texts = root.children.flatMap((n) =>
      n.children.filter((c) => initial.get(c).rules.length),
    );
    const result = reflowDiagramLayout(root, row.available, {
      textFits: (node, state) => {
        const index = texts.indexOf(node),
          values = [
            row.required.wide,
            row.required.narrow,
            row.retryRequired ?? row.required.narrow,
          ];
        const phase = widths.findIndex(
          (w) => Math.abs(w - state.size.w) < 1e-10,
        );
        if (phase < 0)
          throw new Error(`unrecorded width ${state.size.w}: ${widths}`);
        const required = Array.isArray(values[phase])
          ? values[phase][index]
          : values[phase];
        return state.size.h >= required;
      },
    });
    const shapes = root.children.flatMap((n) => n.children);
    for (const [index, node] of shapes.entries()) {
      const rect = result.bounds.get(node),
        expected = row.expected[index];
      for (const [actual, key] of [
        [rect.x, "x"],
        [rect.y, "y"],
        [rect.w, "cx"],
        [rect.h, "cy"],
      ])
        expect(
          Math.abs(Math.trunc(actual * 36000) - Number(expected[key])),
          `${node.name}.${key}`,
        ).toBeLessThanOrEqual(1);
    }
    expect(result.fits).toBe(row.expectedFit ?? true);
    expect([serializeXml(data), serializeXml(layout)]).toEqual(before);
  });
});
