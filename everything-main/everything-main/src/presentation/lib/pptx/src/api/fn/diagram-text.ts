import {
  NS,
  type XmlElement,
  attr,
  firstChildElement,
  getAttrValue,
  qname,
  textContent,
} from "../../internal/xml/index.ts";
import {
  SHAPE_ELEMENT,
  SHAPE_SLIDE,
  SHAPE_XML_SOURCES,
  type SlideShapeData,
} from "../_internal-symbols.ts";
import type { DiagramDrawingView } from "./diagram-drawing.ts";
import { getGroupChildren } from "./shape-read-base.ts";
import {
  mergeDiagramTextProperties as merge,
  diagramTextListLayers as listLayers,
} from "./diagram-text-properties.ts";
import { diagramTextFontLayers } from "./diagram-text-fonts.ts";
import { themeForShape } from "./shape-theme.ts";
import { getEffectiveColorMap } from "./color-map.ts";

const child = (el: XmlElement | null, name: string, ns: string = NS.dml) =>
  el && firstChildElement(el, qname("", name, ns));
const value = (el: XmlElement | null, name: string) =>
  el && getAttrValue(el, qname("", name, ""));
const elements = (el: XmlElement, names: readonly string[]) =>
  el.children.filter(
    (n): n is XmlElement =>
      n.kind === "element" &&
      n.name.namespaceURI === NS.dml &&
      names.includes(n.name.localName),
  );

const paragraphLevel = (p: XmlElement): number | null => {
  const raw = value(child(p, "pPr"), "lvl");
  if (raw === null) return 0;
  const n = Number(raw);
  return /^\+?\d+$/.test(raw.trim()) && Number.isInteger(n) && n >= 0 && n <= 8
    ? n
    : null;
};

// Ignore indentation whitespace in XML, but retain actual text, fields and
// breaks. Different inline segmentation needs layout/text reconciliation;
// never guess a run's semantic formatting from a coincidentally equal string.
const inlineSignature = (p: XmlElement): string =>
  JSON.stringify(
    elements(p, ["r", "fld", "br"]).map((run) => [
      run.name.localName,
      value(run, "id"),
      value(run, "type"),
      child(run, "t") ? textContent(child(run, "t")!) : "",
    ]),
  );

const replaceProperty = (parent: XmlElement, property: XmlElement): void => {
  const old = firstChildElement(parent, property.name);
  if (old) parent.children[parent.children.indexOf(old)] = property;
  else parent.children.unshift(property);
};

/**
 * Fill in text defaults on a private saved-drawing projection. Calculated
 * cache properties and explicit runs win; neither source parts nor geometry
 * are modified. MS-ODRAWXML 1.3.4 requires semantic/layout/quick/color text
 * styles in addition to the saved drawing, and 2.32.1.1 assigns diagram list
 * levels by node depth, independently of a paragraph's local outline level.
 *
 * This is an internal stage, not a layout engine. Diagnostics identify text
 * needing reconciliation or unresolved colors before it is render-ready.
 */
export const materializeDiagramText = (
  view: DiagramDrawingView,
  colorMap: Readonly<Record<string, string>> | null = getEffectiveColorMap(
    view.root[SHAPE_SLIDE],
  ),
): readonly string[] => {
  const { diagram, styles } = view;
  if (!diagram.drawing) return [];
  const sources = view.root[SHAPE_XML_SOURCES];
  if (!sources)
    throw new Error("diagram text requires a private drawing projection");
  const drawingOwner = diagram.drawing.part.name;
  let theme: ReturnType<typeof themeForShape> | undefined;
  const issues: string[] = [];
  const visit = (shape: SlideShapeData): void => {
    const info = view.information(shape);
    if (!info) {
      for (const nested of getGroupChildren(shape)) visit(nested);
      return;
    }
    const body = child(shape[SHAPE_ELEMENT], "txBody", NS.pml);
    const style = info.textStyle;
    if (!body || !style) return;
    const report = (message: string) =>
      issues.push(`diagram text ${info.modelId}: ${message}`);
    for (const issue of style.issues) report(issue);
    const paragraphs = elements(body, ["p"]);
    const semantic = style.sources.flatMap((source) =>
      source.point.text
        ? elements(source.point.text, ["p"]).map((paragraph) => ({
            ...source,
            paragraph,
          }))
        : [],
    );
    if (
      paragraphs.length !== semantic.length ||
      paragraphs.some(
        (p, i) =>
          inlineSignature(p) !== inlineSignature(semantic[i]!.paragraph),
      )
    ) {
      report(
        "saved text differs from semantic text; layout reconciliation required",
      );
      return;
    }
    const bodyProperties = child(body, "bodyPr");
    if (bodyProperties && value(bodyProperties, "compatLnSpc") === null) {
      // ECMA-376 21.1.2.1.1 defaults this to false. Native SmartArt follows
      // that default, whereas ordinary PresentationML text uses
      // compatible spacing when it is omitted. Make the diagram's default
      // explicit when projecting into that vocabulary. A native comparison
      // of saved SmartArt and projected text is pixel-equal with false;
      // omission adds leading to every line. Preserve any authored value.
      bodyProperties.attrs.push(attr(qname("", "compatLnSpc", ""), "0"));
    }
    const quickOwner = diagram.quickStyle?.part.name ?? drawingOwner;
    const savedFont = child(
      child(shape[SHAPE_ELEMENT], "style", NS.pml),
      "fontRef",
    );
    const defaults = diagramTextFontLayers(style, {
      quickOwner,
      colorOwner: diagram.colors?.part.name ?? drawingOwner,
      fontOverride: savedFont
        ? { element: savedFont, owner: drawingOwner }
        : null,
      theme: () => {
        if (theme === undefined) theme = themeForShape(view.root);
        return theme?.theme ?? null;
      },
      colorMap,
      report,
    });
    for (const [i, paragraph] of paragraphs.entries()) {
      const source = semantic[i]!;
      const sourceOwner = diagram.data!.part.name;
      const sourceLevel = paragraphLevel(source.paragraph);
      const cacheLevel = paragraphLevel(paragraph);
      if (sourceLevel === null || cacheLevel === null)
        report(`invalid paragraph level at ${i}`);
      const merged = merge(
        [
          ...defaults,
          ...listLayers(
            styles?.listStyle ?? null,
            source.level,
            diagram.layout?.part.name ?? drawingOwner,
          ),
          ...listLayers(
            child(source.point.text, "lstStyle"),
            sourceLevel,
            sourceOwner,
          ),
          ...listLayers(child(body, "lstStyle"), cacheLevel, drawingOwner),
          { element: child(source.paragraph, "pPr"), owner: sourceOwner },
          { element: child(paragraph, "pPr"), owner: drawingOwner },
        ],
        "pPr",
        sources,
      );
      if (merged.attrs.length || merged.children.length)
        replaceProperty(paragraph, merged);
      const cachedRuns = elements(paragraph, ["r", "fld", "br"]);
      const sourceRuns = elements(source.paragraph, ["r", "fld", "br"]);
      for (const [index, run] of cachedRuns.entries()) {
        const semanticRPr = child(sourceRuns[index]!, "rPr");
        if (!semanticRPr) continue;
        replaceProperty(
          run,
          merge(
            [
              { element: semanticRPr, owner: sourceOwner },
              { element: child(run, "rPr"), owner: drawingOwner },
            ],
            "rPr",
            sources,
          ),
        );
      }
    }
  };
  visit(view.root);
  return issues;
};
