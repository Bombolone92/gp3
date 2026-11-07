import { P } from "../src/model.js";
import { chartSeriesOpacityDeck } from "./chart-series-opacity-fixture.js";
import { chartRoot } from "./chart-copy-fixture.js";
import { nativeChartSeriesHosts } from "../lib/pptx/src/internal/chartml/native-data.ts";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

const child = (e, n, ns = NS.chart) =>
  e && firstChildElement(e, qname("", n, ns));
const choices = new Set([
  "noFill",
  "solidFill",
  "gradFill",
  "pattFill",
  "blipFill",
  "grpFill",
]);

// Explicit noFill is different from both an absent style and solid alpha zero.
// Keep all independent outline/marker metadata in the editable native chart.
export function chartNoFillDeck({
  fill = "none",
  pointFill,
  pointIndex = 1,
  markerFill,
  ...options
} = {}) {
  const f = chartSeriesOpacityDeck({
      ...options,
      ...(pointFill === "solid" ? { pointOpacity: 0.25, pointIndex } : {}),
    }),
    part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data));
  const fragment = (xml) =>
    parseXml(`<r xmlns:a="${NS.dml}" xmlns:c="${NS.chart}">${xml}</r>`).root
      .children;
  const change = (host, value) => {
    if (!host || value === undefined || value === "solid") return;
    host.children = host.children.filter(
      (e) =>
        e.kind !== "element" ||
        e.name.namespaceURI !== NS.dml ||
        !choices.has(e.name.localName),
    );
    if (value === "none") host.children.unshift(...fragment("<a:noFill/>"));
  };
  for (const { series } of nativeChartSeriesHosts(doc.root)) {
    change(child(series, "spPr"), fill);
    change(child(child(series, "marker"), "spPr"), markerFill);
    if (pointFill === "none") {
      const point = fragment(
        `<c:dPt><c:idx val="${pointIndex}"/><c:spPr><a:noFill/></c:spPr></c:dPt>`,
      )[0];
      const at = series.children.findIndex(
        (e) =>
          e.kind === "element" &&
          ["cat", "val", "xVal", "yVal"].includes(e.name.localName),
      );
      series.children.splice(at < 0 ? series.children.length : at, 0, point);
    }
  }
  part.data = new TextEncoder().encode(serializeXml(doc));
  return f;
}
