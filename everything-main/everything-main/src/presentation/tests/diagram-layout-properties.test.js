import { describe, expect, it } from "vitest";
import native from "./data/diagram-layout-properties-native.json";
import { sample } from "./diagram-layout-fixture.js";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import {
  arrangeDiagramChildren,
  readDiagramArrangement,
} from "../lib/pptx/src/internal/diagram/arrange.ts";
import {
  NS,
  parseXml,
  serializeXml,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

const attr = (e, name) => e && getAttrValue(e, qname("", name, ""));
const layout = (body) =>
  parseXml(`<dgm:layoutNode xmlns:dgm="${NS.diagram}" name="root">
    <dgm:alg type="lin"/><dgm:shape/><dgm:presOf/><dgm:constrLst/>
    ${body}</dgm:layoutNode>`);

describe("DiagramML active property replacement", () => {
  it.each(native.cases)("matches the native reference: $name", (row) => {
    const { tree, document } = sample();
    const input = layout(row.body),
      before = [serializeXml(input), serializeXml(document)];
    const root = expandDiagramLayout(input.root, tree);
    expect(root.children).toHaveLength(3);
    // These controls deliberately use only absolute w/h literals. This check
    // isolates which property list executes; it does not model a constraint
    // solver, text fitting, or a regenerated drawing.
    const rectangles = root.children.map((child) => {
      const values = Object.fromEntries(
        child.constraints.map((e) => [attr(e, "type"), Number(attr(e, "val"))]),
      );
      return { x: 0, y: 0, w: values.w ?? 0, h: values.h ?? 0 };
    });
    const bounds = arrangeDiagramChildren(
      { w: 400, h: 100 },
      rectangles,
      readDiagramArrangement(root.algorithm),
    );
    if (row.expected.length === 0) {
      // An explicitly empty final list clears the previous dimensions.
      for (const child of root.children) expect(child.constraints).toEqual([]);
      for (const rect of bounds) expect([rect.w, rect.h]).toEqual([0, 0]);
    } else {
      expect(row.expected).toHaveLength(root.children.length);
      for (const [i, child] of root.children.entries()) {
        const expected = row.expected[i];
        expect(child.name).toBe(expected.name);
        expect(child.context.point.id).toBe(expected.context);
        expect(child.contributors.map((n) => n.point.id)).toEqual(
          expected.contributors,
        );
        expect(attr(child.shape, "type")).toBe(expected.preset);
        for (const key of ["x", "y", "w", "h"])
          expect(
            Math.abs(Math.trunc(bounds[i][key] * 36000) - expected.bounds[key]),
          ).toBeLessThanOrEqual(1);
      }
    }
    expect([serializeXml(input), serializeXml(document)]).toEqual(before);
  });

  it.each(native.rules)(
    "keeps the native active adjustment rules: $name",
    (row) => {
      const { tree } = sample();
      const root = expandDiagramLayout(layout(row.body).root, tree);
      for (const child of root.children)
        expect(child.rules.map((e) => Number(attr(e, "val")))).toEqual(
          row.expectedRuleValues,
        );
      // Native 5pt-minimum controls settle at 8pt; a later 40pt minimum or empty
      // rule list restores 40pt. Recorded native output distinguishes replacement
      // from accumulation. Font measurement is outside this interpreter test.
      expect(row.nativeFontSizes).toEqual(
        Array(3).fill([row.expectedRuleValues[0] === 5 ? 800 : 4000]),
      );
    },
  );

  it("uses only executed branches and preserves the rest of the node's properties", () => {
    const { tree } = sample();
    const input =
      layout(`<dgm:shape type="ellipse"/><dgm:presOf axis="ch" ptType="node"/>
      <dgm:constrLst><dgm:constr type="w" val="20"/></dgm:constrLst>
      <dgm:ruleLst><dgm:rule type="w" val="10"/></dgm:ruleLst>
      <dgm:choose><dgm:if func="cnt" axis="self" op="equ" val="0">
        <dgm:shape/><dgm:presOf/><dgm:constrLst/><dgm:ruleLst/>
      </dgm:if><dgm:else><dgm:alg type="composite"/></dgm:else></dgm:choose>`);
    const root = expandDiagramLayout(input.root, tree);
    expect(attr(root.algorithm, "type")).toBe("composite");
    expect(attr(root.shape, "type")).toBe("ellipse");
    expect(root.contributors.map((n) => n.point.id)).toEqual(["1", "2", "3"]);
    expect(root.constraints.map((e) => attr(e, "val"))).toEqual(["20"]);
    expect(root.rules.map((e) => attr(e, "val"))).toEqual(["10"]);
  });

  it("executes replacements inside transparent loops in their semantic context", () => {
    const { tree } = sample();
    const root = expandDiagramLayout(
      layout(`<dgm:presOf axis="ch" ptType="node"/>
      <dgm:forEach axis="ch" ptType="node">
        <dgm:presOf axis="self"/>
        <dgm:choose><dgm:if func="pos" axis="self" ptType="node" op="equ" val="3">
          <dgm:constrLst/><dgm:ruleLst/><dgm:shape/>
        </dgm:if></dgm:choose>
      </dgm:forEach>`).root,
      tree,
    );
    expect(root.context.point.id).toBe("0");
    expect(root.contributors.map((n) => n.point.id)).toEqual(["3"]);
    expect(root.constraints).toEqual([]);
    expect(root.rules).toEqual([]);
    expect(attr(root.shape, "type")).toBe(null);
  });

  it("keeps replacement lists isolated between sibling instances", () => {
    const { tree } = sample();
    const root = expandDiagramLayout(
      layout(`<dgm:forEach axis="ch" ptType="node">
      <dgm:layoutNode name="item"><dgm:constrLst><dgm:constr type="w" val="20"/></dgm:constrLst>
        <dgm:choose><dgm:if func="pos" axis="self" ptType="node" op="equ" val="2"><dgm:constrLst/></dgm:if></dgm:choose>
      </dgm:layoutNode></dgm:forEach>`).root,
      tree,
    );
    expect(
      root.children.map((n) => n.constraints.map((e) => attr(e, "val"))),
    ).toEqual([["20"], [], ["20"]]);
    expect(root.children[0].constraints).not.toBe(root.children[2].constraints);
  });
});
