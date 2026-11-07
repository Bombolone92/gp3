import { P } from "../src/model.js";
import { chartAxisGridDeck } from "./chart-axis-grid-fixture.js";
import { chartRoot } from "./chart-copy-fixture.js";
import {
  chartAxisRoles,
  chartPlotContext,
} from "../lib/pptx/src/internal/chartml/axis-context.ts";
import {
  NS,
  firstChildElement,
  getAttrValue,
  parseXml,
  qname,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";

const child = (e, name) => firstChildElement(e, qname("", name, NS.chart));
const part = (p, shape) => P._internalPackageOf(p).getPart(chartRoot(shape));
export function secondaryCategoryLabelDistance(p, shape) {
  const root = parseXml(new TextDecoder().decode(part(p, shape).data)).root,
    ctx = chartPlotContext(root),
    axis = chartAxisRoles(ctx.area, ctx.axes).secondaryCategory,
    node = axis && child(axis, "lblOffset");
  return node ? { value: getAttrValue(node, qname("", "val", "")) } : null;
}
export function chartCategoryLabelDistanceDeck(kind, value) {
  const f = chartAxisGridDeck({
    kind,
    categoryAxisLabelOffset: 75,
    categories: ["First", "Second", "Third"],
    series: [
      { name: "Primary", values: [1, 2, 3] },
      { name: "Secondary", values: [10, 20, 30], secondaryAxis: true },
    ],
    axes: {
      secondaryCategory: {
        hidden: false,
        tickMarkSkip: 2,
      },
    },
  });
  const doc = parseXml(new TextDecoder().decode(f.part.data)),
    ctx = chartPlotContext(doc.root),
    roles = chartAxisRoles(ctx.area, ctx.axes),
    axis = roles.secondaryCategory;
  // Native IDs and physical element order are unrelated to semantic roles.
  ctx.area.children = ctx.area.children.filter((e) => e !== axis);
  ctx.area.children.splice(ctx.area.children.indexOf(roles.category), 0, axis);
  if (value !== undefined) {
    const node = parseXml(
      `<c:lblOffset xmlns:c="${NS.chart}"${value === null ? "" : ` val="${value}"`}/>`,
    ).root;
    axis.children.splice(
      axis.children.indexOf(child(axis, "tickMarkSkip")),
      0,
      node,
    );
  }
  f.part.data = new TextEncoder().encode(serializeXml(doc));
  return f;
}
