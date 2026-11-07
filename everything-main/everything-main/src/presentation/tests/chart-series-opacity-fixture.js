import { P } from "../src/model.js";
import { chartLegendLayoutDeck, chartRoot } from "./chart-copy-fixture.js";
import { chartCacheAvailabilityDeck } from "./chart-cache-availability-fixture.js";
import { nativeChartSeriesHosts } from "../lib/pptx/src/internal/chartml/native-data.ts";
import { invertedSolidFillHost } from "../lib/pptx/src/internal/chartml/inversion.ts";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
const child = (e, n, ns = NS.chart) =>
  e && firstChildElement(e, qname("", n, ns));

// Alpha is native DrawingML metadata, separate from the API's editable RGB
// projection. XY/radar authoring remains read-only, as in the cache fixtures.
export function chartSeriesOpacityDeck({
  kind = "column",
  opacity = 0.35,
  lineOpacity = 0.7,
  markerFillOpacity = 0.2,
  markerStrokeOpacity = 0.6,
  negativeOpacity = 0.4,
  pointOpacity,
  pointIndex = 1,
  ...options
} = {}) {
  const f = ["scatter", "bubble", "radar"].includes(kind)
    ? chartCacheAvailabilityDeck({ kind, indices: [] })
    : chartLegendLayoutDeck({
        kind,
        legend: { position: "r" },
        categories: ["A", "B", "C"],
        series: [
          {
            name: "First",
            values: [2, 5, 3],
            color: "#E85239",
            lineColor: "#316BB0",
            lineWidthEmu: 50800,
            invertIfNegative: false,
            negativeColor: "#00AA77",
            markerSymbol: "circle",
            markerSizePt: 14,
            markerFill: "#AA6633",
            markerStrokeColor: "#226699",
            markerStrokeWidthEmu: 25400,
          },
          ...(["pie", "doughnut"].includes(kind)
            ? []
            : [
                {
                  name: "Other",
                  values: [4, 1, 6],
                  color: "#316BB0",
                  lineColor: "#E85239",
                  lineWidthEmu: 25400,
                  invertIfNegative: false,
                  markerSymbol: "square",
                  markerSizePt: 10,
                },
              ]),
        ],
        ...options,
      });
  const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data));
  const fragment = (xml) =>
    parseXml(`<r xmlns:a="${NS.dml}" xmlns:c="${NS.chart}">${xml}</r>`).root
      .children;
  const alpha = (host, value) => {
    const fill = child(host, "solidFill", NS.dml),
      color = fill?.children.find(
        (e) => e.kind === "element" && e.name.namespaceURI === NS.dml,
      );
    if (!color || value === undefined) return;
    color.children = color.children.filter(
      (e) =>
        e.kind !== "element" ||
        !["alpha", "alphaMod", "alphaOff"].includes(e.name.localName),
    );
    color.children.push(
      ...fragment(`<a:alpha val="${Math.round(value * 100000)}"/>`),
    );
  };
  for (const { series, path } of nativeChartSeriesHosts(doc.root)) {
    const sp = child(series, "spPr"),
      marker = child(child(series, "marker"), "spPr");
    alpha(sp, opacity);
    alpha(child(sp, "ln", NS.dml), lineOpacity);
    alpha(marker, markerFillOpacity);
    alpha(child(marker, "ln", NS.dml), markerStrokeOpacity);
    alpha(invertedSolidFillHost(series), negativeOpacity);
    if (kind === "radar")
      child(path.at(-2), "radarStyle").attrs[0].value = "filled";
    if (pointOpacity !== undefined) {
      const point = fragment(
        `<c:dPt><c:idx val="${pointIndex}"/><c:spPr><a:solidFill><a:srgbClr val="CC55AA"><a:alpha val="${Math.round(pointOpacity * 100000)}"/></a:srgbClr></a:solidFill></c:spPr></c:dPt>`,
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
