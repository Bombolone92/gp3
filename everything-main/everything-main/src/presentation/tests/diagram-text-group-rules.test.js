import { describe, expect, it } from "vitest";
import native from "./data/diagram-text-group-rules-native.json";
import {
  parseXml,
  serializeFragment,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { evaluateDiagramInitialConstraints as evaluate } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import { fitDiagramTextGroupRules } from "../lib/pptx/src/internal/diagram/text-group-rules.ts";
import { reflowDiagramLayout } from "../lib/pptx/src/internal/diagram/reflow.ts";
const self = (type) => ({
  type,
  selector: { relationship: "self", name: "", pointType: "all" },
});
describe("shared ordered SmartArt text rules", () => {
  it.each([false, true])(
    "does not mistake shared line-height fit for complete text fit (later font rule %s)",
    (laterFontRule) => {
      const row = native.cases.find(
        (r) => r.name === "shared-height height-font reversefalse limit30",
      );
      let layout = row.layout.replace(
        'type="primFontSz" for="ch" forName="text" val="30" op="equ"',
        'type="primFontSz" for="ch" forName="text" val="30"',
      );
      if (!laterFontRule)
        layout = layout.replace('<dgm:rule type="primFontSz" val="5"/>', "");
      const root = expandDiagramLayout(
        parseXml(layout).root,
        readDiagramHierarchy(readDiagramDataModel(parseXml(row.data).root)),
      );
      const run = () =>
        reflowDiagramLayout(root, row.available, {
          textFits: () => ({ heightFits: true, fits: false }),
        });
      // Shared height with independent fonts requires a separate ordered replay.
      // Height success must not bypass that explicit unsupported path.
      if (laterFontRule)
        expect(run).toThrow("unsupported shared ordered diagram text rules");
      else expect(run().fits).toBe(false);
    },
  );

  it.each([false, true])(
    "separates line height from word fit in an equal-font domain (shared height %s)",
    (sharedHeight) => {
      const rules = [
        { target: self("h"), value: Infinity },
        { target: self("primFontSz"), value: 5 },
      ];
      const probes = [];
      const result = fitDiagramTextGroupRules(
        rules,
        [17, 23].map((maxFont) => (values) => {
          const state = { h: 1, primFontSz: 32, ...values };
          probes.push(state);
          return {
            heightFits: state.h >= state.primFontSz,
            fits: state.h >= state.primFontSz && state.primFontSz <= maxFont,
            rulePlan: (rule) => ({
              rule,
              current: state[rule.target.type],
              limit: rule.value,
              mode: "value",
            }),
          };
        }),
        { sharedHeight },
      );
      expect(result.fits).toBe(true);
      expect(result.values).toEqual([
        { h: 17, primFontSz: 17 },
        { h: 17, primFontSz: 17 },
      ]);
      expect(Math.max(...probes.map((p) => p.h))).toBe(32);
    },
  );

  it("retains allocation when a font reduction fits at the initial height", () => {
    const rules = [
      { target: self("h"), value: 15 },
      { target: self("primFontSz"), value: 5 },
    ];
    const evaluate = (values) => {
      const state = { h: 4, primFontSz: 20, ...values };
      return {
        fits: state.primFontSz <= 10,
        rulePlan: (rule) => ({
          rule,
          current: state[rule.target.type],
          limit: rule.value,
          mode: "value",
        }),
      };
    };
    const result = fitDiagramTextGroupRules(rules, [evaluate, evaluate], {
      sharedHeight: true,
    });
    expect(result.fits).toBe(true);
    expect(result.allocationHeight).toBe(15);
    expect(result.values).toEqual([
      { primFontSz: 10, h: 4 },
      { primFontSz: 10, h: 4 },
    ]);
  });
  it.each([undefined, 12])(
    "reserves a fitting shared height prefix across parent reflow (%s retained)",
    (retainedHeight) => {
      const rules = [
        { target: self("h"), value: 30 },
        { target: self("primFontSz"), value: 5 },
      ];
      const evaluate = (values) => ({
        fits: true,
        rulePlan: (rule) => ({
          rule,
          current:
            values[rule.target.type] ?? (rule.target.type === "h" ? 8 : 20),
          limit: rule.value,
          mode: "value",
        }),
      });
      const result = fitDiagramTextGroupRules(rules, [evaluate, evaluate], {
        sharedHeight: true,
        retainedHeight,
      });
      expect(result.allocationHeight).toBe(retainedHeight ?? 8);
      expect(result.values).toEqual([{ h: 8 }, { h: 8 }]);
      expect(result.fits).toBe(true);
    },
  );
  it.each(
    native.cases.flatMap((row) =>
      [false, true].map((reflow) => ({ ...row, reflow })),
    ),
  )(
    "matches native shared font/height passes ($reflow reflow): $name",
    (row) => {
      const root = expandDiagramLayout(
          parseXml(row.layout).root,
          readDiagramHierarchy(readDiagramDataModel(parseXml(row.data).root)),
        ),
        nodes = root.children,
        before = serializeFragment(root.definition),
        initial = evaluate(root, row.available, { quantizeFonts: true });
      const fits = (node, state) => {
        const i = nodes.indexOf(node),
          font = state.values.get("primFontSz"),
          m = native.measurements[state.size.w]?.[row.texts[i]]?.[font];
        if (!m)
          throw Error(
            `Missing measurement ${state.size.w}/${row.texts[i]}/${font}`,
          );
        return m.wordFits && state.size.h >= m.requiredHeight;
      };
      const result = row.reflow
        ? reflowDiagramLayout(root, row.available, { textFits: fits })
        : fitDiagramTextGroupRules(
            initial.get(nodes[0]).rules,
            nodes.map((node) => (values) => {
              const state = initial
                .get(node)
                .evaluateScope({
                  adjustments: Object.entries(values).map(([type, value]) => ({
                    owner: node,
                    property: self(type),
                    value,
                  })),
                })
                .get(node);
              return {
                state,
                fits: fits(node, state),
                rulePlan: (rule) => state.rulePlan(rule),
              };
            }),
            { sharedHeight: row.sharedHeight },
          );
      for (const [i, node] of nodes.entries()) {
        const state = row.reflow
          ? result.drawing.get(node)
          : result.evaluations[i].state;
        expect(state.values.get("primFontSz")).toBe(row.expected[i].font);
        expect(
          Math.abs(Math.trunc(state.size.h * 36000) - row.expected[i].bounds.h),
        ).toBeLessThanOrEqual(1);
        if (row.reflow)
          for (const key of ["x", "y", "w", "h"])
            expect(
              Math.abs(
                Math.trunc(result.bounds.get(node)[key] * 36000) -
                  row.expected[i].bounds[key],
              ),
              `${node.name}.${key}`,
            ).toBeLessThanOrEqual(1);
      }
      expect(result.fits).toBe(row.expectedFit);
      expect(serializeFragment(root.definition)).toBe(before);
    },
  );
});
