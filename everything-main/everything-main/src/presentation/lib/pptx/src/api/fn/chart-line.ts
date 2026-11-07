import type { PartName } from "../../internal/opc/index.ts";
import {
  NS,
  elem,
  attr,
  qname,
  firstChildElement,
  type XmlElement,
} from "../../internal/xml/index.ts";
import type { SlideData } from "../_internal-symbols.ts";
import { themeBlocks } from "./chart-theme.ts";
import { bindStyleColor } from "./shape-style-reference.ts";
import { styleMatrixEntries } from "./theme-style-matrix.ts";
import { readChartPaint, type ChartPaint } from "./chart-paint.ts";
import { readStrokeWidth } from "./shape-stroke-width.ts";
import {
  readStrokeCap,
  readStrokeDash,
  readStrokeJoin,
  type ShapeStrokeFormatting,
  type ShapeStrokeJoin,
} from "./shape-stroke-formatting.ts";

export interface ChartLine {
  readonly paint: ChartPaint;
  readonly widthEmu: number;
  readonly cap: ShapeStrokeFormatting["cap"];
  readonly dash: ShapeStrokeFormatting["dash"];
  readonly join: ShapeStrokeJoin;
}

const child = (e: XmlElement | null, n: string, ns: string = NS.dml) =>
  e && firstChildElement(e, qname("", n, ns));
const paintChoice = (e: XmlElement | null) =>
  e?.children.find(
    (c): c is XmlElement =>
      c.kind === "element" &&
      c.name.namespaceURI === NS.dml &&
      ["noFill", "solidFill", "gradFill", "pattFill"].includes(
        c.name.localName,
      ),
  );

/** Bind a chart style color before the subtle line entry's own transforms. */
export const chartThemeLine = (
  slide: SlideData,
  part: PartName,
  color: string,
  tint?: number,
  shade?: number,
): XmlElement | null => {
  const fmt = themeBlocks(slide, part).get("fmtScheme")?.element,
    entry = styleMatrixEntries(
      child(fmt ?? null, "lnStyleLst"),
      "lnStyleLst",
    )[0];
  return entry
    ? bindStyleColor(
        entry,
        elem(qname("a", "lnRef", NS.dml), {
          children: [
            elem(qname("a", "schemeClr", NS.dml), {
              attrs: [attr(qname("", "val", ""), color)],
              children: [
                ...(tint === undefined
                  ? []
                  : [
                      elem(qname("a", "tint", NS.dml), {
                        attrs: [attr(qname("", "val", ""), String(tint))],
                      }),
                    ]),
                ...(shade === undefined
                  ? []
                  : [
                      elem(qname("a", "shade", NS.dml), {
                        attrs: [attr(qname("", "val", ""), String(shade))],
                      }),
                    ]),
              ],
            }),
          ],
        }),
      )
    : null;
};

/** DrawingML line properties cascade independently; paint is an atomic choice. */
export const readChartLine = (
  slide: SlideData,
  part: PartName,
  root: XmlElement,
  own: XmlElement | null,
  themeLine: XmlElement | null,
  automatic: boolean,
): ChartLine => {
  const directPaint = paintChoice(own),
    automaticPaint = automatic ? paintChoice(themeLine) : undefined;
  const selected = directPaint ?? automaticPaint;
  let paint: ChartPaint = selected
    ? readChartPaint(slide, part, root, selected)
    : { kind: "none" };
  // An empty solidFill is treated as automatic, distinct from noFill.
  if (directPaint?.name.localName === "solidFill" && paint.kind === "none")
    paint = automaticPaint
      ? readChartPaint(slide, part, root, automaticPaint)
      : { kind: "solid", color: "#000000", opacity: 1 };
  const width = (line: XmlElement | null) => {
    const w = readStrokeWidth(line);
    return w !== null && w <= 20_116_800 ? w : null; // ST_LineWidth
  };
  return {
    paint,
    // Native chart outlines use 0.75pt when no style-matrix width is available.
    // Explicit zero is preserved and never replaced by a display fallback.
    widthEmu: width(own) ?? width(themeLine) ?? 9_525,
    cap:
      (own && readStrokeCap(own)) ??
      (themeLine && readStrokeCap(themeLine)) ??
      "flat",
    dash:
      (own && readStrokeDash(own)) ?? (themeLine && readStrokeDash(themeLine)),
    join: (own && readStrokeJoin(own)) ??
      (themeLine && readStrokeJoin(themeLine)) ?? { kind: "round" },
  };
};
