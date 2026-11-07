import { expect, it } from "vitest";
import { P } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  chartLegendLayoutDeck,
  chartMarkerPaintDeck,
  chartRoot,
} from "./chart-copy-fixture.js";
import {
  NS,
  firstChildElement,
  getAttrValue,
  parseXml,
  qname,
  serializeXml,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";

const C = "#A3472B",
  V = "#9152BD",
  G = "#167E9B",
  D = "#2051BB";
const seriesColors = ["#E85239", "#2F8541", "#376CA8"];
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
function fixture(kind, direction, grouping = "clustered", extra = {}) {
  return chartLegendLayoutDeck({
    kind,
    grouping,
    legend: undefined,
    sizePt: 18,
    categories: ["First", "Second", "Third", "Fourth"],
    series: [
      { name: "Alpha", values: [2, 6, 3, 5], color: seriesColors[0] },
      { name: "Beta", values: [5, 3, 6, 2], color: seriesColors[1] },
    ],
    valueAxis: {
      min: 0,
      max: grouping === "percentStacked" ? 1 : 10,
      majorUnit: grouping === "percentStacked" ? 0.25 : 2,
    },
    categoryAxisCrosses: { at: grouping === "percentStacked" ? 0.5 : 4 },
    valueAxisCrosses: { at: 2.5 },
    categoryAxisOrientation: direction,
    valueAxisOrientation: direction,
    categoryAxisLineColor: C,
    valueAxisLineColor: V,
    categoryAxisMajorTickMark: "cross",
    valueAxisMajorTickMark: "cross",
    valueAxisMajorGridlines: true,
    valueAxisMajorGridlineColor: G,
    categoryAxisLabelStyle: { font: "Arial", sizePt: 18, color: C },
    valueAxisLabelStyle: { font: "Arial", sizePt: 18, color: V },
    dataLabels: {
      showValue: true,
      ...(kind === "area" ? {} : { position: "ctr" }),
      textStyle: { color: D, sizePt: 24 },
    },
    ...extra,
  });
}
function paint(f) {
  const nodes = [];
  walkElements(parseXml(renderSlideToSvg(f.p, f.slide)).root, (e) =>
    nodes.push(e),
  );
  const indices = (predicate) =>
    nodes.flatMap((e, i) => (predicate(e) ? [i] : []));
  const isText = (e) => e.name.localName === "text";
  return {
    grids: indices((e) => attr(e, "stroke") === G),
    axes: indices(
      (e) =>
        e.name.localName === "line" &&
        [C, V, "#DF9031"].includes(attr(e, "stroke")),
    ),
    labels: indices((e) => isText(e) && [C, V].includes(attr(e, "fill"))),
    data: indices((e) => isText(e) && attr(e, "fill") === D),
    fills: indices((e) => !isText(e) && seriesColors.includes(attr(e, "fill"))),
    lines: indices(
      (e) =>
        e.name.localName === "path" &&
        attr(e, "fill") === "none" &&
        seriesColors.includes(attr(e, "stroke")),
    ),
    points: indices(
      (e) =>
        !isText(e) &&
        ["#116699", "#D9B231", "#CC3344"].some(
          (c) => attr(e, "fill") === c || attr(e, "stroke") === c,
        ),
    ),
    columns: indices(
      (e) => e.name.localName === "rect" && attr(e, "fill") === seriesColors[0],
    ),
    lineSeries: indices(
      (e) =>
        !isText(e) &&
        (attr(e, "fill") === seriesColors[1] ||
          attr(e, "stroke") === seriesColors[1]),
    ),
  };
}
function before(a, b) {
  expect(a.length).toBeGreaterThan(0);
  expect(b.length).toBeGreaterThan(0);
  expect(Math.max(...a)).toBeLessThan(Math.min(...b));
}
// The native reference order is gridlines, filled plots, axis strokes,
// line/marker/bubble plots, data labels, then axis labels. In particular,
// interior nextTo labels remain legible over opaque series and data labels.
for (const kind of ["column", "bar", "line", "area"])
  for (const direction of ["minMax", "maxMin"])
    for (const grouping of ["clustered", "stacked", "percentStacked"])
      it(`${kind} ${direction} ${grouping} uses separate grid, series, axis and label layers`, () => {
        const r = paint(fixture(kind, direction, grouping));
        const bodies = kind === "line" ? [...r.lines, ...r.fills] : r.fills;
        before(r.grids, [...bodies, ...r.axes]);
        before(
          kind === "line" ? r.axes : bodies,
          kind === "line" ? bodies : r.axes,
        );
        before([...bodies, ...r.axes], r.data);
        before(r.data, r.labels);
      });
for (const direction of ["minMax", "maxMin"])
  for (const secondaryAxis of [false, true])
    it(`column/line combo ${direction}, secondary=${secondaryAxis}, shares label layers across groups`, () => {
      const r = paint(
        fixture("column", direction, "clustered", {
          secondaryValueAxisLineColor: "#DF9031",
          series: [
            { name: "Columns", values: [2, 6, 3, 5], color: seriesColors[0] },
            {
              name: "Lines",
              values: [5, 3, 6, 2],
              color: seriesColors[1],
              chartKind: "line",
              secondaryAxis,
            },
          ],
        }),
      );
      before(r.grids, r.columns);
      before(r.columns, r.axes);
      before(r.axes, r.lineSeries);
      before([...r.columns, ...r.lineSeries], r.data);
      before(r.data, r.labels);
    });
for (const kind of ["scatter", "bubble"])
  for (const direction of ["minMax", "maxMin"])
    it(`${kind} ${direction} draws both numeric grids below points and labels above them`, () => {
      const f = chartMarkerPaintDeck("scatter");
      const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape));
      const doc = parseXml(new TextDecoder().decode(part.data));
      const child = (e, n) => firstChildElement(e, qname("c", n, NS.chart));
      const chart = child(doc.root, "chart"),
        area = child(chart, "plotArea");
      chart.children = chart.children.filter(
        (e) => e !== child(chart, "legend"),
      );
      for (const [i, axis] of area.children
        .filter((e) => e.kind === "element" && e.name.localName === "valAx")
        .entries()) {
        const color = (i === 0 ? C : V).slice(1);
        axis.children = axis.children.filter(
          (e) =>
            e.kind !== "element" ||
            !["spPr", "txPr", "majorGridlines", "tickLblPos"].includes(
              e.name.localName,
            ),
        );
        child(child(axis, "scaling"), "orientation").attrs[0].value = direction;
        for (const xml of [
          `<c:majorGridlines><c:spPr><a:ln><a:solidFill><a:srgbClr val="${G.slice(1)}"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>`,
          `<c:tickLblPos val="nextTo"/>`,
          `<c:spPr><a:ln><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr>`,
          `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1800"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:pPr></a:p></c:txPr>`,
        ])
          axis.children.push(
            parseXml(
              `<c:wrapper xmlns:c="${NS.chart}" xmlns:a="${NS.dml}">${xml}</c:wrapper>`,
            ).root.children[0],
          );
      }
      if (kind === "bubble") {
        const group = child(area, "scatterChart");
        group.name = qname("c", "bubbleChart", NS.chart);
        group.children = group.children.filter(
          (e) => e.kind !== "element" || e.name.localName !== "scatterStyle",
        );
        for (const ser of group.children.filter(
          (e) => e.kind === "element" && e.name.localName === "ser",
        )) {
          ser.children = ser.children.filter(
            (e) =>
              e.kind !== "element" ||
              !["marker", "smooth"].includes(e.name.localName),
          );
          const size = structuredClone(child(ser, "yVal"));
          size.name = qname("c", "bubbleSize", NS.chart);
          ser.children.push(size);
        }
      }
      part.data = new TextEncoder().encode(serializeXml(doc));
      const r = paint(f),
        bodies = kind === "bubble" ? r.fills : [...r.lines, ...r.points];
      before(r.grids, r.axes);
      before(r.axes, bodies);
      before(bodies, r.labels);
    });
