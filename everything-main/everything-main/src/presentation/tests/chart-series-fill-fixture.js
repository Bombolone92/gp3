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

// Keep the otherwise opaque theme intact while exercising an unresolved color
// scheme. Imported partial packages must not turn automatic points into noFill.
export function withoutChartColorScheme(f) {
  for (const part of P._internalPackageOf(f.p).parts) {
    if (
      part.contentType !==
      "application/vnd.openxmlformats-officedocument.theme+xml"
    )
      continue;
    const doc = parseXml(new TextDecoder().decode(part.data)),
      elements = firstChildElement(
        doc.root,
        qname("", "themeElements", NS.dml),
      );
    if (!elements) continue;
    elements.children = elements.children.filter(
      (e) =>
        e.kind !== "element" ||
        e.name.namespaceURI !== NS.dml ||
        e.name.localName !== "clrScheme",
    );
    part.data = new TextEncoder().encode(serializeXml(doc));
  }
  return f;
}

export function nativeSeriesFillXml({
  paint = "gradient",
  angle = 0,
  alpha = 1,
  tile = "",
  preset = "diagCross",
} = {}) {
  if (paint === "pattern")
    return `<a:pattFill prst="${preset}"><a:fgClr><a:srgbClr val="23AA88"><a:alpha val="${Math.round(alpha * 100000)}"/></a:srgbClr></a:fgClr><a:bgClr><a:srgbClr val="661133"><a:alpha val="${Math.round(alpha * 100000)}"/></a:srgbClr></a:bgClr></a:pattFill>`;
  if (paint === "solid")
    return `<a:solidFill><a:srgbClr val="CC55AA"><a:alpha val="${Math.round(alpha * 100000)}"/></a:srgbClr></a:solidFill>`;
  if (paint === "none") return "<a:noFill/>";
  if (paint === "empty") return "";
  return `<a:gradFill flip="none" rotWithShape="1"><a:gsLst>${[
    [0, "D5244B"],
    [35000, "F4C642"],
    [100000, "177FA7"],
  ]
    .map(
      ([pos, color]) =>
        `<a:gs pos="${pos}"><a:srgbClr val="${color}"><a:alpha val="${Math.round(alpha * 100000)}"/></a:srgbClr></a:gs>`,
    )
    .join(
      "",
    )}</a:gsLst><a:lin ang="${Math.round(angle * 60000)}" scaled="1"/>${tile}</a:gradFill>`;
}

export function chartSeriesFillDeck({
  paint = "gradient",
  angle = 0,
  alpha = 1,
  tile = "",
  preset = "diagCross",
  pointPaint,
  pointIndex = 1,
  pointSwitch,
  pointLine = "",
  ...options
} = {}) {
  const f = chartSeriesOpacityDeck({ opacity: 1, ...options }),
    part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data)),
    node = (xml) =>
      parseXml(`<r xmlns:a="${NS.dml}" xmlns:c="${NS.chart}">${xml}</r>`).root
        .children[0];
  for (const { series } of nativeChartSeriesHosts(doc.root)) {
    const sp = firstChildElement(series, qname("", "spPr", NS.chart));
    sp.children = sp.children.filter(
      (e) =>
        e.kind !== "element" ||
        e.name.namespaceURI !== NS.dml ||
        !["solidFill", "noFill", "gradFill", "pattFill", "blipFill"].includes(
          e.name.localName,
        ),
    );
    const fill = nativeSeriesFillXml({ paint, angle, alpha, tile, preset });
    if (fill) sp.children.unshift(node(fill));
    if (pointPaint !== undefined) {
      const at = series.children.findIndex(
        (e) =>
          e.kind === "element" &&
          ["cat", "val", "xVal", "yVal"].includes(e.name.localName),
      );
      series.children.splice(
        at,
        0,
        node(
          `<c:dPt><c:idx val="${pointIndex}"/>${pointSwitch === undefined ? "" : `<c:invertIfNegative val="${pointSwitch ? 1 : 0}"/>`}${pointPaint === "idx" ? "" : `<c:spPr>${nativeSeriesFillXml({ paint: pointPaint, angle, alpha, tile, preset })}${pointLine}</c:spPr>`}</c:dPt>`,
        ),
      );
    }
  }
  part.data = new TextEncoder().encode(serializeXml(doc));
  return f;
}
