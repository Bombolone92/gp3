import { describe, expect, it } from "vitest";
import native from "./data/diagram-rule-adjustment-native.json";
import { sample } from "./diagram-layout-fixture.js";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { evaluateDiagramInitialConstraints as evaluate } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import { fitDiagramGeneralRule } from "../lib/pptx/src/internal/diagram/rule-fit.ts";
import {
  arrangeDiagramChildren,
  readDiagramArrangement,
} from "../lib/pptx/src/internal/diagram/arrange.ts";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";

const create = (constraints, body = "", rules = "", params = "") => {
  const data = sample(),
    document = parseXml(
      `<dgm:layoutNode xmlns:dgm="${NS.diagram}" name="root"><dgm:alg type="lin"><dgm:param type="horzAlign" val="none"/><dgm:param type="vertAlign" val="none"/>${params}</dgm:alg><dgm:constrLst>${constraints}</dgm:constrLst><dgm:ruleLst>${rules}</dgm:ruleLst>${body}</dgm:layoutNode>`,
    );
  return {
    document,
    data: data.document,
    root: expandDiagramLayout(document.root, data.tree),
  };
};
const property = (
  type,
  relationship = "self",
  name = "",
  pointType = "all",
) => ({
  type,
  selector: { relationship, name, pointType },
});
const child = (name) =>
  `<dgm:layoutNode name="${name}"><dgm:alg type="sp"/></dgm:layoutNode>`;

describe("DiagramML ordered numeric rule applications", () => {
  it.each(native.cases)(
    "computes native scoped and physical results: $name",
    (row) => {
      const { root, document, data } = create(
          row.constraints,
          row.body,
          row.rules,
          row.params,
        ),
        before = [serializeXml(document), serializeXml(data)],
        initial = evaluate(root, native.available),
        initialValues = [...initial].map(([node, state]) => [
          node,
          [...state.values],
        ]),
        arrangement = readDiagramArrangement(root.algorithm),
        main = arrangement.direction === "fromL" ? "w" : "h",
        cross = main === "w" ? "h" : "w",
        adjustments = [];
      let state = initial;
      for (const rule of initial.get(root).rules) {
        const plan = state.get(root).rulePlan(rule);
        const trial = (value) =>
          evaluate(root, native.available, {
            adjustments: [
              ...adjustments,
              { owner: root, property: rule.target, value },
            ],
          });
        const result = fitDiagramGeneralRule(plan, "decrease", (value) => {
          const candidate = trial(value);
          return (
            root.children.reduce(
              (sum, node) => sum + candidate.get(node).size[main],
              0,
            ) <= native.available[main] &&
            Math.max(
              ...root.children.map((node) => candidate.get(node).size[cross]),
            ) <= native.available[cross]
          );
        });
        state = trial(result.value);
        adjustments.push({
          owner: root,
          property: rule.target,
          value: result.value,
        });
      }
      const actual = arrangeDiagramChildren(
        native.available,
        root.children.map((node) => ({ x: 0, y: 0, ...state.get(node).size })),
        arrangement,
      );
      expect(actual).toHaveLength(row.expected.length);
      for (const [i, expected] of row.expected.entries()) {
        expect([
          root.children[i].name,
          root.children[i].context.point.id,
        ]).toEqual([expected.name, expected.context]);
        for (const key of ["x", "y", "w", "h"])
          expect(
            Math.abs(Math.trunc(actual[i][key] * 36000) - expected.bounds[key]),
          ).toBeLessThanOrEqual(1);
      }
      expect(
        [...initial].map(([node, state]) => [node, [...state.values]]),
      ).toEqual(initialValues);
      expect([serializeXml(document), serializeXml(data)]).toEqual(before);
    },
  );

  it("keeps declaration replacement separate from ordered physical application", () => {
    const { root } = create(
      '<dgm:constr type="w" for="ch" forName="a" ptType="node" val="70"/><dgm:constr type="w" for="ch" forName="a" ptType="norm" val="70"/>',
      `<dgm:forEach axis="ch" ptType="norm" cnt="1">${child("a")}</dgm:forEach>`,
    );
    const p = property("w", "ch", "a", "node"),
      change = { owner: root, property: p, value: 23 };
    const replaced = evaluate(root, native.available, { changes: [change] });
    expect(replaced.get(root).reference(p)).toBe(23);
    expect(replaced.get(root.children[0]).size.w).toBe(70);
    const applied = evaluate(root, native.available, { adjustments: [change] });
    expect(applied.get(root).reference(p)).toBe(23);
    expect(applied.get(root.children[0]).size.w).toBe(23);
    expect(applied.get(root).reference(property("w", "ch", "a", "norm"))).toBe(
      70,
    );
  });

  it("allows repeated alias applications and preserves unrelated expression changes", () => {
    const { root } = create(
      '<dgm:constr type="userA" forName="old" val="5"/><dgm:constr type="userA" forName="new" val="7"/><dgm:constr type="userB" refType="userA" fact="2"/>',
    );
    const state = evaluate(root, native.available, {
      changes: [{ owner: root, property: property("w"), value: 83 }],
      adjustments: [
        ["old", 11],
        ["new", 13],
        ["old", 17],
      ].map(([name, value]) => ({
        owner: root,
        property: property("userA", "self", name),
        value,
      })),
    }).get(root);
    expect(state.values.get("w")).toBe(83);
    expect(state.reference(property("userA", "self", "new"))).toBe(17);
    expect(state.values.get("userB")).toBe(34);
  });

  it("supports declared variables with empty selections without inventing shapes", () => {
    const { root } = create(
      '<dgm:constr type="w" for="ch" forName="absent" val="70"/><dgm:constr type="userA" refType="w" refFor="ch" refForName="absent"/>',
    );
    const state = evaluate(root, native.available, {
      adjustments: [
        { owner: root, property: property("w", "ch", "absent"), value: 19 },
      ],
    }).get(root);
    expect(state.values.get("userA")).toBe(19);
    expect(root.children).toHaveLength(0);
  });

  it("severs replaced reference formulas while retaining source variables", () => {
    const { root } = create(
      '<dgm:constr type="userA" val="70"/><dgm:constr type="userB" refType="userA" fact=".5"/>',
      "",
      '<dgm:rule type="userB" fact=".2"/>',
    );
    const initial = evaluate(root, native.available).get(root);
    const state = evaluate(root, native.available, {
      adjustments: [
        { owner: root, property: property("userB"), value: 11 },
        { owner: root, property: property("userA"), value: 50 },
      ],
    }).get(root);
    expect(state.values.get("userB")).toBe(11);
    expect(state.values.get("userA")).toBe(50);
    expect(state.rulePlan(state.rules[0])).toBeNull();
    expect(initial.values.get("userB")).toBe(35);
  });

  it("diagnoses invalid owners, missing variables, nonfinite values, and positions", () => {
    const { root } = create(
      '<dgm:constr type="t" for="ch" forName="a" val="10"/>',
      child("a"),
    );
    for (const [adjustment, error] of [
      [
        { owner: {}, property: property("w"), value: 1 },
        "unknown diagram adjustment owner",
      ],
      [
        { owner: root, property: property("w", "ch", "missing"), value: 1 },
        "unresolved diagram adjustment variable",
      ],
      [
        { owner: root, property: property("w"), value: Infinity },
        "non-finite diagram constraint value",
      ],
      [
        { owner: root, property: property("t", "ch", "a"), value: 1 },
        "unsupported diagram position adjustment",
      ],
    ])
      expect(() =>
        evaluate(root, native.available, { adjustments: [adjustment] }),
      ).toThrow(error);
  });
});
