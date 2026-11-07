import {
  type DiagramDataModel,
  readDiagramDataModel,
} from "../../internal/diagram/data-model.ts";
import { diagramDrawingReferences } from "../../internal/diagram/drawing-reference.ts";
import { type PartName, resolveTarget } from "../../internal/opc/index.ts";
import type { Part } from "../../internal/parts/index.ts";
import { readOnlyPartRoot } from "../../internal/parts/read-only-xml.ts";
import { REL_TYPES } from "../../internal/presentationml/index.ts";
import {
  NS,
  type XmlElement,
  firstChildElement,
  getAttrValue,
  qname,
} from "../../internal/xml/index.ts";
import {
  INTERNAL_PACKAGE,
  SHAPE_ELEMENT,
  SHAPE_SLIDE,
  SHAPE_SNAPSHOT,
  SLIDE_PART_NAME,
  type SlideShapeData,
} from "../_internal-symbols.ts";

export interface DiagramPartView {
  readonly part: Part;
  readonly root: XmlElement;
}

export interface DiagramView {
  readonly owner: PartName;
  readonly data: DiagramPartView | null;
  readonly layout: DiagramPartView | null;
  readonly quickStyle: DiagramPartView | null;
  readonly colors: DiagramPartView | null;
  readonly drawing: DiagramPartView | null;
  readonly model: DiagramDataModel | null;
  readonly issues: readonly string[];
}

const diagramRelIds = (shape: SlideShapeData): XmlElement | null => {
  if (shape[SHAPE_SNAPSHOT].kind !== "graphicFrame") return null;
  const graphic = firstChildElement(
    shape[SHAPE_ELEMENT],
    qname("a", "graphic", NS.dml),
  );
  const data =
    graphic && firstChildElement(graphic, qname("a", "graphicData", NS.dml));
  if (!data || getAttrValue(data, qname("", "uri", "")) !== NS.diagram)
    return null;
  return firstChildElement(data, qname("dgm", "relIds", NS.diagram));
};

export const isDiagramShape = (shape: SlideShapeData): boolean =>
  diagramRelIds(shape) !== null;

const models = new WeakMap<
  Part,
  { data: Uint8Array; model: DiagramDataModel }
>();

/**
 * Internal read-only view of the parts behind a SmartArt frame. The owner is
 * kept separately from each source part: styles inherit from the containing
 * slide/layout/master, while relationships inside drawing/data XML belong to
 * those parts. Nothing is flattened, rewritten, or fetched over the network.
 */
export const readShapeDiagram = (shape: SlideShapeData): DiagramView | null => {
  const ids = diagramRelIds(shape);
  if (!ids) return null;
  const slide = shape[SHAPE_SLIDE];
  const pkg = slide[INTERNAL_PACKAGE];
  const owner = slide[SLIDE_PART_NAME];
  const relationships = pkg.getRels(owner)?.items ?? [];
  const issues: string[] = [];
  const resolve = (
    id: string | null,
    type: string,
    namespace: string,
    rootName: string,
  ): DiagramPartView | null => {
    if (!id) {
      issues.push(`diagram ${rootName} relationship is missing`);
      return null;
    }
    const rel = relationships.find((r) => r.id === id);
    if (!rel || rel.type !== type || rel.targetMode !== "Internal") {
      issues.push(`diagram ${rootName} relationship ${id} is invalid`);
      return null;
    }
    const part = pkg.getPart(resolveTarget(owner, rel.target));
    if (!part) {
      issues.push(`diagram ${rootName} part is missing`);
      return null;
    }
    try {
      const root = readOnlyPartRoot(part);
      if (
        root.name.namespaceURI !== namespace ||
        root.name.localName !== rootName
      ) {
        issues.push(`diagram ${rootName} part has an unexpected root`);
        return null;
      }
      return { part, root };
    } catch {
      issues.push(`diagram ${rootName} part contains invalid XML`);
      return null;
    }
  };
  const relId = (name: string) =>
    getAttrValue(ids, qname("r", name, NS.officeDocRels));
  const data = resolve(
    relId("dm"),
    REL_TYPES.diagramData,
    NS.diagram,
    "dataModel",
  );
  const layout = resolve(
    relId("lo"),
    REL_TYPES.diagramLayout,
    NS.diagram,
    "layoutDef",
  );
  const quickStyle = resolve(
    relId("qs"),
    REL_TYPES.diagramQuickStyle,
    NS.diagram,
    "styleDef",
  );
  const colors = resolve(
    relId("cs"),
    REL_TYPES.diagramColors,
    NS.diagram,
    "colorsDef",
  );
  let drawing: DiagramPartView | null = null;
  let model: DiagramDataModel | null = null;
  if (data) {
    const refs = new Set(
      diagramDrawingReferences(data.root)
        .map((el) => getAttrValue(el, qname("", "relId", "")))
        .filter((id): id is string => !!id),
    );
    if (refs.size > 1)
      issues.push("diagram has conflicting saved drawing references");
    else if (refs.size === 1)
      drawing = resolve(
        [...refs][0]!,
        REL_TYPES.diagramDrawing,
        NS.diagramDrawing,
        "drawing",
      );
    try {
      const cached = models.get(data.part);
      if (cached?.data === data.part.data) model = cached.model;
      else {
        model = readDiagramDataModel(data.root);
        models.set(data.part, { data: data.part.data, model });
      }
    } catch (error) {
      issues.push(
        error instanceof Error ? error.message : "invalid diagram data model",
      );
    }
  }
  return { owner, data, layout, quickStyle, colors, drawing, model, issues };
};
