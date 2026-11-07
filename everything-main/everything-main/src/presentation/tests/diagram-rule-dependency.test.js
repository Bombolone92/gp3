import { describe, expect, it } from "vitest";
import native from "./data/diagram-rule-dependency-native.json";
import { sample } from "./diagram-layout-fixture.js";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { evaluateDiagramInitialConstraints as evaluate } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import { fitDiagramGeneralRule } from "../lib/pptx/src/internal/diagram/rule-fit.ts";
import { readDiagramArrangement } from "../lib/pptx/src/internal/diagram/arrange.ts";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";

const create = (constraints, rules, body = "", params = "") => {
  const data = sample(),
    document = parseXml(
      `<dgm:layoutNode xmlns:dgm="${NS.diagram}" name="root"><dgm:alg type="lin">${params}</dgm:alg><dgm:constrLst>${constraints}</dgm:constrLst><dgm:ruleLst>${rules}</dgm:ruleLst>${body}</dgm:layoutNode>`,
    );
  return {
    document,
    data: data.document,
    root: expandDiagramLayout(document.root, data.tree),
  };
};
const property = (type, name = "") => ({
  type,
  selector: { relationship: "self", name, pointType: "all" },
});

describe("DiagramML effective rule dependencies", () => {
  it.each(native.cases)(
    "follows the native fitting-path dependencies: $name",
    (row) => {
      const { root, document, data } = create(
          row.constraints,
          row.rules,
          row.body,
          row.params,
        ),
        before = [serializeXml(document), serializeXml(data)];
      if (row.rejected) {
        expect(() => evaluate(root, native.available)).toThrow(
          /duplicate|unresolved/,
        );
      } else {
        const initial = evaluate(root, native.available),
          main =
            readDiagramArrangement(root.algorithm).direction === "fromL"
              ? "w"
              : "h",
          cross = main === "w" ? "h" : "w",
          adjustments = [];
        let state = initial;
        for (const rule of initial.get(root).rules) {
          const plan = state.get(root).rulePlan(rule);
          expect(plan).not.toBeNull();
          if (rule.target.type === main) {
            expect(plan.hasCrossPropertyDependents).toBe(
              row.hasCrossPropertyDependents,
            );
            // Repeated metadata queries must remain stable and side-effect free.
            expect(state.get(root).rulePlan(rule)).toEqual(plan);
            break;
          }
          const trial = (value) =>
            evaluate(root, native.available, {
              adjustments: [
                ...adjustments,
                { owner: root, property: rule.target, value },
              ],
            });
          const fit = fitDiagramGeneralRule(plan, "decrease", (value) => {
            const result = trial(value);
            return (
              root.children.reduce(
                (sum, node) => sum + result.get(node).size[main],
                0,
              ) <= native.available[main] &&
              Math.max(
                ...root.children.map((node) => result.get(node).size[cross]),
              ) <= native.available[cross]
            );
          });
          state = trial(fit.value);
          adjustments.push({
            owner: root,
            property: rule.target,
            value: fit.value,
          });
        }
      }
      expect([serializeXml(document), serializeXml(data)]).toEqual(before);
    },
  );

  it("shares self aliases while keeping same-property references out of the set", () => {
    const { root } = create(
      '<dgm:constr type="w" forName="source" val="70"/><dgm:constr type="userA" refType="w" refForName="source" fact="0"/>',
      '<dgm:rule type="w" val="10"/><dgm:rule type="w" forName="source" val="10"/>',
    );
    const state = evaluate(root, native.available).get(root);
    expect(
      state.rules.map(
        (rule) => state.rulePlan(rule).hasCrossPropertyDependents,
      ),
    ).toEqual([true, true]);
    const same = create(
      '<dgm:constr type="w" val="70"/><dgm:constr type="w" for="ch" forName="absent" refType="w"/>',
      '<dgm:rule type="w" val="10"/>',
    ).root;
    const sameState = evaluate(same, native.available).get(same);
    expect(
      sameState.rulePlan(sameState.rules[0]).hasCrossPropertyDependents,
    ).toBe(false);
  });

  it("severs only the replaced consumer formula and leaves prior metadata intact", () => {
    const { root } = create(
      '<dgm:constr type="w" val="70"/><dgm:constr type="userA" refType="w"/><dgm:constr type="userB" refType="userA"/>',
      '<dgm:rule type="w" val="10"/>',
    );
    const initial = evaluate(root, native.available).get(root),
      rule = initial.rules[0];
    expect(initial.rulePlan(rule).hasCrossPropertyDependents).toBe(true);
    for (const option of ["changes", "adjustments"]) {
      const consumer = evaluate(root, native.available, {
        [option]: [{ owner: root, property: property("userA"), value: 3 }],
      }).get(root);
      expect(consumer.rulePlan(rule).hasCrossPropertyDependents).toBe(false);
      const source = evaluate(root, native.available, {
        [option]: [{ owner: root, property: property("w"), value: 30 }],
      }).get(root);
      expect(source.rulePlan(rule).hasCrossPropertyDependents).toBe(true);
    }
    expect(initial.rulePlan(rule).hasCrossPropertyDependents).toBe(true);
  });

  it("counts empty selectors but not superseded self aliases or bounds", () => {
    const { root } = create(
      '<dgm:constr type="w" val="70"/><dgm:constr type="userA" forName="first" refType="w"/><dgm:constr type="userA" forName="last" val="3"/><dgm:constr type="userB" op="gte" refType="w"/><dgm:constr type="h" for="des" forName="absent" refType="w"/>',
      '<dgm:rule type="w" val="10"/>',
    );
    const initial = evaluate(root, native.available).get(root),
      r = initial.rules[0];
    expect(initial.rulePlan(r).hasCrossPropertyDependents).toBe(true);
    const adjusted = evaluate(root, native.available, {
      adjustments: [
        {
          owner: root,
          property: {
            type: "h",
            selector: { relationship: "des", name: "absent", pointType: "all" },
          },
          value: 11,
        },
      ],
    }).get(root);
    expect(adjusted.rulePlan(r).hasCrossPropertyDependents).toBe(false);
  });
});
