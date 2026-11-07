import {
  readDiagramDataModel,
  diagramModelIdKey,
  type DiagramPoint,
} from "../../internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../../internal/diagram/hierarchy.ts";
import { textBodyText, setTextBody } from "../../internal/drawingml/index.ts";
import {
  editTextBodyRange,
  type TextBodyEdit,
} from "../../internal/drawingml/text-body-edit.ts";
import {
  NS,
  type XmlElement,
  elem,
  qname,
  firstChildElement,
  getAttrValue,
  parseXml,
  serializeXml,
  serializeFragment,
  walkElements,
} from "../../internal/xml/index.ts";
import {
  partName,
  resolveTarget,
  relsPartNameFor,
  parseRels,
  type PartName,
} from "../../internal/opc/index.ts";
import { reservedPartNames } from "../../internal/parts/copy-graph.ts";
import {
  INTERNAL_PACKAGE,
  SHAPE_ELEMENT,
  SHAPE_SLIDE,
  SLIDE_DOCUMENT,
  type SlideShapeData,
} from "../_internal-symbols.ts";
import { readShapeDiagram } from "./diagram-read.ts";
import { commitAndRefresh } from "./_helpers.ts";
import { createTextFieldCopy } from "./text-field-copy.ts";

export interface DiagramTextEntry {
  readonly modelId: string;
  readonly text: string;
  readonly depth: number;
}
export interface DiagramTextReplacement {
  readonly modelId: string;
  readonly text: string;
  /** Sequential native range edits, when the caller has an editing history.
   * Their result must equal text; stale or inconsistent histories are rejected.
   * Omitting edits retains select-all-and-type replacement semantics. */
  readonly edits?: readonly DiagramTextEdit[];
}
export type DiagramTextEdit = TextBodyEdit;
const editable = (point: DiagramPoint): boolean =>
  point.type === "node" ||
  point.type === "asst" ||
  (["doc", "parTrans", "sibTrans"].includes(point.type) &&
    !!point.text &&
    textBodyText(point.text) !== "");

/** Logical text in semantic hierarchy order; presentation/cache points are not
 * editable sources. Empty data nodes remain available for authored text.
 * Invalid semantic hierarchies are diagnosed without altering a saved drawing.
 */
export const getShapeDiagramTextEntries = (
  shape: SlideShapeData,
): readonly DiagramTextEntry[] => {
  const diagram = readShapeDiagram(shape);
  if (!diagram) return [];
  if (!diagram.model)
    throw new Error("diagram semantic text sources are missing");
  const hierarchy = readDiagramHierarchy(diagram.model);
  return hierarchy
    .axis(hierarchy.root, "desOrSelf")
    .filter((node) => editable(node.point))
    .map(({ point, depth }) => ({
      modelId: point.id,
      depth,
      text: point.text ? textBodyText(point.text) : "",
    }));
};

// A saved drawing is an independently derived cache, not an editable source.
// Remove recognized payloads, including their now-empty extension wrapper.
// Foreign extensions (even similarly named payloads) remain untouched.
const invalidateDrawing = (root: XmlElement): void => {
  const list = firstChildElement(root, qname("", "extLst", NS.diagram));
  if (!list) return;
  list.children = list.children.filter((ext) => {
    if (
      ext.kind !== "element" ||
      ext.name.namespaceURI !== NS.dml ||
      ext.name.localName !== "ext" ||
      getAttrValue(ext, qname("", "uri", "")) !== NS.diagramDrawing
    )
      return true;
    const before = ext.children.length;
    ext.children = ext.children.filter(
      (c) =>
        c.kind !== "element" ||
        c.name.namespaceURI !== NS.diagramDrawing ||
        c.name.localName !== "dataModelExt",
    );
    return (
      before === ext.children.length ||
      ext.children.some((c) => c.kind === "element")
    );
  });
};

