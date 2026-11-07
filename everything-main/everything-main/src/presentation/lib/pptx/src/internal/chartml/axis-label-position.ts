import type { ChartAxisTickLabelPosition, ChartSpec } from "./types.ts";
import {
  NS,
  type XmlElement,
  firstChildElement,
  getAttrValue,
  qname,
  withInheritedNamespaces,
} from "../xml/index.ts";
import { chartPlotContext, primaryChartAxis } from "./axis-context.ts";

const c = (name: string) => qname("c", name, NS.chart);
const isPosition = (value: unknown): value is ChartAxisTickLabelPosition =>
  value === "none" || value === "low" || value === "high" || value === "nextTo";
const isPositionNode = (node: XmlElement): boolean =>
  node.name.namespaceURI === NS.chart && node.name.localName === "tickLblPos";

export const CHART_AXIS_TICK_LABEL_POSITION_FIELDS = [
  "categoryAxisTickLabelPos",
  "valueAxisTickLabelPos",
  "secondaryCategoryAxisTickLabelPos",
  "secondaryValueAxisTickLabelPos",
] as const;

export const validateChartAxisTickLabelPositions = (spec: ChartSpec): void => {
  for (const key of CHART_AXIS_TICK_LABEL_POSITION_FIELDS)
    if (spec[key] !== undefined && !isPosition(spec[key]))
      throw new RangeError(`${key}: expected none, low, high, or nextTo`);
};

export const readChartAxisTickLabelPosition = (
  axis: XmlElement | null,
): ChartAxisTickLabelPosition | undefined => {
  const node = axis && firstChildElement(axis, c("tickLblPos"));
  if (!node) return undefined;
  // CT_TickLblPos defaults val to nextTo on a present element. Keep omission
  // distinct, and do not turn an unreadable native token into an authored one.
  const value = getAttrValue(node, qname("", "val", "")) ?? "nextTo";
  return isPosition(value) ? value : undefined;
};

/** Retain unedited native label positions, including omission and extensions. */
export const preserveNativeChartAxisTickLabelPositions = (
  original: XmlElement,
  authored: XmlElement,
  spec: ChartSpec,
): void => {
  const source = chartPlotContext(original),
    target = chartPlotContext(authored);
  if (!source || !target) return;
  for (const secondary of [false, true])
    for (const category of [true, false]) {
      const names = category ? ["catAx", "dateAx", "serAx"] : ["valAx"],
        before = secondary
          ? source.axes.axisForGroups(names, true)
          : primaryChartAxis(source, names),
        after = target.axes.axisForGroups(names, secondary),
        key = secondary
          ? category
            ? "secondaryCategoryAxisTickLabelPos"
            : "secondaryValueAxisTickLabelPos"
          : category
            ? "categoryAxisTickLabelPos"
            : "valueAxisTickLabelPos";
      if (!before || !after) continue;
      const unchanged = readChartAxisTickLabelPosition(before) === spec[key];
      if (!unchanged && spec[key] !== undefined) continue;
      after.children = after.children.filter(
        (node) => node.kind !== "element" || !isPositionNode(node),
      );
      if (unchanged) {
        const positions = before.children
          .filter(
            (node): node is XmlElement =>
              node.kind === "element" && isPositionNode(node),
          )
          .map((node) =>
            withInheritedNamespaces(node, [
              original,
              source.chart,
              source.area,
              before,
            ]),
          );
        // The common CT_CatAx/DateAx/SerAx/ValAx sequence places tickLblPos
        // after tick marks and before axis paint, text properties, and crossAx.
        const index = after.children.findIndex(
          (node) =>
            node.kind === "element" &&
            node.name.namespaceURI === NS.chart &&
            ["spPr", "txPr", "crossAx"].includes(node.name.localName),
        );
        after.children.splice(
          index < 0 ? after.children.length : index,
          0,
          ...positions,
        );
      }
    }
};
