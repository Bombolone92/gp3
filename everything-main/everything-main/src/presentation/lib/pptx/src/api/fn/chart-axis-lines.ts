import { CHART_AUTO_ROTATION } from "../../internal/chartml/text-rotation.ts";
import {
  readChartTextStyle,
  type ChartColorResolver,
} from "../../internal/chartml/chart-reader.ts";
import type { ChartSpec } from "../../internal/chartml/index.ts";
import {
  chartPlotContext,
  chartAxisRoles,
  readChartUnsignedInt,
  readChartTickMark,
} from "../../internal/chartml/axis-context.ts";
import type { PartName } from "../../internal/opc/index.ts";
import {
  NS,
  firstChildElement,
  qname,
  getAttrValue,
  type XmlElement,
} from "../../internal/xml/index.ts";
import type { SlideData } from "../_internal-symbols.ts";
import { chartThemeLine, readChartLine } from "./chart-line.ts";
import { readTextSpacing } from "./shape-runs.ts";
import { readCategoryAxisData } from "../../internal/chartml/category-axis-data.ts";
const child = (e: XmlElement | null, n: string, ns: string = NS.chart) =>
  e && firstChildElement(e, qname("", n, ns));

const value = (e: XmlElement | null) =>
  e ? getAttrValue(e, qname("", "val", "")) : null;
const numeric = (e: XmlElement | null) => {
  const raw = value(e),
    n = raw === null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? n : undefined;
};
const rotation = (axis: XmlElement) => {
  const body = child(child(axis, "txPr"), "bodyPr", NS.dml),
    raw = body && getAttrValue(body, qname("", "rot", "")),
    n = raw == null ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n)
    ? n === CHART_AUTO_ROTATION
      ? null
      : n / 60000
    : undefined;
};
const position = (axis: XmlElement): "b" | "t" | "l" | "r" | undefined => {
  const v = value(child(axis, "axPos"));
  return v === "b" || v === "t" || v === "l" || v === "r" ? v : undefined;
};
const paragraphSpacing = (body: XmlElement | null) => {
  const pPr = child(child(body, "p", NS.dml), "pPr", NS.dml);
  const rawLevel = pPr && getAttrValue(pPr, qname("", "lvl", ""));
  const level = rawLevel == null ? 0 : Number(rawLevel);
  const inherited =
    Number.isInteger(level) && level >= 0 && level <= 8
      ? child(child(body, "lstStyle", NS.dml), `lvl${level + 1}pPr`, NS.dml)
      : null;
  return readTextSpacing(pPr, "lnSpc") ?? readTextSpacing(inherited, "lnSpc");
};
/** Read-only native axis paint and declarations. Do not turn automatic defaults into authored
 * ChartSpec fields: style changes and edits in other apps must still re-resolve.
 * Axis and major-gridline colors: ECMA-376 21.2.3.46 tables 1/2, with the
 * 75% tint override in MS-ODRAWXML 2.7.4.1. Minor lines use
 * their independent 50%/90% subtle-line style color before theme transforms. */
