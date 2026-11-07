import type { PartName } from "../../internal/opc/index.ts";
import type { DiagramLayoutNode } from "../../internal/diagram/layout.ts";
import type { DiagramPoint } from "../../internal/diagram/data-model.ts";
import {
  type DiagramTextParagraph,
  readDiagramTextParagraphs,
} from "../../internal/diagram/text-content.ts";
import {
  DEFAULT_DIAGRAM_TEXT_FONT_SIZE,
  hasDiagramPointTextFontSizes,
  isDiagramPointTextCustomized,
  readDiagramTextCustomization,
} from "../../internal/diagram/text-customization.ts";
import {
  readDiagramTextParameters,
  resolveDiagramTextFormatting,
} from "../../internal/diagram/text-parameters.ts";
import { resolveDiagramTextRuler } from "../../internal/diagram/text-ruler.ts";
import {
  NS,
  type XmlElement,
  attr,
  elem,
  firstChildElement,
  getAttrValue,
  qname,
} from "../../internal/xml/index.ts";
import { cloneShapeSource } from "./shape-source.ts";
import {
  type DiagramTextPropertyLayer,
  diagramTextListLayers,
  mergeDiagramTextProperties,
} from "./diagram-text-properties.ts";

export interface DiagramTextParagraphOptions {
  readonly dataOwner: PartName;
  /** The diagram list-style extension uses absolute semantic node depth. */
  readonly layoutListStyle?: DiagramTextPropertyLayer;
  /** Host-resolved direction for the algorithm's LTR/RTL alignment defaults. */
  readonly rtl?: boolean;
  /** Resolved host/quick/color defaults layered above algorithm defaults. */
  readonly defaults: (
    paragraph: DiagramTextParagraph,
  ) => readonly DiagramTextPropertyLayer[];
  /**
   * Fitted fonts for algorithm-controlled text. For mixed custom text whose
   * first character is unsized, supply the algorithm's ruler font preferences
   * before applying the custom primary-font override. Fully unsized custom
   * contributors use the diagram font independently of these values.
   */
  readonly fontSize: (role: "primary" | "secondary") => number;
  /** Before TX display initialization, custT remains local to each source
   * point. Initialized TX promotes any contributor's flag to the whole shape. */
  readonly customizationScope?: "shape" | "contributor";
}

const child = (element: XmlElement | null, name: string) =>
  element && firstChildElement(element, qname("", name, NS.dml));
const put = (parent: XmlElement, property: XmlElement) => {
  const old = firstChildElement(parent, property.name);
  if (old) parent.children[parent.children.indexOf(old)] = property;
  else parent.children.unshift(property);
};
const set = (element: XmlElement, name: string, value: string) => {
  const index = element.attrs.findIndex(
    (a) => a.name.namespaceURI === "" && a.name.localName === name,
  );
  if (index >= 0) element.attrs[index] = { ...element.attrs[index]!, value };
  else element.attrs.push(attr(qname("", name, ""), value));
};

/**
 * Project semantic paragraphs for measurement/drawing without a saved cache.
 * Merge defaults and diagram/point list styles property by property, preserving
 * each relationship's part owner. Direct paragraph formatting wins. Retain
 * original inline segmentation, fields, hyperlinks, breaks and extension data.
 *
 * Algorithm-controlled text uses the fitted primary/secondary size regardless
 * of authored size declarations. Any selected custT preserves authored sizes
 * across the whole text shape, even when fitting cannot make the text fit.
 * Uninitialized TX display explicitly retains contributor-local customization.
 * Within custom text, a contributor with no logical character sizes receives
 * the diagram font; partially sized contributors retain their unsized runs.
 * Resolve algorithm spacing, alignment, bullets and rulers before layering
 * host/list/direct formatting. The caller supplies fitted font constraints,
 * host/quick/color defaults and provenance; this function does not fit text.
 */
