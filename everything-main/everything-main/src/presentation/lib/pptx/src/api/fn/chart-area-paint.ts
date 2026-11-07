import type { ChartSpec } from "../../internal/chartml/index.ts";
import type { PartName } from "../../internal/opc/index.ts";
import {
  NS,
  type XmlElement,
  elem,
  attr,
  firstChildElement,
  childElements,
  qname,
} from "../../internal/xml/index.ts";
import { type SlideData } from "../_internal-symbols.ts";
import { themeBlocks } from "./chart-theme.ts";
import { bindStyleColor } from "./shape-style-reference.ts";
import { styleMatrixEntries } from "./theme-style-matrix.ts";
import { readChartPaint, type ChartPaint } from "./chart-paint.ts";

export type ChartAreaPaint = ChartPaint;

const child = (r: XmlElement, n: string, ns: string = NS.dml) =>
  firstChildElement(r, qname("", n, ns));

// A 3-D plot's walls/floor are separate surfaces, never its automatic
// plot-area fill. Surface charts (including contour views) are 3-D charts.
const threeDimensionalGroups = new Set([
  "bar3DChart",
  "line3DChart",
  "area3DChart",
  "pie3DChart",
  "surfaceChart",
  "surface3DChart",
]);
const pieGroups = new Set(["pieChart", "ofPieChart", "doughnutChart"]);

/** Display-only surface paint: defaults must not become authored settings. */
const readChartSurfacePaint = (
  slide: SlideData,
  part: PartName,
  root: XmlElement,
  spec: ChartSpec,
  area: "chart" | "plot",
): ChartAreaPaint => {
  const chart = child(root, "chart", NS.chart),
    plot = chart && child(chart, "plotArea", NS.chart),
    surface = area === "plot" ? plot : root,
    spPr = surface && child(surface, "spPr", NS.chart);
  let fill = styleMatrixEntries(spPr ?? null, "fillStyleLst")[0];
  let owner = part;
  if (!fill) {
    // ECMA-376 21.2.3.46 tables 1/3; MS-ODRAWXML 2.7.4.1.
    // In a PresentationML host, styles 1–32 are transparent (native reference).
    const style = spec.chartStyle ?? 2;
    if (style <= 32) return { kind: "none" };
    let color = style <= 40 ? "lt1" : "dk1",
      tint: number | undefined;
    if (area === "plot") {
      if (!plot) return { kind: "none" };
      const groups = [...childElements(plot)].filter(
        (e) =>
          e.name.namespaceURI === NS.chart &&
          e.name.localName.endsWith("Chart"),
      );
      // Pie/doughnut automatic plot surfaces stay transparent, but explicit
      // paint is still honored. 3-D uses walls/floor instead.
      if (
        groups.some((e) => threeDimensionalGroups.has(e.name.localName)) ||
        groups.every((e) => pieGroups.has(e.name.localName))
      )
        return { kind: "none" };
      color = style <= 34 || style >= 41 ? "dk1" : `accent${style - 34}`;
      tint =
        style <= 34
          ? 20000
          : style >= 41
            ? 95000
            : spec.chartStyleVariant === "office2010"
              ? 20000
              : undefined;
    }
    const block = themeBlocks(slide, part).get("fmtScheme");
    const entry =
      block &&
      styleMatrixEntries(
        child(block.element, "fillStyleLst"),
        "fillStyleLst",
      )[0];
    if (!entry) return { kind: "none" };
    owner = block!.owner;
    fill = bindStyleColor(
      entry,
      elem(qname("a", "fillRef", NS.dml), {
        children: [
          elem(qname("a", "schemeClr", NS.dml), {
            attrs: [attr(qname("", "val", ""), color)],
            children:
              tint === undefined
                ? []
                : [
                    elem(qname("a", "tint", NS.dml), {
                      attrs: [attr(qname("", "val", ""), String(tint))],
                    }),
                  ],
          }),
        ],
      }),
    );
  }
  return readChartPaint(slide, part, root, fill, owner);
};

/** Native XML, style identity and public ChartSpec stay authored. */
export const readChartAreaPaint = (
  slide: SlideData,
  part: PartName,
  root: XmlElement,
  spec: ChartSpec,
): ChartAreaPaint => readChartSurfacePaint(slide, part, root, spec, "chart");

export const readChartPlotAreaPaint = (
  slide: SlideData,
  part: PartName,
  root: XmlElement,
  spec: ChartSpec,
): ChartAreaPaint => readChartSurfacePaint(slide, part, root, spec, "plot");
