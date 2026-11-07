import { describe, expect, it } from "vitest";
import native from "./data/diagram-constraint-native.json";
import { sample } from "./diagram-layout-fixture.js";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import {
  readDiagramConstraint,
  readDiagramConstraintRule,
  readDiagramConstraintScope,
  diagramConstraintValue,
} from "../lib/pptx/src/internal/diagram/constraint.ts";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";

const element = (tag, attributes = "") =>
  parseXml(`<d:${tag} xmlns:d="${NS.diagram}" ${attributes}/>`).root;
const constraint = (attributes) =>
  readDiagramConstraint(element("constr", attributes));
const rule = (attributes) =>
  readDiagramConstraintRule(element("rule", attributes));
const layout = (body) =>
  parseXml(
    `<dgm:layoutNode xmlns:dgm="${NS.diagram}" name="root">${body}</dgm:layoutNode>`,
  );
const expand = (input) => expandDiagramLayout(input.root, sample().tree);
const self = (type) => ({
  type,
  selector: { relationship: "self", name: "", pointType: "all" },
});

describe("DiagramML constraint declarations", () => {
  it("reads schema defaults without conflating zero, equality, and an absent reference", () => {
    const e = element("constr", 'type="w"');
    expect(readDiagramConstraint(e)).toEqual({
      element: e,
      target: self("w"),
      reference: self("none"),
      operator: "none",
      value: 0,
      factor: 1,
    });
    expect(constraint('type="h" op="equ"').operator).toBe("equ");
    for (const operator of ["none", "equ", "gte", "lte"])
      expect(constraint(`type="w" op="${operator}" val="0"`).value).toBe(0);
  });

  it("preserves the complete target and reference descriptors and significant names", () => {
    const c = constraint(
      'type="h" for=" des " forName=" a / b " ptType=" node " refType="w" refFor="ch" refForName="a / b" refPtType="norm" op="gte" val="12.5" fact="0.75"',
    );
    expect(c.target).toEqual({
      type: "h",
      selector: { relationship: "des", name: " a / b ", pointType: "node" },
    });
    expect(c.reference).toEqual({
      type: "w",
      selector: { relationship: "ch", name: "a / b", pointType: "norm" },
    });
    expect([c.operator, c.value, c.factor]).toEqual(["gte", 12.5, 0.75]);
  });

  it("preserves numeric-rule defaults and unbounded growth", () => {
    const r = rule('type="primFontSz"');
    expect(r.target).toEqual(self("primFontSz"));
    expect([r.value, r.factor, r.maximum]).toEqual([NaN, NaN, NaN]);
    const grow = rule('type="h" val="INF" fact="NaN" max="-INF"');
    expect([grow.value, grow.factor, grow.maximum]).toEqual([
      Infinity,
      NaN,
      -Infinity,
    ]);
    const bounded = rule(
      'type="w" for="ch" forName="item" val="2" fact="1.5" max="10"',
    );
    expect([bounded.value, bounded.factor, bounded.maximum]).toEqual([
      2, 1.5, 10,
    ]);
  });

  it.each([
    ["0", 0],
    ["-0", -0],
    ["+1", 1],
    [".5", 0.5],
    ["-1.", -1],
    [" 1.25e+2 ", 125],
    ["1E-3", 0.001],
    ["INF", Infinity],
    ["-INF", -Infinity],
    ["NaN", NaN],
    ["1e400", Infinity],
    ["1e-400", 0],
  ])("reads XML Schema double %s", (raw, expected) => {
    expect(constraint(`type="w" val="${raw}"`).value).toBe(expected);
    expect(rule(`type="w" max="${raw}"`).maximum).toBe(expected);
  });

  it.each([
    "",
    " ",
    "0x10",
    "0b10",
    "1_000",
    "Infinity",
    "+INF",
    "nan",
    "1pt",
    "1 2",
    "1e",
    "&#160;1&#160;",
  ])("rejects invalid XML Schema double %s", (raw) => {
    expect(() => constraint(`type="w" fact="${raw}"`)).toThrow(
      /diagram constraint number/,
    );
    expect(() => rule(`type="w" val="${raw}"`)).toThrow(
      /diagram constraint number/,
    );
  });

  it.each([
    "",
    'type="unknown"',
    'type="w" for="par"',
    'type="w" ptType="node all"',
    'type="w" refType="unknown"',
    'type="w" refFor="root"',
    'type="w" refPtType="unknown"',
    'type="w" op="neq"',
    'type="w" op="gt"',
  ])("rejects missing or invalid constraint tokens: %s", (attributes) => {
    expect(() => constraint(attributes)).toThrow(/diagram/);
  });

  it("supports geometry, text, spacing, connector, ratio and user-defined variables", () => {
    for (const type of [
      "none",
      "ctrXOff",
      "bMarg",
      "wArH",
      "stemThick",
      "primFontSz",
      "secFontSz",
      "secSibSp",
      "pyraAcctRatio",
      ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        .split("")
        .map((letter) => `user${letter}`),
    ])
      expect(constraint(`type="${type}"`).target.type).toBe(type);
    expect(() => rule('type="UserA"')).toThrow();
    expect(() => readDiagramConstraint(element("rule", 'type="w"'))).toThrow(
      /expected diagram constr/,
    );
    expect(() =>
      readDiagramConstraintRule(parseXml('<rule type="w"/>').root),
    ).toThrow(/expected diagram rule/);
  });

  it("evaluates absolute and referenced right-hand sides without changing their operators", () => {
    const absolute = constraint('type="w" val="20" fact=".5" op="lte"');
    expect(diagramConstraintValue(absolute)).toBe(20);
    expect(diagramConstraintValue(absolute, 100)).toBe(20);
    expect(absolute.operator).toBe("lte");
    const referenced = constraint('type="w" val="999" refType="h" fact=".5"');
    expect(diagramConstraintValue(referenced, 60)).toBe(30);
    expect(diagramConstraintValue(referenced, 0)).toBe(0);
    expect(() => diagramConstraintValue(referenced)).toThrow(/unresolved/);
  });

  it.each(native.units)(
    "uses native declared-unit arithmetic: $name",
    (row) => {
      const root = expand(layout(row.body));
      expect(root.children).toHaveLength(row.heights.length);
      for (const [i, node] of root.children.entries()) {
        const scope = readDiagramConstraintScope(node);
        const height = scope.binding(self("h")).constraints[0];
        const reference = scope.binding(height.reference).constraints[0];
        expect(
          diagramConstraintValue(height, diagramConstraintValue(reference)),
        ).toBe(row.heights[i]);
      }
    },
  );
});

