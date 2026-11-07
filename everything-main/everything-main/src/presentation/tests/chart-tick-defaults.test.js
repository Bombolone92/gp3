import { canonicalSvgDefinitionIds } from "./svg-definition-ids.js";
import { expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { chartRenderingView } from "../lib/pptx/src/api/fn/charts.ts";
import { renderSlideToSvg as renderWithSharedIds } from "../lib/pptx-preview/src/index.ts";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  chartAxisRoles,
  chartPlotContext,
} from "../lib/pptx/src/internal/chartml/axis-context.ts";
import {
  chartTickDefaultDeck,
  tickAxisColors,
} from "./chart-tick-default-fixture.js";
import {
  getAttrValue,
  parseXml,
  qname,
  walkElements,
  firstChildElement,
  NS,
} from "../lib/pptx/src/internal/xml/index.ts";
const render = (f) =>
  renderSlideToSvg(f.p, f.slide, {
    measureText: (text, font) => ({
      widthPx: (text.length * font.sizePx) / 2,
      ascentPx: font.sizePx * 0.9,
      descentPx: font.sizePx * 0.2,
    }),
  });
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
function markDeclaration(p, shape, kind, role, which) {
  const doc = parseXml(
      new TextDecoder().decode(
        P._internalPackageOf(p).getPart(chartRoot(shape)).data,
      ),
    ),
    context = chartPlotContext(doc.root),
    axis = chartAxisRoles(context.area, context.axes, kind === "scatter")[role];
  return firstChildElement(axis, qname("", which + "TickMark", NS.chart));
}
for (const kind of ["column", "bar", "scatter"])
  for (const role of kind === "scatter"
    ? ["category", "value"]
    : Object.keys(tickAxisColors))
    for (const which of ["major", "minor"])
      for (const mode of ["omit", "empty", "cross", "in", "out", "none"])
        it(`${kind} ${role} ${which} ${mode} resolves native defaults without authoring them`, async () => {
          const opts = { kind, role, which, mode },
            f = chartTickDefaultDeck(opts),
            source = f.part.data.slice(),
            book = workbook(f.p, f.shape).data.slice();
          const effective =
            mode === "omit" || mode === "empty" ? "cross" : mode;
          const view = chartRenderingView(f.shape);
          expect(view.axisLines[role].geometry[which + "TickMark"]).toBe(
            effective,
          );
          if (!role.startsWith("secondary"))
            expect(
              P.getShapeChartSpec(f.shape)[
                role +
                  "Axis" +
                  (which === "major" ? "Major" : "Minor") +
                  "TickMark"
              ],
            ).toBe(mode === "omit" ? undefined : effective);
          const svg = render(f);
          expect(svg).toBe(
            render(chartTickDefaultDeck({ ...opts, mode: effective })),
          );
          const marks = [];
          walkElements(parseXml(svg).root, (e) => {
            if (
              e.name.localName === "line" &&
              attr(e, "stroke") === tickAxisColors[role]
            ) {
              const dx = Math.abs(+attr(e, "x2") - +attr(e, "x1")),
                dy = Math.abs(+attr(e, "y2") - +attr(e, "y1"));
              if (Math.max(dx, dy) < 20) marks.push(e);
            }
          });
          if (effective === "none") expect(marks).toHaveLength(0);
          else expect(marks.length).toBeGreaterThan(1);
          expect(f.part.data).toEqual(source);
          const loaded = await P.loadPresentation(
              await P.savePresentation(f.p),
            ),
            slide = P.getSlides(loaded)[0],
            chart = P.getSlideCharts(slide)[0];
          expect(
            P._internalPackageOf(loaded).getPart(chartRoot(chart.shape)).data,
          ).toEqual(source);
          expect(workbook(loaded, chart.shape).data).toEqual(book);
          expect(render({ p: loaded, slide })).toBe(svg);
          expect(P.validatePresentation(loaded)).toEqual([]);
          if (mode !== "omit" && mode !== "empty") return;
          const copy = createDeck("blank"),
            copied = P.importSlide(copy, f.slide, P.getSlideLayouts(copy)[0]),
            c = P.getSlideCharts(copied)[0];
          expect(
            P._internalPackageOf(copy).getPart(chartRoot(c.shape)).data,
          ).toEqual(source);
          expect(workbook(copy, c.shape).data).toEqual(book);
          // XY data authoring is read-only; resizing still exercises an
          // independent editable frame without rewriting its native chart.
          if (kind === "scatter")
            P.setShapeSize(c.shape, P.inches(6), P.inches(3));
          else
            P.setChartSpec(c, {
              ...c.spec,
              series: c.spec.series.map((s) => ({
                ...s,
                values: s.values.map((v) => v + 0.25),
              })),
            });
          expect(
            chartRenderingView(c.shape).axisLines[role].geometry[
              which + "TickMark"
            ],
          ).toBe("cross");
          expect(f.part.data).toEqual(source);
          expect(workbook(f.p, f.shape).data).toEqual(book);
          if (mode === "omit")
            expect(
              markDeclaration(copy, c.shape, kind, role, which),
            ).toBeNull();
          const edited = await P.loadPresentation(
              await P.savePresentation(copy),
            ),
            result = P.getSlideCharts(P.getSlides(edited).at(-1))[0];
          expect(
            chartRenderingView(result.shape).axisLines[role].geometry[
              which + "TickMark"
            ],
          ).toBe("cross");
          if (mode === "omit")
            expect(
              markDeclaration(edited, result.shape, kind, role, which),
            ).toBeNull();
          expect(result.spec.series[0].values).toEqual(
            P.getShapeChartSpec(c.shape).series[0].values,
          );
          expect(P.validatePresentation(edited)).toEqual([]);
        });

function renderSlideToSvg(...args) {
  return canonicalSvgDefinitionIds(renderWithSharedIds(...args));
}