export const projectDiagramTextParagraphs = (
  node: DiagramLayoutNode,
  options: DiagramTextParagraphOptions,
  sources: WeakMap<XmlElement, PartName>,
): readonly XmlElement[] => {
  const shapeCustom = readDiagramTextCustomization(node) !== null;
  const customized = (point: DiagramPoint) =>
    options.customizationScope === "contributor"
      ? isDiagramPointTextCustomized(point)
      : shapeCustom;
  const entries = readDiagramTextParagraphs(node);
  // A contributor can have many paragraphs or empty leading runs. Scan its
  // first logical character once per projection, without caching across edits.
  const firstFonts = new WeakMap<DiagramPoint, number | null>();
  const unsized = new Set<DiagramPoint>();
  if (shapeCustom)
    for (const { point } of node.contributors)
      if (customized(point) && !hasDiagramPointTextFontSizes(point)) {
        unsized.add(point);
        // The synthesized direct size also supplies this point's ruler,
        // independently of its hierarchy-derived primary/secondary role.
        firstFonts.set(point, DEFAULT_DIAGRAM_TEXT_FONT_SIZE);
      }
  const formatting = resolveDiagramTextFormatting(
    readDiagramTextParameters(node),
    entries,
    options.rtl ?? false,
  );
  return entries.map((entry) => {
    const custom = customized(entry.source.point);
    const paragraph = entry.paragraph
      ? cloneShapeSource(entry.paragraph, options.dataOwner, sources)
      : elem(qname("a", "p", NS.dml));
    const sourceProperties = child(entry.paragraph, "pPr");
    // A point's own list style follows its local outline level, independently
    // of the diagram list style's absolute depth and the algorithm's hierarchy.
    const sourceLevel = sourceProperties
      ? Number(getAttrValue(sourceProperties, qname("", "lvl", "")) ?? 0)
      : 0;
    const layout = options.layoutListStyle;
    const font = custom
      ? unsized.has(entry.source.point)
        ? DEFAULT_DIAGRAM_TEXT_FONT_SIZE
        : null
      : options.fontSize(entry.font);
    if (font !== null && (!Number.isFinite(font) || font < 0 || font > 4000))
      throw new Error("invalid diagram displayed font size");
    const ruler = resolveDiagramTextRuler(
      entry,
      custom,
      (role) => font ?? options.fontSize(role),
      firstFonts,
    );
    const format = formatting[entry.font];
    const spacing = (name: string, value: number) =>
      elem(qname("a", name, NS.dml), {
        children: [
          elem(qname("a", "spcPct", NS.dml), {
            attrs: [attr(qname("", "val", ""), String(value))],
          }),
        ],
      });
    const algorithmDefaults = elem(qname("a", "pPr", NS.dml), {
      attrs: Object.entries({
        marL: ruler.marginLeft,
        indent: ruler.indent,
        defTabSz: ruler.defaultTabSize,
        algn: format.alignment,
      }).map(([name, value]) => attr(qname("", name, ""), String(value))),
      children: [
        spacing("lnSpc", format.lineSpacing),
        spacing("spcBef", 0),
        spacing("spcAft", format.spaceAfter),
        entry.hierarchyLevel === 0
          ? elem(qname("a", "buNone", NS.dml))
          : elem(qname("a", "buChar", NS.dml), {
              attrs: [attr(qname("", "char", ""), "•")],
            }),
        elem(qname("a", "defRPr", NS.dml), {
          attrs: [attr(qname("", "kern", ""), "1200")],
        }),
      ],
    });
    const properties = mergeDiagramTextProperties(
      [
        { element: algorithmDefaults, owner: options.dataOwner },
        ...options.defaults(entry),
        ...(layout
          ? diagramTextListLayers(
              layout.element,
              entry.source.depth - 1,
              layout.owner,
            )
          : []),
        ...diagramTextListLayers(
          child(entry.source.point.text, "lstStyle"),
          sourceLevel,
          options.dataOwner,
        ),
        { element: sourceProperties, owner: options.dataOwner },
      ],
      "pPr",
      sources,
    );
    set(properties, "lvl", String(entry.level));
    put(paragraph, properties);
    if (font !== null) {
      // A zero fitted constraint is valid, but DrawingML runs display at least
      // one point. Keep that rendering floor out of the constraint environment.
      const size = String(Math.round(Math.max(1, font) * 100));
      let defaults = child(properties, "defRPr");
      if (!custom && !defaults) {
        defaults = elem(qname("a", "defRPr", NS.dml));
        const extension = child(properties, "extLst");
        if (extension)
          properties.children.splice(
            properties.children.indexOf(extension),
            0,
            defaults,
          );
        else properties.children.push(defaults);
      }
      if (!custom) set(defaults!, "sz", size);
      let inline = false;
      for (const run of paragraph.children) {
        if (run.kind !== "element" || run.name.namespaceURI !== NS.dml)
          continue;
        if (["r", "fld", "br"].includes(run.name.localName)) {
          inline = true;
          let properties = child(run, "rPr");
          if (!properties) {
            properties = elem(qname("a", "rPr", NS.dml));
            run.children.unshift(properties);
          }
          // Empty source runs may carry insertion formatting even though they
          // do not count when detecting a fully unsized contributor.
          if (!custom || getAttrValue(properties, qname("", "sz", "")) === null)
            set(properties, "sz", size);
        } else if (
          run.name.localName === "endParaRPr" &&
          (!custom || getAttrValue(run, qname("", "sz", "")) === null)
        )
          set(run, "sz", size);
      }
      if (!inline && !child(paragraph, "endParaRPr"))
        paragraph.children.push(
          elem(qname("a", "endParaRPr", NS.dml), {
            attrs: [attr(qname("", "sz", ""), size)],
          }),
        );
    }
    return paragraph;
  });
};
