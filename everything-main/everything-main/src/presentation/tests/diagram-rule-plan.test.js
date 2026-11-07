import { describe, expect, it } from "vitest";
import native from "./data/diagram-rule-plan-native.json";
import { sample } from "./diagram-layout-fixture.js";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { evaluateDiagramInitialConstraints as evaluate } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import {
  diagramConstraintRuleMode,
  readDiagramConstraintRule,
} from "../lib/pptx/src/internal/diagram/constraint.ts";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
const create = (constraints = "", rules = "", body = "", algorithm = "lin") => {
  const data = sample(),
    document = parseXml(
      `<dgm:layoutNode xmlns:dgm="${NS.diagram}" name="root"><dgm:alg type="${algorithm}"/><dgm:constrLst>${constraints}</dgm:constrLst><dgm:ruleLst>${rules}</dgm:ruleLst>${body}</dgm:layoutNode>`,
    );
  return {
    root: expandDiagramLayout(document.root, data.tree),
    document,
    data: data.document,
  };
};
const property = (type, relationship = "self", name = "") => ({
  type,
  selector: { relationship, name, pointType: "all" },
});
const size = { w: 100, h: 100 };
const child = (name, content = "", algorithm = "sp") =>
  `<dgm:layoutNode name="${name}"><dgm:alg type="${algorithm}"/>${content}</dgm:layoutNode>`;
const rule = (attrs) =>
  readDiagramConstraintRule(
    parseXml(`<dgm:rule xmlns:dgm="${NS.diagram}" type="w" ${attrs}/>`).root,
  );

