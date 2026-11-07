import { P } from "../src/model.js";
import { chartAxisGridDeck } from "./chart-axis-grid-fixture.js";
import { chartRoot } from "./chart-copy-fixture.js";
import { axisLineModes } from "./chart-axis-line-fixture.js";
import { chartPlotContext } from "../lib/pptx/src/internal/chartml/axis-context.ts";
import {
  NS,
  parseXml,
  serializeXml,
  allChildElements,
  firstChildElement,
  getAttrValue,
  qname,
  withInheritedNamespaces,
} from "../lib/pptx/src/internal/xml/index.ts";

export const guideLineModes = {
  ...axisLineModes,
  gradientTile: axisLineModes.gradient.replace(
    "</a:gradFill>",
    '<a:tileRect l="15000" t="20000" r="45000" b="35000"/></a:gradFill>',
  ),
  compound:
    '<a:ln w="50800" cmpd="dbl"><a:solidFill><a:schemeClr val="accent3"/></a:solidFill></a:ln>',
  extension:
    '<a:ln w="38100"><a:solidFill><a:srgbClr val="9132AD"/></a:solidFill><a:extLst><a:ext uri="urn:test:guide"><gx:payload gx:mode="retained"/></a:ext></a:extLst></a:ln>',
};
const c = (n) => qname("", n, NS.chart),
  child = (e, n) => firstChildElement(e, c(n)),
  val = (e) => getAttrValue(e, qname("", "val", ""));
export function chartPlotGuidesDeck({
  groups = [
    { kind: "column" },
    { kind: "line", secondary: true, dropLines: "custom", hiLowLines: "color" },
  ],
  ...options
} = {}) {
  const f = chartAxisGridDeck({
    kind: groups[0].kind,
    grouping: "standard",
    categories: ["North", "South", "East", "West"],
    series: groups.flatMap((group, i) =>
      [0, 1].map((s) => ({
        name: `Group ${i + 1} series ${s + 1}`,
        values: s ? [25, 11, -8, 19] : [8, -6, 14, 38],
        color: s ? "#425EA8" : "#D85532",
        markerSymbol: "none",
        chartKind: group.kind,
        secondaryAxis: !!group.secondary,
      })),
    ),
    valueAxis: { min: -10, max: 60 },
    textStyle: { font: "Arial", sizePt: 10 },
    legend: undefined,
    title: undefined,
    ...options,
  });
  f.part = P._internalPackageOf(f.p).getPart(
    chartRoot(f.shape ?? P.getSlideCharts(f.slide)[0].shape),
  );
  const doc = parseXml(new TextDecoder().decode(f.part.data)),
    context = chartPlotContext(doc.root),
    native = groups.map((cfg, i) => {
      const host = context.groups.find(({ element }) => {
        const name = element.name.localName,
          kind =
            name === "barChart"
              ? val(child(element, "barDir")) === "bar"
                ? "bar"
                : "column"
              : name.replace("Chart", "");
        return (
          kind === cfg.kind &&
          context.axes.groupUsesSecondaryAxis(element) === !!cfg.secondary
        );
      }).element;
      const group = structuredClone(host),
        members = allChildElements(group, c("ser")).filter((ser) =>
          [i * 2, i * 2 + 1].includes(Number(val(child(ser, "idx")))),
        );
      group.children = group.children.filter(
        (e) => e.kind !== "element" || e.name.localName !== "ser",
      );
      group.children.splice(2, 0, ...members);
      for (const [s, ser] of members.entries()) {
        // Native idx is independent of model position. Keep it within the
        // chart's series domain so .pptx readers accept the diagnostic itself.
        child(ser, "idx").attrs[0].value = String(
          groups.length * 2 - i * 2 - s - 1,
        );
        child(ser, "order").attrs[0].value = String(i * 2 + s);
      }
      if (cfg.grouping) child(group, "grouping").attrs[0].value = cfg.grouping;
      for (const name of ["dropLines", "hiLowLines"]) {
        if (cfg[name] === undefined || cfg[name] === false) continue;
        const line = guideLineModes[cfg[name]],
          wrapper = parseXml(
            `<c:wrapper xmlns:c="${NS.chart}" xmlns:a="${NS.dml}" xmlns:gx="urn:test:guide-payload"><c:${name}>${line ? `<c:spPr>${line}</c:spPr>` : ""}</c:${name}></c:wrapper>`,
          ).root,
          guide = withInheritedNamespaces(wrapper.children[0], [wrapper]),
          at = group.children.findIndex(
            (e) =>
              e.kind === "element" &&
              ["marker", "smooth", "axId"].includes(e.name.localName),
          );
        group.children.splice(at < 0 ? group.children.length : at, 0, guide);
      }
      return group;
    }),
    first = context.area.children.indexOf(context.groups[0].element),
    old = new Set(context.groups.map((g) => g.element));
  context.area.children = context.area.children.filter((e) => !old.has(e));
  context.area.children.splice(first, 0, ...native);
  f.part.data = new TextEncoder().encode(serializeXml(doc));
  return f;
}

const semantic = (e) =>
  e && {
    name: [e.name.namespaceURI, e.name.localName],
    attrs: e.attrs
      .map((a) => [a.name.namespaceURI, a.name.localName, a.value])
      .sort(),
    children: e.children.map((n) => (n.kind === "element" ? semantic(n) : n)),
  };
export function chartPlotGuideState(p, shape) {
  const part = P._internalPackageOf(p).getPart(chartRoot(shape)),
    root = parseXml(new TextDecoder().decode(part.data)).root,
    context = chartPlotContext(root);
  return context.groups.map(({ element }) => ({
    kind: element.name.localName,
    secondary: context.axes.groupUsesSecondaryAxis(element),
    members: allChildElements(element, qname("", "ser", NS.chart)).map((s) =>
      Number(getAttrValue(child(s, "idx"), qname("", "val", ""))),
    ),
    grouping: getAttrValue(child(element, "grouping"), qname("", "val", "")),
    dropLines: semantic(child(element, "dropLines")),
    hiLowLines: semantic(child(element, "hiLowLines")),
    order: element.children
      .filter((n) => n.kind === "element")
      .map((n) => n.name.localName),
  }));
}

// Explicit guide paint for geometry tests, independent of automatic chart styles.
export function paintPlotGuides(f) {
  const part = P._internalPackageOf(f.p).getPart(
    chartRoot(f.shape ?? P.getSlideCharts(f.slide)[0].shape),
  );
  const doc = parseXml(new TextDecoder().decode(part.data));
  let changed = false;
  for (const { element } of chartPlotContext(doc.root).groups)
    for (const [name, color] of [
      ["dropLines", "9CA3AF"],
      ["hiLowLines", "4B5563"],
    ]) {
      const guide = child(element, name);
      if (!guide || child(guide, "spPr")) continue;
      guide.children.push(
        parseXml(
          `<c:spPr xmlns:c="${NS.chart}" xmlns:a="${NS.dml}"><a:ln w="9525"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr>`,
        ).root,
      );
      changed = true;
    }
  if (changed) part.data = new TextEncoder().encode(serializeXml(doc));
  return f;
}
