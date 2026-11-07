import { P } from "../src/model.js";
import { chartAxisGridDeck } from "./chart-axis-grid-fixture.js";
import {
  chartAxisRoles,
  chartPlotContext,
} from "../lib/pptx/src/internal/chartml/axis-context.ts";
import {
  NS,
  firstChildElement,
  parseXml,
  qname,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";

export const labelGapColors = ["#604020", "#804040"];
export function chartAxisLabelGapDeck({
  kind = "bar",
  font = "Arial",
  sizePt = 12,
  secondaryFont = font,
  secondarySizePt = sizePt,
  distance = 100,
  secondaryDistance = distance,
  mark = "none",
  secondary = false,
  high = false,
  angle = 0,
  line = true,
} = {}) {
  const bar = kind === "bar",
    crossing = high ? "max" : "min";
  const f = chartAxisGridDeck({
    kind,
    title: undefined,
    legend: undefined,
    categories: ["A", "B", "C", "D"],
    textStyle: { font: "Arial", sizePt: 12 },
    plotAreaFill: "#ECF5E9",
    chartAreaStrokeColor: null,
    categoryAxisHidden: !bar,
    valueAxisHidden: bar,
    categoryAxisCrosses: crossing,
    valueAxisCrosses: crossing,
    secondaryCategoryAxisCrosses: crossing,
    secondaryValueAxisCrosses: crossing,
    categoryAxisLabelOffset: distance,
    categoryAxisLabelStyle: { font, sizePt, color: labelGapColors[0] },
    valueAxisLabelStyle: { font, sizePt, color: labelGapColors[0] },
    categoryAxisLineColor: line ? labelGapColors[0] : null,
    valueAxisLineColor: line ? labelGapColors[0] : null,
    secondaryCategoryAxisLineColor: line ? labelGapColors[1] : null,
    secondaryValueAxisLineColor: line ? labelGapColors[1] : null,
    categoryAxisLabelRotationDeg: angle,
    valueAxisLabelRotationDeg: angle,
    valueAxis: { min: 0, max: 6, majorUnit: 2 },
    series: [
      { name: "First", values: [2, 4, 3, 5], color: "#E85239" },
      ...(secondary
        ? [
            {
              name: "Second",
              values: [3, 2, 4, 1],
              secondaryAxis: true,
              color: "#376CA8",
            },
          ]
        : []),
    ],
    axes: Object.fromEntries(
      (secondary
        ? ["category", "value", "secondaryCategory", "secondaryValue"]
        : ["category", "value"]
      ).map((role) => [
        role,
        {
          hidden: role.toLowerCase().includes("category") ? !bar : bar,
          majorTickMark: mark,
          minorTickMark: "none",
          ...(role.toLowerCase().includes("value")
            ? { min: 0, max: 6, majorUnit: 2 }
            : {}),
        },
      ]),
    ),
  });
  const doc = parseXml(new TextDecoder().decode(f.part.data)),
    context = chartPlotContext(doc.root),
    roles = chartAxisRoles(context.area, context.axes),
    c = (name) => qname("", name, NS.chart);
  for (const [i, role] of (bar
    ? ["category", "secondaryCategory"]
    : ["value", "secondaryValue"]
  ).entries()) {
    const axis = roles[role];
    if (!axis) continue;
    const text = parseXml(
      `<c:txPr xmlns:c="${NS.chart}" xmlns:a="${NS.dml}"><a:bodyPr rot="${angle * 60000}"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${(i ? secondarySizePt : sizePt) * 100}"><a:solidFill><a:srgbClr val="${labelGapColors[i].slice(1)}"/></a:solidFill><a:latin typeface="${i ? secondaryFont : font}"/></a:defRPr></a:pPr></a:p></c:txPr>`,
    ).root;
    const prior = firstChildElement(axis, c("txPr"));
    if (prior) axis.children[axis.children.indexOf(prior)] = text;
    else
      axis.children.splice(
        axis.children.findIndex(
          (e) => e.kind === "element" && e.name.localName === "crossAx",
        ),
        0,
        text,
      );
    if (bar) {
      const offset = firstChildElement(axis, c("lblOffset"));
      if (offset)
        offset.attrs[0].value = String(i ? secondaryDistance : distance);
      else
        axis.children.push(
          parseXml(
            `<c:lblOffset xmlns:c="${NS.chart}" val="${i ? secondaryDistance : distance}"/>`,
          ).root,
        );
    }
  }
  f.part.data = new TextEncoder().encode(serializeXml(doc));
  return f;
}
