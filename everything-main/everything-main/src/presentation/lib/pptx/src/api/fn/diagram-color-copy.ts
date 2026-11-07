import {
  NS,
  type XmlElement,
  attr,
  getAttrValue,
  qname,
} from "../../internal/xml/index.ts";
import type { SlideData } from "../_internal-symbols.ts";
import { getEffectiveColorMap } from "./color-map.ts";
import { resolveDrawingColor } from "./shape-color.ts";
import { themeForSlide } from "./shape-theme.ts";

export interface DiagramColorCopy {
  readonly sourceSlide: SlideData;
  readonly preserveTextFormatting?: boolean;
  readonly preservePaintFormatting?: boolean;
}

const textContainers = new Set([
  "t",
  "txBody",
  "txPr",
  "txFillClrLst",
  "txLinClrLst",
  "txEffectClrLst",
]);
const paintContainers = new Set([
  "spPr",
  "grpSpPr",
  "bg",
  "whole",
  "scene3d",
  "sp3d",
  "fillClrLst",
  "linClrLst",
  "effectClrLst",
]);
const namespaces: ReadonlySet<string> = new Set([
  NS.diagram,
  NS.diagramDrawing,
  NS.dml,
  NS.mc,
  NS.dgm1612,
]);

/**
 * Retain explicit diagram colors when copying across template contexts.
 * Both the semantic definitions and saved drawing participate in SmartArt
 * formatting; changing only the drawing would lose colors on native reflow.
 * Resolve the scheme base, retaining transforms, palette intervals, phClr,
 * relationship attributes and opaque extensions. This does not materialize
 * theme style-matrix entries or font references.
 */
export const createDiagramColorCopy = (options: DiagramColorCopy) => {
  let theme: ReturnType<typeof themeForSlide> | undefined;
  let map: ReturnType<typeof getEffectiveColorMap> | undefined;
  return (root: XmlElement): boolean => {
    let changed = false;
    const visit = (el: XmlElement, context: "text" | "paint" | null): void => {
      const { namespaceURI: ns, localName: name } = el.name;
      if (!namespaces.has(ns)) return;
      if (ns === NS.diagram || ns === NS.diagramDrawing) {
        if (textContainers.has(name)) context = "text";
        else if (paintContainers.has(name)) context = "paint";
      } else if (ns === NS.dml) {
        if (name === "fontRef" || name === "lstStyle") context = "text";
        else if (["fillRef", "lnRef", "effectRef"].includes(name))
          context = "paint";
      } else if (ns === NS.dgm1612) {
        if (name === "lstStyle") context = "text";
        else if (name === "spPr") context = "paint";
      }
      const preserve =
        context === "text"
          ? options.preserveTextFormatting === true
          : context === "paint"
            ? options.preservePaintFormatting === true
            : false;
      if (
        preserve &&
        ns === NS.dml &&
        name === "schemeClr" &&
        getAttrValue(el, qname("", "val", "")) !== "phClr"
      ) {
        if (theme === undefined) theme = themeForSlide(options.sourceSlide);
        map ??= getEffectiveColorMap(options.sourceSlide);
        const rgb = resolveDrawingColor(
          { ...el, children: [] },
          theme?.theme ?? null,
          map,
        );
        if (rgb) {
          el.name = qname(el.name.prefix, "srgbClr", NS.dml);
          el.attrs = [
            ...el.attrs.filter(
              (a) => a.name.namespaceURI !== "" || a.name.localName !== "val",
            ),
            attr(qname("", "val", ""), rgb.slice(1)),
          ];
          changed = true;
        }
      }
      for (const child of el.children)
        if (child.kind === "element") visit(child, context);
    };
    visit(root, null);
    return changed;
  };
};
