import { P } from "../src/model.js";
import { chartLegendLayoutDeck, chartRoot } from "./chart-copy-fixture.js";
import { chartCacheAvailabilityDeck } from "./chart-cache-availability-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

export const clippingColors = {
  series: "#E85239",
  outline: "#1155AA",
  marker: "#00AA66",
  labels: "#7B1269",
  plot: "#ECF5E9",
};
export function chartSeriesClippingDeck({
  kind = "column",
  direction = "minMax",
  grouping = "clustered",
  crossBetween = "between",
  smooth = false,
  secondary = false,
  markerSizePt = 14,
  ...options
} = {}) {
  const percent = grouping === "percentStacked";
  const f = chartLegendLayoutDeck({
    kind,
    grouping,
    sizePt: 10,
    categories: ["Below", "Lower", "Zero", "Upper", "Above"],
    legend: { position: "b", textStyle: { font: "Arial", sizePt: 10 } },
    valueAxis: { min: percent ? 0 : -2, max: percent ? 1 : 2 },
    valueAxisOrientation: direction,
    secondaryValueAxisOrientation: direction,
    categoryAxisOrientation: direction,
    valueAxisCrossBetween: crossBetween,
    valueAxisMajorGridlines: false,
    plotAreaStrokeColor: null,
    showDataLabelsOverMaximum: true,
    dataLabels: {
      showValue: true,
      ...(kind === "area" ? {} : { position: "ctr" }),
      textStyle: { font: "Arial", sizePt: 10, color: clippingColors.labels },
    },
    series: [
      {
        name: "Clipped",
        values: percent ? [1, 2, 3, 4, 5] : [-5, -2, 0, 2, 5],
        color: clippingColors.series,
        invertIfNegative: false,
        lineColor: clippingColors.outline,
        lineWidthEmu: 101600,
        markerSymbol: "circle",
        markerSizePt,
        markerFill: clippingColors.marker,
        markerStrokeColor: null,
        smooth,
      },
      ...(grouping !== "clustered" || secondary
        ? [
            {
              name: "Other",
              values: secondary
                ? [-12, -2, 2, 6, 14]
                : percent
                  ? [5, 4, 3, 2, 1]
                  : [-3, -1, 1, 3, 6],
              color: "#316BB0",
              invertIfNegative: false,
              markerSymbol: "circle",
              markerFill: "#CC8800",
              markerSizePt,
              ...(secondary ? { chartKind: "line", secondaryAxis: true } : {}),
            },
          ]
        : []),
    ],
    ...options,
  });
  if (secondary) {
    const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
      doc = parseXml(new TextDecoder().decode(part.data)),
      child = (e, n) => firstChildElement(e, qname("c", n, NS.chart)),
      area = child(child(doc.root, "chart"), "plotArea"),
      axis = area.children
        .filter((e) => e.kind === "element" && e.name.localName === "valAx")
        .at(-1),
      scale = child(axis, "scaling");
    scale.children = scale.children.filter(
      (e) => e.kind !== "element" || !["min", "max"].includes(e.name.localName),
    );
    scale.children.push(
      ...parseXml(
        `<c:wrapper xmlns:c="${NS.chart}"><c:max val="4"/><c:min val="-4"/></c:wrapper>`,
      ).root.children,
    );
    part.data = new TextEncoder().encode(serializeXml(doc));
  }
  return f;
}

// Scatter/bubble remain read-only chart kinds. Author valid native numeric
// channels and scaling without rebuilding their independent embedded workbook.
export function chartXYClippingDeck({
  kind = "scatter",
  direction = "minMax",
  size = 72,
  xBounds = [1.05, 3.95],
  yBounds = [2, 4.2],
} = {}) {
  const f = chartCacheAvailabilityDeck({ kind, indices: [] }),
    part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data)),
    child = (e, n) => firstChildElement(e, qname("c", n, NS.chart)),
    fragment = (xml) =>
      parseXml(`<c:wrapper xmlns:c="${NS.chart}">${xml}</c:wrapper>`).root
        .children,
    area = child(child(doc.root, "chart"), "plotArea"),
    group = child(area, kind + "Chart");
  if (kind === "scatter")
    child(group, "scatterStyle").attrs[0].value = "lineMarker";
  else {
    group.children = group.children.filter(
      (e) => e.kind !== "element" || e.name.localName !== "bubbleScale",
    );
    group.children.splice(
      group.children.findIndex(
        (e) => e.kind === "element" && e.name.localName === "axId",
      ),
      0,
      ...fragment(`<c:bubbleScale val="200"/>`),
    );
  }
  for (const [i, axis] of area.children
    .filter((e) => e.kind === "element" && e.name.localName === "valAx")
    .entries()) {
    const scale = child(axis, "scaling"),
      [min, max] = i ? yBounds : xBounds;
    child(scale, "orientation").attrs[0].value = direction;
    scale.children = scale.children.filter(
      (e) => e.kind !== "element" || !["min", "max"].includes(e.name.localName),
    );
    scale.children.push(
      ...fragment(`<c:max val="${max}"/><c:min val="${min}"/>`),
    );
  }
  for (const ser of group.children.filter(
    (e) => e.kind === "element" && e.name.localName === "ser",
  )) {
    const marker = child(ser, "marker");
    if (marker) child(marker, "size").attrs[0].value = String(size);
  }
  part.data = new TextEncoder().encode(serializeXml(doc));
  return f;
}
