import { describe, expect, it } from "vitest";
import native from "./data/diagram-text-rules-native.json";
import { sample } from "./diagram-layout-fixture.js";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { evaluateDiagramInitialConstraints as evaluate } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import { fitDiagramTextRules } from "../lib/pptx/src/internal/diagram/text-rules.ts";
import { reflowDiagramLayout } from "../lib/pptx/src/internal/diagram/reflow.ts";
import { layoutCore } from "../lib/pptx-preview/src/text-layout.ts";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";

const self = (type) => ({
  type,
  selector: { relationship: "self", name: "", pointType: "all" },
});
const rule = (type, limit, mode = "value") => ({
  target: self(type),
  [mode]: limit,
});
const synthetic =
  (initial, fits, probes = []) =>
  (values) => {
    const state = { ...initial, ...values };
    probes.push(state);
    return {
      state,
      fits: fits(state),
      rulePlan: (r) => ({
        rule: r,
        current: state[r.target.type],
        limit: r.value ?? r.factor ?? r.maximum,
        mode:
          r.factor === undefined
            ? r.maximum === undefined
              ? "value"
              : "maximum"
            : "factor",
      }),
    };
  };
const measure = (text, spec) => {
  const result = native.measurements[JSON.stringify([text, spec])];
  if (!result)
    throw new Error(`Unrecorded measurement: ${text} ${JSON.stringify(spec)}`);
  return result;
};

