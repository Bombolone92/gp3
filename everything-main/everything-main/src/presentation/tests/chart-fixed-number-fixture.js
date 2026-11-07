import { P } from "../src/model.js";
import { chartLegendLayoutDeck, chartRoot } from "./chart-copy-fixture.js";
import { chartRadarLabelDeck } from "./chart-radar-label-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";

// Native reference controls use the same formats for axes and data labels.
export const fixedNumberFormats = [
  ["0", "-12346", "0", "12346", "17500"],
  ["0.00", "-12345.60", "0.00", "12345.60", "17500.00"],
  ["#,##0", "-12,346", "0", "12,346", "17,500"],
  ["#,##0.00", "-12,345.60", "0.00", "12,345.60", "17,500.00"],
  ["$0.00", "-$12345.60", "$0.00", "$12345.60", "$17500.00"],
  ["$#,##0.00", "-$12,345.60", "$0.00", "$12,345.60", "$17,500.00"],
  ['"USD "0.00', "-USD 12345.60", "USD 0.00", "USD 12345.60", "USD 17500.00"],
  [
    '"USD "#,##0.00',
    "-USD 12,345.60",
    "USD 0.00",
    "USD 12,345.60",
    "USD 17,500.00",
  ],
  ['0.00" kg"', "-12345.60 kg", "0.00 kg", "12345.60 kg", "17500.00 kg"],
  ['#,##0.00" kg"', "-12,345.60 kg", "0.00 kg", "12,345.60 kg", "17,500.00 kg"],
  ['"a,b "0.00', "-a,b 12345.60", "a,b 0.00", "a,b 12345.60", "a,b 17500.00"],
  ['0.00" a,b"', "-12345.60 a,b", "0.00 a,b", "12345.60 a,b", "17500.00 a,b"],
  ["0,000.00", "-12,345.60", "0,000.00", "12,345.60", "17,500.00"],
  ["0,000", "-12,346", "0,000", "12,346", "17,500"],
  ["0.00,", "-12.35", "0.00", "12.35", "17.50"],
  ["0.00\\,", "-12345.60,", "0.00,", "12345.60,", "17500.00,"],
];

export const fixedNumberAxisMaximums = [
  "20000",
  "20000.00",
  "20,000",
  "20,000.00",
  "$20000.00",
  "$20,000.00",
  "USD 20000.00",
  "USD 20,000.00",
  "20000.00 kg",
  "20,000.00 kg",
  "a,b 20000.00",
  "20000.00 a,b",
  "20,000.00",
  "20,000",
  "20.00",
  "20000.00,",
];

export function chartFixedNumberDeck({
  kind = "column",
  format = "0.00",
  linked = false,
  source = "#,##0.00",
} = {}) {
  const options = {
    categories: ["-12345.6", "0", "12345.6", "17500"],
    categoryNumberFormat: format,
    categoryAxisNumberFormat: format,
    categoryAxisNumberFormatSourceLinked: false,
    legend:
      kind === "pie" || kind === "doughnut" ? { position: "r" } : undefined,
    valueAxis: {
      min: -20000,
      max: 20000,
      majorUnit: 10000,
      numberFormat: format,
      numberFormatSourceLinked: linked,
    },
    valueAxisLabelStyle: { font: "Arial", sizePt: 12, color: "#2468AC" },
    dataLabels: {
      showValue: true,
      numberFormat: format,
      numberFormatSourceLinked: linked,
      textStyle: { font: "Arial", sizePt: 12, color: "#AF2568" },
    },
    series: [
      {
        name: "Amount",
        values: [-12345.6, 0, 12345.6, 17500],
        numberFormat: linked ? source : format,
        color: "#E85239",
      },
    ],
  };
  return kind === "radar"
    ? chartRadarLabelDeck({ ...options, radarStyle: "marker" })
    : chartLegendLayoutDeck({ ...options, kind });
}

export function chartFixedNumberPair(kind, linked, implicit = false) {
  const first = chartFixedNumberDeck({
    kind,
    linked,
    format: "0.00",
    source: "#,##0.00",
  });
  const second = chartFixedNumberDeck({
    kind,
    linked,
    format: "#,##0.00",
    source: "0.00",
  });
  P.setShapePosition(first.shape, P.pt(30), P.pt(70));
  P.setShapeSize(first.shape, P.pt(430), P.pt(390));
  P.setShapePosition(second.shape, P.pt(500), P.pt(70));
  P.setShapeSize(second.shape, P.pt(430), P.pt(390));
  const imported = P.importSlide(
    first.p,
    second.slide,
    P.getSlideLayout(first.slide),
    {
      preservePaintFormatting: true,
      preserveTextFormatting: true,
    },
  );
  P.copyShape(first.slide, P.getSlideCharts(imported)[0].shape);
  P.removeSlide(first.p, imported);
  if (implicit)
    for (const chart of P.getSlideCharts(first.slide)) {
      // Match native omitted-numFmt input, including radar groups which the
      // public authoring API currently treats as read-only.
      const part = P._internalPackageOf(first.p).getPart(
        chartRoot(chart.shape),
      );
      const doc = parseXml(new TextDecoder().decode(part.data));
      walkElements(doc.root, (e) => {
        if (e.name.namespaceURI === NS.chart && e.name.localName === "dLbls")
          e.children = e.children.filter(
            (c) =>
              c.kind !== "element" ||
              c.name.namespaceURI !== NS.chart ||
              c.name.localName !== "numFmt",
          );
      });
      part.data = new TextEncoder().encode(serializeXml(doc));
    }
  return first;
}