describe("DiagramML constraint declaration scopes", () => {
  it.each([
    ["norm", "nonAsst"],
    ["asst", "nonNorm"],
  ])("shares %s/%s identities without rewriting authored selectors", (a, b) => {
    const input = layout(`<dgm:constrLst>
      <dgm:constr type="w" for="ch" forName="item" ptType="${a}" val="37"/>
      <dgm:constr type="w" for="ch" forName="item" ptType="${b}" op="gte" val="11"/>
      <dgm:constr type="w" for="ch" forName="item" ptType="node" val="19"/>
    </dgm:constrLst><dgm:ruleLst><dgm:rule type="w" for="ch" forName="item" ptType="${b}" val="7"/></dgm:ruleLst>`);
    const before = serializeXml(input),
      scope = readDiagramConstraintScope(expand(input)),
      binding = scope.bindings[0],
      alias = {
        ...binding.property,
        selector: { ...binding.property.selector, pointType: b },
      };
    expect(scope.bindings).toHaveLength(2);
    expect(scope.binding(alias)).toBe(binding);
    expect(binding.constraints.map((c) => c.target.selector.pointType)).toEqual(
      [a, b],
    );
    expect(binding.rules[0].target.selector.pointType).toBe(b);
    expect(serializeXml(input)).toBe(before);
  });
  it.each(native.references)(
    "matches native reference lookup: $name",
    (row) => {
      const root = expand(
        layout(`<dgm:constrLst>${row.constraints}</dgm:constrLst>`),
      );
      const scope = readDiagramConstraintScope(root);
      const target = scope.bindings.find(
        (b) => b.property.selector.name === "b",
      ).constraints[0];
      const source = scope.binding(target.reference);
      expect(source !== null).toBe(row.matched);
      if (source) {
        const value = diagramConstraintValue(
          target,
          diagramConstraintValue(source.constraints[0]),
        );
        expect(row.heights).toEqual([value, value, value]);
      }
    },
  );

  it("does not resolve through descendants or leak bindings across instances", () => {
    const root = expand(
      layout(`<dgm:constrLst><dgm:constr type="h" for="ch" forName="b" refType="h" refFor="ch" refForName="a"/></dgm:constrLst>
      <dgm:forEach axis="ch" ptType="node"><dgm:layoutNode name="a"><dgm:constrLst><dgm:constr type="h" val="20"/></dgm:constrLst></dgm:layoutNode></dgm:forEach>`),
    );
    const parent = readDiagramConstraintScope(root);
    expect(parent.binding(parent.bindings[0].constraints[0].reference)).toBe(
      null,
    );
    const scopes = root.children.map(readDiagramConstraintScope);
    for (const scope of scopes)
      expect(scope.binding(self("h")).constraints[0].value).toBe(20);
    expect(scopes[0].bindings[0]).not.toBe(scopes[1].bindings[0]);
  });

  it("retains bounds, equality groups and rules in source order without pretending to solve them", () => {
    const input = layout(`<dgm:constrLst>
      <dgm:constr type="h" op="equ"/><dgm:constr type="h" val="20"/>
      <dgm:constr type="h" op="gte" val="10"/><dgm:constr type="h" op="lte" val="40"/>
    </dgm:constrLst><dgm:ruleLst><dgm:rule type="h" val="100"/><dgm:rule type="h" fact="2"/>
      <dgm:rule type="primFontSz" val="5"/></dgm:ruleLst>`);
    const before = serializeXml(input),
      root = expand(input),
      scope = readDiagramConstraintScope(root);
    expect(scope.bindings).toHaveLength(2);
    expect(
      scope.binding(self("h")).constraints.map((c) => [c.operator, c.value]),
    ).toEqual([
      ["equ", 0],
      ["none", 20],
      ["gte", 10],
      ["lte", 40],
    ]);
    expect(
      scope.binding(self("h")).rules.map((r) => [r.value, r.factor]),
    ).toEqual([
      [100, NaN],
      [NaN, 2],
    ]);
    // Rule-only bindings remain available for implicit algorithm defaults.
    expect(scope.binding(self("primFontSz")).constraints).toEqual([]);
    expect(scope.binding(self("primFontSz")).rules[0].value).toBe(5);
    expect(serializeXml(input)).toBe(before);
  });

  it("indexes exact names without separator, prototype, or whitespace collisions", () => {
    const names = [
      "a",
      " a ",
      "a/all/w",
      "a|all|w",
      "__proto__",
      "constructor",
      "",
    ];
    const input = layout(
      `<dgm:constrLst>${names.map((name, i) => `<dgm:constr type="w" for="ch" forName="${name}" val="${i}"/>`).join("")}</dgm:constrLst>`,
    );
    const scope = readDiagramConstraintScope(expand(input));
    expect(scope.bindings).toHaveLength(names.length);
    for (const [i, name] of names.entries())
      expect(
        scope.binding({
          type: "w",
          selector: { relationship: "ch", name, pointType: "all" },
        }).constraints[0].value,
      ).toBe(i);
  });

  it("handles a large declaration group without spreading arguments or losing constraints", () => {
    const count = 20000;
    const input = layout(
      `<dgm:constrLst>${'<dgm:constr type="w" op="lte" val="40"/>'.repeat(count)}</dgm:constrLst>`,
    );
    const scope = readDiagramConstraintScope(expand(input));
    expect(scope.bindings).toHaveLength(1);
    expect(scope.bindings[0].constraints).toHaveLength(count);
  });
});
