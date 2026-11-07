import { describe, expect, it } from "vitest";
import native from "./data/diagram-condition-native.json";
import { sample } from "./diagram-layout-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
import {
  readDiagramIterator,
  selectDiagramNodes,
  countDiagramNodes,
  iterateDiagramNodes,
} from "../lib/pptx/src/internal/diagram/iterator.ts";
import {
  readDiagramVariables,
  readDiagramCondition,
  diagramConditionValue,
  evaluateDiagramCondition,
} from "../lib/pptx/src/internal/diagram/condition.ts";

const xml = (body) => parseXml(`<d:if xmlns:d="${NS.diagram}" ${body}/>`).root;
const condition = (body) => readDiagramCondition(xml(body));
const scope = (body, parent) =>
  readDiagramVariables(
    parseXml(`<dgm:varLst xmlns:dgm="${NS.diagram}">${body}</dgm:varLst>`).root,
    parent,
  );
const context = (tree, query) => {
  const nodes = selectDiagramNodes(
    tree,
    tree.root,
    readDiagramIterator(xml(query)),
  );
  expect(nodes).toHaveLength(1);
  return nodes[0];
};

describe("DiagramML conditions", () => {
  it.each(native.numeric)("matches the native reference: $name", (row) => {
    const { tree, document } = sample(),
      before = serializeXml(document);
    const parsed = condition(
      `func="${row.func}" op="equ" val="${row.value}" ${row.query}`,
    );
    const node = context(tree, row.context);
    expect(diagramConditionValue(tree, node, parsed)).toBe(BigInt(row.value));
    expect(evaluateDiagramCondition(tree, node, parsed)).toBe(true);
    expect(serializeXml(document)).toBe(before);
  });

  it.each(native.numericDeep)(
    "matches the native reference on a deeper tree: $name",
    (row) => {
      const { tree, document } = sample(
          undefined,
          false,
          "",
          native.extraEdges,
        ),
        before = serializeXml(document);
      const parsed = condition(
        `func="${row.func}" op="equ" val="${row.value}" ${row.query}`,
      );
      const node = context(tree, row.context);
      expect(diagramConditionValue(tree, node, parsed)).toBe(BigInt(row.value));
      expect(evaluateDiagramCondition(tree, node, parsed)).toBe(true);
      expect(serializeXml(document)).toBe(before);
    },
  );

  it("uses hierarchy semantics independently of model IDs and XML order", () => {
    const { tree } = sample((id) => `renamed-${id}`, true);
    for (const row of native.numeric) {
      const parsed = condition(
        `func="${row.func}" op="equ" val="${row.value}" ${row.query}`,
      );
      expect(
        diagramConditionValue(tree, context(tree, row.context), parsed),
      ).toBe(BigInt(row.value));
    }
  });

  it.each(native.variables)(
    "matches native variable comparison: $name",
    (row) => {
      const { tree } = sample();
      const parsed = condition(
        `func="var" arg="${row.arg}" op="${row.op}" val="${row.val}"`,
      );
      expect(
        evaluateDiagramCondition(tree, tree.root, parsed, scope(row.vars)),
      ).toBe(row.expected);
    },
  );

  it.each(native.scopes)(
    "matches native layout variable scope: $name",
    (row) => {
      const properties =
        row.override === null || row.override === undefined
          ? ""
          : `<d:prSet><d:presLayoutVars><d:chMax val="${row.override}"/></d:presLayoutVars></d:prSet>`;
      const { tree } = sample(undefined, false, properties);
      const parent = scope(row.vars),
        child = scope(row.childVars, parent);
      const parsed = condition(
        `func="var" arg="${row.arg}" op="equ" val="${row.val ?? row.expected}"`,
      );
      if (row.op)
        expect(
          evaluateDiagramCondition(
            tree,
            context(tree, row.context),
            parsed,
            child,
          ),
        ).toBe(row.expected === 1);
      else
        expect(
          diagramConditionValue(
            tree,
            context(tree, row.context),
            parsed,
            child,
          ),
        ).toBe(BigInt(row.expected));
      expect([...parent]).toEqual([...scope(row.vars)]);
    },
  );

  it("keeps missing, explicitly defaulted, inherited, and explicitly zero variables distinct", () => {
    const parent = scope('<dgm:chMax val="5"/><dgm:animOne val="branch"/>');
    expect(scope("", parent).get("chMax")).toBe(5n);
    expect(scope("<dgm:chMax/>", parent).get("chMax")).toBe(-1n);
    expect(scope('<dgm:chMax val="0"/>', parent).get("chMax")).toBe(0n);
    expect(scope("<dgm:animOne/>", parent).get("animOne")).toBe(1n);
    expect(readDiagramVariables(null, parent)).toEqual(parent);
    expect(readDiagramVariables(null, parent)).not.toBe(parent);
    expect(scope("").has("chMax")).toBe(false);
    expect(scope("<dgm:resizeHandles/>").get("resizeHandles")).toBe(1n);
    expect(scope('<dgm:resizeHandles val="exact"/>').get("resizeHandles")).toBe(
      0n,
    );
  });

  it.each([
    ["equ", [false, true, false]],
    ["neq", [true, false, true]],
    ["gt", [true, false, false]],
    ["gte", [true, true, false]],
    ["lt", [false, false, true]],
    ["lte", [false, true, true]],
  ])("compares integers using %s", (op, expected) => {
    const { tree } = sample();
    expect(
      [2, 3, 4].map((value) =>
        evaluateDiagramCondition(
          tree,
          tree.root,
          condition(
            `axis="ch" ptType="node" func="cnt" op="${op}" val="${value}"`,
          ),
        ),
      ),
    ).toEqual(expected);
  });

  it("counts repeated paths exactly with bounded work and no Number overflow", () => {
    const { tree } = sample();
    let calls = 0;
    const measured = {
      ...tree,
      axis(node, axis) {
        calls++;
        return tree.axis(node, axis);
      },
    };
    const parsed = condition(
      `axis="${Array(80).fill("ch par").join(" ")}" ptType="${Array(80).fill("node all").join(" ")}" func="cnt" op="gt" val="2147483647"`,
    );
    expect(diagramConditionValue(measured, tree.root, parsed)).toBe(3n ** 80n);
    expect(calls).toBe(2 + 80 * 4);
    expect(evaluateDiagramCondition(tree, tree.root, parsed)).toBe(true);
  });

  it("counts the same instances as lazy traversal on varied nested expressions", () => {
    const { tree } = sample();
    for (const row of native.numeric) {
      const node = context(tree, row.context),
        expr = readDiagramIterator(xml(row.query));
      expect(countDiagramNodes(tree, node, expr)).toBe(
        BigInt([...iterateDiagramNodes(tree, node, expr)].length),
      );
    }
    expect(countDiagramNodes(tree, tree.root, [])).toBe(0n);
    expect(
      countDiagramNodes(
        tree,
        tree.root,
        readDiagramIterator(xml('axis="none ch"')),
      ),
    ).toBe(0n);
    expect(() => countDiagramNodes(tree, sample().tree.root, [])).toThrow(
      /different hierarchy/,
    );
  });

  it("accepts signed integers, booleans, schema enums, and token whitespace", () => {
    for (const [val, result] of [
      [" +0002 ", 2n],
      ["-2147483648", -2147483648n],
      ["2147483647", 2147483647n],
      ["true", 1n],
      ["false", 0n],
      ["std", 3n],
      ["rel", 1n],
    ])
      expect(condition(`func=" cnt " op=" equ " val="${val}"`).value).toBe(
        result,
      );
    expect(
      scope(
        '<dgm:orgChart val=" 1 "/><dgm:bulletEnabled val="0"/><dgm:chPref val="+2"/>',
      ),
    ).toEqual(
      new Map([
        ["orgChart", 1n],
        ["chPref", 2n],
        ["bulEnabled", 0n],
      ]),
    );
    const { tree } = sample();
    expect(
      diagramConditionValue(
        tree,
        tree.root,
        condition('func="var" op="equ" val="0"'),
      ),
    ).toBe(0n);
    expect(scope('<x:chMax xmlns:x="urn:other" val="5"/>').size).toBe(0);
    expect(scope('<dgm:dir xmlns:x="urn:other" x:val="rev"/>').get("dir")).toBe(
      0n,
    );
  });

  it.each([
    'op="equ" val="0"',
    'func="nope" op="equ" val="0"',
    'func="cnt" val="0"',
    'func="cnt" op="==" val="0"',
    'func="cnt" op="equ"',
    'func="cnt" op="equ" val=""',
    'func="cnt" op="equ" val="1.2"',
    'func="cnt" op="equ" val="1e2"',
    'func="cnt" op="equ" val="2147483648"',
    'func="cnt" op="equ" val="-2147483649"',
    'func="var" arg="prototype" op="equ" val="0"',
    'func="var" arg="toString" op="equ" val="0"',
    'func="cnt" op="equ" val="0" axis="bad"',
  ])("rejects invalid conditions without changing XML: %s", (attributes) => {
    const element = xml(attributes),
      before = serializeXml({ root: element, prolog: [], epilog: [] });
    expect(() => readDiagramCondition(element)).toThrow(/diagram/);
    expect(serializeXml({ root: element, prolog: [], epilog: [] })).toBe(
      before,
    );
  });

  it.each([
    '<dgm:orgChart val="TRUE"/>',
    '<dgm:bulletEnabled val="2"/>',
    '<dgm:chMax val="-2"/>',
    '<dgm:chPref val="2147483648"/>',
    '<dgm:dir val="right"/>',
    '<dgm:hierBranch val="none"/>',
    '<dgm:animOne val="ctr"/>',
    '<dgm:animLvl val="one"/>',
    '<dgm:resizeHandles val="full"/>',
    '<dgm:chMax val=""/>',
  ])(
    "rejects malformed variables without changing the parent scope: %s",
    (body) => {
      const parent = scope('<dgm:chMax val="5"/>');
      expect(() => scope(body, parent)).toThrow(/diagram/);
      expect(parent).toEqual(new Map([["chMax", 5n]]));
    },
  );

  it("rejects foreign condition contexts even for variable functions", () => {
    const { tree } = sample();
    expect(() =>
      diagramConditionValue(
        tree,
        sample().tree.root,
        condition('func="var" op="equ" val="0"'),
      ),
    ).toThrow(/different hierarchy/);
  });
});
