import { describe, expect, it } from "vitest";
import native from "./data/diagram-nested-precedence-native.json";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { evaluateDiagramInitialConstraints as evaluate } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
const available = { w: 300, h: 200 };
const expand = (document, model = native.models[0]) =>
  expandDiagramLayout(
    document.root,
    readDiagramHierarchy(readDiagramDataModel(parseXml(model).root)),
  );
const property = (type, relationship = "self", name = "") => ({
  type,
  selector: { relationship, name, pointType: "all" },
});

describe("SmartArt nested declaration precedence", () => {
  it.each(native.cases)(
    "matches native geometry and font sizes: $name",
    (row) => {
      const document = parseXml(native.layouts[row.layout]);
      const before = serializeXml(document);
      const root = expand(document, native.models[row.model]),
        leaf = root.children[0].children[0];
      const result = evaluate(root, available).get(leaf);
      expect(Math.round(result.size.w * 36000)).toBe(row.expected.w);
      expect(Math.round(result.size.h * 36000)).toBe(row.expected.h);
      if (row.expected.font !== null)
        expect(result.values.get("primFontSz")).toBe(row.expected.font);
      expect(serializeXml(document)).toBe(before);
    },
  );

  const fixture = () => {
    const root = expand(
      parseXml(`<d:layoutNode xmlns:d="${NS.diagram}" name="root"><d:alg type="lin"/>
      <d:constrLst><d:constr type="h" for="des" forName="leaf" val="32"/></d:constrLst>
      <d:layoutNode name="middle"><d:alg type="lin"/>
        <d:constrLst><d:constr type="userA" val="16"/><d:constr type="h" for="ch" forName="leaf" refType="userA" fact="0.5"/></d:constrLst>
        <d:ruleLst><d:rule type="h" for="ch" forName="leaf" fact="0.25"/></d:ruleLst>
        <d:layoutNode name="leaf"><d:alg type="sp"/><d:constrLst>
          <d:constr type="h" val="63"/><d:constr type="w" refType="h" fact="2"/>
        </d:constrLst></d:layoutNode>
      </d:layoutNode></d:layoutNode>`),
    );
    return {
      root,
      middle: root.children[0],
      leaf: root.children[0].children[0],
    };
  };
  it("retains independently referenceable ancestor declarations and active rule bases", () => {
    const { root, middle, leaf } = fixture();
    const result = evaluate(root, available);
    expect(result.get(root).reference(property("h", "des", "leaf"))).toBe(32);
    expect(result.get(middle).reference(property("h", "ch", "leaf"))).toBe(8);
    expect(result.get(leaf).size).toEqual({ w: 16, h: 8 });
    expect(
      result.get(middle).rulePlan(result.get(middle).rules[0]),
    ).toMatchObject({ current: 8, limit: 4 });
  });
  it("reevaluates effective references without reactivating shadowed outer declarations", () => {
    const { root, middle, leaf } = fixture();
    const outer = {
      owner: root,
      property: property("h", "des", "leaf"),
      value: 5,
    };
    const inner = {
      owner: middle,
      property: property("h", "ch", "leaf"),
      value: 11,
    };
    expect(
      evaluate(root, available, { changes: [outer] }).get(leaf).size,
    ).toEqual({ w: 16, h: 8 });
    expect(
      evaluate(root, available, { changes: [outer, inner] }).get(leaf).size,
    ).toEqual({ w: 22, h: 11 });
    expect(
      evaluate(root, available, {
        changes: [
          outer,
          inner,
          { owner: leaf, property: property("h"), value: 0 },
        ],
      }).get(leaf).size,
    ).toEqual({ w: 0, h: 0 });
  });
  it("still permits an outer rule to write physical slots after initial declarations", () => {
    const { root, leaf } = fixture();
    const result = evaluate(root, available, {
      adjustments: [
        { owner: root, property: property("h", "des", "leaf"), value: 5 },
      ],
    });
    expect(result.get(leaf).size).toEqual({ w: 10, h: 5 });
  });
});