describe("ordered local DiagramML text rules", () => {
  it("projects an exhausted finite endpoint instead of the last failed doubling", () => {
    const result = fitDiagramTextRules(
      [rule("h", 25.599999)],
      synthetic({ h: 0.1 }, ({ h }) => h >= 26),
    );
    expect(result.values.h).toBe(25.599999);
    expect(result.evaluation.state.h).toBe(25.599999);
    expect(result.evaluation.fits).toBe(false);
  });

  it("fits line height before lowering the font for an overflowing word", () => {
    const probes = [];
    const result = fitDiagramTextRules(
      [rule("h", Infinity), rule("primFontSz", 5)],
      (values) => {
        const state = { h: 1, primFontSz: 32, ...values };
        probes.push(state);
        return {
          heightFits: state.h >= state.primFontSz,
          fits: state.h >= state.primFontSz && state.primFontSz <= 17,
          rulePlan: (r) => ({
            rule: r,
            current: state[r.target.type],
            limit: r.value,
            mode: "value",
          }),
        };
      },
    );
    expect(result.values).toEqual({ h: 17, primFontSz: 17 });
    expect(result.evaluation.fits).toBe(true);
    expect(Math.max(...probes.map((p) => p.h))).toBe(32);
  });

  it.each(
    native.cases.flatMap((row) =>
      [false, true, "reflow"].map((scoped) => ({ ...row, scoped })),
    ),
  )("matches native ordered rules ($scoped scoped): $name", (row) => {
    const document = parseXml(
      `<d:layoutNode xmlns:d="${NS.diagram}" name="root"><d:alg type="lin"/><d:layoutNode name="text"><d:alg type="tx"/>${row.constraints}${row.rules}</d:layoutNode></d:layoutNode>`,
    );
    const root = expandDiagramLayout(document.root, sample().tree),
      text = root.children[0],
      available = { w: 400, h: 200 };
    const original = serializeXml(document),
      initial = evaluate(root, available, { quantizeFonts: true }).get(text);
    const inspect = (values) => {
      const options = {
        quantizeFonts: true,
        adjustments: Object.entries(values).map(([type, value]) => ({
          owner: text,
          property: self(type),
          value,
        })),
      };
      const state = (
        row.scoped
          ? initial.evaluateScope(options)
          : evaluate(root, available, options)
      ).get(text);
      return measureState(state);
    };
    const measureState = (state) => {
      const font = Math.max(1, state.values.get("primFontSz")),
        sizePx = (font * 96) / 72,
        paragraph = native.base.paragraphs[0];
      const input = {
        ...native.base,
        boxWpx:
          (state.size.w * 96) / 25.4 -
          ((state.values.get("lMarg") + state.values.get("rMarg")) * 96) / 72,
        boxHpx:
          (state.size.h * 96) / 25.4 -
          ((state.values.get("tMarg") + state.values.get("bMarg")) * 96) / 72,
        paragraphs: [
          {
            ...paragraph,
            lineSpacing: { kind: "pct", value: 0.9 },
            spcAftPct: 0.35,
            fallbackSizePx: sizePx,
            pieces: [
              {
                ...paragraph.pieces[0],
                text: row.content,
                sizePx,
                kerning: font < 12 ? "none" : "normal",
                isBreak: false,
              },
            ],
          },
        ],
      };
      const measured = layoutCore(input, measure);
      return {
        ...state,
        fits:
          measured.requiredH <= input.boxHpx &&
          measured.unbreakableOverflowW === 0,
      };
    };
    const coordinated =
      row.scoped === "reflow"
        ? reflowDiagramLayout(root, available, {
            textFits: (_node, state) => measureState(state).fits,
          })
        : null;
    const result = coordinated
        ? {
            evaluation: {
              ...coordinated.drawing.get(text),
              fits: coordinated.fits,
            },
            values: Object.fromEntries(
              ["h", "primFontSz", "secFontSz"].map((type) => [
                type,
                coordinated.drawing.get(text).values.get(type),
              ]),
            ),
          }
        : fitDiagramTextRules(initial.rules, inspect),
      state = result.evaluation;
    expect(state.fits).toBe(true);
    expect(state.values.get("primFontSz")).toBe(row.expected.font);
    for (const side of ["l", "r", "t", "b"])
      expect(Math.round(state.values.get(`${side}Marg`) * 12700)).toBe(
        row.expected.insets[side],
      );
    expect(
      Math.abs(state.size.w * 36000 - row.expected.width),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(state.size.h * 36000 - row.expected.height),
    ).toBeLessThanOrEqual(1);
    expect(inspect(result.values).size).toEqual(state.size);
    expect(serializeXml(document)).toBe(original);
  });

  it("returns the initial state without evaluating unused rule plans", () => {
    let calls = 0;
    const evaluation = {
      fits: true,
      rulePlan: () => {
        throw new Error("unused plan");
      },
    };
    const result = fitDiagramTextRules(
      [rule("h", Infinity), rule("primFontSz", 5)],
      () => {
        calls++;
        return evaluation;
      },
    );
    expect(result).toEqual({ values: {}, evaluation });
    expect(calls).toBe(1);
  });

  it("retains failed fonts while resetting height preferences during later font trials", () => {
    const result = fitDiagramTextRules(
      [rule("primFontSz", 20), rule("h", 10), rule("primFontSz", 5)],
      synthetic({ h: 2, primFontSz: 40 }, (s) => s.h >= s.primFontSz),
    );
    expect(result.values).toEqual({ primFontSz: 10, h: 10 });
    expect(result.evaluation.fits).toBe(true);
  });

  it("preserves both font variables across height replay", () => {
    const result = fitDiagramTextRules(
      [rule("primFontSz", 20), rule("h", 12), rule("secFontSz", 5)],
      synthetic(
        { h: 2, primFontSz: 40, secFontSz: 30 },
        (s) => s.h >= s.primFontSz / 4 + s.secFontSz,
      ),
    );
    expect(result.values).toEqual({ primFontSz: 20, secFontSz: 7, h: 12 });
    expect(result.evaluation.fits).toBe(true);
  });

  it("retains exhausted values and does not leak a rejected probe into the result", () => {
    const result = fitDiagramTextRules(
      [rule("h", 12), rule("primFontSz", 20)],
      synthetic({ h: 2, primFontSz: 40 }, () => false),
    );
    expect(result.values).toEqual({ primFontSz: 20, h: 12 });
    expect(result.evaluation.fits).toBe(false);
  });

  it("does not create numeric replacements for inactive or unmatched rules", () => {
    const inspect = synthetic({ h: 2, primFontSz: 40 }, () => false);
    const result = fitDiagramTextRules(
      [
        rule("h", 12, "maximum"),
        rule("primFontSz", 0, "factor"),
        rule("secFontSz", 3),
      ],
      (values) => {
        const state = inspect(values),
          plan = state.rulePlan;
        return {
          ...state,
          rulePlan: (r) => (r.target.type === "secFontSz" ? null : plan(r)),
        };
      },
    );
    expect(result.values).toEqual({});
  });

  it("resolves height limits again after dependent fonts change", () => {
    const inspect = synthetic(
      { h: 1, primFontSz: 40 },
      (s) => s.h >= 6 && s.primFontSz <= 10,
    );
    const result = fitDiagramTextRules(
      [rule("h", 20), rule("primFontSz", 5)],
      (values) => {
        const state = inspect(values),
          plan = state.rulePlan;
        return {
          ...state,
          rulePlan: (r) => ({
            ...plan(r),
            ...(r.target.type === "h"
              ? { limit: 2 * state.state.primFontSz }
              : {}),
          }),
        };
      },
    );
    expect(result.values.primFontSz).toBe(10);
    expect(result.values.h).toBe(6.34375);
  });

  it("retains a zero font adjustment when initial height becomes sufficient", () => {
    const result = fitDiagramTextRules(
      [rule("h", 12), rule("primFontSz", 0)],
      synthetic({ h: 2, primFontSz: 40 }, (s) => s.primFontSz === 0),
    );
    expect(result.values).toEqual({ primFontSz: 0 });
    expect(result.evaluation.state.h).toBe(2);
    expect(result.evaluation.fits).toBe(true);
  });

  it("uses bounded whole-point probing and preserves the selected evaluation", () => {
    const probes = [],
      result = fitDiagramTextRules(
        [rule("primFontSz", 1)],
        synthetic(
          { h: 10, primFontSz: Number.MAX_SAFE_INTEGER },
          (s) => s.primFontSz <= s.h,
          probes,
        ),
      );
    expect(result.values).toEqual({ primFontSz: 10 });
    expect(result.evaluation.state).toEqual({ h: 10, primFontSz: 10 });
    expect(probes.length).toBeLessThan(60);
    expect(new Set(probes.map((p) => p.primFontSz)).size).toBe(probes.length);
  });

  it.each(["w", "userA", "t"])(
    "rejects unsupported %s instead of running the wrong search",
    (type) => {
      expect(() =>
        fitDiagramTextRules([rule(type, 2)], () => ({ fits: true })),
      ).toThrow("unsupported local diagram text rule");
    },
  );
  it("rejects selectors that require domain-level fitting and propagates evaluation errors", () => {
    const r = rule("h", 10);
    r.target.selector.relationship = "ch";
    expect(() => fitDiagramTextRules([r], () => ({ fits: true }))).toThrow(
      "unsupported local diagram text rule",
    );
    expect(() =>
      fitDiagramTextRules([], () => {
        throw Error("measurement failed");
      }),
    ).toThrow("measurement failed");
  });
});
