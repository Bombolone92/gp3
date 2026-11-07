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

const c = (name) => qname("", name, NS.chart);
const val = qname("", "val", "");
function axes(p, shape) {
  const part = P._internalPackageOf(p).getPart(chartRoot(shape)),
    doc = parseXml(new TextDecoder().decode(part.data)),
    ctx = chartPlotContext(doc.root),
    spec = P.getShapeChartSpec(shape);
  return {
    part,
    doc,
    ctx,
    roles: chartAxisRoles(
      ctx.area,
      ctx.axes,
      spec.kind === "scatter" || spec.kind === "bubble",
    ),
  };
}
export function chartAxisPositions(p, shape) {
  const { roles } = axes(p, shape);
  return Object.fromEntries(
    Object.entries(roles).map(([role, axis]) => [
      role,
      axis ? getAttrValue(firstChildElement(axis, c("axPos")), val) : null,
    ]),
  );
}
export function chartAxisPositionDeck(kind, highCategory, highValue) {
  const f = chartAxisGridDeck({
    kind,
    categories: ["First", "Second", "Third"],
    categoryAxisCrosses: { at: 1 },
    secondaryCategoryAxisCrosses: { at: 10 },
    valueAxis: { min: 0, max: 60 },
    series: [
      { name: "Primary", values: [1, 2, 3] },
      { name: "Secondary", values: [10, 20, 30], secondaryAxis: true },
    ],
    axes: {
      secondaryCategory: { hidden: false },
      secondaryValue: { min: 10, max: 50 },
    },
  });
  const { doc, ctx, roles } = axes(f.p, f.shape),
    bar = kind === "bar";
  for (const [role, axis] of Object.entries(roles)) {
    const category = role === "category" || role === "secondaryCategory",
      horizontal = category !== bar,
      high = category ? highCategory : highValue;
    firstChildElement(axis, c("axPos")).attrs.find(
      (a) => a.name.localName === "val",
    ).value = horizontal ? (high ? "t" : "b") : high ? "r" : "l";
  }
  // Role lookup must follow plot/crossing references even when both value
  // axes share a physical edge and their XML elements are reordered.
  const nativeAxes = new Set(Object.values(roles));
  const reversed = ctx.area.children.filter((e) => nativeAxes.has(e)).reverse();
  let i = 0;
  ctx.area.children = ctx.area.children.map((e) =>
    nativeAxes.has(e) ? reversed[i++] : e,
  );
  f.part.data = new TextEncoder().encode(serializeXml(doc));
  return f;
}
