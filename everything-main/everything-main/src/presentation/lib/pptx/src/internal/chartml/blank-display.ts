import {
  NS,
  type XmlElement,
  allChildElements,
  childElements,
  firstChildElement,
  getAttrValue,
  qname,
} from "../xml/index.ts";
import { CHART_PLOT_KINDS } from "./chart-reader.ts";
import { chartCachePoints, chartNumberCache } from "./chart-cache.ts";
import type { ChartSpec } from "./types.ts";
import { readChartUnsignedInt } from "./axis-context.ts";

export type ChartBlankDisplay = NonNullable<ChartSpec["dispBlanksAs"]>;
export interface ChartSeriesDisplay {
  readonly blank: ChartBlankDisplay;
  /** No native val/yVal cache, distinct from a present zero-point cache. */
  readonly missingValueCache?: true;
  /** Native #N/A points that connect surrounding points rather than act blank. */
  readonly naSpans?: ReadonlySet<number>;
  /** Native bar/column #N/A points: no bar, but the error can have a label. */
  readonly naGaps?: ReadonlySet<number>;
  /** A native dPt has its own enabled inversion default, even without spPr. */
  readonly pointInversionDefaults?: ReadonlySet<number>;
}
const child = (e: XmlElement, name: string) =>
  firstChildElement(e, qname("c", name, NS.chart));
const value = (e: XmlElement | null) =>
  e && getAttrValue(e, qname("", "val", ""));

/** Native plot capabilities, independent of the authored chart-wide setting.
 * MS-OE376 2.1.1471: unsupported methods fall back to the plot type's default.
 * Inspect the native group: line3DChart supports gaps even when stacked, whereas
 * area3DChart supports only zero. Folding both into their 2D kinds loses this.
 */
export const chartBlankDisplay = (
  plot: XmlElement,
  requested: string | null | undefined,
): ChartBlankDisplay => {
  const name = plot.name.localName,
    grouping = value(child(plot, "grouping")),
    stacked = grouping === "stacked" || grouping === "percentStacked";
  // Missing elements and missing val use zero in the native reference, as
  // does CT_DispBlanksAs's attribute default. This is distinct from the per-plot
  // fallback for an explicitly requested, unsupported method below.
  if (requested == null) return "zero";
  if (
    name === "area3DChart" ||
    (stacked && (name === "lineChart" || name === "areaChart"))
  )
    return "zero";
  // Standard 2D areas cannot interpolate blanks. The native reference uses zero
  // for an authored span, despite MS-OE376 listing gap as the fallback.
  if (name === "areaChart" && requested === "span") return "zero";
  if (requested === "zero") return "zero";
  if (
    requested === "span" &&
    ![
      "areaChart",
      "line3DChart",
      "barChart",
      "bar3DChart",
      "pieChart",
      "pie3DChart",
      "doughnutChart",
    ].includes(name)
  )
    return "span";
  // Types absent from the MS-OE376 capability table (such as stockChart) retain
  // the existing represented method; do not invent an unsupported-mode rule.
  return "gap";
};

const CHART_2017 = "http://schemas.microsoft.com/office/drawing/2017/03/chart";
const DATA_DISPLAY_EXTENSION = "{56B9EC1D-385E-4148-901F-78D8002777C0}";
// MS-ODRAWXML 2.33.3.2: CT_BooleanFalse defaults a missing val to false.
const naAsBlank = (chart: XmlElement): boolean => {
  const extensions = child(chart, "extLst");
  if (!extensions) return false;
  for (const ext of allChildElements(extensions, qname("c", "ext", NS.chart))) {
    if (getAttrValue(ext, qname("", "uri", "")) !== DATA_DISPLAY_EXTENSION)
      continue;
    const options = firstChildElement(
        ext,
        qname("", "dataDisplayOptions16", CHART_2017),
      ),
      flag =
        options &&
        firstChildElement(options, qname("", "dispNaAsBlank", CHART_2017)),
      token = value(flag)?.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "");
    return token === "1" || token === "true";
  }
  return false;
};

/** Native display semantics per modeled series, in the reader's group order.
 * The numeric API intentionally keeps missing/error values as null. Retain the
 * #N/A distinction here, without materializing another dense point array.
 */
export const readChartSeriesDisplays = (
  root: XmlElement,
): ReadonlyArray<ChartSeriesDisplay> => {
  const chart = child(root, "chart"),
    area = chart && child(chart, "plotArea");
  if (!chart || !area) return [];
  const requested = value(child(chart, "dispBlanksAs")),
    treatNaAsBlank = naAsBlank(chart),
    displays: ChartSeriesDisplay[] = [];
  for (const group of childElements(area)) {
    if (
      group.name.namespaceURI !== NS.chart ||
      !CHART_PLOT_KINDS.some((kind) => kind.localName === group.name.localName)
    )
      continue;
    const blank = chartBlankDisplay(group, requested),
      grouping = value(child(group, "grouping")),
      // Stacked 2D lines plot #N/A at zero. Standard 2D lines connect across it
      // unless dispNaAsBlank is enabled, independently of gap/span/zero.
      connectNa =
        !treatNaAsBlank &&
        group.name.localName === "lineChart" &&
        grouping !== "stacked" &&
        grouping !== "percentStacked",
      gapNa =
        !treatNaAsBlank &&
        (group.name.localName === "barChart" ||
          group.name.localName === "bar3DChart");
    for (const series of allChildElements(group, qname("c", "ser", NS.chart))) {
      const channel = child(series, "val") ?? child(series, "yVal"),
        cache = channel && chartNumberCache(channel);
      let naPoints: Set<number> | undefined;
      let pointInversionDefaults: Set<number> | undefined;
      if (
        group.name.localName === "barChart" ||
        group.name.localName === "bar3DChart"
      )
        for (const point of allChildElements(
          series,
          qname("c", "dPt", NS.chart),
        )) {
          const index = readChartUnsignedInt(value(child(point, "idx")));
          if (index !== null) (pointInversionDefaults ??= new Set()).add(index);
        }
      if (cache && (connectNa || gapNa))
        for (const [index, raw] of chartCachePoints(cache)) {
          // Cache points use last-record-wins semantics, including duplicates
          // that replace an error with a number or an empty value.
          if (raw === "#N/A") (naPoints ??= new Set()).add(index);
          else naPoints?.delete(index);
        }
      displays.push({
        blank,
        ...(pointInversionDefaults ? { pointInversionDefaults } : {}),
        ...(!cache ? { missingValueCache: true as const } : {}),
        ...(naPoints?.size
          ? connectNa
            ? { naSpans: naPoints }
            : { naGaps: naPoints }
          : {}),
      });
    }
  }
  return displays;
};

export const readChartBlankDisplays = (
  root: XmlElement,
): ReadonlyArray<ChartBlankDisplay> =>
  readChartSeriesDisplays(root).map((display) => display.blank);
