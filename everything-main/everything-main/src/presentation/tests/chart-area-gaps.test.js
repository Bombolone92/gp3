import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { P, createDeck, preview } from "../src/model.js";
import {
  chartLineGapsDeck,
  chartRoot,
  workbook,
} from "./chart-copy-fixture.js";
import {
  parseXml,
  walkElements,
  qname,
  getAttrValue,
} from "../lib/pptx/src/internal/xml/index.ts";
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
function fixture(options = {}) {
  return chartLineGapsDeck({ kind: "area", smooth: false, ...options });
}
function render(f, color = "#376CA8") {
  const svg = decodeURIComponent(
      preview(f.p, f.slide).split(",").slice(1).join(","),
    ),
    paths = [];
  walkElements(parseXml(svg).root, (e) => {
    if (e.name.localName === "path" && attr(e, "fill") === color) paths.push(e);
  });
  return {
    svg,
    paths,
    polygons: paths.flatMap((e) =>
      (attr(e, "d").match(/M[^M]*Z/g) ?? []).map((p) =>
        [...p.matchAll(/[ML]([-\d.]+),([-\d.]+)/g)].map((m) => [
          Number(m[1]),
          Number(m[2]),
        ]),
      ),
    ),
  };
}

describe("area gaps close each connected run at its own baseline", () => {
  for (const [name, values, counts] of [
    ["three-point runs", [2, 4, 3, null, 3, 1, 5], [2, 1, 1]],
    ["two-point runs", [2, 4, null, 3, 1, null, 5, 2], [3, 1, 1]],
    ["isolated and edge points", [null, 2, 4, 3, null, 1, null], [1, 1, 1]],
    ["only isolated points", [2, null, 4, null, 1], [0, 1, 1]],
    ["all blanks", [null, null, null, null], [0, 1, 1]],
  ])
    for (const [index, dispBlanksAs] of ["gap", "span", "zero"].entries())
      it(`${name} in ${dispBlanksAs} has the native connected polygons`, () => {
        const f = fixture({ values, dispBlanksAs }),
          bytes = P._internalPackageOf(f.p)
            .getPart(chartRoot(f.shape))
            .data.slice(),
          book = workbook(f.p, f.shape).data.slice(),
          r = render(f);
        expect(r.polygons).toHaveLength(counts[index]);
        expect(
          (
            r.paths
              .map((e) => attr(e, "d"))
              .join(" ")
              .match(/M/g) ?? []
          ).length,
        ).toBe(counts[index]);
        for (const polygon of r.polygons) {
          const xs = polygon.map((p) => p[0]);
          // Both baseline endpoints lie beneath this polygon's own top run.
          expect(polygon.at(-1)[0]).toBe(polygon[0][0]);
          expect(Math.min(...xs)).toBe(
            Math.min(polygon[0][0], polygon[polygon.length / 2][0]),
          );
          expect(Math.max(...xs)).toBe(
            Math.max(polygon[0][0], polygon[polygon.length / 2][0]),
          );
        }
        expect(r.svg).not.toMatch(/NaN|Infinity/);
        expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual(values);
        expect(P.getShapeChartSpec(f.shape).dispBlanksAs).toBe(dispBlanksAs);
        expect(
          P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
        ).toEqual(bytes);
        expect(workbook(f.p, f.shape).data).toEqual(book);
        if (dispBlanksAs === "span")
          expect(r.svg).toBe(
            render(fixture({ values, dispBlanksAs: "zero" })).svg,
          );
      });
  for (const lineColor of [undefined, null, "#A93570"])
    for (const reversed of [false, true])
      it(`separated negative runs retain independent closure and outline ${lineColor}, reversed=${reversed}`, () => {
        const options = {
            values: [-2, 4, null, -3, 1, null, 5, -2],
            valueAxis: { min: -6, max: 6 },
            categoryAxisOrientation: reversed ? "maxMin" : "minMax",
            valueAxisOrientation: reversed ? "maxMin" : "minMax",
            series: [
              {
                name: "Net",
                values: [-2, 4, null, -3, 1, null, 5, -2],
                color: "#376CA8",
                lineColor,
                lineWidthEmu: lineColor === undefined ? undefined : 38100,
              },
            ],
          },
          r = render(fixture(options));
        expect(r.polygons).toHaveLength(3);
        // Each run is identical to the same points with every other run blank.
        const expected = [0, 3, 6].flatMap(
          (start) =>
            render(
              fixture({
                ...options,
                series: [
                  {
                    ...options.series[0],
                    values: options.values.map((v, i) =>
                      i >= start && i < start + 2 ? v : null,
                    ),
                  },
                ],
              }),
            ).polygons,
        );
        expect(r.polygons).toEqual(expected);
        expect(r.paths).toHaveLength(1);
        expect(attr(r.paths[0], "stroke")).toBe(lineColor ?? "none");
        if (lineColor === "#A93570")
          expect(Number(attr(r.paths[0], "stroke-width"))).toBe(4);
        expect(r.svg).not.toMatch(/NaN|Infinity/);
      });
  for (const dispNaAsBlank of [undefined, false, true])
    for (const dispBlanksAs of ["gap", "span", "zero"])
      it(`area #N/A with flag ${dispNaAsBlank}, ${dispBlanksAs} follows area blanks`, () => {
        const f = fixture({ naIndices: [3], dispNaAsBlank, dispBlanksAs });
        expect(render(f).svg).toBe(render(fixture({ dispBlanksAs })).svg);
        expect(
          strFromU8(P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data),
        ).toContain("#N/A");
        expect(
          strFromU8(
            unzipSync(workbook(f.p, f.shape).data)["xl/worksheets/sheet1.xml"],
          ),
        ).toContain("#N/A");
      });
  for (const grouping of ["stacked", "percentStacked"])
    it(`${grouping} closes on the previous series rather than the axis baseline`, () => {
      const f = fixture({
          grouping,
          series: [
            { name: "Base", values: [1, 2, 3, 1], color: "#E85239" },
            { name: "Top", values: [2, null, 1, 2], color: "#376CA8" },
          ],
          categories: ["A", "B", "C", "D"],
        }),
        lower = render(f, "#E85239").polygons[0],
        upper = render(f).polygons[0];
      expect(upper).toHaveLength(8);
      expect(upper.slice(4)).toEqual(lower.slice(0, 4).reverse());
      expect(upper[1]).toEqual(upper[6]);
    });
  it("keeps overlapping series fill and authored outline paint in native series order", () => {
    const f = fixture({
        series: [
          {
            name: "Front",
            values: [2, 4, null, 3, 1],
            color: "#E85239",
            lineColor: "#713AC8",
          },
          {
            name: "Back",
            values: [4, 2, null, 1, 5],
            color: "#376CA8",
            lineColor: "#238F61",
          },
        ],
        categories: ["A", "B", "C", "D", "E"],
      }),
      svg = render(f).svg;
    expect(svg.indexOf('fill="#376CA8"')).toBeLessThan(
      svg.indexOf('fill="#E85239"'),
    );
    for (const [color, stroke] of [
      ["#E85239", "#713AC8"],
      ["#376CA8", "#238F61"],
    ]) {
      const r = render(f, color);
      expect(r.polygons).toHaveLength(2);
      expect(r.paths).toHaveLength(1);
      expect(attr(r.paths[0], "stroke")).toBe(stroke);
    }
  });
  it("preserves raw modes and error cells through transfer, copied edits, export and reimport", async () => {
    const f = fixture({ naIndices: [3] }),
      q = createDeck("blank"),
      copied = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      returned = P.importSlide(f.p, copied, P.getSlideLayout(f.slide)),
      chart = P.getSlideCharts(returned)[0];
    expect(render({ p: q, slide: copied }).polygons).toHaveLength(2);
    const original = P.getShapeChartSpec(f.shape),
      book = workbook(f.p, f.shape).data.slice();
    P.setChartSpec(chart, {
      ...chart.spec,
      dispBlanksAs: "span",
      series: chart.spec.series.map((s) => ({
        ...s,
        values: s.values.map((v) => (v === null ? null : v + 1)),
      })),
    });
    expect(render({ p: f.p, slide: returned }).polygons).toHaveLength(1);
    expect(P.getShapeChartSpec(f.shape)).toEqual(original);
    expect(workbook(f.p, f.shape).data).toEqual(book);
    const saved = await P.loadPresentation(await P.savePresentation(f.p)),
      slides = P.getSlides(saved),
      charts = slides.map((s) => P.getSlideCharts(s)[0]);
    expect(charts.map((c) => c.spec.dispBlanksAs)).toEqual(["gap", "span"]);
    expect(charts.map((c) => c.spec.series[0].values)).toEqual([
      original.series[0].values,
      original.series[0].values.map((v) => (v === null ? null : v + 1)),
    ]);
    expect(
      slides.map((slide) => render({ p: saved, slide }).polygons.length),
    ).toEqual([2, 1]);
    expect(new Set(charts.map((c) => workbook(saved, c.shape).name)).size).toBe(
      2,
    );
    for (const chart of charts)
      expect(
        strFromU8(
          unzipSync(workbook(saved, chart.shape).data)[
            "xl/worksheets/sheet1.xml"
          ],
        ),
      ).toContain("#N/A");
    expect(P.validatePresentation(saved)).toEqual([]);
  });
});
