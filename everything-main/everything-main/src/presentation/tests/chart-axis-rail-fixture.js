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
  parseXml,
  qname,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";

export const railColors = { category: "#AC2351", secondaryCategory: "#245A41" };
export function chartAxisRailDeck(kind = "column", returned = true) {
  const f = chartAxisGridDeck({
    kind,
    plotAreaFill: "#ECF5E9",
    title: undefined,
    legend: undefined,
    categories: ["A", "B", "C", "D"],
    textStyle: { font: "Arial", sizePt: 12 },
    categoryAxisLabelStyle: {
      font: "Arial",
      sizePt: 12,
      color: railColors.category,
    },
    categoryAxisLineColor: railColors.category,
    secondaryCategoryAxisLineColor: railColors.secondaryCategory,
    categoryAxisCrosses: returned ? { at: 50 } : "min",
    secondaryCategoryAxisCrosses: returned ? { at: 50 } : "min",
    categoryAxisTickLabelPos: "nextTo",
    secondaryCategoryAxisTickLabelPos: "nextTo",
    categoryAxisMajorTickMark: "out",
    categoryAxisMinorTickMark: "none",
    categoryAxisLabelRotationDeg: 0,
    categoryAxisLabelOffset: 200,
    valueAxis: { min: 10, max: 50, majorUnit: 10 },
    valueAxisHidden: true,
    series: [
      { name: "Primary", values: [20, 30, 40, 25] },
      { name: "Secondary", values: [25, 35, 45, 20], secondaryAxis: true },
    ],
    axes: {
      value: { hidden: true },
      secondaryValue: { hidden: true, min: 10, max: 50, majorUnit: 10 },
      secondaryCategory: {
        hidden: false,
        majorTickMark: "out",
        minorTickMark: "none",
      },
    },
  });
  const part = P._internalPackageOf(f.p).getPart(chartRoot(f.shape));
  const doc = parseXml(new TextDecoder().decode(part.data));
  const context = chartPlotContext(doc.root);
  const roles = chartAxisRoles(context.area, context.axes, false);
  const c = (name) => qname("", name, NS.chart);
  for (const role of ["category", "secondaryCategory"]) {
    const axis = roles[role];
    firstChildElement(axis, c("axPos")).attrs[0].value =
      kind === "bar" ? "r" : "t";
    if (role === "secondaryCategory") {
      const offset = firstChildElement(axis, c("lblOffset"));
      if (offset) offset.attrs[0].value = "0";
      else {
        const index = axis.children.findIndex(
          (e) =>
            e.kind === "element" &&
            ["tickLblSkip", "tickMarkSkip", "noMultiLvlLbl", "extLst"].includes(
              e.name.localName,
            ),
        );
        axis.children.splice(
          index < 0 ? axis.children.length : index,
          0,
          parseXml(`<c:lblOffset xmlns:c="${NS.chart}" val="0"/>`).root,
        );
      }
      // Give the secondary axis its independent font/color and explicit angle.
      const txPr = firstChildElement(axis, c("txPr"));
      const replacement = parseXml(
        `<c:txPr xmlns:c="${NS.chart}" xmlns:a="${NS.dml}"><a:bodyPr rot="0"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200"><a:solidFill><a:srgbClr val="245A41"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:pPr></a:p></c:txPr>`,
      ).root;
      if (txPr) axis.children[axis.children.indexOf(txPr)] = replacement;
      else {
        const index = axis.children.findIndex(
          (e) => e.kind === "element" && e.name.localName === "crossAx",
        );
        axis.children.splice(
          index < 0 ? axis.children.length : index,
          0,
          replacement,
        );
      }
    }
  }
  part.data = new TextEncoder().encode(serializeXml(doc));
  return f;
}
