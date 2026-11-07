import { describe, expect, it } from "vitest";
import native from "./data/diagram-text-auto-native.json";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { evaluateDiagramInitialConstraints as evaluate } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import {
  arrangeDiagramChildren,
  readDiagramArrangement,
} from "../lib/pptx/src/internal/diagram/arrange.ts";

const expand = (layout) =>
  expandDiagramLayout(
    layout.root,
    readDiagramHierarchy(readDiagramDataModel(parseXml(native.model).root)),
  );

describe("SmartArt initial text dimensions", () => {
  it.each(native.cases)(
    "matches native defaults and parent arrangement: $name",
    (row) => {
      const document = parseXml(native.layouts[row.layout]);
      const before = serializeXml(document);
      const root = expand(document);
      const states = evaluate(root, row.available);
      const children = root.children.map((node) => {
        const state = states.get(node);
        return {
          x: state.coordinates?.l ?? 0,
          y: state.coordinates?.t ?? 0,
          ...state.size,
        };
      });
      const result = arrangeDiagramChildren(
        row.available,
        children,
        readDiagramArrangement(root.algorithm),
      ).filter((r) => r.w !== 0 || r.h !== 0);
      expect(result).toHaveLength(row.expected.length);
      for (const [i, expected] of row.expected.entries()) {
        for (const key of ["x", "y", "w", "h"]) {
          expect(
            Math.abs(Math.trunc(result[i][key] * 36000) - expected[key]),
            key,
          ).toBeLessThanOrEqual(1);
        }
      }
      expect(serializeXml(document)).toBe(before);
    },
  );

  const fixture = (constraints = "", algorithm = "lin") => {
    const root = expand(
      parseXml(`<d:layoutNode xmlns:d="${NS.diagram}" name="root">
      <d:alg type="${algorithm}"/>
      <d:layoutNode name="text"><d:alg type="tx"/>
        <d:constrLst>${constraints}</d:constrLst>
        <d:ruleLst><d:rule type="h" val="200"/></d:ruleLst>
      </d:layoutNode></d:layoutNode>`),
    );
    return { root, text: root.children[0] };
  };
  const property = (type) => ({
    type,
    selector: { relationship: "self", name: "", pointType: "all" },
  });

  it("exposes the initial preference to references and fitting before parent arrangement", () => {
    const { root, text } = fixture(
      '<d:constr type="h" val="0"/><d:constr type="w" refType="h" fact="0.5"/>',
    );
    const state = evaluate(root, { w: 20, h: 30 }).get(text);
    expect(state.size).toEqual({ w: 50, h: 100 });
    expect(state.reference(property("h"))).toBe(100);
    expect(state.rulePlan(state.rules[0])).toMatchObject({
      current: 100,
      limit: 200,
    });
  });

  it.each(["changes", "adjustments"])(
    "preserves zero chosen by subsequent %s",
    (option) => {
      const { root, text } = fixture(
        '<d:constr type="h" val="0"/><d:constr type="w" refType="h" fact="0.5"/>',
      );
      const state = evaluate(
        root,
        { w: 20, h: 30 },
        {
          [option]: [{ owner: text, property: property("h"), value: 0 }],
        },
      ).get(text);
      expect(state.size).toEqual({ w: 0, h: 0 });
      expect(state.rulePlan(state.rules[0]).current).toBe(0);
    },
  );

  it.each([-1, -1e-12, 1e-12, 0.01])(
    "does not reinterpret nonzero dimension %s as automatic",
    (value) => {
      const { root, text } = fixture(`<d:constr type="h" val="${value}"/>`);
      expect(evaluate(root, { w: 200, h: 200 }).get(text).size.h).toBe(value);
    },
  );

  it("keeps zero equality declarations separate from literal base assignments", () => {
    const { root, text } = fixture(
      '<d:constr type="h" op="equ" val="0"/>',
      "composite",
    );
    expect(evaluate(root, { w: 137, h: 183 }).get(text).size).toEqual({
      w: 137,
      h: 183,
    });
  });

  it("uses caller defaults only when the dimension has no explicit assignment", () => {
    const { root, text } = fixture('<d:constr type="h" val="0"/>');
    const state = evaluate(
      root,
      { w: 200, h: 200 },
      {
        defaults: (node) =>
          node === text
            ? new Map([
                ["w", 42],
                ["h", 43],
              ])
            : new Map(),
      },
    ).get(text);
    expect(state.size).toEqual({ w: 42, h: 100 });
  });
});
