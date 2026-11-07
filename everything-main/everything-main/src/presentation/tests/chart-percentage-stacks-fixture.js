import { P } from "../src/model.js";
import { chartLegendLayoutDeck, chartRoot } from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

export const percentageColors = ["#E85239", "#316BB0", "#2F8541"];
export function chartPercentageStacksDeck({
  kind = "column",
  direction = "minMax",
  values = [
    [1, -2, 3],
    [-3, 2, -1],
  ],
  axis = { min: -1, max: 1, majorUnit: 0.25 },
  ...options
} = {}) {
  return chartLegendLayoutDeck({
    kind,
    grouping: "percentStacked",
    categories: Array.from(
      { length: Math.max(...values.map((v) => v.length)) },
      (_, i) => `Category ${i + 1}`,
    ),
    series: values.map((values, i) => ({
      name: `Series ${i + 1}`,
      values,
      color: percentageColors[i % percentageColors.length],
      lineColor: percentageColors[i % percentageColors.length],
      lineWidthEmu: 25400,
      invertIfNegative: false,
      markerSymbol: "circle",
      markerSizePt: 8,
      markerFill: percentageColors[i % percentageColors.length],
    })),
    legend: { position: null },
    categoryAxisTickLabelPos: "none",
    categoryAxisLineColor: null,
    valueAxisTickLabelPos: "low",
    categoryAxisLabelRotationDeg: 0,
    valueAxisLabelRotationDeg: 0,
    valueAxisLabelStyle: { font: "Arial", sizePt: 9, color: "#17589B" },
    valueAxisOrientation: direction,
    valueAxisMajorGridlines: true,
    valueAxisMajorGridlineColor: "#9152BD",
    valueAxis: axis,
    ...options,
  });
}

export function chartPercentageComboDeck({
  secondary = false,
  ...options
} = {}) {
  const f = chartPercentageStacksDeck({
    ...options,
    kind: "column",
    series: [
      {
        name: "Column one",
        values: [1, -2, 3],
        color: "#E85239",
        invertIfNegative: false,
      },
      {
        name: "Column two",
        values: [-3, 2, -1],
        color: "#316BB0",
        invertIfNegative: false,
      },
      ...[
        [-5, 4, -2],
        [1, -1, 6],
      ].map((values, i) => ({
        name: `Line ${i + 1}`,
        values,
        chartKind: "line",
        secondaryAxis: secondary,
        lineColor: ["#882266", "#CC8800"][i],
        markerSymbol: "circle",
        markerSizePt: 8,
      })),
    ],
  });
  if (secondary) {
    // Secondary bounds have no authoring projection yet. Supply valid native
    // axis declarations and exercise their preserved rendering projection.
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
        `<c:wrapper xmlns:c="${NS.chart}"><c:max val="0.6"/><c:min val="-0.6"/></c:wrapper>`,
      ).root.children,
    );
    const unit = child(axis, "majorUnit");
    if (unit) unit.attrs[0].value = "0.3";
    else
      axis.children.push(
        ...parseXml(
          `<c:wrapper xmlns:c="${NS.chart}"><c:majorUnit val="0.3"/></c:wrapper>`,
        ).root.children,
      );
    part.data = new TextEncoder().encode(serializeXml(doc));
  }
  return f;
}
