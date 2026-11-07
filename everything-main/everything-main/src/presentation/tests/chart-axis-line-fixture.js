import { P } from "../src/model.js";
import {
  chartAreaPaintDeck,
  chartLineTheme,
  areaGradient,
  areaPattern,
} from "./chart-area-paint-fixture.js";
import { chartRoot } from "./chart-copy-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
const child = (e, n, ns = NS.chart) =>
  e && firstChildElement(e, qname("", n, ns));
const node = (s) =>
  parseXml(
    `<c:wrapper xmlns:c="${NS.chart}" xmlns:a="${NS.dml}">${s}</c:wrapper>`,
  ).root.children[0];
export const axisLineModes = {
  automatic: undefined,
  empty: "<a:ln/>",
  width: '<a:ln w="76200"/>',
  color:
    '<a:ln><a:solidFill><a:srgbClr val="1B7CA3"><a:alpha val="40000"/></a:srgbClr></a:solidFill></a:ln>',
  dash: '<a:ln><a:prstDash val="dashDot"/></a:ln>',
  zero: '<a:ln w="0"><a:solidFill><a:srgbClr val="1B7CA3"/></a:solidFill></a:ln>',
  none: "<a:ln><a:noFill/></a:ln>",
  solidEmpty: "<a:ln><a:solidFill/></a:ln>",
  custom:
    '<a:ln w="38100" cap="sq"><a:solidFill><a:srgbClr val="1B7CA3"><a:alpha val="40000"/></a:srgbClr></a:solidFill><a:custDash><a:ds d="250000" sp="150000"/></a:custDash><a:miter lim="350000"/></a:ln>',
  gradient: `<a:ln w="76200">${areaGradient.replaceAll("phClr", "accent2")}</a:ln>`,
  pattern: `<a:ln w="76200">${areaPattern.replaceAll("phClr", "accent2")}</a:ln>`,
};
export { chartLineTheme };
export function chartAxisLineDeck({ lines = {}, grids = {}, ...options } = {}) {
  const f = chartAreaPaintDeck(options),
    part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)),
    doc = parseXml(new TextDecoder().decode(part.data)),
    area = child(child(doc.root, "chart"), "plotArea");
  const set = (host, line) => {
    if (!host || !line) return;
    let sp = child(host, "spPr");
    if (!sp) {
      sp = node("<c:spPr/>");
      const before = host.children.findIndex(
        (e) =>
          e.kind === "element" &&
          e.name.namespaceURI === NS.chart &&
          ["txPr", "crossAx", "crosses", "crossesAt"].includes(
            e.name.localName,
          ),
      );
      host.children.splice(before < 0 ? host.children.length : before, 0, sp);
    }
    sp.children = sp.children.filter(
      (e) =>
        e.kind !== "element" ||
        e.name.namespaceURI !== NS.dml ||
        e.name.localName !== "ln",
    );
    sp.children.push(node(line));
  };
  for (const axis of area.children) {
    if (
      axis.kind !== "element" ||
      axis.name.namespaceURI !== NS.chart ||
      !["catAx", "dateAx", "valAx"].includes(axis.name.localName)
    )
      continue;
    const pos = child(axis, "axPos"),
      side = pos && getAttrValue(pos, qname("", "val", "")),
      secondary = side === "r" || side === "t",
      role =
        (secondary ? "secondary" : "") +
        (axis.name.localName === "valAx"
          ? secondary
            ? "Value"
            : "value"
          : secondary
            ? "Category"
            : "category");
    set(axis, lines[role]);
    if (grids[role]) {
      let grid = child(axis, "majorGridlines");
      if (!grid) {
        grid = node("<c:majorGridlines/>");
        axis.children.splice(
          axis.children.findIndex(
            (e) => e.kind === "element" && e.name.localName === "axPos",
          ) + 1,
          0,
          grid,
        );
      }
      set(grid, grids[role]);
    }
  }
  part.data = new TextEncoder().encode(serializeXml(doc));
  return { ...f, part };
}
