import { lineWidthEmu } from "../bounds.ts";
import {
  NS,
  firstChildElement,
  getAttrValue,
  qname,
  type XmlElement,
} from "../xml/index.ts";

export const CHART_STROKE_WIDTH_FIELDS = [
  "categoryAxisLineWidthEmu",
  "valueAxisLineWidthEmu",
  "categoryAxisMajorGridlineWidthEmu",
  "categoryAxisMinorGridlineWidthEmu",
  "valueAxisMajorGridlineWidthEmu",
  "valueAxisMinorGridlineWidthEmu",
  "secondaryCategoryAxisLineWidthEmu",
  "secondaryValueAxisLineWidthEmu",
  "plotAreaStrokeWidthEmu",
  "chartAreaStrokeWidthEmu",
] as const;

// Read explicit DrawingML ST_LineWidth independently of its line paint.
// Missing/malformed values keep the chart's inherited/default width, while
// zero is a valid authored width. Do not repair or mutate source XML.
export const readChartStrokeWidth = (
  parent: XmlElement | null | undefined,
): number | undefined => {
  const sp = parent && firstChildElement(parent, qname("c", "spPr", NS.chart));
  const ln = sp && firstChildElement(sp, qname("a", "ln", NS.dml));
  const raw = ln && getAttrValue(ln, qname("", "w", ""));
  if (raw == null) return undefined;
  const token = raw.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
  if (!/^[+-]?\d+$/.test(token)) return undefined;
  try {
    return lineWidthEmu(Number(token), "chart stroke width");
  } catch {
    return undefined;
  }
};
