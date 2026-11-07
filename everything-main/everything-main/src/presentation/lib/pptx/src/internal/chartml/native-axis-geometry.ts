import type { ChartSpec } from "./types.ts";
import { chartAxisRoles, chartPlotContext } from "./axis-context.ts";
import {
  NS,
  type XmlElement,
  firstChildElement,
  getAttrValue,
  qname,
  withInheritedNamespaces,
} from "../xml/index.ts";

const c = (name: string) => qname("c", name, NS.chart);
const is = (e: XmlElement, name: string) =>
  e.name.namespaceURI === NS.chart && e.name.localName === name;

/** Preserve native axis declarations without an editable ChartSpec field.
 * Rebuilding caches must not reset secondary grids/units/visibility or XY
 * x bounds. Model-owned direction, crossings, formats and paints still edit
 * through their normal writers. Only surviving equivalent axis roles merge.
 */
export const preserveNativeChartAxisGeometry = (
  original: XmlElement,
  authored: XmlElement,
  spec: ChartSpec,
): void => {
  const source = chartPlotContext(original),
    target = chartPlotContext(authored);
  if (!source || !target) return;
  const xy = spec.kind === "scatter" || spec.kind === "bubble";
  const before = chartAxisRoles(source.area, source.axes, xy),
    after = chartAxisRoles(target.area, target.axes, xy);
  const copy = (
    from: XmlElement,
    to: XmlElement,
    name: string,
    following: ReadonlyArray<string>,
  ) => {
    to.children = to.children.filter(
      (e) => e.kind !== "element" || !is(e, name),
    );
    const nodes = from.children
      .filter((e): e is XmlElement => e.kind === "element" && is(e, name))
      .map((e) =>
        withInheritedNamespaces(e, [original, source.chart, source.area, from]),
      );
    const at = to.children.findIndex(
      (e) =>
        e.kind === "element" &&
        e.name.namespaceURI === NS.chart &&
        following.includes(e.name.localName),
    );
    to.children.splice(at < 0 ? to.children.length : at, 0, ...nodes);
  };
  for (const role of [
    "category",
    "value",
    "secondaryCategory",
    "secondaryValue",
  ] as const) {
    const from = before[role],
      to = after[role],
      secondary = role.startsWith("secondary");
    if (!from || !to || from.name.localName !== to.name.localName) continue;
    const plane = (axis: XmlElement) => {
      const node = firstChildElement(axis, c("axPos")),
        value = node && getAttrValue(node, qname("", "val", ""));
      return value === "b" || value === "t"
        ? "horizontal"
        : value === "l" || value === "r"
          ? "vertical"
          : null;
    };
    // axPos is not model-owned. Despite MS-OE376 2.1.1449's broad note,
    // the native reference retains it at numeric crossings and uses it for boundary
    // labels/shared-edge rows. A data rebuild must not reset that choice.
    // Preserve only equivalent physical axes: changing bar/column orientation
    // must still rotate them, even though catAx/valAx element types survive.
    if (plane(from) !== null && plane(from) === plane(to))
      copy(from, to, "axPos", [
        "majorGridlines",
        "minorGridlines",
        "title",
        "numFmt",
        "majorTickMark",
        "minorTickMark",
        "tickLblPos",
        "spPr",
        "txPr",
        "crossAx",
      ]);
    const unmodeledScale = secondary || (xy && role === "category");
    if (unmodeledScale) {
      const generated = firstChildElement(to, c("scaling")),
        orientation =
          generated && firstChildElement(generated, c("orientation"));
      copy(from, to, "scaling", ["delete", "axPos"]);
      const scaling = firstChildElement(to, c("scaling"));
      if (scaling) {
        scaling.children = scaling.children.filter(
          (e) => e.kind !== "element" || !is(e, "orientation"),
        );
        if (orientation) {
          // CT_Scaling: logBase, orientation, max, min, extLst.
          const at = scaling.children.findIndex(
            (e) =>
              e.kind === "element" &&
              ["max", "min", "extLst"].includes(e.name.localName) &&
              e.name.namespaceURI === NS.chart,
          );
          scaling.children.splice(
            at < 0 ? scaling.children.length : at,
            0,
            orientation,
          );
        }
      }
      copy(from, to, "majorUnit", ["minorUnit", "dispUnits", "extLst"]);
      copy(from, to, "minorUnit", ["dispUnits", "extLst"]);
    }
    if (!secondary) continue;
    copy(from, to, "delete", ["axPos"]);
    const afterGrid = [
      "title",
      "numFmt",
      "majorTickMark",
      "minorTickMark",
      "tickLblPos",
      "spPr",
      "txPr",
      "crossAx",
    ];
    copy(from, to, "majorGridlines", ["minorGridlines", ...afterGrid]);
    copy(from, to, "minorGridlines", afterGrid);
    copy(from, to, "majorTickMark", [
      "minorTickMark",
      "tickLblPos",
      "spPr",
      "txPr",
      "crossAx",
    ]);
    copy(from, to, "minorTickMark", ["tickLblPos", "spPr", "txPr", "crossAx"]);
    if (!from.name.localName.endsWith("valAx")) {
      // Label distance belongs to this category axis. It has no secondary
      // ChartSpec field, so a cache/data rebuild must retain its native slot
      // (including omission or an attribute-defaulted element), independently
      // of the model-owned primary distance. CT_CatAx places it before skips.
      if (from.name.localName === "catAx")
        copy(from, to, "lblOffset", [
          "tickLblSkip",
          "tickMarkSkip",
          "noMultiLvlLbl",
          "extLst",
        ]);
      copy(from, to, "tickLblSkip", [
        "tickMarkSkip",
        "noMultiLvlLbl",
        "extLst",
      ]);
      copy(from, to, "tickMarkSkip", ["noMultiLvlLbl", "extLst"]);
    }
  }
};
