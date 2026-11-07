// Crossing settings belong to each axis, independently of its perpendicular
// partner. crossesAt is interpreted on the axis named by crossAx, rather
// than on the parent axis (MS-OE376 2.1.1464). Keep the native slot identity.
import type { ChartAxisCrossing, ChartSpec } from "./types.ts";
import {
  NS,
  type XmlElement,
  firstChildElement,
  getAttrValue,
  qname,
  withInheritedNamespaces,
} from "../xml/index.ts";
import { chartPlotContext, primaryChartAxis } from "./axis-context.ts";

const c = (name: string) => qname("c", name, NS.chart),
  val = qname("", "val", "");
const isCrossing = (node: XmlElement): boolean =>
  node.name.namespaceURI === NS.chart &&
  ["crosses", "crossesAt"].includes(node.name.localName);

export const CHART_AXIS_CROSSING_FIELDS = [
  "categoryAxisCrosses",
  "valueAxisCrosses",
  "secondaryCategoryAxisCrosses",
  "secondaryValueAxisCrosses",
] as const;

export const validateChartAxisCrossings = (spec: ChartSpec): void => {
  for (const key of CHART_AXIS_CROSSING_FIELDS) {
    const crossing = spec[key];
    if (
      crossing !== undefined &&
      crossing !== "autoZero" &&
      crossing !== "min" &&
      crossing !== "max" &&
      !(
        crossing !== null &&
        typeof crossing === "object" &&
        Number.isFinite(crossing.at)
      )
    )
      throw new RangeError(
        `${key}: expected autoZero, min, max, or { at: finite number }`,
      );
  }
};

export const readChartAxisCrossing = (
  axis: XmlElement | null,
): ChartAxisCrossing | undefined => {
  if (!axis) return undefined;
  // The schema makes these mutually exclusive. A present crossesAt takes
  // precedence over crosses, including when its value is unreadable.
  const at = firstChildElement(axis, c("crossesAt"));
  if (at) {
    const raw = getAttrValue(at, val)?.trim();
    // Accept the complete XML Schema double lexical form, excluding the
    // unsupported INF/-INF/NaN. parseFloat would turn "2garbage" into 2.
    if (raw && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) {
      const number = Number(raw);
      if (Number.isFinite(number)) return { at: number };
    }
    return undefined;
  }
  const element = firstChildElement(axis, c("crosses"));
  const token = element && getAttrValue(element, val);
  return token === "autoZero" || token === "min" || token === "max"
    ? token
    : undefined;
};

const equal = (
  a: ChartAxisCrossing | undefined,
  b: ChartAxisCrossing | undefined,
): boolean =>
  a === b || (typeof a === "object" && typeof b === "object" && a.at === b.at);

/** Keep unedited native crossing nodes, including omission and lexical form. */
export const preserveNativeChartCrossings = (
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
            ? "secondaryCategoryAxisCrosses"
            : "secondaryValueAxisCrosses"
          : category
            ? "categoryAxisCrosses"
            : "valueAxisCrosses",
        requested = spec[key];
      if (!before || !after) continue;
      // New secondary pairs keep the builder's opposite-edge default. For an
      // existing pair, omission is an intentional native state or an edit that
      // clears the setting, so do not silently reintroduce that default.
      const unchanged = equal(readChartAxisCrossing(before), requested);
      if (!unchanged && requested !== undefined) continue;
      after.children = after.children.filter(
        (node) => node.kind !== "element" || !isCrossing(node),
      );
      if (unchanged) {
        const crossings = before.children
          .filter(
            (node): node is XmlElement =>
              node.kind === "element" && isCrossing(node),
          )
          .map((node) =>
            withInheritedNamespaces(node, [
              original,
              source.chart,
              source.area,
              before,
            ]),
          );
        // Both CT_CatAx and CT_ValAx place the crossing choice after crossAx.
        const index = after.children.indexOf(
          firstChildElement(after, c("crossAx"))!,
        );
        after.children.splice(index + 1, 0, ...crossings);
      }
    }
};
