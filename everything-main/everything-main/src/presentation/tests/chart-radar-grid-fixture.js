import { P } from "../src/model.js";
import { chartRadarLabelDeck } from "./chart-radar-label-fixture.js";
import { chartRoot } from "./chart-copy-fixture.js";
import { setChartAxisGridDeclarations } from "./chart-axis-grid-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  qname,
  firstChildElement,
} from "../lib/pptx/src/internal/xml/index.ts";

export const radarGridColors = {
  value: "#C32032",
  category: "#193CB0",
  major: "#0A7C45",
  minor: "#8C43B8",
};
export const radarGridLine = (color, width = 19050) =>
  `<a:ln w="${width}"><a:solidFill><a:srgbClr val="${color.slice(1)}"/></a:solidFill></a:ln>`;

// Native radar declarations, independent from the renderer and its automatic
// defaults. The editable caches and embedded workbook come from the line fixture.
export function chartRadarGridDeck({
  radarStyle = "marker",
  n = 5,
  axes = {},
  valueLine,
  ...options
} = {}) {
  const f = chartRadarLabelDeck({
    radarStyle,
    categories: Array.from({ length: n }, (_, i) => `Category ${i + 1}`),
    valueAxis: { min: 0, max: 8, majorUnit: 2, minorUnit: 0.5 },
    valueAxisLabelStyle: { font: "Arial", sizePt: 12, color: "#2468AC" },
    valueAxisLineColor: radarGridColors.value,
    valueAxisLineWidthEmu: 19050,
    categoryAxisLineColor: radarGridColors.category,
    series: [
      {
        name: "Data",
        values: Array.from({ length: n }, (_, i) => 1 + (i % 6)),
        color: "#AA9988",
      },
    ],
    ...options,
  });
  setChartAxisGridDeclarations(f, {
    value: {
      major: false,
      minor: false,
      majorTickMark: "none",
      minorTickMark: "none",
      ...axes.value,
    },
    category: {
      major: false,
      minor: false,
      majorTickMark: "none",
      minorTickMark: "none",
      ...axes.category,
    },
  });
  if (valueLine) {
    const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
      doc = parseXml(new TextDecoder().decode(part.data)),
      child = (e, n, ns = NS.chart) => firstChildElement(e, qname("", n, ns)),
      axis = child(child(child(doc.root, "chart"), "plotArea"), "valAx"),
      sp = child(axis, "spPr");
    sp.children = sp.children.filter(
      (e) =>
        e.kind !== "element" ||
        e.name.namespaceURI !== NS.dml ||
        e.name.localName !== "ln",
    );
    sp.children.push(
      parseXml(`<w xmlns:a="${NS.dml}">${valueLine}</w>`).root.children[0],
    );
    part.data = new TextEncoder().encode(serializeXml(doc));
  }
  return f;
}
