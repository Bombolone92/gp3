import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { P, createDeck } from "../src/model.js";
import { semanticTextGroupDeck } from "./diagram-text-group-fixture.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { isDiagramShape } from "../lib/pptx/src/api/fn/diagram-read.ts";
import native from "./data/diagram-height-binding-native.json";
import {
  parseXml,
  childElements,
  serializeFragment,
  textContent,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { evaluateDiagramInitialConstraints as evaluate } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import { reflowDiagramLayout } from "../lib/pptx/src/internal/diagram/reflow.ts";
const layout = (row) =>
  expandDiagramLayout(
    parseXml(row.layout).root,
    readDiagramHierarchy(readDiagramDataModel(parseXml(row.data).root)),
  );
const type = (node) =>
  node.shape && getAttrValue(node.shape, qname("", "type", ""));
const measure = (row) => (node, state) => {
  const key = JSON.stringify([
    node.name,
    node.contributors.map((c) => textContent(c.point.text)).join("\n"),
    state.size.w,
    state.size.h,
    ...["primFontSz", "secFontSz", "lMarg", "rMarg", "tMarg", "bMarg"].map(
      (k) => state.values.get(k),
    ),
  ]);
  const m = row.measurements[key];
  if (!m) throw Error(`Unrecorded glyph measurement ${key}`);
  return !m.collapsed && m.wordFits && state.size.h >= m.requiredHeight;
};
describe("composite child dimension equality bindings", () => {
  it.each(native.cases)(
    "matches complete native fitting and geometry: $name",
    (row) => {
      const root = layout(row),
        before = serializeFragment(root.definition),
        run = () =>
          reflowDiagramLayout(root, row.available, { textFits: measure(row) }),
        result = run();
      const drawn = [...result.bounds.keys()].filter(
        (n) => type(n) && type(n) !== "none",
      );
      expect(drawn).toHaveLength(row.expected.length);
      expect(result.fits).toBe(row.fits);
      for (const [i, n] of drawn.entries()) {
        expect(n.name).toBe(row.expected[i].name);
        for (const k of ["x", "y", "w", "h"])
          expect(
            Math.abs(
              Math.trunc(result.bounds.get(n)[k] * 36000) -
                row.expected[i].bounds[k],
            ),
            `${n.name}.${k}`,
          ).toBeLessThanOrEqual(1);
        if (row.expected[i].font.length)
          expect(result.drawing.get(n).values.get("primFontSz")).toBe(
            Number(row.expected[i].font[0]) / 100,
          );
      }
      // Allocation retains the frame canvas; a LIN drawing uses its child union.
      expect(result.allocation.get(root).size).toEqual(row.available);
      expect(run().bounds).toEqual(result.bounds);
      expect(serializeFragment(root.definition)).toBe(before);
    },
  );
});

it.each(
  native.cases.filter(
    (r) =>
      r.name.startsWith("binding-conflict /") ||
      r.name.startsWith("binding-initial /"),
  ),
)(
  "resolves the initial child geometry from the active parent ruler: $name",
  (row) => {
    const root = layout(row),
      states = evaluate(root, row.available),
      query = [...states.keys()].find((n) => n.name === "query"),
      state = states.get(query),
      expected = row.expected[0].bounds.h / 36000;
    expect(state.size.h).toBe(expected);
    const trial = state.evaluateScope().get(query);
    expect(trial.size).toEqual(state.size);
    for (const rule of state.rules) {
      const plan = state.rulePlan(rule);
      expect(plan.limit).toBe(expected);
      expect(trial.rulePlan(rule)).toEqual(plan);
    }
    expect(evaluate(root, row.available).get(query).size).toEqual(state.size);
  },
);

it.each(["svg", "foreignObject"])(
  "preserves dimension bindings through %s rendering and bidirectional copy/export",
  async (mode) => {
    const row = native.cases.find((r) => r.expected[0].font[0] === "1200"),
      { p, frame } = await semanticTextGroupDeck(row);
    const render = (pres, slide = P.getSlides(pres)[0]) =>
      renderSlideToSvg(pres, slide, {
        textLayout: mode,
        stableDefinitionIds: true,
      });
    const before = unzipSync(await P.savePresentation(p)),
      svg = render(p);
    expect(svg).toContain('data-pptx-diagram="semantic-layout"');
    expect(svg).not.toContain("data-pptx-diagram-issues");
    expect(svg).toContain("Alpha");
    expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    const diagram = (svg) =>
      serializeFragment(
        [...childElements(parseXml(svg).root)].find((e) =>
          getAttrValue(e, qname("", "data-pptx-diagram", "")),
        ),
      );
    const local = P.addSlide(p, { layout: P.getSlideLayouts(p)[0] });
    P.copyShape(local, frame);
    expect(diagram(render(p, local))).toBe(diagram(svg));
    const target = createDeck("blank"),
      blank = P.getSlides(target)[0];
    P.importSlide(target, local, P.getSlideLayouts(target)[0]);
    P.removeSlide(target, blank);
    const transferred = render(target),
      reopened = await P.loadPresentation(await P.savePresentation(target));
    expect(render(reopened)).toBe(transferred);
    expect(
      P.getSlideShapes(P.getSlides(reopened)[0]).filter(isDiagramShape),
    ).toHaveLength(1);
    const back = P.importSlide(
      p,
      P.getSlides(reopened)[0],
      P.getSlideLayouts(p)[0],
    );
    expect(diagram(render(p, back))).toBe(diagram(svg));
  },
);
