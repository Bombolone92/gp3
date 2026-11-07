import type { ChartSpec } from "../../internal/chartml/index.ts";
import type { PartName } from "../../internal/opc/index.ts";
import {
  NS,
  firstChildElement,
  qname,
  type XmlElement,
} from "../../internal/xml/index.ts";
import type { SlideData } from "../_internal-symbols.ts";
import { chartThemeLine, readChartLine, type ChartLine } from "./chart-line.ts";
export type ChartAreaLine = ChartLine;
const child = (e: XmlElement | null, n: string, ns: string = NS.dml) =>
  e && firstChildElement(e, qname("", n, ns));

/** PresentationML chart styles 1–32 suppress automatic outline paint while
 * retaining theme line properties for explicit paint. Styles 41–48 and all
 * plot areas have no theme outline (ECMA-376 21.2.3.46; native controls). */
export const readChartAreaLine = (
  slide: SlideData,
  part: PartName,
  root: XmlElement,
  spec: ChartSpec,
  area: "chart" | "plot",
): ChartAreaLine => {
  const surface =
      area === "chart"
        ? root
        : child(child(root, "chart", NS.chart), "plotArea", NS.chart),
    own = child(child(surface, "spPr", NS.chart), "ln"),
    style = spec.chartStyle ?? 2,
    themeLine =
      area === "chart" && style <= 40
        ? chartThemeLine(slide, part, style <= 32 ? "tx1" : "dk1", 75000)
        : null;
  return readChartLine(
    slide,
    part,
    root,
    own,
    themeLine,
    area === "chart" && style >= 33 && style <= 40,
  );
};
