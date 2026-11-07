import type { ChartSpec } from "../../internal/chartml/types.ts";
import {
  chartPlotContext,
  readChartUnsignedInt,
} from "../../internal/chartml/axis-context.ts";
import type { PartName } from "../../internal/opc/index.ts";
import {
  NS,
  elem,
  attr,
  type XmlElement,
  allChildElements,
  firstChildElement,
  getAttrValue,
  qname,
} from "../../internal/xml/index.ts";
import type { SlideData } from "../_internal-symbols.ts";
import { chartPaintReader, type ChartPaint } from "./chart-paint.ts";
import { readChartLine, type ChartLine } from "./chart-line.ts";
import { readBoolean } from "../../internal/chartml/chart-reader.ts";

// null is explicit noFill, distinct from an absent paint or solid alpha zero.
type FillOpacity = number | null;

// Missing theme data must not turn automatic paint into authored noFill.
// Keep its palette identity so the renderer can use its ordinary fallback.
export type ChartSeriesBodyPaint =
  ChartPaint | { readonly kind: "automatic"; readonly accent: number };

/** Display-only native paints; XML and the editable RGB projection stay intact. */
export interface ChartSeriesOpacity {
  readonly fill: FillOpacity | undefined;
  readonly line: number | undefined;
  readonly markerFill: number | undefined;
  readonly markerLine: number | undefined;
  readonly points?: ReadonlyMap<number, FillOpacity>;
  /** Complete native body paints, kept separate from editable RGB fields. */
  readonly body?: ChartPaint;
  readonly pointBodies?: ReadonlyMap<number, ChartSeriesBodyPaint>;
  readonly pointLines?: ReadonlyMap<number, ChartLine>;
}

const child = (e: XmlElement | null, n: string, ns: string = NS.chart) =>
  e && firstChildElement(e, qname("", n, ns));

export const readChartSeriesOpacities = (
  slide: SlideData,
  part: PartName,
  root: XmlElement,
  spec: ChartSpec,
): ReadonlyArray<ChartSeriesOpacity> => {
  const context = chartPlotContext(root);
  if (!context) return [];
  const readPaint = chartPaintReader(slide, part, root),
    automaticPaints = new Map<number, ChartSeriesBodyPaint>(),
    defaultPointLine = readChartLine(slide, part, root, null, null, false);
  const automaticPaint = (index: number): ChartSeriesBodyPaint => {
    const accent = index % 6;
    let paint = automaticPaints.get(accent);
    if (!paint) {
      paint = readPaint(
        elem(qname("a", "solidFill", NS.dml), {
          children: [
            elem(qname("a", "schemeClr", NS.dml), {
              attrs: [attr(qname("", "val", ""), `accent${accent + 1}`)],
            }),
          ],
        }),
      );
      if (paint.kind === "none") paint = { kind: "automatic", accent };
      automaticPaints.set(accent, paint);
    }
    return paint;
  };
  const opacity = (host: XmlElement | null): number | undefined => {
    const fill = child(host, "solidFill", NS.dml);
    if (!fill) return undefined;
    const paint = readPaint(fill);
    return paint.kind === "solid" ? paint.opacity : undefined;
  };
  const fillOpacity = (
    paint: ChartSeriesBodyPaint | undefined,
  ): FillOpacity | undefined =>
    paint?.kind === "none"
      ? null
      : paint?.kind === "solid"
        ? paint.opacity
        : paint?.kind === "automatic"
          ? 1
          : undefined;
  const body = (host: XmlElement | null): ChartPaint | undefined => {
    for (const node of host?.children ?? [])
      if (
        node.kind === "element" &&
        node.name.namespaceURI === NS.dml &&
        ["noFill", "solidFill", "gradFill", "pattFill", "blipFill"].includes(
          node.name.localName,
        )
      ) {
        const paint = readPaint(node);
        return paint.kind === "none" && node.name.localName !== "noFill"
          ? undefined
          : paint;
      }
    return undefined;
  };
  let index = 0;
  return context.groups.flatMap(({ element }) => {
    const hosts = allChildElements(element, qname("", "ser", NS.chart)),
      varying =
        readBoolean(child(element, "varyColors")) === true &&
        (["pieChart", "pie3DChart", "ofPieChart", "doughnutChart"].includes(
          element.name.localName,
        ) ||
          (["barChart", "bar3DChart"].includes(element.name.localName) &&
            hosts.length === 1));
    return hosts.map((series) => {
      const seriesIndex = index++,
        model = spec.series[seriesIndex],
        sp = child(series, "spPr"),
        marker = child(child(series, "marker"), "spPr"),
        points = new Map<number, FillOpacity>(),
        pointBodies = new Map<number, ChartSeriesBodyPaint>(),
        pointLines = new Map<number, ChartLine>(),
        nativeIndex = child(series, "idx"),
        paletteIndex =
          nativeIndex &&
          readChartUnsignedInt(getAttrValue(nativeIndex, qname("", "val", "")));
      for (const point of allChildElements(
        series,
        qname("", "dPt", NS.chart),
      )) {
        const idx = child(point, "idx"),
          at =
            idx &&
            readChartUnsignedInt(getAttrValue(idx, qname("", "val", "")));
        // Native sparse style indices need not belong to the numeric cache.
        // Keep those in the package without allocating display-only holes.
        if (at == null || at >= (model?.values.length ?? 0)) continue;
        const pointStyle = child(point, "spPr");
        if (!pointStyle) continue;
        // A point record alone inherits the series. Its own spPr starts a new
        // style: omitted fill/line revert to automatic independently (native
        // reference controls), rather than inheriting the series' direct paint.
        const paint =
            body(pointStyle) ??
            automaticPaint(varying ? at : (paletteIndex ?? seriesIndex)),
          alpha = fillOpacity(paint),
          ownLine = child(pointStyle, "ln", NS.dml);
        pointLines.set(
          at,
          ownLine
            ? readChartLine(slide, part, root, ownLine, null, false)
            : defaultPointLine,
        );
        if (alpha !== undefined) points.set(at, alpha);
        if (paint !== undefined) pointBodies.set(at, paint);
      }
      const seriesBody = body(sp);
      return {
        fill: fillOpacity(seriesBody),
        line: opacity(child(sp, "ln", NS.dml)),
        markerFill: opacity(marker),
        markerLine: opacity(child(marker, "ln", NS.dml)),
        ...(points.size ? { points } : {}),
        ...(seriesBody ? { body: seriesBody } : {}),
        ...(pointBodies.size ? { pointBodies } : {}),
        ...(pointLines.size ? { pointLines } : {}),
      };
    });
  });
};
