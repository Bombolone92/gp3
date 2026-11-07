import { P } from "../src/model.js";
import { chartRadarLabelDeck } from "./chart-radar-label-fixture.js";
import { chartRoot } from "./chart-copy-fixture.js";
import { nativeChartSeriesHosts } from "../lib/pptx/src/internal/chartml/native-data.ts";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

export const radarDataLabelColor = "#AF2568";
export const radarAlternateLabelColor = "#663399";

// Point labels have no public authoring API. Retain their native XML while
// exercising the same import, rendering, transfer and save paths as real files.
export function withRadarPointLabels(f, points, { deleted, series = 0 } = {}) {
  const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data)),
    host = nativeChartSeriesHosts(doc.root)[series].series;
  let labels = firstChildElement(host, qname("c", "dLbls", NS.chart));
  if (!labels) {
    labels = parseXml(
      `<c:dLbls xmlns:c="${NS.chart}"><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/></c:dLbls>`,
    ).root;
    const at = host.children.findIndex(
      (e) =>
        e.kind === "element" &&
        ["cat", "val", "xVal", "yVal"].includes(e.name.localName),
    );
    host.children.splice(at, 0, labels);
  }
  const records = points.map(
    ({ index, xml }) =>
      parseXml(
        `<c:dLbl xmlns:c="${NS.chart}" xmlns:a="${NS.dml}"><c:idx val="${index}"/>${xml}</c:dLbl>`,
      ).root,
  );
  if (deleted !== undefined)
    records.push(
      parseXml(`<c:delete xmlns:c="${NS.chart}" val="${deleted ? 1 : 0}"/>`)
        .root,
    );
  labels.children.unshift(...records);
  part.data = new TextEncoder().encode(serializeXml(doc));
  return f;
}

export function chartRadarDataLabelDeck({
  radarStyle = "marker",
  count = 5,
  sizePt = 12,
  ...options
} = {}) {
  return chartRadarLabelDeck({
    radarStyle,
    categories: Array.from({ length: count }, (_, i) =>
      String.fromCharCode(65 + i),
    ),
    series: [
      {
        name: "Signal",
        values: Array.from({ length: count }, (_, i) => 2 + (i * 8) / count),
        color: "#E85239",
        markerSymbol: "circle",
        markerSizePt: 6,
      },
    ],
    dataLabels: {
      showValue: true,
      showCategory: false,
      showSeriesName: false,
      showPercent: false,
      numberFormat: "0.0",
      numberFormatSourceLinked: false,
      textStyle: { font: "Arial", sizePt, color: radarDataLabelColor },
    },
    showDataLabelsOverMaximum: true,
    categoryAxisLabelStyle: { font: "Arial", sizePt: 12, color: "#604020" },
    valueAxisLabelStyle: { font: "Arial", sizePt: 12, color: "#2468AC" },
    valueAxis: { min: 0, max: 10, majorUnit: 2 },
    ...options,
  });
}

export function chartRadarDataLabelPair(radarStyle, mode) {
  const common = { radarStyle },
    labels = {
      showValue: true,
      showCategory: false,
      showSeriesName: false,
      showPercent: false,
      numberFormat: "0.0",
      numberFormatSourceLinked: false,
      textStyle: { font: "Arial", sizePt: 12, color: radarDataLabelColor },
    };
  if (mode === "range") {
    common.series = [
      { name: "Signal", values: [-5, 0, null, 10, 15], color: "#E85239" },
    ];
  } else if (mode === "combined") {
    common.categories = ["A<&>", "B", "C", "D", "E"];
    labels.showCategory = true;
    labels.showSeriesName = true;
    labels.separator = " | ";
  }
  const first = chartRadarDataLabelDeck({
      ...common,
      dataLabels: labels,
      showDataLabelsOverMaximum: mode !== "range",
    }),
    secondLabels = {
      ...labels,
      textStyle: {
        font: "Arial",
        sizePt: 12,
        italic: true,
        color: radarAlternateLabelColor,
      },
      ...(mode === "combined" ? { separator: "\n" } : {}),
    },
    second = chartRadarDataLabelDeck({
      ...common,
      dataLabels: labels,
      series: [
        {
          ...P.getShapeChartSpec(first.shape).series[0],
          dataLabels:
            mode === "value"
              ? { ...secondLabels, showValue: false, showCategory: true }
              : secondLabels,
        },
      ],
    });
  P.setShapePosition(first.shape, P.pt(30), P.pt(70));
  P.setShapeSize(first.shape, P.pt(430), P.pt(390));
  P.setShapePosition(second.shape, P.pt(500), P.pt(70));
  P.setShapeSize(second.shape, P.pt(430), P.pt(390));
  const imported = P.importSlide(
    first.p,
    second.slide,
    P.getSlideLayout(first.slide),
    { preservePaintFormatting: true, preserveTextFormatting: true },
  );
  P.copyShape(first.slide, P.getSlideCharts(imported)[0].shape);
  P.removeSlide(first.p, imported);
  return first;
}
