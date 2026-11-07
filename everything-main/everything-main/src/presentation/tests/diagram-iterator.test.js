import { describe, expect, it } from "vitest";
import native from "./data/diagram-iterator-native.json";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
import { sample } from "./diagram-layout-fixture.js";
import {
  readDiagramIterator,
  iterateDiagramNodes,
  selectDiagramNodes,
} from "../lib/pptx/src/internal/diagram/iterator.ts";

const expression = (attributes) =>
  readDiagramIterator(
    parseXml(`<d:presOf xmlns:d="${NS.diagram}" ${attributes}/>`).root,
  );
const ids = (nodes) => nodes.map((n) => n.point.id);

describe("DiagramML iterator selection", () => {
  it.each(native.cases)(
    "matches the native reference: $name",
    ({ context, query, selected }) => {
      const { tree, document } = sample();
      const before = serializeXml(document);
      const contexts = selectDiagramNodes(tree, tree.root, expression(context));
      expect(contexts).toHaveLength(1);
      expect(
        ids(selectDiagramNodes(tree, contexts[0], expression(query))),
      ).toEqual(selected);
      expect(serializeXml(document)).toBe(before);
    },
  );

  it("selects by topology and options independently of IDs and XML order", () => {
    const rename = (id) => `point-${id}-different`;
    const { tree } = sample(rename, true);
    for (const { context, query, selected } of native.cases) {
      const contexts = selectDiagramNodes(tree, tree.root, expression(context));
      expect(
        ids(selectDiagramNodes(tree, contexts[0], expression(query))),
      ).toEqual(selected.map(rename));
    }
  });

  it("uses schema defaults per axis instead of broadcasting scalar attributes", () => {
    expect(
      expression(
        'axis="ch ch" ptType="node" st="2" cnt="1" step="2" hideLastTrans="0"',
      ),
    ).toEqual([
      {
        axis: "ch",
        pointType: "node",
        start: 2,
        count: 1,
        step: 2,
        hideLastTransition: false,
      },
      {
        axis: "ch",
        pointType: "all",
        start: 1,
        count: 0,
        step: 1,
        hideLastTransition: true,
      },
    ]);
    expect(expression("")).toEqual([
      {
        axis: "none",
        pointType: "all",
        start: 1,
        count: 0,
        step: 1,
        hideLastTransition: true,
      },
    ]);
  });

  it("accepts XML list whitespace, integer signs, boolean spellings and empty optional lists", () => {
    expect(
      expression(
        'axis=" ch&#9;self " st="+02 -01" cnt="+0 01" step="0 -1" hideLastTrans="1 false" ptType="node all"',
      ),
    ).toEqual([
      {
        axis: "ch",
        pointType: "node",
        start: 2,
        count: 0,
        step: 0,
        hideLastTransition: true,
      },
      {
        axis: "self",
        pointType: "all",
        start: -1,
        count: 1,
        step: -1,
        hideLastTransition: false,
      },
    ]);
    expect(expression('axis="" ptType=" " cnt=""')).toEqual(expression(""));
  });

  it("ignores namespaced lookalike attributes", () => {
    expect(expression('xmlns:x="urn:unrelated" x:axis="ch" x:st="2"')).toEqual(
      expression(""),
    );
  });

  it.each([
    'axis="child"',
    'axis="ch BAD"',
    'axis="self" ptType="unknown"',
    'axis="self" hideLastTrans="TRUE"',
    'axis="self" st="1.2"',
    'axis="self" st="1e2"',
    'axis="self" st="Infinity"',
    'axis="self" st="-2147483649"',
    'axis="self" st="2147483648"',
    'axis="self" cnt="-1"',
    'axis="self" cnt="4294967296"',
    'axis="self" step="NaN"',
    'axis="self" step="2147483648"',
    'axis="self self" cnt="0 nope"',
  ])(
    "rejects malformed supported attributes without mutating XML: %s",
    (attributes) => {
      const document = parseXml(
          `<d:presOf xmlns:d="${NS.diagram}" ${attributes}/>`,
        ),
        before = serializeXml(document);
      expect(() => readDiagramIterator(document.root)).toThrow(
        /diagram iterator/,
      );
      expect(serializeXml(document)).toBe(before);
    },
  );

  it("supports integer boundaries without wrapping or inventing nodes", () => {
    const { tree } = sample();
    for (const start of [-2147483648, 2147483647])
      expect(
        selectDiagramNodes(
          tree,
          tree.root,
          expression(`axis="ch" st="${start}"`),
        ),
      ).toEqual([]);
    expect(
      ids(
        selectDiagramNodes(
          tree,
          tree.root,
          expression('axis="ch" ptType="node" cnt="4294967295"'),
        ),
      ),
    ).toEqual(["1", "2", "3"]);
    for (const step of [-2147483648, 2147483647])
      expect(
        ids(
          selectDiagramNodes(
            tree,
            tree.root,
            expression(`axis="ch" ptType="node" step="${step}"`),
          ),
        ),
      ).toEqual(["1"]);
  });

  it("keeps repeated traversal results distinct from the presOf contributor set", () => {
    const { tree } = sample(),
      expr = expression('axis="ch par" ptType="node all"');
    expect(ids([...iterateDiagramNodes(tree, tree.root, expr)])).toEqual([
      "0",
      "0",
      "0",
    ]);
    expect(ids(selectDiagramNodes(tree, tree.root, expr))).toEqual(["0"]);
  });

  it("deduplicates contributor contexts before repeated nested walks can explode", () => {
    const { tree } = sample();
    let calls = 0;
    const measured = {
      ...tree,
      axis: (node, axis) => {
        calls++;
        return tree.axis(node, axis);
      },
    };
    const expr = expression(
      `axis="${Array(40).fill("ch par").join(" ")}" ptType="${Array(40).fill("node all").join(" ")}"`,
    );
    expect(ids(selectDiagramNodes(measured, tree.root, expr))).toEqual(["0"]);
    expect(calls).toBe(1 + 40 * 4);
  });

  it("handles deeply nested expressions without recursive calls", () => {
    const { tree } = sample(),
      expr = expression(`axis="${Array(12000).fill("self").join(" ")}"`);
    expect(ids([...iterateDiagramNodes(tree, tree.root, expr)])).toEqual(["0"]);
    expect(ids(selectDiagramNodes(tree, tree.root, expr))).toEqual(["0"]);
  });

  it("can stop a lazy traversal without enumerating later branches", () => {
    const { tree } = sample();
    const expr = expression(
      `axis="${Array(30).fill("ch par").join(" ")}" ptType="${Array(30).fill("node all").join(" ")}"`,
    );
    const iterator = iterateDiagramNodes(tree, tree.root, expr);
    expect(iterator.next().value).toBe(tree.root);
    iterator.return();
    expect(iterator.next().done).toBe(true);
  });

  it("handles empty selections and rejects foreign contexts even for empty expressions", () => {
    const { tree } = sample(),
      foreign = sample().tree.root;
    expect(selectDiagramNodes(tree, tree.root, [])).toEqual([]);
    expect([...iterateDiagramNodes(tree, tree.root, [])]).toEqual([]);
    expect(
      selectDiagramNodes(tree, tree.root, expression('axis="none ch"')),
    ).toEqual([]);
    expect(() => selectDiagramNodes(tree, foreign, [])).toThrow(
      /different hierarchy/,
    );
    expect(() => [...iterateDiagramNodes(tree, foreign, [])]).toThrow(
      /different hierarchy/,
    );
  });
});
