import type { DiagramPoint } from "./data-model.ts";
import type { DiagramLayoutNode } from "./layout.ts";
import {
  NS,
  type XmlElement,
  firstChildElement,
  getAttrValue,
  qname,
} from "../xml/index.ts";

// The TX primary-font fallback, also used for customized text whose
// first logical character has no direct size. Independent native controls with
// presentation/master/theme/list defaults and major/minor/none font references
// establish that this is a diagram default, not ordinary text inheritance.
export const DEFAULT_DIAGRAM_TEXT_FONT_SIZE = 36;

export interface DiagramTextCustomization {
  /** The first customized contributor in presentation-of order. */
  readonly source: DiagramPoint;
  /**
   * Authored first-character font size, in points, or the diagram default.
   * It does not inherit paragraph styles or the layout's primary-font value.
   * This is an input to layout, before font quantization or fitting.
   */
  readonly primaryFontSize: number;
}
const child = (element: XmlElement | null, name: string): XmlElement | null =>
  element && firstChildElement(element, qname("", name, NS.dml));
const attr = (element: XmlElement | null, name: string): string | null =>
  element && getAttrValue(element, qname("", name, ""));
const runHasText = (run: XmlElement): boolean =>
  child(run, "t")?.children.some(
    (node) =>
      (node.kind === "text" || node.kind === "cdata") && node.data.length > 0,
  ) ?? false;

const firstCharacterProperties = (
  body: XmlElement | null,
): XmlElement | null => {
  const paragraph = child(body, "p");
  for (const inline of paragraph?.children ?? []) {
    if (inline.kind !== "element" || inline.name.namespaceURI !== NS.dml)
      continue;
    const type = inline.name.localName;
    if (type === "r") {
      // Empty runs occupy no character position. Spaces and tabs do; do not
      // trim them or scan ahead for a run that happens to specify a font.
      if (!runHasText(inline)) continue;
      return child(inline, "rPr");
    }
    // A field occupies one logical position even when its cached text is empty.
    if (type === "br" || type === "fld") return child(inline, "rPr");
  }
  // An empty first paragraph contributes its end marker. Later paragraphs and
  // pPr/defRPr are not the first character's directly authored properties.
  return child(paragraph, "endParaRPr");
};

/** Direct first-character size, shared by layout overrides and text rulers. */
export const readDiagramPointTextFontSize = (
  source: DiagramPoint,
): number | null => {
  const raw = attr(firstCharacterProperties(source.text), "sz")?.trim();
  if (raw === undefined) return null;
  const size = Number(raw);
  if (
    !/^\+?\d+$/.test(raw) ||
    !Number.isSafeInteger(size) ||
    size < 100 ||
    size > 400000
  )
    throw new Error("invalid diagram custom text font size");
  return size / 100;
};

/**
 * Whether a contributor's logical text declares any character size. The
 * diagram font is supplied only when ALL such declarations are absent. The
 * test spans its paragraphs, includes paragraph-end markers/breaks/fields, and
 * ignores empty runs and paragraph/list defaults. Contributors are independent,
 * even when one custT flag customizes the entire presented text shape.
 */
export const hasDiagramPointTextFontSizes = (source: DiagramPoint): boolean => {
  for (const paragraph of source.text?.children ?? []) {
    if (
      paragraph.kind !== "element" ||
      paragraph.name.namespaceURI !== NS.dml ||
      paragraph.name.localName !== "p"
    )
      continue;
    for (const inline of paragraph.children) {
      if (inline.kind !== "element" || inline.name.namespaceURI !== NS.dml)
        continue;
      const type = inline.name.localName;
      const properties =
        type === "endParaRPr"
          ? inline
          : type === "br" ||
              type === "fld" ||
              (type === "r" && runHasText(inline))
            ? child(inline, "rPr")
            : null;
      if (attr(properties, "sz") !== null) return true;
    }
  }
  return false;
};

/** A point-local custT flag, before initialized TX promotes it to its peers. */
export const isDiagramPointTextCustomized = (source: DiagramPoint): boolean => {
  const flag = attr(source.properties, "custT")?.trim();
  if (flag === undefined || flag === "0" || flag === "false") return false;
  if (flag !== "1" && flag !== "true")
    throw new Error("invalid diagram custom text flag");
  return true;
};

/**
 * TX initialization promotes customization to the entire presented text shape:
 * any contributing custT point preserves authored runs from all contributors.
 * The first customized contributor supplies the primary-font layout override,
 * irrespective of its bullet level. Context/point-list order is not presOf
 * order, and a customized node outside presOf has no effect.
 *
 * Null means ordinary algorithm-controlled text. Missing direct custom sizes
 * use the diagram default, independently of the containing slide's text styles.
 * This reader never rewrites semantic text or substitutes saved drawing text.
 */
export const readDiagramTextCustomization = (
  node: DiagramLayoutNode,
): DiagramTextCustomization | null => {
  for (const contributor of node.contributors) {
    const source = contributor.point;
    if (!isDiagramPointTextCustomized(source)) continue;
    return {
      source,
      primaryFontSize:
        readDiagramPointTextFontSize(source) ?? DEFAULT_DIAGRAM_TEXT_FONT_SIZE,
    };
  }
  return null;
};
