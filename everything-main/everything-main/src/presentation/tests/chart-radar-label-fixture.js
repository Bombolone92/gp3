import { P } from "../src/model.js";
import { chartLegendLayoutDeck, chartRoot } from "./chart-copy-fixture.js";
import {
  NS,
  firstChildElement,
  parseXml,
  qname,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";

export const radarCategories = [
  "Operating income",
  'ABCDEFGHIJé👩‍👩‍👧‍👦 <&> "net"',
  "Cost … projection",
  "Customer support",
];
export const radarLabelColor = "#604020";

// The public authoring API does not create radar charts. Convert the native
// line plot's group to the corresponding schema-shaped radar group while
// retaining its independently authored caches, text styles and workbook.
export function chartRadarLabelDeck({
  radarStyle = "standard",
  ...options
} = {}) {
  const f = chartLegendLayoutDeck({
    kind: "line",
    legend: undefined,
    categories: radarCategories,
    categoryAxisLabelRotationDeg: 0,
    categoryAxisLabelStyle: {
      font: "Arial",
      sizePt: 12,
      color: radarLabelColor,
    },
    series: [
      { name: "Units", values: [2, 4, 3, 5], color: "#E85239" },
      { name: "Plan", values: [4, 3, 5, 2], color: "#316BB0" },
    ],
    lineMarkers: radarStyle === "marker",
    ...options,
  });
  const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data)),
    child = (e, n) => firstChildElement(e, qname("c", n, NS.chart)),
    group = child(child(child(doc.root, "chart"), "plotArea"), "lineChart"),
    style = child(group, "grouping");
  group.name = qname("c", "radarChart", NS.chart);
  style.name = qname("c", "radarStyle", NS.chart);
  style.attrs[0].value = radarStyle;
  group.children = group.children.filter(
    (e) =>
      e.kind !== "element" || !["marker", "smooth"].includes(e.name.localName),
  );
  for (const series of group.children.filter(
    (e) => e.kind === "element" && e.name.localName === "ser",
  ))
    series.children = series.children.filter(
      (e) => e.kind !== "element" || e.name.localName !== "smooth",
    );
  part.data = new TextEncoder().encode(serializeXml(doc));
  return f;
}
