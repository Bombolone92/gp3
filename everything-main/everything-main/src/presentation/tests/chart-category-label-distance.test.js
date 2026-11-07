import { describe, expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { workbook } from "./chart-copy-fixture.js";
import {
  chartCategoryLabelDistanceDeck as fixture,
  secondaryCategoryLabelDistance as distance,
} from "./chart-category-label-distance-fixture.js";
import {
  chartAxisRoles,
  chartPlotContext,
} from "../lib/pptx/src/internal/chartml/axis-context.ts";
import { parseXml } from "../lib/pptx/src/internal/xml/index.ts";

describe("native secondary category label distance", () => {
  for (const kind of ["column", "bar", "line", "area"])
    for (const value of [
      undefined,
      null,
      "0",
      "50",
      "100",
      "200",
      "1000",
      "00050",
    ])
      it(`${kind} retains independent ${String(value)} distance through edits and slide transfers`, async () => {
        const f = fixture(kind, value),
          expected = value === undefined ? null : { value },
          source = f.part.data.slice(),
          book = workbook(f.p, f.shape).data.slice();
        expect(distance(f.p, f.shape)).toEqual(expected);
        const initial = P.getShapeChartSpec(f.shape);
        expect(initial.categoryAxisLabelOffset).toBe(75);
        expect(f.part.data).toEqual(source);
        P.setChartSpec(P.getSlideCharts(f.slide)[0], {
          ...initial,
          title: "Independent title edit",
          categoryAxisLabelOffset: 175,
        });
        expect(distance(f.p, f.shape)).toEqual(expected);
        expect(P.getShapeChartSpec(f.shape).categoryAxisLabelOffset).toBe(175);
        expect(workbook(f.p, f.shape).data).toEqual(book);
        const beforeData = f.part.data.slice(),
          spec = P.getShapeChartSpec(f.shape);
        P.setChartSpec(P.getSlideCharts(f.slide)[0], {
          ...spec,
          series: spec.series.map((s, i) => ({
            ...s,
            values: s.values.map((v) => v + i + 2),
          })),
        });
        expect(f.part.data).not.toEqual(beforeData);
        expect(workbook(f.p, f.shape).data).not.toEqual(book);
        expect(distance(f.p, f.shape)).toEqual(expected);
        const root = parseXml(new TextDecoder().decode(f.part.data)).root,
          ctx = chartPlotContext(root),
          axis = chartAxisRoles(ctx.area, ctx.axes).secondaryCategory,
          names = axis.children
            .filter((e) => e.kind === "element")
            .map((e) => e.name.localName);
        if (value !== undefined) {
          expect(names.filter((n) => n === "lblOffset")).toHaveLength(1);
          expect(names.indexOf("lblOffset")).toBeGreaterThan(
            names.indexOf("crossAx"),
          );
          expect(names.indexOf("lblOffset")).toBeLessThan(
            names.indexOf("tickMarkSkip"),
          );
        }
        const q = createDeck("blank"),
          copied = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
          copy = P.getSlideCharts(copied)[0];
        expect(distance(q, copy.shape)).toEqual(expected);
        const back = P.importSlide(f.p, copied, P.getSlideLayout(f.slide));
        expect(distance(f.p, P.getSlideCharts(back)[0].shape)).toEqual(
          expected,
        );
        const loaded = await P.loadPresentation(await P.savePresentation(q));
        expect(
          distance(loaded, P.getSlideCharts(P.getSlides(loaded)[1])[0].shape),
        ).toEqual(expected);
        expect(P.validatePresentation(loaded)).toEqual([]);
      });

  it("drops the native slot when its secondary axis no longer survives", () => {
    const f = fixture("column", "200"),
      spec = P.getShapeChartSpec(f.shape);
    P.setChartSpec(P.getSlideCharts(f.slide)[0], {
      ...spec,
      series: spec.series.filter((s) => !s.secondaryAxis),
    });
    expect(distance(f.p, f.shape)).toBeNull();
    expect(P.getShapeChartSpec(f.shape).categoryAxisLabelOffset).toBe(75);
  });
});