export const readChartAxisLines = (
  slide: SlideData,
  part: PartName,
  root: XmlElement,
  spec: ChartSpec,
  resolveColor: ChartColorResolver,
) => {
  const context = chartPlotContext(root);
  if (!context) return null;
  const roles = chartAxisRoles(
      context.area,
      context.axes,
      spec.kind === "scatter" || spec.kind === "bubble",
    ),
    style = spec.chartStyle ?? 2,
    themeLine = chartThemeLine(
      slide,
      part,
      style <= 32 ? "tx1" : "dk1",
      spec.chartStyleVariant === "office2010" ? 75000 : undefined,
    );
  const minorThemeLine = chartThemeLine(
    slide,
    part,
    spec.chartStyleVariant === "office2010" && style > 32 ? "dk1" : "tx1",
    style > 40 ? 90000 : 50000,
  );
  const allocationOrder = (axis: XmlElement) => {
    const id = readChartUnsignedInt(value(child(axis, "axId")));
    if (id === null) return undefined;
    const order = context.groups.findIndex((group) =>
      context.axes.groupAxisIds(group.element).includes(id),
    );
    return order < 0 ? undefined : order;
  };
  const dataByAxis = new Map<
    XmlElement,
    ReturnType<typeof readCategoryAxisData>
  >();
  const categoryData = (axis: XmlElement) => {
    if (!["column", "bar", "line", "area"].includes(spec.kind))
      return undefined;
    if (!dataByAxis.has(axis))
      dataByAxis.set(axis, readCategoryAxisData(context, axis));
    return dataByAxis.get(axis);
  };
  const read = (axis: XmlElement | null, sharedWithPrimary = false) => ({
    geometry: axis
      ? {
          labelRotationDeg: rotation(axis),
          categoryData: categoryData(axis),
          sharedWithPrimary,
          position: position(axis),
          // Row priority follows plot references. Model primary/secondary
          // roles can swap when crossing choices put the value axes on the
          // opposite physical edges; that must not reverse native row order.
          allocationOrder: allocationOrder(axis),
          labelOffset: numeric(child(axis, "lblOffset")),
          labelLineSpacing:
            paragraphSpacing(child(axis, "txPr")) ??
            paragraphSpacing(child(root, "txPr")),
          tickLabelSkip:
            readChartUnsignedInt(value(child(axis, "tickLblSkip"))) ||
            undefined,
          labelStyle: child(axis, "txPr")
            ? readChartTextStyle(child(axis, "txPr")!, resolveColor)
            : undefined,
          hidden:
            !!child(axis, "delete") &&
            ["1", "true"].includes(value(child(axis, "delete")) ?? "1"),
          min: numeric(child(child(axis, "scaling"), "min")),
          max: numeric(child(child(axis, "scaling"), "max")),
          majorUnit: numeric(child(axis, "majorUnit")),
          minorUnit: numeric(child(axis, "minorUnit")),
          majorGridlines: !!child(axis, "majorGridlines"),
          minorGridlines: !!child(axis, "minorGridlines"),
          // Omitted major/minor declarations render as cross (native reference),
          // just like CT_TickMark's attribute default on a present element.
          // Resolve here without changing ChartSpec or the source package.
          majorTickMark:
            readChartTickMark(child(axis, "majorTickMark")) ?? "cross",
          minorTickMark:
            readChartTickMark(child(axis, "minorTickMark")) ?? "cross",
          tickMarkSkip:
            readChartUnsignedInt(value(child(axis, "tickMarkSkip"))) ||
            undefined,
        }
      : null,
    minorGridline: readChartLine(
      slide,
      part,
      root,
      child(child(child(axis, "minorGridlines"), "spPr"), "ln", NS.dml),
      minorThemeLine,
      true,
    ),
    line: readChartLine(
      slide,
      part,
      root,
      child(child(axis, "spPr"), "ln", NS.dml),
      themeLine,
      true,
    ),
    // Radar's automatic line paints tick marks without painting radial
    // spines. Width/dash-only declarations retain that distinction; an
    // explicit fill (including an empty solid fill) opts the spines in.
    ...(spec.kind === "radar"
      ? {
          spine: readChartLine(
            slide,
            part,
            root,
            child(child(axis, "spPr"), "ln", NS.dml),
            themeLine,
            !!child(
              child(child(axis, "spPr"), "ln", NS.dml),
              "solidFill",
              NS.dml,
            ),
          ),
        }
      : {}),
    majorGridline: readChartLine(
      slide,
      part,
      root,
      child(child(child(axis, "majorGridlines"), "spPr"), "ln", NS.dml),
      themeLine,
      true,
    ),
  });
  return {
    value: read(roles.value),
    category: read(roles.category),
    secondaryValue: read(roles.secondaryValue),
    secondaryCategory: read(
      roles.secondaryCategory,
      roles.secondaryCategory !== null &&
        roles.secondaryCategory === roles.category,
    ),
  };
};
export type ChartAxisLines = NonNullable<ReturnType<typeof readChartAxisLines>>;
