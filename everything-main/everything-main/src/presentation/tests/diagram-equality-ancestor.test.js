import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { P, createDeck } from "../src/model.js";
import { semanticTextGroupDeck } from "./diagram-text-group-fixture.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { isDiagramShape } from "../lib/pptx/src/api/fn/diagram-read.ts";
import native from "./data/diagram-equality-ancestor-native.json";
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
describe("equality propagation through ancestor references", () => {
  it.each(native.cases)(
    "preserves ancestor rulers while projecting the native trial: $name",
    (row) => {
      const root = layout(row),
        initial = evaluate(root, row.available),
        query = [...initial.keys()].find((n) => n.name === "query"),
        seed = row.expected.find((s) => s.name === "query").bounds.h / 36000;
      const ancestors = [];
      for (let n = query.parent; n; n = n.parent) ancestors.push(n);
      const trial = initial.get(query).equalityTrial("h", seed),
        next = evaluate(root, row.available, { changes: trial.changes });
      expect(trial.changes.every((c) => !ancestors.includes(c.owner))).toBe(
        true,
      );
      expect(
        trial.scopes.some(
          (s) =>
            s.property.selector.relationship === "self" &&
            ancestors.includes(s.scope),
        ),
      ).toBe(true);
      for (const n of ancestors) {
        expect(next.get(n).size).toEqual(initial.get(n).size);
        expect(next.get(n).values).toEqual(initial.get(n).values);
      }
      for (const n of initial.keys())
        if (n.name === "probe")
          expect(next.get(n).size.w * 36000).toBeCloseTo(
            row.expected.find((s) => s.name === "probe").bounds.w,
            4,
          );
      expect(initial.get(query).size.h).toBeLessThan(seed);
      expect(initial.get(query).equalityTrial("h", seed)).toEqual(trial);
    },
  );
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
      expect(result.fits).toBe(true);
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

it.each(["svg", "foreignObject"])(
  "preserves ancestor references through %s rendering and bidirectional copy/export",
  async (mode) => {
    const row = native.cases.find((r) => r.name === "root w probe equ"),
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
