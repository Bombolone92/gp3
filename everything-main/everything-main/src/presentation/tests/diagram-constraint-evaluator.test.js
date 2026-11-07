import { describe, expect, it } from "vitest";
import {
  createDiagramConstraintEvaluator,
  evaluateDiagramInitialConstraints,
} from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import { reflowDiagramLayout } from "../lib/pptx/src/internal/diagram/reflow.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
import { sample } from "./diagram-layout-fixture.js";

const prepare = (body) => {
  const xml = parseXml(
    `<d:layoutNode xmlns:d="${NS.diagram}" name="root"><d:alg type="lin"/>${body}</d:layoutNode>`,
  );
  return { xml, root: expandDiagramLayout(xml.root, sample().tree) };
};
const property = (type) => ({
  type,
  selector: { relationship: "self", name: "", pointType: "all" },
});
const change = (owner, type, value) => ({
  owner,
  property: property(type),
  value,
});
const view = (states) =>
  [...states].map(([node, state]) => ({
    name: node.name,
    values: [...state.values],
    size: state.size,
    coordinates: state.coordinates,
    rules: state.rules.map((rule) => state.rulePlan(rule)),
  }));
const available = { w: 200, h: 80 };

describe("constraint declarations shared within one reflow", () => {
  it("rebuilds numeric inputs and scoped trials without retaining earlier values", () => {
    const { root, xml } = prepare(
      `<d:constrLst><d:constr type="userA" val="40"/><d:constr type="primFontSz" for="des" forName="text" refType="userA" fact=".5"/></d:constrLst><d:layoutNode name="column"><d:alg type="composite"/><d:layoutNode name="text"><d:alg type="tx"/><d:constrLst><d:constr type="primFontSz" val="99"/></d:constrLst><d:ruleLst><d:rule type="primFontSz" fact=".1"/></d:ruleLst></d:layoutNode></d:layoutNode>`,
    );
    const text = root.children[0].children[0];
    const evaluate = createDiagramConstraintEvaluator(root);
    const before = serializeXml(xml);
    const retained = [];
    for (const value of [40, 12.5, 0, 61, 40]) {
      const size = { w: 100 + value, h: 80 };
      const options = {
        quantizeFonts: true,
        changes: [change(root, "userA", value)],
        defaults: () => new Map([["w", 30 + value]]),
      };
      const actual = evaluate(size, options);
      const expected = evaluateDiagramInitialConstraints(root, size, options);
      expect(view(actual)).toEqual(view(expected));
      expect(actual.get(text).values.get("primFontSz")).toBe(
        Math.round(value / 2),
      );
      for (const font of [7.25, 0, 19]) {
        const local = { adjustments: [change(text, "primFontSz", font)] };
        const trial = actual.get(text).evaluateScope(local);
        expect(view(trial)).toEqual(
          view(expected.get(text).evaluateScope(local)),
        );
        expect(trial.get(text).values.get("primFontSz")).toBe(font);
      }
      retained.push([actual, view(actual)]);
    }
    for (const [states, snapshot] of retained)
      expect(view(states)).toEqual(snapshot);
    expect(serializeXml(xml)).toBe(before);
  });

  it("reads edited declarations and new declarations on the next reflow", () => {
    const { root } = prepare(
      '<d:layoutNode name="space"><d:alg type="sp"/><d:constrLst><d:constr type="w" val="12"/><d:constr type="h" val="9"/></d:constrLst></d:layoutNode>',
    );
    const leaf = root.children[0];
    const original = evaluateDiagramInitialConstraints(root, available);
    const run = () =>
      reflowDiagramLayout(root, available, { textFits: () => true });
    const first = run();
    expect(first.bounds.get(leaf).w).toBe(12);
    leaf.constraints[0].attrs.find((a) => a.name.localName === "val").value =
      "31";
    leaf.constraints.push(
      parseXml(`<d:constr xmlns:d="${NS.diagram}" type="userA" val="17"/>`)
        .root,
    );
    expect(run().bounds.get(leaf).w).toBe(31);
    const next = createDiagramConstraintEvaluator(root)(available);
    expect(next.get(leaf).values.get("userA")).toBe(17);
    expect(original.get(root).evaluateScope().get(leaf).size.w).toBe(31);
    expect(first.bounds.get(leaf).w).toBe(12);
    leaf.constraints[0].attrs.find((a) => a.name.localName === "val").value =
      "invalid";
    expect(run).toThrow("invalid diagram constraint number");
  });

  it("still enforces each trial's operation budget after declarations were read", () => {
    const { root } = prepare(
      '<d:layoutNode name="space"><d:alg type="sp"/></d:layoutNode>',
    );
    const evaluate = createDiagramConstraintEvaluator(root);
    evaluate(available);
    expect(() => evaluate(available, { maxOperations: 1 })).toThrow(
      "operation budget",
    );
    expect(view(evaluate(available))).toEqual(
      view(evaluateDiagramInitialConstraints(root, available)),
    );
  });
});
