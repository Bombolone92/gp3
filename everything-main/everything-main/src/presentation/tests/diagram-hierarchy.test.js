import { describe, expect, it } from "vitest";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";

const point = (id, type = "node", extra = "") =>
  `<d:pt modelId="${id}" type="${type}" ${extra}/>`;
const edge = (id, src, dest, order = 0, extra = "") =>
  `<d:cxn modelId="${id}" srcId="${src}" destId="${dest}" srcOrd="${order}" destOrd="0" ${extra}/>`;
const document = (points, edges = "") =>
  parseXml(
    `<d:dataModel xmlns:d="${NS.diagram}"><d:ptLst>${points}</d:ptLst><d:cxnLst>${edges}</d:cxnLst></d:dataModel>`,
  );
const hierarchy = (points, edges) =>
  readDiagramHierarchy(readDiagramDataModel(document(points, edges).root));
const ids = (nodes) => nodes.map((node) => node.point.id);

// A and B are root children; A has one child. Parent/sibling transition
// points surround each data child but do not increase its semantic depth.
const sample = () =>
  document(
    point("0", "doc") +
      point("A") +
      point("B", "asst") +
      point("A1") +
      point("AP", "parTrans", 'cxnId="10"') +
      point("AS", "sibTrans", 'cxnId="10"') +
      point("BP", "parTrans", 'cxnId="11"') +
      point("BS", "sibTrans", 'cxnId="11"') +
      point("A1P", "parTrans", 'cxnId="12"') +
      point("A1S", "sibTrans", 'cxnId="12"') +
      point("P", "pres"),
    edge("11", "0", "B", 1, 'parTransId="BP" sibTransId="BS"') +
      edge("12", "A", "A1", 0, 'parTransId="A1P" sibTransId="A1S"') +
      edge("10", "0", "A", 0, 'parTransId="AP" sibTransId="AS"') +
      edge("13", "A", "P", 0, 'type="presOf"') +
      edge("14", "P", "P", 0, 'type="presParOf"'),
  );

