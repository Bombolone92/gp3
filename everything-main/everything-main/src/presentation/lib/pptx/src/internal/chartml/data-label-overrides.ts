import {
  NS,
  type XmlElement,
  allChildElements,
  childElements,
  firstChildElement,
  getAttrValue,
  qname,
} from "../xml/index.ts";
import { chartPlotContext, readChartUnsignedInt } from "./axis-context.ts";
import {
  chartStringCache,
  chartCachePoints,
  chartCacheText,
} from "./chart-cache.ts";
import {
  readBoolean,
  readNumberFormat,
  readDataLabelSeparator,
  readChartTextStyle,
  type ChartColorResolver,
} from "./chart-reader.ts";
import type { ChartDataLabels } from "./types.ts";

export interface ChartPointDataLabel {
  readonly deleted?: boolean;
  readonly options: ChartDataLabels;
  readonly resetTextStyle: boolean;
  readonly richText: boolean;
  /** A present tx replaces generated components, including when it is empty. */
  readonly text?: string;
}
export interface ChartSeriesDataLabels {
  readonly deleted?: boolean;
  readonly options?: ChartDataLabels;
  readonly textStyleDeclared: boolean;
  readonly points: ReadonlyMap<number, ChartPointDataLabel>;
}

const child = (e: XmlElement | null, name: string, ns: string = NS.chart) =>
  e && firstChildElement(e, qname("", name, ns));
const textOf = (e: XmlElement | null): string => (e ? chartCacheText(e) : "");

// Native radar label records have independent defaults. A collection replaces
// the plot-group collection; point records do not inherit its component switches
// or number format. Missing switches enable the corresponding component.
const labelOptions = (
  host: XmlElement,
  resolveColor: ChartColorResolver,
): ChartDataLabels => {
  const format = readNumberFormat(host),
    separator = readDataLabelSeparator(host),
    style = child(host, "txPr"),
    rich = child(child(host, "tx"), "rich"),
    textStyle = style
      ? readChartTextStyle(style, resolveColor)
      : rich
        ? readChartTextStyle(rich, resolveColor)
        : undefined;
  return {
    showValue: readBoolean(child(host, "showVal")) ?? true,
    showCategory: readBoolean(child(host, "showCatName")) ?? true,
    showSeriesName: readBoolean(child(host, "showSerName")) ?? true,
    showPercent: readBoolean(child(host, "showPercent")) ?? true,
    numberFormatSourceLinked: true,
    ...format,
    ...(separator !== undefined ? { separator } : {}),
    ...(textStyle ? { textStyle } : {}),
  };
};

const labelText = (tx: XmlElement): string => {
  const rich = child(tx, "rich");
  if (rich)
    return allChildElements(rich, qname("a", "p", NS.dml))
      .map((p) =>
        childElements(p)
          .map((run) =>
            run.name.namespaceURI !== NS.dml
              ? ""
              : run.name.localName === "br"
                ? "\n"
                : ["r", "fld"].includes(run.name.localName)
                  ? textOf(child(run, "t", NS.dml))
                  : "",
          )
          .join(""),
      )
      .join("\n");
  const cache = chartStringCache(tx);
  if (!cache) return textOf(child(tx, "v"));
  // A label has one cached string. Do not allocate a dense cache from opaque
  // sparse records that cannot contribute to this label.
  let text = "";
  for (const [index, value] of chartCachePoints(cache))
    if (index === 0) text = value;
  return text;
};

/** Read-only radar label selection/content. Do not rewrite ChartSpec or
 * materialize sparse indices. Native tx overrides component switches and numFmt
 * (MS-OI29500 2.1.1455); unrepresented rich run paints/layout remain in the XML.
 */
export const readChartDataLabelOverrides = (
  root: XmlElement,
  resolveColor: ChartColorResolver,
): ReadonlyArray<ChartSeriesDataLabels> => {
  const context = chartPlotContext(root);
  if (!context) return [];
  const result: ChartSeriesDataLabels[] = [];
  for (const { element } of context.groups) {
    const group = child(element, "dLbls");
    for (const series of allChildElements(
      element,
      qname("c", "ser", NS.chart),
    )) {
      const labels = child(series, "dLbls"),
        selected = labels ?? group,
        deleted = readBoolean(child(selected, "delete"));
      const points = new Map<number, ChartPointDataLabel>();
      for (const point of labels
        ? allChildElements(labels, qname("c", "dLbl", NS.chart))
        : []) {
        const idx = child(point, "idx");
        const index =
          idx && readChartUnsignedInt(getAttrValue(idx, qname("", "val", "")));
        if (index == null) continue;
        const tx = child(point, "tx"),
          rich = child(tx, "rich"),
          style = child(point, "txPr");
        const pointDeleted = readBoolean(child(point, "delete"));
        points.set(index, {
          options: labelOptions(point, resolveColor),
          // A point-format container supplies its own text defaults. A custom
          // tx ignores numFmt (MS-OI29500 2.1.1455), so that alone cannot reset it.
          resetTextStyle: !!(
            style ||
            child(point, "spPr") ||
            (!tx && child(point, "numFmt"))
          ),
          richText: !!rich,
          ...(pointDeleted !== undefined ? { deleted: pointDeleted } : {}),
          ...(tx ? { text: labelText(tx) } : {}),
        });
      }
      result.push({
        ...(deleted !== undefined ? { deleted } : {}),
        ...(selected ? { options: labelOptions(selected, resolveColor) } : {}),
        textStyleDeclared: !!child(selected, "txPr"),
        points,
      });
    }
  }
  return result;
};
