import { describe, expect, it } from "vitest";
import native from "./data/diagram-layout-native.json";
import { sample } from "./diagram-layout-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";

const layout = (body) =>
  parseXml(
    `<dgm:layoutNode xmlns:dgm="${NS.diagram}" name="root"><dgm:alg type="lin"/><dgm:shape/><dgm:presOf/>${body}</dgm:layoutNode>`,
  );
const attr = (e, name) => e && getAttrValue(e, qname("", name, ""));
const flatten = (root) => {
  const nodes = [],
    stack = [{ node: root, parent: null }];
  while (stack.length) {
    const { node, parent } = stack.pop(),
      index = nodes.length;
    expect(node.parent).toBe(parent === null ? null : nodes[parent].node);
    nodes.push({
      node,
      name: node.name,
      context: node.context.point.id,
      parent,
    });
    for (const child of [...node.children].reverse())
      stack.push({ node: child, parent: index });
  }
  return nodes;
};
const structure = (rows) =>
  rows.map(({ name, context, parent }) => ({ name, context, parent }));

describe("DiagramML layout expansion", () => {
  it.each(native.cases)(
    "matches the native reference layout structure: $name",
    (row) => {
      const { tree, document } = sample(),
        input = layout(row.body);
      const before = [serializeXml(input), serializeXml(document)];
      const nodes = flatten(expandDiagramLayout(input.root, tree));
      expect(structure(nodes)).toEqual(structure(row.nodes));
      for (const [i, { node }] of nodes.entries())
        if (attr(node.algorithm, "type") === "tx" && node.contributors.length)
          expect(node.contributors.map((n) => n.point.id)).toEqual(
            row.nodes[i].contributors,
          );
      expect([serializeXml(input), serializeXml(document)]).toEqual(before);
    },
  );

  it("does not depend on model IDs, XML point order, or layout identifier spellings", () => {
    const rename = (id) => `different-${id}`,
      { tree } = sample(rename, true);
    for (const row of native.cases) {
      const body = row.body.replace(
        /(name|ref)="([^"]+)"/g,
        (_, attr, value) => `${attr}="renamed-${value}"`,
      );
      const nodes = structure(
        flatten(expandDiagramLayout(layout(body).root, tree)),
      );
      expect(nodes).toEqual(
        row.nodes.map((n) => ({
          name: n.name === "root" ? "root" : `renamed-${n.name}`,
          context: rename(n.context),
          parent: n.parent,
        })),
      );
    }
  });

  it("takes only the first satisfied branch, preserves context, and allows a missing else", () => {
    const { tree } = sample();
    const input =
      layout(`<dgm:forEach axis="ch" ptType="node" cnt="1"><dgm:choose>
      <dgm:if func="cnt" axis="ch" ptType="node" op="equ" val="2"><dgm:layoutNode name="first"/></dgm:if>
      <dgm:if func="cnt" axis="self" op="equ" val="1"><dgm:layoutNode name="second"/></dgm:if>
      <dgm:else><dgm:layoutNode name="otherwise"/></dgm:else>
    </dgm:choose><dgm:choose><dgm:if func="cnt" axis="self" op="equ" val="0"><dgm:layoutNode name="never"/></dgm:if></dgm:choose></dgm:forEach>`);
    expect(structure(flatten(expandDiagramLayout(input.root, tree)))).toEqual([
      { name: "root", context: "0", parent: null },
      { name: "first", context: "1", parent: 0 },
    ]);
  });

  it("reads inherited variables before choosing algorithms and keeps sibling scopes separate", () => {
    const { tree } = sample();
    const input =
      parseXml(`<d:layoutDef xmlns:d="${NS.diagram}"><d:layoutNode name="root"><d:varLst><d:dir val="rev"/></d:varLst>
      <d:layoutNode name="left" styleLbl="accent" moveWith="right" chOrder="t"><d:varLst><d:dir/></d:varLst>
        <d:choose><d:if func="var" arg="dir" op="equ" val="norm"><d:alg type="lin"/><d:shape type="rect"/><d:constrLst><d:constr type="w" val="2"/></d:constrLst></d:if><d:else><d:alg type="sp"/></d:else></d:choose>
        <d:constrLst><d:constr type="h" val="3"/></d:constrLst><d:ruleLst><d:rule type="primFontSz" val="10"/></d:ruleLst>
        <d:layoutNode name="child"/>
      </d:layoutNode>
      <d:layoutNode name="right"><d:choose><d:if func="var" arg="dir" op="equ" val="norm"><d:alg type="sp"/></d:if><d:else><d:alg type="tx"/></d:else></d:choose></d:layoutNode>
    </d:layoutNode></d:layoutDef>`);
    const root = expandDiagramLayout(input.root, tree),
      [left, right] = root.children;
    expect(root.variables.get("dir")).toBe(1n);
    expect(left.variables.get("dir")).toBe(0n);
    expect(left.children[0].variables.get("dir")).toBe(0n);
    expect(right.variables.get("dir")).toBe(1n);
    expect([
      attr(left.algorithm, "type"),
      attr(right.algorithm, "type"),
    ]).toEqual(["lin", "tx"]);
    expect(left.styleLabel).toBe("accent");
    expect(left.moveWith).toBe("right");
    expect(left.childOrder).toBe("t");
    expect(attr(left.shape, "type")).toBe("rect");
    expect(left.constraints.map((e) => attr(e, "type"))).toEqual(["h"]);
    expect(left.rules.map((e) => attr(e, "val"))).toEqual(["10"]);
    // Child order controls eventual drawing stacking, not semantic traversal.
    expect(root.children.map((n) => n.name)).toEqual(["left", "right"]);
  });

  it("distinguishes an omitted mapping from an explicitly empty mapping", () => {
    const { tree } = sample();
    const root = expandDiagramLayout(
      layout(
        `<dgm:forEach axis="ch" ptType="node" cnt="1"><dgm:layoutNode name="omitted"/><dgm:layoutNode name="empty"><dgm:presOf/></dgm:layoutNode><dgm:layoutNode name="children"><dgm:presOf axis="ch" ptType="node"/></dgm:layoutNode></dgm:forEach>`,
      ).root,
      tree,
    );
    expect(
      root.children.map((n) => n.contributors.map((c) => c.point.id)),
    ).toEqual([["1"], [], ["11", "12"]]);
    expect(root.children.map((n) => n.context.point.id)).toEqual([
      "1",
      "1",
      "1",
    ]);
    expect(root.children[0].presentationOf).toBe(null);
  });

  it("handles reference chains and ignores the referring loop's selector and body", () => {
    const { tree } = sample();
    const body = `<dgm:forEach ref="alias" axis="none"><dgm:layoutNode name="unused"/></dgm:forEach>
      <dgm:choose><dgm:if func="cnt" axis="none" op="equ" val="1">
        <dgm:forEach name="alias" ref="actual"/><dgm:forEach name="actual" axis="ch" ptType="node"><dgm:layoutNode name="leaf"/></dgm:forEach>
      </dgm:if></dgm:choose>`;
    expect(
      expandDiagramLayout(layout(body).root, tree).children.map(
        (n) => n.context.point.id,
      ),
    ).toEqual(["1", "2", "3"]);
  });

  it("terminates repeated mappings without enumerating exponentially repeated paths", () => {
    const { tree } = sample();
    let calls = 0;
    const measured = {
      ...tree,
      axis(n, a) {
        calls++;
        return tree.axis(n, a);
      },
    };
    const body = `<dgm:forEach axis="${Array(35).fill("ch par").join(" ")} ch" ptType="${Array(35).fill("node all").join(" ")} node"><dgm:layoutNode name="leaf"/></dgm:forEach><dgm:layoutNode name="after"/>`;
    const root = expandDiagramLayout(layout(body).root, measured);
    expect(root.children.map((n) => n.context.point.id)).toEqual([
      "1",
      "2",
      "3",
      "0",
    ]);
    expect(calls).toBeLessThan(100);
  });

  it("expands deeply nested lexical nodes without JavaScript recursion", () => {
    const { tree } = sample(),
      depth = 12000;
    const input = parseXml(
      `<d:layoutNode xmlns:d="${NS.diagram}" name="root">${"<d:layoutNode>".repeat(depth)}${"</d:layoutNode>".repeat(depth)}</d:layoutNode>`,
    );
    let node = expandDiagramLayout(input.root, tree),
      count = 0;
    while (node.children.length) {
      node = node.children[0];
      count++;
    }
    expect(count).toBe(depth);
  });

  it("expands recursive references over deep data trees without call-stack growth", () => {
    const depth = 3000;
    const points = Array.from(
      { length: depth + 1 },
      (_, i) => `<d:pt modelId="${i}" type="${i ? "node" : "doc"}"/>`,
    ).join("");
    const edges = Array.from(
      { length: depth },
      (_, i) =>
        `<d:cxn modelId="${i + depth + 1}" srcId="${i}" destId="${i + 1}"/>`,
    ).join("");
    const tree = readDiagramHierarchy(
      readDiagramDataModel(
        parseXml(
          `<d:dataModel xmlns:d="${NS.diagram}"><d:ptLst>${points}</d:ptLst><d:cxnLst>${edges}</d:cxnLst></d:dataModel>`,
        ).root,
      ),
    );
    const input = layout(
      '<dgm:forEach name="descend" axis="ch" ptType="node"><dgm:layoutNode name="node"><dgm:forEach ref="descend"/></dgm:layoutNode></dgm:forEach>',
    );
    let node = expandDiagramLayout(input.root, tree),
      count = 0;
    while (node.children.length) {
      node = node.children[0];
      count++;
    }
    expect(count).toBe(depth);
    expect(node.context.point.id).toBe(String(depth));
  });

  it.each([
    '<dgm:forEach ref="missing"/>',
    '<dgm:forEach name="a" ref="b"/><dgm:forEach name="b" ref="a"/>',
    '<dgm:forEach name="same"/><dgm:forEach name="same"/>',
    '<dgm:forEach name="forever" axis="self"><dgm:layoutNode name="node"><dgm:forEach ref="forever"/></dgm:layoutNode></dgm:forEach>',
    '<dgm:forEach name="forever" axis="self"><dgm:forEach ref="forever"/></dgm:forEach>',
    '<dgm:layoutNode chOrder="reverse"/>',
    '<dgm:forEach axis="unknown"/>',
    "<dgm:unsupported/>",
  ])(
    "rejects invalid or non-progressing expansion without mutating inputs: %s",
    (body) => {
      const { tree, document } = sample(),
        input = layout(body),
        before = [serializeXml(input), serializeXml(document)];
      expect(() => expandDiagramLayout(input.root, tree)).toThrow(/diagram/);
      expect([serializeXml(input), serializeXml(document)]).toEqual(before);
    },
  );

  it("validates the layout root and ignores unrelated namespace lookalikes", () => {
    const { tree } = sample();
    for (const body of [
      `<x:layoutNode xmlns:x="urn:other"/>`,
      `<d:layoutDef xmlns:d="${NS.diagram}"/>`,
      `<d:layoutDef xmlns:d="${NS.diagram}"><d:layoutNode/><d:layoutNode/></d:layoutDef>`,
    ])
      expect(() => expandDiagramLayout(parseXml(body).root, tree)).toThrow(
        /diagram/,
      );
    const root = expandDiagramLayout(
      layout(
        '<x:forEach xmlns:x="urn:other" axis="bad"/><dgm:extLst><dgm:forEach ref="not-executable"/></dgm:extLst>',
      ).root,
      tree,
    );
    expect(root.children).toEqual([]);
  });

  it("excludes extension payloads from the reference namespace", () => {
    const { tree } = sample();
    const input = layout(
      '<dgm:extLst><dgm:forEach name="loop" axis="bad"/></dgm:extLst><dgm:forEach name="loop" axis="ch" ptType="node"><dgm:layoutNode name="node"/></dgm:forEach>',
    );
    expect(expandDiagramLayout(input.root, tree).children).toHaveLength(3);
  });

  it("rejects excessive work without returning a partial layout or changing source XML", () => {
    const { tree } = sample();
    const input = layout(
        `<dgm:forEach axis="${Array(35).fill("ch par").join(" ")}" ptType="${Array(35).fill("node all").join(" ")}"><dgm:choose><dgm:if func="cnt" axis="none" op="equ" val="1"><dgm:layoutNode name="never"/></dgm:if></dgm:choose></dgm:forEach>`,
      ),
      before = serializeXml(input);
    expect(() =>
      expandDiagramLayout(input.root, tree, { maxOperations: 100 }),
    ).toThrow(/operation budget exceeded/);
    expect(serializeXml(input)).toBe(before);
    const noResults = layout(
      `<dgm:forEach axis="${Array(35).fill("ch par").join(" ")} none" ptType="${Array(35).fill("node all").join(" ")}"><dgm:layoutNode name="never"/></dgm:forEach>`,
    );
    expect(() =>
      expandDiagramLayout(noResults.root, tree, { maxOperations: 100 }),
    ).toThrow(/operation budget exceeded/);
    for (const maxOperations of [0, -1, NaN, Infinity, 1.5])
      expect(() =>
        expandDiagramLayout(layout("").root, tree, { maxOperations }),
      ).toThrow(/invalid.*budget/);
    expect(
      expandDiagramLayout(layout("").root, tree, { maxOperations: 10 })
        .children,
    ).toEqual([]);
  });
});
