import type { PartName } from "../../internal/opc/index.ts";
import { readGroupChildren } from "../../internal/presentationml/index.ts";
import {
  type DiagramTextStyle,
  type DiagramStyles,
  readDiagramStyles,
} from "../../internal/diagram/styles.ts";
import {
  NS,
  type XmlElement,
  elem,
  firstChildElement,
  getAttrValue,
  qname,
} from "../../internal/xml/index.ts";
import {
  SHAPE_ELEMENT,
  SHAPE_SLIDE,
  SHAPE_SNAPSHOT,
  SHAPE_XML_SOURCES,
  type SlideShapeData,
} from "../_internal-symbols.ts";
import { type DiagramView, readShapeDiagram } from "./diagram-read.ts";
import { cloneShapeSource } from "./shape-source.ts";

export interface DiagramDrawingShape {
  readonly modelId: string | null;
  /** Text rectangle before shape rotation; txXfrm rotation is relative to the shape. */
  readonly textTransform: XmlElement | null;
  readonly textStyle: DiagramTextStyle | null;
}

export interface DiagramDrawingView {
  readonly diagram: DiagramView;
  /** Display-only handles; never pass these to the shape mutation APIs. */
  readonly root: SlideShapeData;
  readonly styles: DiagramStyles | null;
  readonly issues: readonly string[];
  information(shape: SlideShapeData): DiagramDrawingShape | null;
}

const dspChild = (el: XmlElement, name: string): XmlElement | null =>
  firstChildElement(el, qname("dsp", name, NS.diagramDrawing));

/**
 * MS-ODRAWXML's saved layout uses DrawingML geometry and a DSP shape-tree
 * wrapper. Project only those schema-defined wrappers into the shape reader's
 * PresentationML vocabulary; keep all original data and package parts intact.
 *
 * This is the saved geometry view, not a layout engine. Text still needs the
 * semantic/layout/style cascade in `information`: the cache does not contain
 * all text formatting. Resizing or semantic edits must run diagram layout.
 */
export const readDiagramDrawing = (
  frame: SlideShapeData,
): DiagramDrawingView | null => {
  const diagram = readShapeDiagram(frame);
  if (!diagram?.drawing) return null;
  const tree = dspChild(diagram.drawing.root, "spTree");
  if (!tree) return null;
  const sources = new WeakMap<XmlElement, PartName>();
  const root = cloneShapeSource(tree, diagram.drawing.part.name, sources);
  const styles = diagram.model
    ? readDiagramStyles(
        diagram.model,
        diagram.layout?.root ?? null,
        diagram.quickStyle?.root ?? null,
        diagram.colors?.root ?? null,
      )
    : null;
  const info = new WeakMap<XmlElement, DiagramDrawingShape>();
  const issues = [...diagram.issues];
  const rename = (el: XmlElement, name = el.name.localName): void => {
    el.name = qname("p", name, NS.pml);
  };
  const header = (parent: XmlElement, name: string, property: string): void => {
    const nv = dspChild(parent, name);
    if (!nv) return;
    rename(nv);
    for (const local of ["cNvPr", property]) {
      const el = dspChild(nv, local);
      if (el) rename(el);
    }
  };
  const visit = (container: XmlElement): void => {
    rename(container, "grpSp");
    header(container, "nvGrpSpPr", "cNvGrpSpPr");
    const properties = dspChild(container, "grpSpPr");
    if (properties) rename(properties);
    for (const el of container.children) {
      if (el.kind !== "element") continue;
      if (el.name.namespaceURI === NS.diagramDrawing) {
        if (el.name.localName === "grpSp") {
          visit(el);
          continue;
        }
        if (el.name.localName === "sp") {
          const modelId = getAttrValue(el, qname("", "modelId", ""));
          const textTransform = dspChild(el, "txXfrm");
          info.set(el, {
            modelId,
            textTransform,
            textStyle: modelId ? (styles?.textStyle(modelId) ?? null) : null,
          });
          rename(el);
          header(el, "nvSpPr", "cNvSpPr");
          for (const local of ["spPr", "style", "txBody"]) {
            const child = dspChild(el, local);
            if (child) rename(child);
          }
          continue;
        }
        if (el.name.localName === "extLst") continue;
      }
      if (
        el.name.namespaceURI !== NS.pml ||
        !["nvGrpSpPr", "grpSpPr"].includes(el.name.localName)
      )
        issues.push(
          `unrecognized saved diagram child {${el.name.namespaceURI}}${el.name.localName}`,
        );
    }
  };
  visit(root);
  const [snapshot] = readGroupChildren(
    elem(qname("p", "grpSp", NS.pml), {
      children: [root],
    }),
  );
  return {
    diagram,
    root: {
      [SHAPE_SLIDE]: frame[SHAPE_SLIDE],
      [SHAPE_ELEMENT]: root,
      [SHAPE_SNAPSHOT]: snapshot!,
      [SHAPE_XML_SOURCES]: sources,
    },
    styles,
    issues,
    information: (shape) => info.get(shape[SHAPE_ELEMENT]) ?? null,
  };
};
