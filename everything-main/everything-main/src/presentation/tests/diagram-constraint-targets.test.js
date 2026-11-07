import { describe, expect, it } from "vitest";
import native from "./data/diagram-constraint-targets-native.json";
import { sample } from "./diagram-layout-fixture.js";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { readDiagramConstraint } from "../lib/pptx/src/internal/diagram/constraint.ts";
import { selectDiagramConstraintTargets } from "../lib/pptx/src/internal/diagram/constraint-targets.ts";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";

const layout = (body) =>
  parseXml(
    `<dgm:layoutNode xmlns:dgm="${NS.diagram}" name="root">${body}</dgm:layoutNode>`,
  );
const selector = (relationship, name = "", pointType = "all") => ({
  relationship,
  name,
  pointType,
});
const identify = (nodes) =>
  nodes.map((node) => ({ name: node.name, context: node.context.point.id }));

describe("DiagramML constraint target selection", () => {
  it.each(native.cases)("matches the native reference: $name", (row) => {
    const { tree, document } = sample();
    const input = layout(
      `<dgm:constrLst>${row.constraints}</dgm:constrLst>${row.body}`,
    );
    const before = [serializeXml(input), serializeXml(document)];
    const root = expandDiagramLayout(input.root, tree);
    const selected = [];
    const pending = [root];
    while (pending.length) {
      const node = pending.pop();
      for (const element of node.constraints) {
        const c = readDiagramConstraint(element);
        if (c.target.type === "h" && c.value === 30)
          selected.push(
            ...selectDiagramConstraintTargets(node, c.target.selector),
          );
      }
      for (let i = node.children.length - 1; i >= 0; --i)
        pending.push(node.children[i]);
    }
    // Native drawing output has only the query shapes; a des/empty selector
    // additionally selects invisible containers in the logical layout tree.
    expect(identify(selected.filter((n) => n.name === "query"))).toEqual(
      row.expected,
    );
    expect([serializeXml(input), serializeXml(document)]).toEqual(before);
  });

  it("walks layout relationships and retains distinct instances of one data point", () => {
    const root = expandDiagramLayout(
      layout(`<dgm:forEach axis="ch" ptType="node">
        <dgm:layoutNode name="container">
          <dgm:layoutNode name="item"/>
          <dgm:layoutNode name="item"/>
        </dgm:layoutNode>
      </dgm:forEach>`).root,
      sample().tree,
    );
    const selected = selectDiagramConstraintTargets(
      root,
      selector("des", "item"),
    );
    expect(selected).toHaveLength(6);
    expect(new Set(selected).size).toBe(6);
    expect(selected.map((n) => n.context.point.id)).toEqual([
      "1",
      "1",
      "2",
      "2",
      "3",
      "3",
    ]);
    expect(
      selectDiagramConstraintTargets(root, selector("ch", "item")),
    ).toEqual([]);
    expect(selectDiagramConstraintTargets(root, selector("ch"))).toEqual(
      root.children,
    );
    expect(selectDiagramConstraintTargets(root, selector("des"))).toHaveLength(
      9,
    );
    expect(selectDiagramConstraintTargets(root, selector("des"))).not.toContain(
      root,
    );
  });

  it("uses semantic contexts rather than text contributors or saved presentation points", () => {
    const root = expandDiagramLayout(
      layout(`<dgm:forEach axis="ch" ptType="node">
        <dgm:layoutNode name="item"><dgm:presOf axis="ch" ptType="node"/></dgm:layoutNode>
      </dgm:forEach>`).root,
      sample().tree,
    );
    expect(root.children[2].contributors.map((n) => n.point.id)).toEqual([
      "31",
    ]);
    expect(
      selectDiagramConstraintTargets(root, selector("ch", "", "asst")),
    ).toEqual([root.children[2]]);
    expect(
      selectDiagramConstraintTargets(root, selector("ch", "", "norm")),
    ).toEqual(root.children.slice(0, 2));
    expect(
      selectDiagramConstraintTargets(root, selector("ch", "", "pres")),
    ).toEqual([]);
  });

  it("keeps names exact, with only the empty name acting as a wildcard", () => {
    const root = expandDiagramLayout(
      layout(
        '<dgm:layoutNode name=" a "/><dgm:layoutNode name="a"/><dgm:layoutNode name="A"/>',
      ).root,
      sample().tree,
    );
    for (const [i, name] of [" a ", "a", "A"].entries())
      expect(
        selectDiagramConstraintTargets(root, selector("ch", name)),
      ).toEqual([root.children[i]]);
    expect(
      selectDiagramConstraintTargets(root, selector("ch", "missing")),
    ).toEqual([]);
    expect(selectDiagramConstraintTargets(root, selector("ch"))).toEqual(
      root.children,
    );
  });

  it("does not prune descendants when their ancestors fail the point-type filter", () => {
    const root = expandDiagramLayout(
      layout(`<dgm:forEach axis="ch" ptType="asst">
        <dgm:layoutNode name="assistant"><dgm:forEach axis="ch" ptType="node">
          <dgm:layoutNode name="normal"/>
        </dgm:forEach></dgm:layoutNode>
      </dgm:forEach>`).root,
      sample().tree,
    );
    expect(
      identify(
        selectDiagramConstraintTargets(root, selector("des", "", "norm")),
      ),
    ).toEqual([{ name: "normal", context: "31" }]);
  });

  it("selects closing transitions already present in the layout", () => {
    const root = expandDiagramLayout(
      layout(`<dgm:forEach axis="ch" ptType="sibTrans" hideLastTrans="false">
        <dgm:layoutNode name="space"/>
      </dgm:forEach>`).root,
      sample().tree,
    );
    const nodes = selectDiagramConstraintTargets(
      root,
      selector("ch", "", "sibTrans"),
    );
    expect(nodes.map((n) => n.context.point.id)).toEqual(["S1", "S2", "S3"]);
    expect(nodes[2].context.closesCycle).toBe(true);
  });

  it("returns the owner for self/all without using its name, contributors, or semantic type", () => {
    const root = expandDiagramLayout(layout("").root, sample().tree);
    for (const name of ["", "root", "missing"])
      expect(
        selectDiagramConstraintTargets(root, selector("self", name)),
      ).toEqual([root]);
    for (const type of [
      "doc",
      "node",
      "norm",
      "nonNorm",
      "asst",
      "nonAsst",
      "parTrans",
      "sibTrans",
      "pres",
    ])
      expect(
        selectDiagramConstraintTargets(root, selector("self", "", type)),
      ).toEqual([]);
  });

  it("handles deep layouts without recursion and returns independent result arrays", () => {
    const depth = 15_000;
    const root = expandDiagramLayout(
      layout(
        '<dgm:layoutNode name="item">'.repeat(depth) +
          "</dgm:layoutNode>".repeat(depth),
      ).root,
      sample().tree,
    );
    const s = selector("des", "item");
    const result = selectDiagramConstraintTargets(root, s);
    expect(result).toHaveLength(depth);
    expect(result[0]).toBe(root.children[0]);
    expect(result.at(-1).children).toEqual([]);
    result.length = 0;
    expect(selectDiagramConstraintTargets(root, s)).toHaveLength(depth);
    expect(selectDiagramConstraintTargets(root, selector("ch"))).toHaveLength(
      1,
    );
  });
});
