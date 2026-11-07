import { P } from "../src/model.js";
import { chartAxisGridDeck } from "./chart-axis-grid-fixture.js";
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
export const categoryAxisColors = { primary: "#AC2351", secondary: "#245A41" };
export function categoryAxisDataDeck({
  kind = "column",
  primaryCount = 4,
  secondaryCount = 4,
  sources,
  shared = false,
  reverseAxes = false,
  swapPositions = false,
  sourceLinked = true,
  categoryFormat = "0.00",
  noPrimary = false,
  groupOrder,
} = {}) {
  const values = (n) => Array.from({ length: n }, (_, i) => 15 + 5 * (i % 4));
  const f = chartAxisGridDeck({
    kind,
    title: undefined,
    legend: undefined,
    plotAreaFill: "#F7F9FB",
    categories: ["P-A", "P-B", "P-C", "P-D"],
    textStyle: { font: "Arial", sizePt: 12 },
    categoryAxisLabelStyle: {
      font: "Arial",
      sizePt: 12,
      color: categoryAxisColors.primary,
    },
    categoryAxisLineColor: categoryAxisColors.primary,
    secondaryCategoryAxisLineColor: categoryAxisColors.secondary,
    categoryAxisLabelRotationDeg: 0,
    categoryAxisTickLabelSkip: 1,
    categoryAxisCrosses: "min",
    secondaryCategoryAxisCrosses: "max",
    valueAxisHidden: true,
    valueAxis: { min: 10, max: 50, majorUnit: 10 },
    categoryAxisMajorTickMark: "out",
    categoryAxisMinorTickMark: "none",
    series: [
      { name: "Primary first", values: values(primaryCount) },
      {
        name: "Primary other",
        chartKind: kind === "bar" ? "bar" : "line",
        values: values(primaryCount),
      },
      {
        name: "Secondary first",
        secondaryAxis: true,
        values: values(secondaryCount),
      },
      {
        name: "Secondary other",
        secondaryAxis: true,
        chartKind: kind === "bar" ? "bar" : "line",
        values: values(secondaryCount),
      },
    ],
    axes: {
      secondaryCategory: {
        hidden: false,
        majorTickMark: "out",
        minorTickMark: "none",
      },
      secondaryValue: { hidden: true, min: 10, max: 50, majorUnit: 10 },
    },
  });
  const c = (n) => qname("", n, NS.chart),
    child = (e, n) => e && firstChildElement(e, c(n));
  const node = (xml) =>
    parseXml(
      `<c:wrapper xmlns:c="${NS.chart}" xmlns:a="${NS.dml}">${xml}</c:wrapper>`,
    ).root.children[0];
  const doc = parseXml(new TextDecoder().decode(f.part.data)),
    context = chartPlotContext(doc.root),
    roles = chartAxisRoles(context.area, context.axes, false);
  const defaults = ["P", "Q", "S", "T"].map((prefix, i) => ({
    values: Array.from(
      { length: i < 2 ? primaryCount : secondaryCount },
      (_, j) => `${prefix}-${String.fromCharCode(65 + j)}`,
    ),
  }));
  for (const { element: group } of context.groups) {
    if (noPrimary && !context.axes.groupUsesSecondaryAxis(group)) {
      group.children = group.children.filter(
        (e) => e.kind !== "element" || e.name.localName !== "ser",
      );
      continue;
    }
    for (const series of group.children.filter(
      (e) => e.kind === "element" && e.name.localName === "ser",
    )) {
      const index = Number(
          getAttrValue(child(series, "idx"), qname("", "val", "")),
        ),
        source =
          sources?.[index] === undefined ? defaults[index] : sources[index];
      const old = child(series, "cat"),
        at = series.children.indexOf(old);
      if (source === null) {
        series.children.splice(at, 1);
        continue;
      }
      const type = source.type ?? "strLit",
        numeric = type.startsWith("num"),
        points = source.points ?? source.values.map((v, i) => [i, v]);
      const count = source.count ?? source.values?.length ?? 0;
      const data = `${numeric ? `<c:formatCode>${source.format ?? "General"}</c:formatCode>` : ""}<c:ptCount val="${count}"/>${points.map(([i, v]) => `<c:pt idx="${i}"><c:v>${String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</c:v></c:pt>`).join("")}`;
      const body =
        type === "multiLvlStrRef"
          ? `<c:multiLvlStrRef><c:f>Sheet1!$A$2:$A$5</c:f><c:multiLvlStrCache><c:ptCount val="${count}"/><c:lvl>${points.map(([i, v]) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("")}</c:lvl></c:multiLvlStrCache></c:multiLvlStrRef>`
          : source.cacheMissing
            ? `<c:${type}><c:f>Sheet1!$A$2:$A$5</c:f></c:${type}>`
            : type.endsWith("Ref")
              ? `<c:${type}><c:f>Sheet1!$A$2:$A$5</c:f><c:${numeric ? "numCache" : "strCache"}>${data}</c:${numeric ? "numCache" : "strCache"}></c:${type}>`
              : `<c:${type}>${data}</c:${type}>`;
      series.children.splice(at, 1, node(`<c:cat>${body}</c:cat>`));
    }
  }
  const secondary = roles.secondaryCategory,
    tx = child(secondary, "txPr"),
    replacement = node(
      '<c:txPr><a:bodyPr rot="0"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200"><a:solidFill><a:srgbClr val="245A41"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:pPr></a:p></c:txPr>',
    );
  if (tx) secondary.children[secondary.children.indexOf(tx)] = replacement;
  else secondary.children.push(replacement);
  secondary.children.push(node('<c:tickLblSkip val="1"/>'));
  if (sources?.[2]?.type?.startsWith("num"))
    secondary.children.push(
      node(
        `<c:numFmt formatCode="${categoryFormat}" sourceLinked="${sourceLinked ? 1 : 0}"/>`,
      ),
    );
  if (swapPositions)
    for (const a of [roles.value, roles.secondaryValue]) {
      const pos = child(a, "axPos");
      pos.attrs[0].value =
        pos.attrs[0].value === (kind === "bar" ? "b" : "l")
          ? kind === "bar"
            ? "t"
            : "r"
          : kind === "bar"
            ? "b"
            : "l";
    }
  if (shared) {
    const attr = (e) => getAttrValue(e, qname("", "val", "")),
      oldId = attr(child(secondary, "axId")),
      id = attr(child(roles.category, "axId"));
    for (const { element: group } of context.groups)
      for (const e of group.children.filter(
        (e) => e.kind === "element" && e.name.localName === "axId",
      ))
        if (attr(e) === oldId) e.attrs[0].value = id;
    child(roles.secondaryValue, "crossAx").attrs[0].value = id;
    context.area.children = context.area.children.filter(
      (e) => e !== secondary,
    );
  }
  if (reverseAxes) {
    const axes = Object.values(roles),
      reversed = axes.slice().reverse();
    let i = 0;
    context.area.children = context.area.children.map((e) =>
      axes.includes(e) ? reversed[i++] : e,
    );
  }
  if (groupOrder) {
    const groups = context.groups.map((g) => g.element);
    let i = 0;
    context.area.children = context.area.children.map((e) =>
      groups.includes(e) ? groups[groupOrder[i++]] : e,
    );
  }
  f.part.data = new TextEncoder().encode(serializeXml(doc));
  return f;
}