describe("DiagramML layout hierarchy", () => {
  it("interleaves transition points by relationship order, independently of XML point order", () => {
    const doc = sample(),
      before = serializeXml(doc);
    const tree = readDiagramHierarchy(readDiagramDataModel(doc.root));
    expect(ids(tree.root.children)).toEqual(["AP", "A", "AS", "BP", "B", "BS"]);
    expect(ids(tree.node("A").children)).toEqual(["A1P", "A1", "A1S"]);
    expect(tree.node("P")).toBeNull();
    expect(tree.root.depth).toBe(0);
    expect(tree.node("A").depth).toBe(1);
    expect(tree.node("A1").depth).toBe(2);
    expect(tree.node("A1P").depth).toBe(2);
    expect(tree.node("AP").parent).toBe(tree.root);
    expect(tree.node("A1S").parent).toBe(tree.node("A"));
    expect(tree.node("AS").closesCycle).toBe(false);
    expect(tree.node("BS").closesCycle).toBe(true);
    expect(tree.node("A1S").closesCycle).toBe(true);
    expect(serializeXml(doc)).toBe(before);
  });

  it.each([
    ["none", "A", []],
    ["self", "A", ["A"]],
    ["root", "A1", ["0"]],
    ["par", "A1", ["A"]],
    ["par", "0", []],
    ["ch", "A", ["A1P", "A1", "A1S"]],
    ["ch", "AP", []],
    ["des", "0", ["AP", "A", "A1P", "A1", "A1S", "AS", "BP", "B", "BS"]],
    ["desOrSelf", "A", ["A", "A1P", "A1", "A1S"]],
    ["ancst", "A1", ["0", "A"]],
    ["ancstOrSelf", "A1", ["0", "A", "A1"]],
    ["followSib", "A", ["AS", "BP", "B", "BS"]],
    ["follow", "AP", ["A", "A1P", "A1", "A1S", "AS", "BP", "B", "BS"]],
    ["precedSib", "B", ["AP", "A", "AS", "BP"]],
    ["preced", "B", ["AP", "A", "A1P", "A1", "A1S", "AS", "BP"]],
    ["follow", "A1", ["A1S"]],
    ["preced", "A1", ["A1P"]],
  ])("selects %s from %s", (axis, id, expected) => {
    const tree = readDiagramHierarchy(readDiagramDataModel(sample().root));
    expect(ids(tree.axis(tree.node(id), axis))).toEqual(expected);
  });

  it("keeps the final transition available for cycle layouts", () => {
    const tree = readDiagramHierarchy(readDiagramDataModel(sample().root));
    expect(ids(tree.axis(tree.node("B"), "followSib"))).toEqual(["BS"]);
    // hideLastTrans belongs to the iterator, not the semantic hierarchy.
    expect(tree.node("BS").closesCycle).toBe(true);
  });

  it("orders ancestors from the document toward the context at any depth", () => {
    // Native reference presOf/ancst and ancstOrSelf controls produce this
    // order in presOf@destOrd. It matters when an iterator selects a prefix.
    const tree = hierarchy(
      point("document", "doc") + point("a") + point("b") + point("c"),
      edge("1", "document", "a") + edge("2", "a", "b") + edge("3", "b", "c"),
    );
    expect(ids(tree.axis(tree.node("c"), "ancst"))).toEqual([
      "document",
      "a",
      "b",
    ]);
    expect(ids(tree.axis(tree.node("c"), "ancstOrSelf"))).toEqual([
      "document",
      "a",
      "b",
      "c",
    ]);
    expect(tree.axis(tree.root, "ancst")).toEqual([]);
    expect(tree.axis(tree.root, "ancstOrSelf")).toEqual([tree.root]);
    expect(ids(tree.axis(tree.node("a"), "par"))).toEqual(["document"]);
  });

  it("accepts absent transition IDs and explicit schema defaults without inventing nodes", () => {
    const tree = hierarchy(
      point("0", "doc") + point("1") + point("2"),
      edge("10", "0", "1") +
        edge("11", "0", "2", 1, 'parTransId="+0" sibTransId="000"'),
    );
    expect(ids(tree.root.children)).toEqual(["1", "2"]);
  });

  it("compares model IDs by value and validates transition back references the same way", () => {
    const tree = hierarchy(
      point("0", "doc") + point("001") + point("2", "parTrans", 'cxnId="+10"'),
      edge("010", "+0", "+1", 0, 'parTransId="002"'),
    );
    expect(tree.node("+1").point.id).toBe("001");
    expect(ids(tree.root.children)).toEqual(["2", "001"]);
  });

  it.each([
    [point("1"), "", "one document"],
    [point("0", "doc") + point("1", "doc"), "", "one document"],
    [point("0", "doc") + point("1"), "", "disconnected"],
    [point("0", "doc"), edge("10", "0", "missing"), "invalid data child"],
    [point("0", "doc"), edge("10", "missing", "0"), "has a parent"],
    [
      point("0", "doc") + point("1"),
      edge("10", "0", "1", 0, 'sibTransId="missing"'),
      "invalid sibTransId",
    ],
    [
      point("0", "doc") + point("1"),
      edge("10", "0", "1", 0, 'parTransId="1"'),
      "invalid parTransId",
    ],
    [
      point("0", "doc") + point("1") + point("2", "parTrans", 'cxnId="99"'),
      edge("10", "0", "1", 0, 'parTransId="2"'),
      "conflicting cxnId",
    ],
    [
      point("0", "doc") + point("1"),
      edge("10", "0", "1") + edge("11", "0", "1"),
      "multiple parents",
    ],
    [
      point("0", "doc") + point("1"),
      edge("10", "0", "1") + edge("11", "1", "0"),
      "repeats point",
    ],
    [
      point("0", "doc") + point("1") + point("2"),
      edge("10", "1", "2") + edge("11", "2", "1"),
      "disconnected",
    ],
    [
      point("0", "doc") + point("1") + point("2", "parTrans") + point("3"),
      edge("10", "0", "1", 0, 'parTransId="2"') + edge("11", "2", "3"),
      "data children",
    ],
  ])(
    "rejects an ambiguous hierarchy without modifying its source",
    (points, edges, error) => {
      const doc = document(points, edges),
        before = serializeXml(doc);
      const model = readDiagramDataModel(doc.root);
      expect(() => readDiagramHierarchy(model)).toThrow(error);
      expect(serializeXml(doc)).toBe(before);
    },
  );

  it("does not use another diagram's node as a traversal context", () => {
    const tree = hierarchy(point("0", "doc")),
      other = hierarchy(point("0", "doc"));
    expect(() => tree.axis(other.root, "ch")).toThrow("different hierarchy");
    expect(() => tree.axis(tree.root, "unknown")).toThrow(
      "unknown diagram axis",
    );
  });

  it("traverses deep input without recursive JavaScript calls", () => {
    const count = 12000;
    const points = [point("0", "doc")],
      edges = [];
    for (let i = 1; i <= count; i++) {
      points.push(point(String(i)));
      edges.push(edge(String(i), String(i - 1), String(i)));
    }
    const tree = hierarchy(points.join(""), edges.join(""));
    expect(tree.node(String(count)).depth).toBe(count);
    expect(tree.axis(tree.root, "des")).toHaveLength(count);
    expect(tree.axis(tree.node(String(count)), "ancst")).toHaveLength(count);
  });
});
