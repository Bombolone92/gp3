import { describe, expect, it } from "vitest";
import native from "./data/diagram-font-quantization-native.json";
import { sample } from "./diagram-layout-fixture.js";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { evaluateDiagramInitialConstraints as evaluate } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import { arrangeDiagramChildren } from "../lib/pptx/src/internal/diagram/arrange.ts";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
const property = (type, relationship = "self", name = "") => ({
  type,
  selector: { relationship, name, pointType: "all" },
});
const fixture = (text = "", parent = "", rules = "") => {
  const document = parseXml(
    `<d:layoutNode xmlns:d="${NS.diagram}" name="root"><d:alg type="lin"/>${parent}<d:layoutNode name="text"><d:alg type="tx"/>${text}<d:ruleLst>${rules}</d:ruleLst></d:layoutNode><d:layoutNode name="probe"><d:alg type="sp"/></d:layoutNode></d:layoutNode>`,
  );
  const root = expandDiagramLayout(document.root, sample().tree);
  return { document, root, text: root.children[0] };
};
describe("scope-ordered initial font realization", () => {
  it.each(native.cases)("matches independent native geometry: $name", (row) => {
    const { document, root, text } = fixture(row.text, row.parent),
      before = serializeXml(document);
    const changes =
      row.customPrimary === null
        ? []
        : [
            {
              owner: text,
              property: property("primFontSz"),
              value: row.customPrimary,
            },
          ];
    const result = evaluate(root, native.available, {
      quantizeFonts: true,
      changes,
    });
    const bounds = arrangeDiagramChildren(
      native.available,
      root.children.map((node) => ({ x: 0, y: 0, ...result.get(node).size })),
      { type: "lin", direction: "fromL", horizontal: "none", vertical: "none" },
    );
    for (const [i, expected] of row.expected.entries()) {
      for (const [type, actual] of Object.entries(bounds[i]))
        expect(
          Math.abs(
            Math.round(actual * 36000) -
              expected.bounds[{ w: "cx", h: "cy" }[type] ?? type],
          ),
        ).toBeLessThanOrEqual(1);
      if (expected.insets)
        for (const side of ["l", "r", "t", "b"])
          expect(
            Math.round(
              result.get(root.children[i]).values.get(`${side}Marg`) * 12700,
            ),
          ).toBe(expected.insets[side]);
    }
    expect(serializeXml(document)).toBe(before);
  });
  it("keeps factor rules and equality edges after realizing font values", () => {
    const { document, root, text } = fixture(
      `<d:constrLst><d:constr type="userA" val="18.6"/><d:constr type="primFontSz" refType="userA"/><d:constr type="secFontSz" refType="primFontSz" op="equ" fact="0.78"/></d:constrLst>`,
      "",
      '<d:rule type="primFontSz" fact="0.5"/><d:rule type="secFontSz" fact="0.5"/>',
    );
    const before = serializeXml(document),
      state = evaluate(root, native.available, { quantizeFonts: true }).get(
        text,
      );
    expect(state.values.get("primFontSz")).toBe(19);
    expect(state.values.get("secFontSz")).toBe(15);
    expect(state.rulePlan(state.rules[0])).toMatchObject({
      current: 19,
      limit: 9.3,
      hasCrossPropertyDependents: true,
    });
    expect(state.rulePlan(state.rules[1])).toMatchObject({
      current: 15,
      limit: 9.5,
    });
    const trial = state.equalityTrial("primFontSz", 10);
    expect(
      trial.scopes.some(
        (change) =>
          change.scope === text &&
          change.property.type === "secFontSz" &&
          Math.abs(change.value - 7.8) < 1e-12,
      ),
    ).toBe(true);
    expect(serializeXml(document)).toBe(before);
  });
  it("keeps explicit fitted zero values while realizing other initial fonts", () => {
    const { root, text } = fixture(
      '<d:constrLst><d:constr type="primFontSz" val="18.6"/></d:constrLst>',
    );
    const state = evaluate(root, native.available, {
      quantizeFonts: true,
      adjustments: [
        { owner: text, property: property("primFontSz"), value: 0 },
      ],
    }).get(text);
    expect(state.values.get("primFontSz")).toBe(0);
    expect(state.values.get("lMarg")).toBe(0);
  });
  it("retains the raw evaluation when quantization is not requested", () => {
    const { root, text } = fixture(
      '<d:constrLst><d:constr type="primFontSz" val="1.9"/></d:constrLst>',
    );
    for (const options of [{}, { quantizeFonts: false }]) {
      const state = evaluate(root, native.available, options).get(text);
      expect(state.values.get("primFontSz")).toBe(1.9);
      expect(state.values.get("secFontSz")).toBeCloseTo(1.482);
    }
  });
  it("realizes the TX primary and derived secondary defaults when fonts are omitted", () => {
    const { root, text } = fixture();
    const state = evaluate(root, native.available, {
      quantizeFonts: true,
    }).get(text);
    expect(state.values.get("primFontSz")).toBe(36);
    expect(state.values.get("secFontSz")).toBe(28);
  });
  it("rejects cyclic font references instead of using a rounded partial value", () => {
    const { root } = fixture(
      '<d:constrLst><d:constr type="primFontSz" refType="secFontSz"/><d:constr type="secFontSz" refType="primFontSz"/></d:constrLst>',
    );
    expect(() =>
      evaluate(root, native.available, { quantizeFonts: true }),
    ).toThrow("cyclic diagram constraint reference");
  });
});
