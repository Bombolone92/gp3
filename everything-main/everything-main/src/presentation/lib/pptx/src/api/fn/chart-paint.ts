import type { GradientFillOptions } from "../../internal/drawingml/index.ts";
import type { PartName } from "../../internal/opc/index.ts";
import { NS, type XmlElement } from "../../internal/xml/index.ts";
import { INTERNAL_PACKAGE, type SlideData } from "../_internal-symbols.ts";
import { themeForChartPart, colorMapForChart } from "./chart-theme.ts";
import { resolveDrawingColor, resolveDrawingOpacity } from "./shape-color.ts";
import { parseGradFill } from "./shape-gradient-read.ts";
import { readPatternFill, type PatternFillData } from "./pattern-fill-read.ts";
import { readImagePaint, type ShapeImagePaint } from "./shape-image-effects.ts";

export type ChartPaint =
  | { kind: "none" }
  | { kind: "solid"; color: string; opacity: number }
  | { kind: "gradient"; gradient: GradientFillOptions }
  | { kind: "pattern"; pattern: PatternFillData }
  | { kind: "image"; image: ShapeImagePaint };

/** Resolve one chart context for repeated read-only DrawingML paints. */
export const chartPaintReader = (
  slide: SlideData,
  part: PartName,
  root: XmlElement,
) => {
  const theme = themeForChartPart(slide, part).theme,
    mapping = colorMapForChart(slide, root),
    resolve = (c: XmlElement) => resolveDrawingColor(c, theme, mapping);
  return (fill: XmlElement, owner = part): ChartPaint => {
    switch (fill.name.localName) {
      case "solidFill":
        for (const c of fill.children) {
          if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
          const color = resolve(c);
          if (color)
            return { kind: "solid", color, opacity: resolveDrawingOpacity(c) };
        }
        break;
      case "gradFill": {
        const gradient = parseGradFill(fill, { theme, clrMap: mapping });
        if (gradient) return { kind: "gradient", gradient };
        break;
      }
      case "pattFill":
        return { kind: "pattern", pattern: readPatternFill(fill, resolve) };
      case "blipFill":
        return {
          kind: "image",
          image: readImagePaint(slide[INTERNAL_PACKAGE], owner, fill, resolve),
        };
    }
    return { kind: "none" };
  };
};

/** Read-only DrawingML paint shared by chart surfaces and their outlines. */
export const readChartPaint = (
  slide: SlideData,
  part: PartName,
  root: XmlElement,
  fill: XmlElement,
  owner = part,
): ChartPaint => chartPaintReader(slide, part, root)(fill, owner);
