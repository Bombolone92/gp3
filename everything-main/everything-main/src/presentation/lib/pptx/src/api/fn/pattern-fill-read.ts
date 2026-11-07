import { resolveDrawingOpacity } from "./shape-color.ts";
import {
  NS,
  type XmlElement,
  firstChildElement,
  getAttrValue,
  qname,
} from "../../internal/xml/index.ts";

/** Resolved pattern channels. Omitted opacity means opaque, as for solid fills. */
export interface PatternFillData {
  preset: string;
  foreground: string;
  background: string;
  foregroundOpacity?: number;
  backgroundOpacity?: number;
}

/** Resolve RGB and alpha from the same qualified color, in the owner's context. */
export const readPatternFill = (
  fill: XmlElement,
  resolveColor: (color: XmlElement) => string | null,
): PatternFillData => {
  const channel = (name: string, fallback: string) => {
    const parent = firstChildElement(fill, qname("a", name, NS.dml));
    for (const child of parent?.children ?? []) {
      if (child.kind !== "element" || child.name.namespaceURI !== NS.dml)
        continue;
      const color = resolveColor(child);
      if (color) return { color, opacity: resolveDrawingOpacity(child) };
    }
    return { color: fallback, opacity: 1 };
  };
  const fg = channel("fgClr", "#000000"),
    bg = channel("bgClr", "#FFFFFF");
  return {
    // MS-OI29500 20.1.8: the hard-coded pattern default is pct5.
    preset: getAttrValue(fill, qname("", "prst", "")) ?? "pct5",
    foreground: fg.color,
    background: bg.color,
    ...(fg.opacity === 1 ? {} : { foregroundOpacity: fg.opacity }),
    ...(bg.opacity === 1 ? {} : { backgroundOpacity: bg.opacity }),
  };
};
