import {
  type PartName,
  type Relationship,
  type Relationships,
  resolveTarget,
} from "../../internal/opc/index.ts";
import type { OpcPackage } from "../../internal/parts/index.ts";
import { copyPartGraph } from "../../internal/parts/copy-graph.ts";
import { diagramDrawingReferences } from "../../internal/diagram/drawing-reference.ts";
import { REL_TYPES } from "../../internal/presentationml/index.ts";
import {
  createDiagramColorCopy,
  type DiagramColorCopy,
} from "./diagram-color-copy.ts";
import { createDiagramMatrixCopy } from "./diagram-matrix-copy.ts";
import { createDiagramFontCopy } from "./diagram-font-copy.ts";
import { createTextFieldCopy, type TextFieldCopy } from "./text-field-copy.ts";
import {
  prepareDiagramFontDefaults,
  applyDiagramFontDefaults,
} from "./diagram-font-default-copy.ts";
import {
  NS,
  type XmlElement,
  getAttrValue,
  parseXml,
  qname,
  serializeXml,
} from "../../internal/xml/index.ts";

const diagramTypes: ReadonlySet<string> = new Set([
  REL_TYPES.diagramData,
  REL_TYPES.diagramLayout,
  REL_TYPES.diagramQuickStyle,
  REL_TYPES.diagramColors,
  REL_TYPES.diagramDrawing,
]);

export const isDiagramRelationship = (type: string): boolean =>
  diagramTypes.has(type);

// Follow shape/group/graphic containers and compatibility alternatives, not
// table cells or ordinary shape text. Large non-diagram objects should not
// pay for another complete relationship-attribute traversal when copied.
export const getDiagramRelationshipIds = (root: XmlElement): Set<string> => {
  const ids = new Set<string>();
  const visit = (el: XmlElement): void => {
    const { namespaceURI: ns, localName: name } = el.name;
    if (ns === NS.diagram && name === "relIds") {
      for (const attr of el.attrs)
        if (attr.name.namespaceURI === NS.officeDocRels) ids.add(attr.value);
      return;
    }
    if (!(
      (ns === NS.pml && (name === "grpSp" || name === "graphicFrame")) ||
      (ns === NS.dml && (name === "graphic" || name === "graphicData")) ||
      ns === NS.mc
    ))
      return;
    for (const child of el.children) if (child.kind === "element") visit(child);
  };
  visit(root);
  return ids;
};

/** Copy diagram parts together, including the implicit owner-to-drawing edge. */
export const copyDiagramRelationships = (
  source: OpcPackage,
  owner: PartName,
  sourceRels: Relationships,
  target: OpcPackage,
  mapId: (id: string) => string,
  selectedIds?: ReadonlySet<string>,
  colors?: DiagramColorCopy & {
    readonly targetThemeOwner?: PartName;
    readonly sourceRoot?: XmlElement;
  },
  fieldCopy: TextFieldCopy = createTextFieldCopy(target),
): ReadonlyMap<string, Relationship> | null => {
  const selected = sourceRels.items.filter(
    (r) => diagramTypes.has(r.type) && (!selectedIds || selectedIds.has(r.id)),
  );
  if (!selected.length) return null;
  const data = new Map<PartName, ReturnType<typeof parseXml>>();
  for (const rel of selected) {
    if (rel.type !== REL_TYPES.diagramData || rel.targetMode !== "Internal")
      continue;
    const name = resolveTarget(owner, rel.target);
    const part = source.getPart(name);
    if (!part) throw new Error(`cannot copy missing diagram data ${name}`);
    const doc = parseXml(new TextDecoder().decode(part.data));
    data.set(part.name, doc);
    for (const ref of diagramDrawingReferences(doc.root)) {
      const id = getAttrValue(ref, qname("", "relId", ""));
      if (!id) continue;
      const drawing = sourceRels.items.find((r) => r.id === id);
      if (!drawing || drawing.type !== REL_TYPES.diagramDrawing)
        throw new Error(`diagram drawing relationship ${id} is missing`);
      if (!selected.some((r) => r.id === id)) selected.push(drawing);
    }
  }
  const preserveColors =
    colors &&
    (colors.preserveTextFormatting === true ||
      colors.preservePaintFormatting === true)
      ? createDiagramColorCopy(colors)
      : null;
  const preserveFonts =
    colors?.preserveTextFormatting === true
      ? createDiagramFontCopy(colors)
      : null;
  const preserveMatrix = colors
    ? createDiagramMatrixCopy(colors, target)
    : null;
  const documents = new Map(data),
    modified = new Set<PartName>(),
    processed = new Set<string>();
  const fontDefaults =
    colors?.preserveTextFormatting === true && colors.sourceRoot
      ? prepareDiagramFontDefaults(colors, colors.sourceRoot)
      : new Map();
  // Prepare formatting before graph mutation, including any theme dependencies.
  for (const rel of selected) {
    if (rel.targetMode !== "Internal") continue;
    const resolved = resolveTarget(owner, rel.target);
    const name = source.getPart(resolved)?.name ?? resolved;
    if (processed.has(name.toLowerCase())) continue;
    processed.add(name.toLowerCase());
    let doc = documents.get(name);
    if (!doc && (preserveColors || preserveFonts || preserveMatrix)) {
      try {
        const xml = new TextDecoder().decode(source.getPart(name)!.data);
        if (
          (preserveColors && xml.includes("schemeClr")) ||
          (preserveFonts &&
            (/\btypeface\s*=/.test(xml) || fontDefaults.has(name))) ||
          (preserveMatrix && /(?:fill|ln|effect)Ref\b/.test(xml))
        )
          doc = parseXml(xml);
      } catch {
        // Keep malformed optional style/layout/drawing XML opaque and copyable.
      }
    }
    if (!doc) continue;
    documents.set(name, doc);
    let changed = applyDiagramFontDefaults(
      doc.root,
      fontDefaults.get(name) ?? [],
      name,
    );
    changed = (preserveColors?.(doc.root) ?? false) || changed;
    changed = (preserveFonts?.(doc.root) ?? false) || changed;
    changed = (preserveMatrix?.preserve(doc.root) ?? false) || changed;
    changed = fieldCopy.rewrite(doc.root) || changed;
    if (changed) modified.add(name);
  }
  const names = copyPartGraph(
    source,
    target,
    [
      ...selected
        .filter((r) => r.targetMode === "Internal")
        .map((r) => resolveTarget(owner, r.target)),
      ...(preserveMatrix?.roots ?? []),
    ],
    fieldCopy.bytes,
  );
  const copied = new Map(
    selected.map((rel) => [
      rel.id,
      {
        ...rel,
        id: mapId(rel.id),
        target:
          rel.targetMode === "External"
            ? rel.target
            : names.get(resolveTarget(owner, rel.target).toLowerCase())!,
      },
    ]),
  );
  for (const [name, doc] of documents) {
    let changed = modified.has(name);
    for (const ref of data.has(name)
      ? diagramDrawingReferences(doc.root)
      : []) {
      ref.attrs = ref.attrs.map((attr) => {
        if (attr.name.namespaceURI !== "" || attr.name.localName !== "relId")
          return attr;
        const next = copied.get(attr.value)?.id;
        if (next && next !== attr.value) {
          changed = true;
          return { ...attr, value: next };
        }
        return attr;
      });
    }
    if (changed)
      target.getPart(names.get(name.toLowerCase())!)!.data =
        new TextEncoder().encode(serializeXml(doc));
  }
  preserveMatrix?.commit(names);
  return copied;
};
