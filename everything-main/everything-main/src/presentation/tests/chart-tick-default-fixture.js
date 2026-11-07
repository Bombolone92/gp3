import { P } from "../src/model.js";
import {
  chartAxisGridDeck,
  setChartAxisGridDeclarations,
} from "./chart-axis-grid-fixture.js";
import { chartMarkerPaintDeck, chartRoot } from "./chart-copy-fixture.js";
import {
  chartAxisRoles,
  chartPlotContext,
} from "../lib/pptx/src/internal/chartml/axis-context.ts";
import {
  NS,
  parseXml,
  serializeXml,
  qname,
  firstChildElement,
} from "../lib/pptx/src/internal/xml/index.ts";

export const tickAxisColors = {
  category: "#604020",
  value: "#202020",
  secondaryCategory: "#804040",
  secondaryValue: "#404080",
};
// One mark channel varies; every other channel is explicitly disabled.
export function chartTickDefaultDeck({
  kind = "column",
  role = "category",
  which = "major",
  mode = "omit",
} = {}) {
  const axes = {
    category: {
      hidden: false,
      major: false,
      minor: false,
      majorTickMark: "none",
      minorTickMark: "none",
    },
    value: {
      hidden: false,
      major: false,
      minor: false,
      majorTickMark: "none",
      minorTickMark: "none",
    },
  };
  const secondary = role.startsWith("secondary");
  if (secondary) {
    axes.secondaryCategory = { ...axes.category };
    axes.secondaryValue = {
      ...axes.value,
      min: 5,
      max: 45,
      majorUnit: 10,
      minorUnit: 2,
    };
  }
  let f;
  if (kind === "scatter") {
    f = chartMarkerPaintDeck("scatter");
    axes.category = {
      ...axes.category,
      min: 0,
      max: 8,
      majorUnit: 2,
      minorUnit: 0.5,
    };
    axes.value = {
      ...axes.value,
      min: -3,
      max: 6,
      majorUnit: 2,
      minorUnit: 0.5,
    };
    setChartAxisGridDeclarations(f, axes, true);
  } else {
    f = chartAxisGridDeck({
      kind,
      legend: undefined,
      title: undefined,
      plotAreaFill: "#F7F9FB",
      categories: ["A", "B", "C", "D"],
      textStyle: { font: "Arial", sizePt: 12 },
      valueAxis: { min: 0, max: 5, majorUnit: 1, minorUnit: 0.2 },
      series: [
        { name: "Primary", values: [1, 4, 2, 3], color: "#E85239" },
        ...(secondary
          ? [
              {
                name: "Secondary",
                chartKind: kind === "bar" ? "bar" : "line",
                secondaryAxis: true,
                values: [10, 40, 20, 30],
                color: "#376CA8",
              },
            ]
          : []),
      ],
      axes,
    });
  }
  f.part ??= P._internalPackageOf(f.p).getPart(chartRoot(f.shape));
  const doc = parseXml(new TextDecoder().decode(f.part.data)),
    context = chartPlotContext(doc.root),
    roles = chartAxisRoles(context.area, context.axes, kind === "scatter");
  for (const [name, axis] of Object.entries(roles)) {
    if (!axis) continue;
    const child = (n) => firstChildElement(axis, qname("", n, NS.chart));
    const sp = child("spPr");
    const line = parseXml(
      `<c:spPr xmlns:c="${NS.chart}" xmlns:a="${NS.dml}"><a:ln w="12700"><a:solidFill><a:srgbClr val="${tickAxisColors[name].slice(1)}"/></a:solidFill></a:ln></c:spPr>`,
    ).root;
    if (sp) axis.children[axis.children.indexOf(sp)] = line;
    else axis.children.splice(axis.children.indexOf(child("crossAx")), 0, line);
  }
  const axis = roles[role],
    local = which + "TickMark",
    mark = firstChildElement(axis, qname("", local, NS.chart)),
    at = axis.children.indexOf(mark);
  if (mode === "omit") axis.children.splice(at, 1);
  else if (mode === "empty") mark.attrs = [];
  else mark.attrs.find((a) => a.name.localName === "val").value = mode;
  f.part.data = new TextEncoder().encode(serializeXml(doc));
  return f;
}
