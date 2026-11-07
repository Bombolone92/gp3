import type { ChartSpec, ChartKind } from "../../internal/chartml/types.ts";
import { chartPlotContext } from "../../internal/chartml/axis-context.ts";
import { CHART_PLOT_KINDS } from "../../internal/chartml/plot-kinds.ts";
import type { PartName } from "../../internal/opc/index.ts";
import {
  NS,
  firstChildElement,
  allChildElements,
  getAttrValue,
  qname,
  type XmlElement,
} from "../../internal/xml/index.ts";
import type { SlideData } from "../_internal-symbols.ts";
import { chartThemeLine, readChartLine, type ChartLine } from "./chart-line.ts";

export interface ChartPlotGroup {
  readonly kind: ChartKind;
  readonly secondary: boolean;
  readonly grouping: ChartSpec["grouping"];
  /** Model positions follow native group/series order, independently of idx/order. */
  readonly series: ReadonlyArray<number>;
  readonly dropLines: ChartLine | undefined;
  readonly hiLowLines: ChartLine | undefined;
}
const child = (e: XmlElement | null, name: string, ns: string = NS.chart) =>
  e && firstChildElement(e, qname("", name, ns));
const value = (e: XmlElement | null) =>
  e && getAttrValue(e, qname("", "val", ""));

/** Read-only native group boundaries. Legacy ChartSpec flags and grouping
 * describe the first plot; resolving other plots must not author new defaults.
 * Automatic guide lines use the subtle theme line and the Other Lines column
 * of ECMA-376 21.2.3.46 table 2. The 35–40 shade is omitted (native reference).
 */
export const readChartPlotGroups = (
  slide: SlideData,
  part: PartName,
  root: XmlElement,
  spec: ChartSpec,
): ReadonlyArray<ChartPlotGroup> => {
  const context = chartPlotContext(root);
  if (!context) return [];
  const style = spec.chartStyle ?? 2;
  let automaticLine: XmlElement | null | undefined;
  const themeLine = () => {
    if (automaticLine === undefined)
      automaticLine = chartThemeLine(
        slide,
        part,
        style <= 32 ? "tx1" : style <= 40 ? "dk1" : "lt1",
        undefined,
        style >= 35 && style <= 40 && spec.chartStyleVariant !== "office2010"
          ? 25000
          : undefined,
      );
    return automaticLine;
  };
  let index = 0;
  return context.groups.map(({ element }) => {
    const mapped = CHART_PLOT_KINDS.find(
        (entry) => entry.localName === element.name.localName,
      )!,
      kind =
        element.name.localName.startsWith("bar") &&
        value(child(element, "barDir")) === "bar"
          ? "bar"
          : mapped.kind,
      grouping = value(child(element, "grouping")),
      read = (name: string) => {
        const guide = child(element, name);
        return guide
          ? readChartLine(
              slide,
              part,
              root,
              child(child(guide, "spPr"), "ln", NS.dml),
              themeLine(),
              true,
            )
          : undefined;
      };
    return {
      kind,
      secondary: context.axes.groupUsesSecondaryAxis(element),
      grouping:
        grouping === "standard" ||
        grouping === "clustered" ||
        grouping === "stacked" ||
        grouping === "percentStacked"
          ? grouping
          : undefined,
      series: allChildElements(element, qname("", "ser", NS.chart)).map(
        () => index++,
      ),
      dropLines: read("dropLines"),
      hiLowLines: read("hiLowLines"),
    };
  });
};