const dataRelationship = (shape: SlideShapeData): XmlElement => {
  const graphic = firstChildElement(
      shape[SHAPE_ELEMENT],
      qname("", "graphic", NS.dml),
    ),
    data =
      graphic && firstChildElement(graphic, qname("", "graphicData", NS.dml)),
    ids = data && firstChildElement(data, qname("", "relIds", NS.diagram));
  if (!ids) throw new Error("diagram relationships are missing");
  return ids;
};

/** Replace logical entries. Range edits retain unselected native rich text;
 * whole replacements retain body/list and first paragraph/run formatting.
 * Unchanged entries retain their complete rich XML. Validate the whole batch
 * before committing. Shared data is detached for this frame; dependencies,
 * layouts, styles, presentation graphs and unrelated caches remain intact.
 * The saved drawing reference is invalidated so renderers/native layout use
 * semantic data. This does not manufacture a replacement drawing or guarantee
 * that every layout feature is supported by the host renderer.
 */
export const replaceShapeDiagramText = (
  shape: SlideShapeData,
  replacements: readonly DiagramTextReplacement[],
): number => {
  const diagram = readShapeDiagram(shape);
  if (!diagram?.data || !diagram.model)
    throw new Error("diagram semantic text sources are missing");
  const allowed = new Set(
      getShapeDiagramTextEntries(shape).map((e) =>
        diagramModelIdKey(e.modelId),
      ),
    ),
    document = parseXml(new TextDecoder().decode(diagram.data.part.data)),
    model = readDiagramDataModel(document.root),
    seen = new Set<string>();
  const changes: {
    point: DiagramPoint;
    text: string;
    edits?: readonly DiagramTextEdit[];
  }[] = [];
  for (const edit of replacements) {
    if (typeof edit.modelId !== "string" || typeof edit.text !== "string")
      throw new TypeError(
        "diagram text replacements require modelId and text strings",
      );
    for (const character of edit.text) {
      const code = character.codePointAt(0)!;
      if (!(
        code === 9 ||
        code === 10 ||
        code === 13 ||
        (code >= 0x20 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd) ||
        (code >= 0x10000 && code <= 0x10ffff)
      ))
        throw new Error("diagram text contains an invalid XML character");
    }
    const key = diagramModelIdKey(edit.modelId);
    if (seen.has(key))
      throw new Error(`duplicate diagram text replacement ${edit.modelId}`);
    seen.add(key);
    const point = model.point(edit.modelId);
    if (!point || !allowed.has(key))
      throw new Error(`diagram text entry ${edit.modelId} is not editable`);
    const value = edit.text.replace(/\r\n?/g, "\n");
    if (edit.edits !== undefined && !Array.isArray(edit.edits))
      throw new TypeError("diagram text edits must be an array");
    if (
      (point.text ? textBodyText(point.text) : "") !== value ||
      edit.edits?.length
    )
      changes.push({
        point,
        text: value,
        ...(edit.edits ? { edits: edit.edits } : {}),
      });
  }
  if (!changes.length) return 0;
  let changed = 0;
  for (const { point, text, edits } of changes) {
    let body = point.text;
    const before = body && serializeFragment(body);
    if (!body) {
      body = elem(qname("dgm", "t", NS.diagram), {
        children: [
          elem(qname("a", "bodyPr", NS.dml)),
          elem(qname("a", "lstStyle", NS.dml)),
        ],
      });
      const at = point.element.children.findIndex(
        (c) =>
          c.kind === "element" &&
          c.name.namespaceURI === NS.diagram &&
          c.name.localName === "extLst",
      );
      point.element.children.splice(
        at < 0 ? point.element.children.length : at,
        0,
        body,
      );
    }
    if (edits) {
      for (const edit of edits) editTextBodyRange(body, edit);
      if (textBodyText(body) !== text)
        throw new Error(
          "diagram text edit history does not match replacement text",
        );
    } else setTextBody(body, text);
    if (serializeFragment(body) !== before) changed++;
  }
  if (!changed) return 0;
  invalidateDrawing(document.root);
  const slide = shape[SHAPE_SLIDE],
    pkg = slide[INTERNAL_PACKAGE],
    source = diagram.data.part,
    ids = dataRelationship(shape),
    dm = ids.attrs.find(
      (a) =>
        a.name.namespaceURI === NS.officeDocRels && a.name.localName === "dm",
    )!;
  // Distinct relationships can share a part; one relationship can also be
  // referenced by several frames in the same owner (including grouped frames).
  let incoming = 0;
  // One temporary name index avoids a package-wide linear lookup for every
  // owner in large decks. Include root relationships and escaped targets.
  const partsByName = new Map(
      pkg.parts.map((part) => [part.name.toLowerCase(), part]),
    ),
    owners: (PartName | "/")[] = ["/", ...pkg.parts.map((part) => part.name)];
  for (const owner of owners) {
    const relsPart = partsByName.get(
      (owner === "/" ? "/_rels/.rels" : relsPartNameFor(owner)).toLowerCase(),
    );
    if (!relsPart) continue;
    // Unreadable relationship XML prevents a safe ownership audit and is
    // diagnosed before any package mutation.
    const rels = parseRels(new TextDecoder().decode(relsPart.data));
    for (const rel of rels.items) {
      if (rel.targetMode !== "Internal") continue;
      let target;
      try {
        target = resolveTarget(owner, rel.target);
      } catch {
        continue;
      }
      if (target.toLowerCase() === source.name.toLowerCase()) incoming++;
    }
    if (incoming > 1) break;
  }
  let frames = 0;
  walkElements(slide[SLIDE_DOCUMENT].root, (e) => {
    if (
      e.name.namespaceURI === NS.diagram &&
      e.name.localName === "relIds" &&
      getAttrValue(e, qname("", "dm", NS.officeDocRels)) === dm.value
    )
      frames++;
  });
  if (incoming > 1 || frames > 1) {
    const occupied = reservedPartNames(pkg),
      dot = source.name.lastIndexOf("."),
      split = dot > source.name.lastIndexOf("/") ? dot : source.name.length;
    let index = 1,
      name: PartName;
    do {
      name = partName(
        `${source.name.slice(0, split)}_copy${index++}${source.name.slice(split)}`,
      );
    } while (
      occupied.has(name.toLowerCase()) ||
      occupied.has(relsPartNameFor(name).toLowerCase())
    );
    const relationships = pkg.getRels(source.name),
      copied = relationships && {
        items: relationships.items.map((r) => ({
          ...r,
          target:
            r.targetMode === "Internal"
              ? resolveTarget(source.name, r.target).toLowerCase() ===
                source.name.toLowerCase()
                ? name
                : resolveTarget(source.name, r.target)
              : r.target,
        })),
      },
      ownerRels = pkg.getRels(diagram.owner)!,
      relationship = ownerRels.items.find((r) => r.id === dm.value)!,
      takenIds = new Set(ownerRels.items.map((r) => r.id));
    // Relationship IDs are XML IDs, not bounded integer counters.
    let ordinal = 1;
    while (takenIds.has(`rId${ordinal}`)) ordinal++;
    const newId = `rId${ordinal}`;
    // Detaching shared data creates new logical fields; the unselected source
    // and its saved drawing retain their original identities.
    createTextFieldCopy(pkg).rewrite(document.root);
    pkg.addPart(
      name,
      source.contentType,
      new TextEncoder().encode(serializeXml(document)),
    );
    if (copied) pkg.setRels(name, copied);
    pkg.setRels(diagram.owner, {
      items: [...ownerRels.items, { ...relationship, id: newId, target: name }],
    });
    ids.attrs = ids.attrs.map((a) => (a === dm ? { ...a, value: newId } : a));
    commitAndRefresh(shape);
  } else source.data = new TextEncoder().encode(serializeXml(document));
  return changed;
};
