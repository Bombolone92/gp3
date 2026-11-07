import { describe, expect, it } from "vitest";
import native from "./data/diagram-font-search-native.json";
import { sample } from "./diagram-layout-fixture.js";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { evaluateDiagramInitialConstraints as evaluate } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import { fitDiagramTextFontRule as fit } from "../lib/pptx/src/internal/diagram/rule-fit.ts";
import { arrangeDiagramChildren } from "../lib/pptx/src/internal/diagram/arrange.ts";
import { layoutCore } from "../lib/pptx-preview/src/text-layout.ts";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";

const measure = (text, spec) => {
  const result = native.measurements[JSON.stringify([text, spec])];
  if (!result)
    throw new Error(`Unrecorded measurement: ${text} ${JSON.stringify(spec)}`);
  return result;
};
const plan = (current, limit, mode = "value", factor = NaN) => ({
  current,
  limit,
  mode,
  rule: { factor },
});

describe("DiagramML whole-point font fitting", () => {
  it.each(native.cases)("fits independently measured text: $name", (row) => {
    const document = parseXml(
      `<d:layoutNode xmlns:d="${NS.diagram}" name="root"><d:alg type="lin"/><d:layoutNode name="text"><d:alg type="tx"/>${row.constraints}${row.rules}</d:layoutNode></d:layoutNode>`,
    );
    const root = expandDiagramLayout(document.root, sample().tree),
      text = root.children[0];
    const available = { w: 400, h: 200 },
      initial = evaluate(root, available, { quantizeFonts: true }).get(text);
    const original = serializeXml(document),
      rulePlan = initial.rulePlan(initial.rules[0]);
    // Quantization retains authored rule bases while producing the whole-point
    // current constraint required by the font search.
    const current = initial.values.get("primFontSz");
    const trial = (value) =>
      evaluate(root, available, {
        changes: [
          {
            owner: text,
            property: {
              type: "primFontSz",
              selector: { relationship: "self", name: "", pointType: "all" },
            },
            value,
          },
        ],
      }).get(text);
    const textFits = (value) => {
      const state = trial(value),
        displayed = Math.max(1, value),
        sizePx = (displayed * 96) / 72;
      const template = native.base.paragraphs[0],
        piece = native.base.paragraphs[0].pieces[0];
      const run = (word) => ({
        ...piece,
        text: word,
        isBreak: false,
        sizePx,
        kerning: displayed < 12 ? "none" : "normal",
      });
      const paragraph = (pieces) => ({
        ...template,
        pieces,
        fallbackSizePx: sizePx,
        lineSpacing: {
          kind: "pct",
          value: row.style === "single100" ? 1 : 0.9,
        },
        spcAftPct: ["default", "noEnd"].includes(row.style) ? 0.35 : 0,
      });
      const paragraphs =
        row.content === "paragraph"
          ? row.words.map((word) => paragraph([run(word)]))
          : [
              paragraph(
                row.words.flatMap((word, i) =>
                  i ? [{ ...run(""), isBreak: true }, run(word)] : [run(word)],
                ),
              ),
            ];
      const input = {
        ...native.base,
        paragraphs,
        boxWpx:
          (state.size.w * 96) / 25.4 -
          ((state.values.get("lMarg") + state.values.get("rMarg")) * 96) / 72,
        boxHpx:
          (state.size.h * 96) / 25.4 -
          ((state.values.get("tMarg") + state.values.get("bMarg")) * 96) / 72,
      };
      const measured = layoutCore(input, measure);
      return (
        measured.requiredH <= input.boxHpx &&
        measured.unbreakableOverflowW === 0
      );
    };
    const result = rulePlan
      ? fit({ ...rulePlan, current }, textFits)
      : { value: current, fits: false };
    expect(Math.max(1, result.value)).toBe(row.expected.font);
    const state = trial(result.value);
    for (const side of ["l", "r", "t", "b"])
      expect(Math.round(state.values.get(`${side}Marg`) * 12700)).toBe(
        row.expected.insets[side],
      );
    // No-reference factor controls deliberately have no writable rule plan.
    // They verify inactivity, without inventing an authored reference base.
    if (rulePlan) {
      const [bounds] = arrangeDiagramChildren(
        available,
        [{ x: 0, y: 0, ...state.size }],
        {
          type: "lin",
          direction: "fromL",
          horizontal: "none",
          vertical: "none",
        },
        { childrenFit: result.fits },
      );
      expect(
        Math.abs(Math.trunc(bounds.w * 36000) - row.expected.width),
      ).toBeLessThanOrEqual(1);
    } else expect(Number.isFinite(initial.rules[0].factor)).toBe(true);
    expect(serializeXml(document)).toBe(original);
    expect(initial.rulePlan(initial.rules[0])).toEqual(rulePlan);
  });

  it("does not stop at a coarse continuous approximation", () => {
    const probes = [];
    expect(
      fit(plan(201, 5), (v) => {
        probes.push(v);
        return v <= 10.75;
      }),
    ).toEqual({ value: 10, fits: true });
    expect(probes.every(Number.isInteger)).toBe(true);
    expect(probes.length).toBeLessThanOrEqual(10);
    expect(new Set(probes).size).toBe(probes.length);
  });
  it("preserves failed zero constraints separately from displayed font minimums", () => {
    expect(fit(plan(3, 0.1), () => false)).toEqual({ value: 0, fits: false });
    expect(fit(plan(0, 0.5), () => false)).toEqual({ value: 0, fits: false });
    expect(fit(plan(0, 0), () => true)).toEqual({ value: 0, fits: true });
  });
  it("retains an already feasible current value and never grows", () => {
    expect(fit(plan(18, 5), () => true)).toEqual({ value: 18, fits: true });
    const calls = [];
    expect(
      fit(plan(5, 20), (v) => {
        calls.push(v);
        return false;
      }),
    ).toEqual({ value: 5, fits: false });
    expect(calls).toEqual([5]);
  });
  it("bounds work for enormous valid intervals", () => {
    let probes = 0;
    expect(
      fit(plan(Number.MAX_SAFE_INTEGER, 0), (v) => {
        ++probes;
        return v <= 1000000000000;
      }),
    ).toEqual({ value: 1000000000000, fits: true });
    expect(probes).toBeLessThanOrEqual(55);
  });
  it.each([
    plan(NaN, 5),
    plan(Infinity, 5),
    plan(-1, 0),
    plan(18.5, 5),
    plan(18, NaN),
    plan(18, Infinity),
    plan(18, -Infinity),
    plan(18, -0.1),
    plan(Number.MAX_SAFE_INTEGER + 1, 5),
  ])("rejects unsupported numeric intervals without probing: %j", (p) => {
    let probes = 0;
    expect(() =>
      fit(p, () => {
        ++probes;
        return true;
      }),
    ).toThrow("invalid diagram font fit interval");
    expect(probes).toBe(0);
  });
});
