import { describe, expect, it } from "vitest";
import dimensions from "./data/diagram-linear-rules-native.json";
import general from "./data/diagram-general-rule-fit-native.json";
import ordered from "./data/diagram-rule-adjustment-native.json";
import { sample } from "./diagram-layout-fixture.js";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { reflowDiagramLayout } from "../lib/pptx/src/internal/diagram/reflow.ts";
import { fitDiagramLinearGeometryRule } from "../lib/pptx/src/internal/diagram/rule-fit.ts";
import {
  NS,
  getAttrValue,
  qname,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";

const create = (row) => {
  const data = sample(),
    document = parseXml(
      `<dgm:layoutNode xmlns:dgm="${NS.diagram}" name="root"><dgm:alg type="lin">${row.params.includes('type="horzAlign"') ? "" : '<dgm:param type="horzAlign" val="none"/>'}${row.params.includes('type="vertAlign"') ? "" : '<dgm:param type="vertAlign" val="none"/>'}${row.params}</dgm:alg><dgm:constrLst>${row.constraints}</dgm:constrLst><dgm:ruleLst>${row.rules}</dgm:ruleLst>${row.body}</dgm:layoutNode>`,
    );
  return {
    data: data.document,
    document,
    root: expandDiagramLayout(document.root, data.tree),
  };
};

describe("DiagramML linear container rule execution", () => {
  for (const family of [dimensions, general, ordered])
    it.each(family.cases)("reflows native geometry: $name", (row) => {
      const { root, document, data } = create(row),
        before = [serializeXml(document), serializeXml(data)],
        result = reflowDiagramLayout(root, row.available ?? family.available, {
          textFits: () => {
            throw new Error("SP geometry does not measure text");
          },
        });
      const actual = root.children
        .filter(
          (node) =>
            node.shape &&
            getAttrValue(node.shape, qname("", "type", "")) !== "none",
        )
        .map((node) => ({
          name: node.name,
          context: node.context.point.id,
          bounds: result.bounds.get(node),
        }))
        .filter((s) => s.bounds.w !== 0 || s.bounds.h !== 0);
      expect(actual).toHaveLength(row.expected.length);
      for (const [i, expected] of row.expected.entries()) {
        expect([actual[i].name, actual[i].context]).toEqual([
          expected.name,
          expected.context,
        ]);
        for (const key of ["x", "y", "w", "h"])
          expect(
            Math.abs(
              Math.trunc(actual[i].bounds[key] * 36000) - expected.bounds[key],
            ),
            `${row.name} ${i} ${key}`,
          ).toBeLessThanOrEqual(1);
      }
      expect([serializeXml(document), serializeXml(data)]).toEqual(before);
    });
  it.each(["tx", "composite", "leaf rule"])(
    "keeps unsupported descendant execution explicit: %s",
    (kind) => {
      const row = { ...dimensions.cases[0] };
      row.body =
        kind === "leaf rule"
          ? row.body.replace(
              '<dgm:alg type="sp"/>',
              '<dgm:alg type="sp"/><dgm:ruleLst><dgm:rule type="w" val="1"/></dgm:ruleLst>',
            )
          : row.body.replace(
              '<dgm:alg type="sp"/>',
              `<dgm:alg type="${kind}"/>`,
            );
      const { root } = create(row);
      expect(() =>
        reflowDiagramLayout(root, dimensions.available, {
          textFits: () => true,
        }),
      ).toThrow("unsupported diagram container adjustment rules");
    },
  );
  it("leaves inactive spacer rules to the same signed fallback as an unruled row", () => {
    const row = dimensions.cases.find(
      (r) => r.name === "signed spacer increase",
    );
    const fit = (rules) => {
      const { root } = create({ ...row, rules });
      const result = reflowDiagramLayout(root, dimensions.available, {
        textFits: () => true,
      });
      return [root, ...root.children].map((node) => result.bounds.get(node));
    };
    expect(fit(row.rules)).toEqual(fit(""));
  });
});

describe("DiagramML linear geometry search boundaries", () => {
  const plan = (current = 70, limit = 10, overrides = {}) => ({
    current,
    limit,
    mode: "value",
    hasCrossPropertyDependents: false,
    rule: { target: { type: "w" }, factor: NaN },
    ...overrides,
  });
  it("selects distinct searches from the effective direct dependency", () => {
    const fit = (p) => fitDiagramLinearGeometryRule(p, "w", (v) => v <= 30);
    expect(fit(plan()).value).toBeGreaterThan(29.9);
    const negative = plan(-70, -10, {
      rule: { target: { type: "userA" }, factor: NaN },
    });
    expect(
      fitDiagramLinearGeometryRule(negative, "w", (v) => -v <= 30),
    ).toEqual({ value: -28.75, fits: true });
    expect(
      fitDiagramLinearGeometryRule(
        { ...negative, limit: -100 },
        "w",
        () => false,
      ),
    ).toEqual({ value: -70, fits: false });
    expect(fit(plan(70, 10, { hasCrossPropertyDependents: true })).value).toBe(
      28.75,
    );
    expect(fit(plan(70, 10, { mode: "maximum" })).value).toBe(10);
    expect(
      fit(
        plan(70, 0, {
          mode: "factor",
          rule: { target: { type: "w" }, factor: 0 },
        }),
      ).value,
    ).toBeGreaterThan(29.9);
  });
  it("keeps main-axis height content-driven and uses the general cross-axis path", () => {
    const p = plan(70, 10, { rule: { target: { type: "h" }, factor: NaN } });
    expect(fitDiagramLinearGeometryRule(p, "h", (v) => v <= 30)).toEqual({
      value: 70,
      fits: false,
    });
    expect(fitDiagramLinearGeometryRule(p, "w", (v) => v <= 30)).toEqual({
      value: 28.75,
      fits: true,
    });
    expect(
      fitDiagramLinearGeometryRule(
        { ...p, hasCrossPropertyDependents: true },
        "h",
        (v) => v <= 30,
      ),
    ).toEqual({ value: 28.75, fits: true });
  });
  it("retains current fits and exhausted endpoints for later ordered rules", () => {
    expect(
      fitDiagramLinearGeometryRule(
        plan(70, 10, { mode: "maximum" }),
        "w",
        () => true,
      ),
    ).toEqual({ value: 70, fits: true });
    expect(
      fitDiagramLinearGeometryRule(plan(70, 40), "w", (v) => v <= 30),
    ).toEqual({ value: 40, fits: false });
    expect(
      fitDiagramLinearGeometryRule(plan(70, Infinity), "w", () => false),
    ).toEqual({ value: 70, fits: false });
  });
  it.each([
    2 ** -100,
    0.5 - Number.EPSILON,
    0.5,
    0.5 + Number.EPSILON,
    2 ** 100,
  ])(
    "retains significant precision across interval scales: %s",
    (threshold) => {
      let probes = 0;
      const current = Math.max(1, threshold * 4);
      const result = fitDiagramLinearGeometryRule(
        plan(current, 0),
        "w",
        (v) => {
          ++probes;
          return v <= threshold;
        },
      );
      expect(result.fits).toBe(true);
      expect(result.value).toBeLessThanOrEqual(threshold);
      expect(result.value).toBeGreaterThan(threshold * (1 - 1 / 512));
      expect(probes).toBeLessThan(120);
    },
  );
  it("stops at finite machine precision, including zero and opposite-signed extremes", () => {
    const next = 1 + Number.EPSILON;
    expect(
      fitDiagramLinearGeometryRule(plan(next, 1), "w", (v) => v === 1),
    ).toEqual({ value: 1, fits: true });
    expect(
      fitDiagramLinearGeometryRule(plan(1, 0), "w", (v) => v === 0),
    ).toEqual({ value: 0, fits: true });
    const extreme = fitDiagramLinearGeometryRule(
      plan(1e308, -1e308),
      "w",
      (v) => v <= 0,
    );
    expect(extreme.fits).toBe(true);
    expect(Number.isFinite(extreme.value)).toBe(true);
    expect(extreme.value).toBeLessThanOrEqual(0);
  });
  it("rejects invalid intervals and bounds constraint work through reflow", () => {
    for (const p of [plan(NaN), plan(Infinity), plan(1, NaN)])
      expect(() => fitDiagramLinearGeometryRule(p, "w", () => false)).toThrow(
        "invalid diagram rule fit interval",
      );
    expect(() =>
      fitDiagramLinearGeometryRule(plan(1, -Infinity), "w", () => false),
    ).toThrow("unbounded diagram rule fit interval");
    const { root } = create(dimensions.cases[0]);
    expect(() =>
      reflowDiagramLayout(root, dimensions.available, {
        textFits: () => true,
        maxOperations: 20,
      }),
    ).toThrow("diagram reflow operation budget exceeded");
  });
});
