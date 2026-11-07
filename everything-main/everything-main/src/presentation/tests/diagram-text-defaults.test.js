import { describe, expect, it } from "vitest";
import native from "./data/diagram-text-defaults-native.json";
import { sample } from "./diagram-layout-fixture.js";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { evaluateDiagramInitialConstraints as evaluate } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";

const available = { w: 200, h: 200 };
const property = (type, relationship = "self", name = "") => ({
  type,
  selector: { relationship, name, pointType: "all" },
});
const constraint = (type, attributes) =>
  `<d:constr type="${type}" ${attributes}/>`;
const fixture = (constraints = "", parent = "", rules = "") => {
  const document = parseXml(`<d:layoutNode xmlns:d="${NS.diagram}" name="root">
    <d:alg type="lin"/><d:constrLst>${parent}</d:constrLst>
    <d:layoutNode name="text"><d:alg type="tx"/>
    <d:constrLst>${constraints}</d:constrLst><d:ruleLst>${rules}</d:ruleLst>
    </d:layoutNode></d:layoutNode>`);
  const root = expandDiagramLayout(document.root, sample().tree);
  return { document, root, text: root.children[0] };
};
const change = (owner, type, value) => ({
  owner,
  property: property(type),
  value,
});

describe("SmartArt live text-constraint defaults", () => {
  it("keeps implicit primary defaults live through font realization and trials", () => {
    const { root, text } = fixture(constraint("h", 'refType="secFontSz"'));
    const initial = evaluate(root, available).get(text);
    expect(initial.values.get("primFontSz")).toBe(36);
    expect(initial.values.get("secFontSz")).toBeCloseTo(28.08);
    expect(initial.values.get("lMarg")).toBeCloseTo(20.16);
    const realized = evaluate(root, available, { quantizeFonts: true }).get(
      text,
    );
    expect(realized.size.h).toBe(28);
    const trial = evaluate(root, available, {
      changes: [change(text, "primFontSz", 12.5)],
    }).get(text);
    expect(trial.size.h).toBe(9.75);
    expect(trial.values.get("lMarg")).toBeCloseTo(7);
    expect(initial.values.get("primFontSz")).toBe(36);
    expect(evaluate(root, available).get(text).values.get("primFontSz")).toBe(
      36,
    );
  });

  it.each(native.cases)(
    "matches native default references after font quantization: $name",
    (row) => {
      const secondary =
        row.secondary === null
          ? ""
          : constraint(
              "secFontSz",
              row.secondary === "reference"
                ? 'refType="primFontSz" fact="0.78"'
                : `val="${row.secondary}"`,
            );
      const { document, root, text } = fixture(
        constraint("w", `val="${row.width}"`) +
          constraint("h", 'refType="secFontSz"') +
          constraint("primFontSz", `val="${row.primary}"`) +
          secondary +
          (row.marginOverride ? constraint("lMarg", 'val="3"') : ""),
      );
      const before = serializeXml(document);
      const initial = evaluate(root, available).get(text);
      const result = evaluate(root, available, { quantizeFonts: true }).get(
        text,
      );
      expect(Math.round(result.size.h * 36000)).toBe(row.expected.height);
      for (const side of ["l", "r", "t", "b"])
        expect(Math.round(result.values.get(`${side}Marg`) * 12700)).toBe(
          row.expected.insets[side],
        );
      expect(initial.values.get("primFontSz")).toBe(row.primary);
      expect(serializeXml(document)).toBe(before);
    },
  );

  it("reevaluates default margins, secondary fonts and downstream dimensions for local trials", () => {
    const { root, text } = fixture(
      constraint("w", 'refType="lMarg" fact="10"') +
        constraint("h", 'refType="secFontSz"'),
      constraint("primFontSz", 'for="ch" forName="text" val="25"'),
    );
    const initial = evaluate(root, available);
    const result = evaluate(root, available, {
      changes: [change(text, "primFontSz", 12.5)],
    });
    expect(result.get(text).size.w).toBeCloseTo(70);
    expect(result.get(text).size.h).toBe(9.75);
    expect(result.get(text).values.get("rMarg")).toBeCloseTo(7);
    expect(
      result.get(root).reference(property("primFontSz", "ch", "text")),
    ).toBe(25);
    expect(initial.get(text).values.get("secFontSz")).toBe(19.5);
  });

  it("gives authored and caller-provided values priority over algorithm defaults", () => {
    const { root, text } = fixture(
      constraint("lMarg", 'val="2"'),
      constraint("secFontSz", 'for="ch" forName="text" val="17"'),
    );
    const result = evaluate(root, available, {
      defaults: (node) =>
        node === text
          ? new Map([
              ["primFontSz", 25],
              ["secFontSz", 13],
              ["lMarg", 8],
              ["rMarg", 9],
            ])
          : new Map(),
      adjustments: [change(text, "primFontSz", 10)],
    }).get(text);
    for (const [type, value] of Object.entries({
      secFontSz: 17,
      lMarg: 2,
      primFontSz: 10,
      rMarg: 9,
      tMarg: 5.6,
      bMarg: 5.6,
    }))
      expect(result.values.get(type)).toBeCloseTo(value);
  });

  it("exposes implicit rules and dependencies without fabricating authored factor bases", () => {
    const { root, text } = fixture(
      constraint("primFontSz", 'val="20"'),
      "",
      '<d:rule type="primFontSz" val="5"/><d:rule type="secFontSz" val="4"/><d:rule type="lMarg" fact="0.1"/>',
    );
    const initial = evaluate(root, available).get(text);
    expect(initial.rulePlan(initial.rules[0]).hasCrossPropertyDependents).toBe(
      true,
    );
    expect(initial.rulePlan(initial.rules[1]).current).toBeCloseTo(15.6);
    expect(initial.rulePlan(initial.rules[1]).limit).toBe(4);
    expect(initial.rulePlan(initial.rules[2])).toBeNull();
    const changes = ["secFontSz", "lMarg", "rMarg", "tMarg", "bMarg"].map(
      (type) => change(text, type, 1),
    );
    const result = evaluate(root, available, { changes }).get(text);
    expect(result.rulePlan(result.rules[0]).hasCrossPropertyDependents).toBe(
      false,
    );
    expect(initial.rulePlan(initial.rules[0]).hasCrossPropertyDependents).toBe(
      true,
    );
  });

  it("does not make implicit font ratios into authored equality groups", () => {
    const { root, text } = fixture(constraint("primFontSz", 'val="20"'));
    const result = evaluate(root, available).get(text);
    expect(result.equalityChanges("secFontSz", 8)).toEqual([
      change(text, "secFontSz", 8),
    ]);
    const trial = evaluate(root, available, {
      changes: result.equalityChanges("secFontSz", 8),
    }).get(text);
    expect(trial.values.get("primFontSz")).toBe(20);
    expect(trial.values.get("lMarg")).toBeCloseTo(11.2);
  });

  it("rejects cycles through implicit defaults and resolves absent primary fonts", () => {
    const cyclic = fixture(constraint("primFontSz", 'refType="secFontSz"'));
    expect(() => evaluate(cyclic.root, available)).toThrow(
      "cyclic diagram constraint",
    );
    const missing = fixture(constraint("h", 'refType="secFontSz"'));
    const defaults = evaluate(missing.root, available).get(missing.text);
    expect(defaults.values.get("primFontSz")).toBe(36);
    expect(defaults.size.h).toBeCloseTo(36 * 0.78);
    const explicit = fixture();
    const result = evaluate(explicit.root, available, {
      defaults: (node) =>
        node === explicit.text ? new Map([["primFontSz", 12]]) : new Map(),
    });
    expect(result.get(explicit.text).values.get("secFontSz")).toBe(9.36);
    expect(result.get(explicit.root).values.has("secFontSz")).toBe(false);
  });
});
