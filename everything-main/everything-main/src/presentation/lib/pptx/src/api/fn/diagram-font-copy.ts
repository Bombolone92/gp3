import {
  NS,
  type XmlElement,
  attr,
  firstChildElement,
  getAttrValue,
  qname,
} from "../../internal/xml/index.ts";
import type { DiagramColorCopy } from "./diagram-color-copy.ts";
import { themeForSlide } from "./shape-theme.ts";
import { resolveThemeTypeface } from "./theme.ts";

const fontElements = new Set(["latin", "ea", "cs", "sym", "buFont"]);
const textContainers = new Set(["t", "txBody", "txPr"]);
const paintContainers = new Set([
  "spPr",
  "grpSpPr",
  "bg",
  "whole",
  "scene3d",
  "sp3d",
]);
const namespaces: ReadonlySet<string> = new Set([
  NS.diagram,
  NS.diagramDrawing,
  NS.dml,
  NS.mc,
  NS.dgm1612,
]);
const value = (el: XmlElement, name: string) =>
  getAttrValue(el, qname("", name, ""));
const child = (el: XmlElement | null, name: string) =>
  el && firstChildElement(el, qname("", name, NS.dml));
const unspecified = (name: string, field: string | null): boolean =>
  field === null ||
  (name === "pitchFamily" && Number(field) === 0) ||
  (name === "panose" && /^0{20}$/.test(field.trim()));

/** Resolve explicitly authored theme-font typefaces in copied diagram text.
 * Keep semantic and saved definitions aligned, preserve explicit descriptors,
 * and leave unresolved slots and opaque extension content intact. fontRef's
 * implicit defaults need a separate formatting operation; they are not fonts
 * that can be replaced by a typeface attribute in that schema vocabulary.
 */
export const createDiagramFontCopy = (options: DiagramColorCopy) => {
  let theme: ReturnType<typeof themeForSlide> | undefined;
  return (root: XmlElement): boolean => {
    if (options.preserveTextFormatting !== true) return false;
    let changed = false;
    const visit = (el: XmlElement, text: boolean): void => {
      const { namespaceURI: ns, localName: name } = el.name;
      if (!namespaces.has(ns)) return;
      // Only the recognized list-style payload inside extensions contributes
      // text properties. Never search opaque wrappers for familiar font tags.
      if (name === "extLst" && ns !== NS.mc) {
        for (const ext of el.children) {
          if (
            ext.kind !== "element" ||
            ext.name.namespaceURI !== NS.dml ||
            ext.name.localName !== "ext"
          )
            continue;
          for (const payload of ext.children)
            if (
              payload.kind === "element" &&
              payload.name.namespaceURI === NS.dgm1612 &&
              payload.name.localName === "lstStyle"
            )
              visit(payload, true);
        }
        return;
      }
      if (ns === NS.diagram || ns === NS.diagramDrawing) {
        if (textContainers.has(name)) text = true;
        else if (paintContainers.has(name)) text = false;
      } else if (ns === NS.dml || ns === NS.dgm1612) {
        if (name === "lstStyle") text = true;
        else if (paintContainers.has(name)) text = false;
      }
      const token =
        ns === NS.dml && text && fontElements.has(name)
          ? value(el, "typeface")
          : null;
      const match = token?.match(/^\+m([jn])-(lt|ea|cs)$/);
      if (match) {
        if (theme === undefined) theme = themeForSlide(options.sourceSlide);
        const family = resolveThemeTypeface(token, theme?.fonts);
        if (family) {
          el.attrs = el.attrs.map((a) =>
            a.name.namespaceURI === "" && a.name.localName === "typeface"
              ? { ...a, value: family }
              : a,
          );
          // Theme font descriptors describe matching/fallback behavior, not
          // font binaries. Direct authored attributes retain precedence.
          const scheme = child(
              child(theme?.root ?? null, "themeElements"),
              "fontScheme",
            ),
            collection = child(
              scheme,
              match[1] === "j" ? "majorFont" : "minorFont",
            ),
            declaration = child(
              collection,
              match[2] === "lt" ? "latin" : match[2] === "ea" ? "ea" : "cs",
            );
          for (const field of ["panose", "pitchFamily", "charset"]) {
            const inherited = declaration && value(declaration, field);
            if (
              !unspecified(field, value(el, field)) ||
              unspecified(field, inherited)
            )
              continue;
            el.attrs = [
              ...el.attrs.filter(
                (a) => a.name.namespaceURI !== "" || a.name.localName !== field,
              ),
              attr(qname("", field, ""), inherited!),
            ];
          }
          changed = true;
        }
      }
      for (const next of el.children)
        if (next.kind === "element") visit(next, text);
    };
    visit(root, false);
    return changed;
  };
};
