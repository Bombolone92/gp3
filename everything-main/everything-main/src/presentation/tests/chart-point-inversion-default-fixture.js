import { P } from "../src/model.js";
import { chartZeroFillInversionDeck } from "./chart-zero-fill-inversion-fixture.js";
import { chartRoot } from "./chart-copy-fixture.js";
import { nativeChartSeriesHosts } from "../lib/pptx/src/internal/chartml/native-data.ts";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";

export function chartPointInversionDefaultDeck({
  pointIndex = 0,
  pointSwitch,
  format = "solid",
  inversion = false,
  ...options
} = {}) {
  const f = chartZeroFillInversionDeck({
    opacity: 1,
    series: [
      {
        name: "Signed",
        values: [-2, 4, -3],
        color: "#E85239",
        invertIfNegative: inversion,
        lineColor: null,
      },
    ],
    ...options,
  });
  const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data)),
    host = nativeChartSeriesHosts(doc.root)[0].series;
  if (format !== "absent") {
    const fill =
        format === "solid"
          ? '<a:solidFill><a:srgbClr val="CC55AA"/></a:solidFill>'
          : "",
      line =
        format === "outline"
          ? '<a:ln w="50800"><a:solidFill><a:srgbClr val="316BB0"/></a:solidFill></a:ln>'
          : "";
    const point = parseXml(
        `<c:dPt xmlns:c="${NS.chart}" xmlns:a="${NS.dml}"><c:idx val="${pointIndex}"/>${pointSwitch === undefined ? "" : `<c:invertIfNegative val="${pointSwitch ? 1 : 0}"/>`}${format === "idx" ? "" : `<c:spPr>${fill}${line}</c:spPr>`}</c:dPt>`,
      ).root,
      at = host.children.findIndex(
        (e) =>
          e.kind === "element" && ["cat", "val"].includes(e.name.localName),
      );
    host.children.splice(at, 0, point);
  }
  part.data = new TextEncoder().encode(serializeXml(doc));
  return f;
}
