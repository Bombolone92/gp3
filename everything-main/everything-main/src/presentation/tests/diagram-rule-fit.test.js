import { describe, expect, it } from "vitest";
import native from "./data/diagram-general-rule-fit-native.json";
import { sample } from "./diagram-layout-fixture.js";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { evaluateDiagramInitialConstraints as evaluate } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import { fitDiagramGeneralRule } from "../lib/pptx/src/internal/diagram/rule-fit.ts";
import {
  arrangeDiagramChildren,
  readDiagramArrangement,
} from "../lib/pptx/src/internal/diagram/arrange.ts";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
const plan = (current, limit, mode = "value", factor = NaN) => ({
  current,
  limit,
  mode,
  rule: { factor },
});

describe("DiagramML general-variable rule fitting", () => {
  it.each(native.cases)(
    "computes native geometry from rule limits: $name",
    (row) => {
      const data = sample(),
        document = parseXml(
          `<dgm:layoutNode xmlns:dgm="${NS.diagram}" name="root"><dgm:alg type="${row.algorithm}"><dgm:param type="horzAlign" val="none"/><dgm:param type="vertAlign" val="none"/>${row.params}</dgm:alg><dgm:constrLst>${row.constraints}</dgm:constrLst><dgm:ruleLst>${row.rules}</dgm:ruleLst>${row.body}</dgm:layoutNode>`,
        );
      const before = [serializeXml(document), serializeXml(data.document)],
        root = expandDiagramLayout(document.root, data.tree),
        available = row.available ?? native.available,
        initial = evaluate(root, available),
        rule = initial.get(root).rules[0],
        p = initial.get(root).rulePlan(rule),
        arrangement = readDiagramArrangement(root.algorithm),
        main = arrangement.direction === "fromL" ? "w" : "h",
        cross = main === "w" ? "h" : "w";
      const evaluateTrial = (value) =>
        evaluate(root, available, {
          changes: [{ owner: root, property: rule.target, value }],
        });
      let probes = 0;
      const fit = fitDiagramGeneralRule(p, "decrease", (value) => {
        ++probes;
        const state = evaluateTrial(value);
        return (
          root.children.reduce(
            (sum, node) => sum + state.get(node).size[main],
            0,
          ) <= available[main] &&
          Math.max(
            ...root.children.map((node) => state.get(node).size[cross]),
          ) <= available[cross]
        );
      });
      expect(probes).toBeLessThanOrEqual(7);
      const state = evaluateTrial(fit.value),
        rects = arrangeDiagramChildren(
          available,
          root.children.map((node) => ({
            x: 0,
            y: 0,
            ...state.get(node).size,
          })),
          arrangement,
        );
      const actual = rects
        .map((bounds, i) => ({
          name: root.children[i].name,
          context: root.children[i].context.point.id,
          bounds,
        }))
        .filter((s) => s.bounds.w !== 0 || s.bounds.h !== 0);
      expect(actual).toHaveLength(row.expected.length);
      for (const [i, expected] of row.expected.entries()) {
        expect([actual[i].name, actual[i].context]).toEqual([
          expected.name,
          expected.context,
        ]);
        for (const type of ["x", "y", "w", "h"])
          expect(
            Math.abs(
              Math.trunc(actual[i].bounds[type] * 36000) -
                expected.bounds[type],
            ),
          ).toBeLessThanOrEqual(1);
      }
      expect([serializeXml(document), serializeXml(data.document)]).toEqual(
        before,
      );
      expect(initial.get(root).rulePlan(rule)).toEqual(p);
    },
  );
  it("returns immediately when the current value fits, including an unbounded rule", () => {
    const calls = [];
    expect(
      fitDiagramGeneralRule(plan(7, Infinity), "increase", (v) => {
        calls.push(v);
        return true;
      }),
    ).toEqual({ value: 7, fits: true });
    expect(calls).toEqual([7]);
  });
  it("searches in either direction and retains the nearest feasible trial", () => {
    expect(
      fitDiagramGeneralRule(plan(10, 90), "increase", (v) => v >= 31),
    ).toEqual({ value: 32.5, fits: true });
    expect(
      fitDiagramGeneralRule(plan(90, 10), "decrease", (v) => v <= 31),
    ).toEqual({ value: 30, fits: true });
  });
  it("retains an exhausted limit for the next rule instead of calling it a success", () => {
    expect(
      fitDiagramGeneralRule(plan(80, 40), "decrease", (v) => v <= 30),
    ).toEqual({ value: 40, fits: false });
    expect(
      fitDiagramGeneralRule(plan(10, 25), "increase", (v) => v >= 30),
    ).toEqual({ value: 25, fits: false });
  });
  it("tests factor activity before multiplication and includes the exact boundary", () => {
    for (const factor of [0, 5e-10, -5e-10])
      expect(
        fitDiagramGeneralRule(
          plan(70, factor * 1e6, "factor", factor),
          "decrease",
          (v) => v <= 1,
        ),
      ).toEqual({ value: 70, fits: false });
    for (const factor of [1e-9, -1e-9])
      expect(
        fitDiagramGeneralRule(
          plan(70, factor * 1e6, "factor", factor),
          "decrease",
          (v) => v <= 1,
        ),
      ).toEqual({ value: factor * 1e6, fits: true });
  });
  it("does not move in a forbidden direction and does not grow a maximum rule", () => {
    for (const [p, d] of [
      [plan(10, 20), "decrease"],
      [plan(20, 10), "increase"],
      [plan(10, 20, "maximum"), "increase"],
      [plan(20, 10, "maximum"), "increase"],
    ]) {
      const calls = [];
      expect(
        fitDiagramGeneralRule(p, d, (v) => {
          calls.push(v);
          return false;
        }),
      ).toEqual({ value: p.current, fits: false });
      expect(calls).toEqual([p.current]);
    }
  });
  it("supports signed intervals and stops when no representable midpoint remains", () => {
    expect(
      fitDiagramGeneralRule(plan(-10, 10), "increase", (v) => v >= 1),
    ).toEqual({ value: 1.25, fits: true });
    const calls = [];
    expect(
      fitDiagramGeneralRule(plan(1, 1 + Number.EPSILON), "increase", (v) => {
        calls.push(v);
        return v > 1;
      }),
    ).toEqual({ value: 1 + Number.EPSILON, fits: true });
    expect(calls).toHaveLength(2);
    expect(
      fitDiagramGeneralRule(plan(-1e308, 1e308), "increase", (v) => v >= 0),
    ).toEqual({ value: 0, fits: true });
  });
  it("requires finite trial endpoints when adjustment is necessary", () => {
    for (const current of [NaN, Infinity, -Infinity])
      expect(() =>
        fitDiagramGeneralRule(plan(current, 10), "decrease", () => false),
      ).toThrow("invalid diagram rule fit interval");
    expect(() =>
      fitDiagramGeneralRule(plan(1, NaN), "increase", () => false),
    ).toThrow("invalid diagram rule fit interval");
    expect(() =>
      fitDiagramGeneralRule(plan(1, Infinity), "increase", () => false),
    ).toThrow("unbounded diagram rule fit interval");
  });
  it("propagates feasibility errors without hiding a failed layout evaluation", () => {
    expect(() =>
      fitDiagramGeneralRule(plan(10, 1), "decrease", () => {
        throw Error("layout failed");
      }),
    ).toThrow("layout failed");
  });
});
