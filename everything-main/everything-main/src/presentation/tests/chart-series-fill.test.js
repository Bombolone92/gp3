import { expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { chartRenderingView } from "../lib/pptx/src/api/fn/charts.ts";
import {
  chartAreaPathBounds,
  chartPointBounds,
  chartSliceBounds,
} from "../lib/pptx-preview/src/chart-fill-bounds.ts";
import {
  chartSeriesFillDeck,
  withoutChartColorScheme,
} from "./chart-series-fill-fixture.js";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { nativeChartSeriesHosts } from "../lib/pptx/src/internal/chartml/native-data.ts";
const kinds = [
    "bar",
    "column",
    "line",
    "area",
    "pie",
    "doughnut",
    "scatter",
    "bubble",
    "radar",
  ],
  active = kinds.filter((k) => !["line", "scatter"].includes(k)),
  attr = (e, n) => getAttrValue(e, qname("", n, ""));
function rendered(f) {
  const svg = renderSlideToSvg(f.p, f.slide, { stableDefinitionIds: true }),
    all = [],
    visible = [],
    ids = new Map();
  const visit = (e, definition = false) => {
    all.push(e);
    if (!definition && e.name.localName !== "defs") visible.push(e);
    if (attr(e, "id")) ids.set(attr(e, "id"), e);
    for (const c of e.children)
      if (c.kind === "element")
        visit(c, definition || e.name.localName === "defs");
  };
  visit(parseXml(svg).root);
  return {
    svg,
    all,
    visible,
    ids,
    painted: visible.filter((e) => attr(e, "fill")?.startsWith("url(#")),
  };
}
function stops(r, e) {
  const id = attr(e, "fill").slice(5, -1),
    gradient = r.ids.get(id);
  expect(gradient?.name.localName).toBe("linearGradient");
  return gradient.children
    .filter((c) => c.kind === "element" && c.name.localName === "stop")
    .map((c) => [
      Number(attr(c, "offset")),
      attr(c, "stop-color"),
      Number(attr(c, "stop-opacity") ?? 1),
    ]);
}
const signed = {
  name: "Signed",
  values: [-2, 4, -3],
  color: "#E85239",
  lineColor: null,
  invertIfNegative: false,
};
const bars = (r) =>
  r.visible.filter((e) => e.name.localName === "rect" && attr(e, "clip-path"));

for (const kind of ["bar", "column", "pie", "doughnut", "bubble"]) {
  for (const paint of ["gradient", "pattern"])
    it(`${kind} unresolved chart color scheme keeps automatic points visible over ${paint}`, async () => {
      const f = withoutChartColorScheme(
          chartSeriesFillDeck({
            kind,
            paint,
            pointPaint: "empty",
            legend: { position: null },
            series: [
              { name: "Values", values: [2, 5, 3], invertIfNegative: false },
            ],
          }),
        ),
        spec = P.getShapeChartSpec(f.shape),
        raw = P._internalPackageOf(f.p)
          .getPart(chartRoot(f.shape))
          .data.slice(),
        view = chartRenderingView(f.shape),
        r = rendered(f);
      expect(view.seriesOpacities[0].points?.get(1)).not.toBeNull();
      // Pie/doughnut default to varying category colors; the other kinds use
      // the series palette. Both keep their identity without a color scheme.
      const expected = ["pie", "doughnut"].includes(kind)
        ? "#ED7D31"
        : "#5B9BD5";
      expect(r.visible.some((e) => attr(e, "fill") === expected)).toBe(true);
      expect(P.getShapeChartSpec(f.shape)).toEqual(spec);
      expect(
        P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
      ).toEqual(raw);
      const loaded = await P.loadPresentation(await P.savePresentation(f.p)),
        slide = P.getSlides(loaded)[0],
        shape = P.getSlideCharts(slide)[0].shape;
      expect(P.getShapeChartSpec(shape)).toEqual(spec);
      expect(
        P._internalPackageOf(loaded).getPart(chartRoot(shape)).data,
      ).toEqual(raw);
      expect(
        renderSlideToSvg(loaded, slide, { stableDefinitionIds: true }),
      ).toBe(r.svg);
    });
  it(`${kind} unresolved chart color scheme retains explicit point noFill`, () => {
    const f = withoutChartColorScheme(
      chartSeriesFillDeck({
        kind,
        pointPaint: "none",
        legend: { position: null },
      }),
    );
    expect(
      chartRenderingView(f.shape).seriesOpacities[0].points?.get(1),
    ).toBeNull();
    expect(rendered(f).svg).not.toMatch(/NaN|Infinity/);
  });
}

for (const kind of kinds)
  for (const paint of ["gradient", "pattern"])
    for (const alpha of [0, 0.35, 1])
      it(`${kind} ${paint} body and key retain native alpha ${alpha} independently of RGB, outlines and markers`, () => {
        const f = chartSeriesFillDeck({ kind, paint, alpha }),
          before = P.getShapeChartSpec(f.shape),
          raw = P._internalPackageOf(f.p)
            .getPart(chartRoot(f.shape))
            .data.slice(),
          r = rendered(f),
          view = chartRenderingView(f.shape);
        expect(view.seriesOpacities.every((s) => s.body?.kind === paint)).toBe(
          true,
        );
        if (active.includes(kind)) {
          expect(r.painted.length).toBeGreaterThan(before.series.length);
          for (const e of r.painted) {
            const definition = r.ids.get(attr(e, "fill").slice(5, -1));
            expect(definition).toBeDefined();
            if (paint === "gradient")
              expect(stops(r, e).map((s) => s[2])).toEqual([
                alpha,
                alpha,
                alpha,
              ]);
          }
        } else expect(r.painted).toHaveLength(0);
        for (const s of view.seriesOpacities) {
          if (paint === "gradient")
            expect(s.body.gradient.stops.map((x) => x.opacity ?? 1)).toEqual([
              alpha,
              alpha,
              alpha,
            ]);
          else {
            expect(s.body.pattern.foregroundOpacity ?? 1).toBe(alpha);
            expect(s.body.pattern.backgroundOpacity ?? 1).toBe(alpha);
          }
        }
        expect(P.getShapeChartSpec(f.shape)).toEqual(before);
        expect(
          P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data,
        ).toEqual(raw);
        expect(r.svg).not.toMatch(/NaN|Infinity/);
      });

for (const kind of ["bar", "column"])
  for (const paint of ["gradient", "pattern"])
    for (const pointPaint of ["gradient", "pattern", "solid", "none", "empty"])
      it(`${kind} point ${pointPaint} takes precedence over series ${paint} without changing geometry`, () => {
        const f = chartSeriesFillDeck({
            kind,
            paint,
            pointPaint,
            pointSwitch: false,
            legend: { position: null },
            series: [signed],
          }),
          r = rendered(f),
          b = bars(r),
          view = chartRenderingView(f.shape);
        expect(b).toHaveLength(3);
        const own = view.seriesOpacities[0].pointBodies?.get(1);
        expect(own?.kind).toBe(pointPaint === "empty" ? "solid" : pointPaint);
        expect(attr(b[1], "fill")).toEqual(
          pointPaint === "none"
            ? "none"
            : pointPaint === "solid"
              ? "#CC55AA"
              : pointPaint === "empty"
                ? "#4F81BD"
                : expect.stringMatching(/^url\(#/),
        );
        const normal = rendered(
          chartSeriesFillDeck({
            kind,
            paint,
            legend: { position: null },
            series: [signed],
          }),
        );
        expect(
          b.map((e) => ["x", "y", "width", "height"].map((k) => attr(e, k))),
        ).toEqual(
          bars(normal).map((e) =>
            ["x", "y", "width", "height"].map((k) => attr(e, k)),
          ),
        );
      });

for (const kind of ["bar", "column"])
  for (const invert of [false, true])
    for (const pointSwitch of [undefined, false, true])
      it(`${kind} gradient inversion ${invert} / point ${pointSwitch} reverses the stop domain and preserves ordinary outlines`, () => {
        const f = chartSeriesFillDeck({
            kind,
            pointPaint: "idx",
            pointIndex: 0,
            pointSwitch,
            legend: { position: null },
            series: [{ ...signed, invertIfNegative: invert }],
          }),
          r = rendered(f),
          b = bars(r);
        const normal = [
            [0, "#D5244B", 1],
            [0.35, "#F4C642", 1],
            [1, "#177FA7", 1],
          ],
          reverse = [
            [0, "#177FA7", 1],
            [0.65, "#F4C642", 1],
            [1, "#D5244B", 1],
          ];
        expect(stops(r, b[0])).toEqual(
          pointSwitch === false ? normal : reverse,
        );
        expect(stops(r, b[1])).toEqual(normal);
        expect(stops(r, b[2])).toEqual(invert ? reverse : normal);
        expect(b.every((e) => attr(e, "stroke") !== "#000000")).toBe(true);
      });

for (const kind of ["bar", "column"])
  for (const grouping of ["clustered", "stacked", "percentStacked"])
    for (const direction of ["minMax", "maxMin"])
      it(`${kind} ${grouping} ${direction} gradients retain full pre-clip body bounds`, () => {
        const f = chartSeriesFillDeck({
            kind,
            grouping,
            valueAxisOrientation: direction,
            legend: { position: null },
            series: [signed],
            valueAxis: { min: -1, max: 1, majorUnit: 0.5 },
          }),
          r = rendered(f);
        for (const b of bars(r)) {
          const g = r.ids.get(attr(b, "fill").slice(5, -1)),
            frame = attr(g, "gradientTransform")
              .match(/[-+]?\d*\.?\d+/g)
              .map(Number);
          expect(frame).toEqual([
            Number(attr(b, "x")),
            Number(attr(b, "y")),
            Number(attr(b, "width")),
            Number(attr(b, "height")),
          ]);
          expect(attr(b, "clip-path")).toMatch(/^url/);
        }
      });

for (const kind of active)
  for (const paint of ["gradient", "pattern"])
    it(`${kind} ${paint} stays editable and exact through slide transfer, save and reimport`, async () => {
      const f = chartSeriesFillDeck({ kind, paint, pointPaint: paint }),
        spec = P.getShapeChartSpec(f.shape),
        raw = P._internalPackageOf(f.p)
          .getPart(chartRoot(f.shape))
          .data.slice(),
        book = workbook(f.p, f.shape).data.slice(),
        q = createDeck("blank"),
        slide = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
        before = renderSlideToSvg(q, slide, { stableDefinitionIds: true }),
        saved = await P.loadPresentation(await P.savePresentation(q)),
        s = P.getSlides(saved).at(-1),
        chart = P.getSlideCharts(s)[0];
      expect(chart.spec).toEqual(spec);
      expect(
        P._internalPackageOf(saved).getPart(chartRoot(chart.shape)).data,
      ).toEqual(raw);
      expect(workbook(saved, chart.shape).data).toEqual(book);
      expect(renderSlideToSvg(saved, s, { stableDefinitionIds: true })).toBe(
        before,
      );
      expect(P.validatePresentation(saved)).toEqual([]);
    });

for (const kind of ["bar", "column", "area"])
  for (const paint of ["gradient", "pattern"])
    it(`${kind} ${paint} survives independent title, values, bounds and line edits`, () => {
      const f = chartSeriesFillDeck({ kind, paint }),
        chart = P.getSlideCharts(f.slide)[0],
        before = chartRenderingView(f.shape).seriesOpacities.map((s) => s.body);
      P.setChartSpec(chart, {
        ...chart.spec,
        title: "Independent edit",
        valueAxis: { min: -4, max: 9, majorUnit: 1 },
        series: chart.spec.series.map((s) => ({
          ...s,
          values: [-3, 6, 2],
          lineColor: "#440099",
        })),
      });
      const r = rendered(f);
      expect(r.painted.length).toBeGreaterThan(0);
      expect(
        chartRenderingView(f.shape).seriesOpacities.map((s) => s.body),
      ).toEqual(before);
      expect(P.getShapeChartSpec(f.shape).series[0].values).toEqual([-3, 6, 2]);
      expect(P.getShapeChartSpec(f.shape).title).toBe("Independent edit");
    });

it("area paint bounds use cubic extrema across every disconnected polygon", () => {
  expect(
    chartAreaPathBounds(
      "M0,0 C0,100 100,100 100,0 L100,-20 L0,-20 Z M120,0 L140,10 L120,10 Z",
    ),
  ).toEqual({ x: 0, y: -20, w: 140, h: 95 });
  expect(chartAreaPathBounds("M-10,-2 L-5,5 L2,-3 Z")).toEqual({
    x: -10,
    y: -3,
    w: 12,
    h: 8,
  });
});
it("slice paint bounds include angular extrema and ring endpoints without including the hole center", () => {
  const quarter = chartSliceBounds(0, 0, 10, 5, 0, Math.PI / 2);
  expect(quarter.x).toBeCloseTo(0);
  expect(quarter.y).toBe(0);
  expect(quarter.w).toBeCloseTo(10);
  expect(quarter.h).toBe(10);
  const narrow = chartSliceBounds(0, 0, 10, 5, Math.PI / 6, Math.PI / 3);
  expect(narrow.x).toBeCloseTo(2.5);
  expect(narrow.y).toBeCloseTo(2.5);
  expect(narrow.w).toBeCloseTo(10 * Math.cos(Math.PI / 6) - 2.5);
  const full = chartSliceBounds(20, 30, 10, 0, -Math.PI / 2, (3 * Math.PI) / 2);
  expect(full).toEqual({ x: 10, y: 20, w: 20, h: 20 });
  expect(
    chartPointBounds([
      [0, 1],
      [4, -2],
      [-3, 6],
    ]),
  ).toEqual({ x: -3, y: -2, w: 7, h: 8 });
});

// Native controls distinguish a record with no style from an empty spPr.
for (const kind of ["bar", "column"])
  for (const paint of ["gradient", "pattern"])
    for (const pointPaint of ["idx", "empty", "solid"])
      for (const pointIndex of [0, 1])
        for (const pointSwitch of [undefined, false])
          it(`${kind} ${paint} ${pointPaint} point ${pointIndex}/${pointSwitch} resolves its own fill and outline`, () => {
            const f = chartSeriesFillDeck({
                kind,
                paint,
                pointPaint,
                pointIndex,
                pointSwitch,
                legend: { position: null },
                series: [
                  {
                    ...signed,
                    negativeColor: "#00AA77",
                    lineColor: "#316BB0",
                    lineWidthEmu: 25400,
                  },
                ],
              }),
              r = rendered(f),
              b = bars(r),
              own = b[pointIndex],
              inverted = pointIndex === 0 && pointSwitch !== false;
            if (pointPaint === "idx") {
              expect(attr(own, "fill")).toMatch(/^url/);
              expect(attr(own, "stroke")).toBe("#316BB0");
            } else {
              expect(attr(own, "fill")).toBe(
                inverted
                  ? "#FFFFFF"
                  : pointPaint === "empty"
                    ? "#4F81BD"
                    : "#CC55AA",
              );
              expect(attr(own, "stroke")).toBe(inverted ? "#000000" : "none");
              expect(attr(own, "fill-opacity")).toBeNull();
            }
            expect(attr(b[2], "stroke")).toBe("#316BB0");
          });

for (const kind of ["bar", "column"])
  for (const pointIndex of [0, 1])
    for (const mode of ["empty", "width", "dash", "noFill", "solid"])
      it(`${kind} point outline ${mode} at ${pointIndex} retains independent width, alpha and dash`, () => {
        const pointLine = `<a:ln${mode === "width" ? ' w="50800"' : ""}>${mode === "noFill" ? "<a:noFill/>" : mode === "dash" ? '<a:prstDash val="dash"/>' : mode === "solid" ? '<a:solidFill><a:srgbClr val="CC55AA"><a:alpha val="30000"/></a:srgbClr></a:solidFill>' : ""}</a:ln>`,
          f = chartSeriesFillDeck({
            kind,
            pointPaint: "empty",
            pointIndex,
            pointLine,
            legend: { position: null },
            series: [{ ...signed, lineColor: "#316BB0" }],
          }),
          b = bars(rendered(f))[pointIndex];
        expect(attr(b, "stroke")).toBe(
          mode === "solid" ? "#CC55AA" : pointIndex === 0 ? "#000000" : "none",
        );
        expect(Number(attr(b, "stroke-width"))).toBe(
          mode === "width" ? 50800 / 9525 : 1,
        );
        expect(attr(b, "stroke-opacity")).toBe(mode === "solid" ? "0.3" : null);
        if (mode === "dash") expect(attr(b, "stroke-dasharray")).toBe("4 3");
      });

for (const kind of ["pie", "doughnut", "bubble"])
  for (const paint of ["gradient", "pattern"])
    for (const varyColors of [false, true])
      it(`${kind} own empty point uses the automatic palette with varyColors ${varyColors}, not the series paint`, () => {
        const f = chartSeriesFillDeck({
          kind,
          paint,
          pointPaint: "empty",
          pointIndex: 1,
        });
        rewrite(f, (_root, hosts) => {
          for (const { path } of hosts) {
            const group = path.at(-2),
              option = firstChildElement(
                group,
                qname("", "varyColors", NS.chart),
              );
            option.attrs = [
              { name: qname("", "val", ""), value: varyColors ? "1" : "0" },
            ];
          }
        });
        const view = chartRenderingView(f.shape),
          r = rendered(f);
        for (const [i, s] of view.seriesOpacities.entries()) {
          const expected =
            kind === "bubble"
              ? ["#4F81BD", "#C0504D", "#9BBB59"][i]
              : varyColors
                ? "#C0504D"
                : "#4F81BD";
          expect(s.pointBodies?.get(1)).toEqual({
            kind: "solid",
            color: expected,
            opacity: 1,
          });
          expect(
            r.visible.some(
              (e) =>
                attr(e, "fill") === expected && attr(e, "stroke") === "none",
            ),
          ).toBe(true);
        }
      });

function rewrite(f, update) {
  const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data));
  update(doc.root, nativeChartSeriesHosts(doc.root));
  part.data = new TextEncoder().encode(serializeXml(doc));
}
for (const kind of ["bar", "column"])
  for (const paint of ["gradient", "pattern"])
    it(`${kind} inverted ${paint} retains each color's independent alpha`, () => {
      const f = chartSeriesFillDeck({
        kind,
        paint,
        legend: { position: null },
        series: [{ ...signed, invertIfNegative: true }],
      });
      rewrite(f, (_root, hosts) => {
        const sp = firstChildElement(
            hosts[0].series,
            qname("", "spPr", NS.chart),
          ),
          native = firstChildElement(
            sp,
            qname("", paint === "gradient" ? "gradFill" : "pattFill", NS.dml),
          );
        let index = 0;
        const visit = (e) => {
          if (e.name.localName === "alpha")
            e.attrs = [
              {
                name: qname("", "val", ""),
                value: String(
                  (paint === "gradient"
                    ? [10000, 50000, 90000]
                    : [20000, 80000])[index++],
                ),
              },
            ];
          for (const c of e.children) if (c.kind === "element") visit(c);
        };
        visit(native);
        expect(index).toBe(paint === "gradient" ? 3 : 2);
      });
      const r = rendered(f),
        b = bars(r);
      for (const bar of [b[0], b[1]])
        expect(attr(bar, "fill")).toMatch(/^url\(#/);
      if (paint === "gradient") {
        // Unequal alpha uses complementary SVG layers. Their nonzero control
        // stops must still carry the complete original or inverted RGBA list.
        const retainedStops = (bar) => {
          const list = [];
          const visit = (e) => {
            if (e.name.localName === "linearGradient") {
              for (const stop of e.children.filter(
                (c) => c.kind === "element" && c.name.localName === "stop",
              )) {
                const opacity = Number(attr(stop, "stop-opacity") ?? 1);
                if (opacity > 0)
                  list.push([
                    Number(attr(stop, "offset")),
                    attr(stop, "stop-color"),
                    opacity,
                  ]);
              }
            } else {
              const fill = attr(e, "fill");
              if (fill?.startsWith("url(#"))
                visit(r.ids.get(fill.slice(5, -1)));
              for (const c of e.children) if (c.kind === "element") visit(c);
            }
          };
          visit(r.ids.get(attr(bar, "fill").slice(5, -1)));
          return list.sort((a, b) => a[0] - b[0]);
        };
        expect(retainedStops(b[1])).toEqual([
          [0, "#D5244B", 0.1],
          [0.35, "#F4C642", 0.5],
          [1, "#177FA7", 0.9],
        ]);
        expect(retainedStops(b[0])).toEqual([
          [0, "#177FA7", 0.9],
          [0.65, "#F4C642", 0.5],
          [1, "#D5244B", 0.1],
        ]);
      } else {
        const channels = (bar) => {
          const pattern = r.ids.get(attr(bar, "fill").slice(5, -1)),
            group = pattern.children.find(
              (e) => e.kind === "element" && e.name.localName === "g",
            ),
            filter = r.ids.get(attr(group, "filter").slice(5, -1));
          return ["fg", "bg"].map((channel) => {
            const flood = filter.children.find(
              (e) =>
                e.kind === "element" &&
                e.name.localName === "feFlood" &&
                attr(e, "result") === channel,
            );
            return [
              attr(flood, "flood-color"),
              Number(attr(flood, "flood-opacity")),
            ];
          });
        };
        expect(channels(b[1])).toEqual([
          ["#23AA88", 0.2],
          ["#661133", 0.8],
        ]);
        expect(channels(b[0])).toEqual([
          ["#661133", 0.8],
          ["#23AA88", 0.2],
        ]);
      }
    });
for (const pointIndex of [-1, "1.5", "bad", 4294967296, 4294967295])
  it(`full native paint ignores nonvisible sparse index ${pointIndex} without allocating holes`, () => {
    const f = chartSeriesFillDeck({ pointPaint: "pattern", pointIndex });
    expect(
      chartRenderingView(f.shape).seriesOpacities.every(
        (s) => s.pointBodies === undefined && s.pointLines === undefined,
      ),
    ).toBe(true);
    expect(rendered(f).svg).not.toMatch(/NaN|Infinity/);
  });

it("gradient and automatic point colors share chart-local color mapping and transforms", () => {
  const f = chartSeriesFillDeck({
    pointPaint: "empty",
    series: [signed],
    legend: { position: null },
  });
  rewrite(f, (root, hosts) => {
    root.children.push(
      parseXml(`<c:clrMapOvr xmlns:c="${NS.chart}" accent1="accent4"/>`).root,
    );
    const sp = firstChildElement(hosts[0].series, qname("", "spPr", NS.chart)),
      g = firstChildElement(sp, qname("", "gradFill", NS.dml)),
      list = firstChildElement(g, qname("", "gsLst", NS.dml));
    list.children.filter((e) => e.kind === "element")[0].children = [
      parseXml(
        `<a:schemeClr xmlns:a="${NS.dml}" val="accent1"><a:alpha val="25000"/></a:schemeClr>`,
      ).root,
    ];
  });
  const view = chartRenderingView(f.shape),
    r = rendered(f);
  expect(view.seriesOpacities[0].body.gradient.stops[0]).toMatchObject({
    color: "#8064A2",
    opacity: 0.25,
  });
  expect(view.seriesOpacities[0].pointBodies.get(1)).toEqual({
    kind: "solid",
    color: "#8064A2",
    opacity: 1,
  });
  expect(attr(bars(r)[1], "fill")).toBe("#8064A2");
});
for (const paint of ["gradient", "pattern"])
  it(`explicit RGB and point edits replace native ${paint} atomically, preserving untouched series`, () => {
    const f = chartSeriesFillDeck({ paint, pointPaint: "empty" }),
      chart = P.getSlideCharts(f.slide)[0],
      before = chartRenderingView(f.shape).seriesOpacities[1].body;
    P.setChartSpec(chart, {
      ...chart.spec,
      series: chart.spec.series.map((s, i) =>
        i ? s : { ...s, color: "#1199AA", pointColors: [null, "#AA8811"] },
      ),
    });
    const view = chartRenderingView(f.shape);
    expect(view.seriesOpacities[0].body).toEqual({
      kind: "solid",
      color: "#1199AA",
      opacity: 1,
    });
    expect(view.seriesOpacities[0].pointBodies.get(1)).toEqual({
      kind: "solid",
      color: "#AA8811",
      opacity: 1,
    });
    expect(view.seriesOpacities[1].body).toEqual(before);
    expect(rendered(f).svg).not.toMatch(/NaN|Infinity/);
  });

for (const paint of ["gradient", "pattern"])
  it(`mixed plot filtering retains native ${paint} identity and original automatic point palette`, () => {
    const f = chartSeriesFillDeck({
        paint,
        pointPaint: "empty",
        pointIndex: 1,
        legend: { position: null },
        series: [
          { ...signed, name: "Line", chartKind: "line" },
          { ...signed, name: "Primary", chartKind: "column" },
          {
            ...signed,
            name: "Secondary",
            chartKind: "column",
            secondaryAxis: true,
          },
        ],
      }),
      r = rendered(f),
      b = bars(r);
    expect(b).toHaveLength(6);
    for (const color of ["#C0504D", "#9BBB59"])
      expect(b.filter((e) => attr(e, "fill") === color)).toHaveLength(1);
    expect(b.filter((e) => attr(e, "fill")?.startsWith("url"))).toHaveLength(4);
    expect(P.getShapeChartSpec(f.shape).series.map((s) => s.color)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
it("empty paint geometry has finite empty bounds", () => {
  expect(chartPointBounds([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  expect(chartAreaPathBounds("")).toEqual({ x: 0, y: 0, w: 0, h: 0 });
});

for (const index of [0, 1, 2])
  for (const order of [0, 2])
    it(`automatic point color follows native series idx ${index}, independently of order ${order}`, () => {
      const f = chartSeriesFillDeck({
        pointPaint: "empty",
        pointIndex: 1,
        series: [
          signed,
          { ...signed, name: "Other" },
          { ...signed, name: "Third" },
        ],
      });
      rewrite(f, (_root, hosts) => {
        for (const [at, { series }] of hosts.entries())
          for (const [tag, value] of [
            ["idx", (index + at) % 3],
            ["order", (order + at) % 3],
          ])
            firstChildElement(series, qname("", tag, NS.chart)).attrs = [
              { name: qname("", "val", ""), value: String(value) },
            ];
      });
      expect(
        chartRenderingView(f.shape).seriesOpacities[0].pointBodies?.get(1),
      ).toMatchObject({
        kind: "solid",
        color: ["#4F81BD", "#C0504D", "#9BBB59"][index],
      });
    });