describe("DiagramML scoped rule plans", () => {
  it.each([
    ["norm", "nonAsst", "ch"],
    ["norm", "nonAsst", "des"],
    ["asst", "nonNorm", "ch"],
    ["asst", "nonNorm", "des"],
  ])(
    "updates one %s/%s variable in %s scope and rejects duplicate alias trials",
    (a, b, relationship) => {
      const { root } = create(
        `<dgm:constr type="userZ" val="74"/><dgm:constr type="w" for="${relationship}" forName="absent" ptType="${a}" refType="userZ" fact=".5"/>`,
        `<dgm:rule type="w" for="${relationship}" forName="absent" ptType="${b}" fact=".25"/>`,
      );
      const p = (type) => ({
          type: "w",
          selector: { relationship, name: "absent", pointType: type },
        }),
        state = evaluate(root, size).get(root),
        r = state.rules[0];
      expect(state.rulePlan(r)).toMatchObject({ current: 37, limit: 18.5 });
      const changed = evaluate(root, size, {
        changes: [{ owner: root, property: p(b), value: 13 }],
      }).get(root);
      expect(changed.reference(p(a))).toBe(13);
      expect(changed.rulePlan(r)).toBeNull();
      expect(state.reference(p(a))).toBe(37);
      expect(() =>
        evaluate(root, size, {
          changes: [a, b].map((type) => ({
            owner: root,
            property: p(type),
            value: 13,
          })),
        }),
      ).toThrow("duplicate diagram change variable");
    },
  );
  it.each(native.cases)("resolves native rule bindings: $name", (row) => {
    const { root, document, data } = create(
        row.constraints,
        row.rules,
        row.body,
        row.algorithm,
      ),
      before = [serializeXml(document), serializeXml(data)];
    if (row.rejected)
      expect(() => evaluate(root, size)).toThrow(
        "invalid diagram rule numeric mode",
      );
    else {
      const result = evaluate(root, size),
        owner = row.ownerIndex < 0 ? root : root.children[row.ownerIndex],
        state = result.get(owner);
      expect(state.rules).toHaveLength(1);
      const plan = state.rulePlan(state.rules[0]);
      if (row.plan === null) expect(plan).toBeNull();
      else expect(plan).toMatchObject(row.plan);
    }
    expect([serializeXml(document), serializeXml(data)]).toEqual(before);
  });
  it("resolves exact names and implicit self aliases without applying a rule", () => {
    const { root } = create(
      '<dgm:constr type="w" forName="alias" val="37"/>',
      '<dgm:rule type="w" val="9"/>',
    );
    const result = evaluate(root, size).get(root);
    expect(result.rulePlan(rule('forName="alias" val="9"'))).toMatchObject({
      current: 37,
      limit: 9,
    });
    expect(result.rulePlan(rule('val="9"'))).toMatchObject({
      current: 37,
      limit: 9,
    });
    expect(result.rulePlan(rule('forName="missing" val="9"'))).toBeNull();
    expect(result.rulePlan(rule('ptType="node" val="9"'))).toBeNull();
    expect(result.values.get("w")).toBe(37);
  });
  it("uses the live reference value, not the current target value, for factors", () => {
    const { root } = create(
      '<dgm:constr type="userA" val="80"/><dgm:constr type="w" refType="userA" fact="0.5"/>',
      '<dgm:rule type="w" fact="0.2"/>',
    );
    const initial = evaluate(root, size),
      r = initial.get(root).rules[0];
    expect(initial.get(root).rulePlan(r)).toMatchObject({
      mode: "factor",
      current: 40,
      limit: 16,
    });
    const changed = evaluate(root, size, {
      changes: [{ owner: root, property: property("userA"), value: 60 }],
    });
    expect(changed.get(root).rulePlan(r)).toMatchObject({
      current: 30,
      limit: 12,
    });
    const replaced = evaluate(root, size, {
      changes: [{ owner: root, property: property("w"), value: 31 }],
    });
    expect(replaced.get(root).rulePlan(r)).toBeNull();
  });
  it.each(["ch", "des"])(
    "retains rule variables and trial references for an empty %s selection",
    (relationship) => {
      const { root, document } = create(
          `<dgm:constr type="userZ" val="60"/>
          <dgm:constr type="userA" for="${relationship}" forName="absent" refType="userZ" fact=".5"/>
          <dgm:constr type="w" for="ch" forName="probe" refType="userA" refFor="${relationship}" refForName="absent" fact=".5"/>`,
          `<dgm:rule type="userA" for="${relationship}" forName="absent" fact=".25"/>`,
          child("probe"),
        ),
        before = serializeXml(document),
        initial = evaluate(root, size),
        state = initial.get(root),
        r = state.rules[0],
        target = property("userA", relationship, "absent");
      expect(state.reference(target)).toBe(30);
      expect(state.rulePlan(r)).toMatchObject({ current: 30, limit: 15 });
      expect(initial.get(root.children[0]).values.get("w")).toBe(15);
      const changed = evaluate(root, size, {
        changes: [{ owner: root, property: target, value: 12 }],
      });
      expect(changed.get(root.children[0]).values.get("w")).toBe(6);
      expect(changed.get(root).reference(target)).toBe(12);
      expect(changed.get(root).rulePlan(r)).toBeNull();
      expect(state.reference(target)).toBe(30);
      expect(state.rulePlan(r)).toMatchObject({ current: 30, limit: 15 });
      expect(serializeXml(document)).toBe(before);
    },
  );
  it("uses the last effective local user-variable formula and preserves infinity limits", () => {
    const { root } = create(
      '<dgm:constr type="userA" forName="old" refType="h" fact="0.5"/><dgm:constr type="userA" forName="new" val="14"/>',
      '<dgm:rule type="userA" forName="old" fact="0.1"/><dgm:rule type="w" val="INF"/><dgm:rule type="h" max="INF"/>',
    );
    const state = evaluate(root, size).get(root);
    expect(state.rulePlan(state.rules[0])).toBeNull();
    expect(state.rulePlan(state.rules[1])).toMatchObject({
      mode: "value",
      limit: Infinity,
      current: 100,
    });
    expect(state.rulePlan(state.rules[2])).toMatchObject({
      mode: "maximum",
      limit: Infinity,
      current: 100,
    });
  });
  it("does not promote wildcard reservations to named rule variables", () => {
    const { root } = create(
      '<dgm:constr type="w" for="ch" val="37"/>',
      "",
      child("a"),
    );
    const state = evaluate(root, size).get(root);
    expect(state.rulePlan(rule('for="ch" val="9"'))).toMatchObject({
      current: 37,
      limit: 9,
    });
    expect(state.rulePlan(rule('for="ch" forName="a" val="9"'))).toBeNull();
  });
  it("diagnoses implicit composite targets and arithmetic overflow explicitly", () => {
    const { root } = create("", "", child("a"), "composite");
    expect(() =>
      evaluate(root, size)
        .get(root)
        .rulePlan(rule('for="ch" forName="a" val="10"')),
    ).toThrow("unsupported implicit composite rule variable");
    const huge = create(
      '<dgm:constr type="userA" val="1e308"/><dgm:constr type="w" refType="userA" fact="0.1"/>',
    ).root;
    expect(() =>
      evaluate(huge, size).get(huge).rulePlan(rule('fact="10"')),
    ).toThrow("non-finite diagram rule limit");
  });
});

describe("DiagramML executable numeric modes", () => {
  it("requires exactly one mode while the raw schema reader preserves NaN defaults", () => {
    expect(Number.isNaN(rule("").value)).toBe(true);
    for (const attributes of [
      "",
      'val="NaN" fact="NaN" max="NaN"',
      'val="1" fact="2"',
      'val="1" max="2"',
      'fact="1" max="2"',
      'val="1" fact="2" max="3"',
    ])
      expect(() => diagramConstraintRuleMode(rule(attributes))).toThrow(
        "invalid diagram rule numeric mode",
      );
    expect(
      diagramConstraintRuleMode(rule('val="0" fact="NaN" max="NaN"')),
    ).toEqual({ kind: "value", value: 0 });
    expect(diagramConstraintRuleMode(rule('fact="-0.25"'))).toEqual({
      kind: "factor",
      value: -0.25,
    });
    expect(diagramConstraintRuleMode(rule('max="INF"'))).toEqual({
      kind: "maximum",
      value: Infinity,
    });
  });
});
