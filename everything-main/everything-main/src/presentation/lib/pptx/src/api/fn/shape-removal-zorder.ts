// Shape removal and z-order.

import {
  createTextStyleCopy,
  preserveCopiedText,
} from "./text-style-import.ts";
import { preserveCopiedGeometry } from "./shape-geometry-import.ts";
import {
  createPaintStyleCopy,
  preserveCopiedPaint,
} from "./paint-style-import.ts";
import { getSlideLayout } from "./shape-slide-read.ts";
import { REL_TYPES } from "../../internal/presentationml/index.ts";
import { createTextFieldCopy } from "./text-field-copy.ts";
import { copyChartRelationships } from "./chart-copy.ts";
import { withPackageTransaction } from "../../internal/parts/package-transaction.ts";
import { LAYOUT_PART_NAME } from "../_internal-symbols.ts";
import {
  dirname,
  emptyRels,
  nextRelId,
  resolveTarget,
} from "../../internal/opc/index.ts";
import {
  copyDiagramRelationships,
  getDiagramRelationshipIds,
  isDiagramRelationship,
} from "./diagram-copy.ts";
import {
  NS,
  type XmlElement,
  type XmlAttr,
  walkElements,
  getAttrValue,
  firstChildElement,
  qname,
} from "../../internal/xml/index.ts";
import {
  INTERNAL_PACKAGE,
  SHAPE_ELEMENT,
  SHAPE_SLIDE,
  SLIDE_DOCUMENT,
  SLIDE_PART_NAME,
  SLIDE_SHAPES,
  type SlideData,
  type SlideShapeData,
} from "../_internal-symbols.ts";
import {
  commitSlideData,
  rebuildShapesFromDocument,
  requireSpTree,
} from "./_helpers.ts";
// ---------------------------------------------------------------------------
// Shape mutation — removal.

/**
 * Copies a shape into `targetSlide`. The source XML is cloned and
 * appended to the target's `<p:spTree>`. Relationship references are rebound
 * to the target slide. Ordinary media parts remain shared within the package;
 * chart/diagram parts and their dependencies are cloned so edits or rebinding
 * cannot alter the original object.
 *
 * v1 requires source and target to live in the same package
 * (`sourceShape`'s slide and `targetSlide` must share the same
 * `OpcPackage`). Cross-package copy is `importSlide` territory.
 *
 * Set `preserveTextFormatting` when the copy must retain its source text
 * styles across slide, layout or theme contexts. The default retains authored
 * theme references, which adapt to the destination.
 * `preservePaintFormatting` retains source fills, outlines and effects too.
 * Diagram palettes, explicit colors and authored theme-font typefaces participate
 * in these options. Diagram paint preservation imports referenced theme matrix
 * entries; implicit diagram fontRef defaults are not materialized yet.
 * Returns the new `SlideShapeData` on `targetSlide`.
 */
export const copyShape = (
  targetSlide: SlideData,
  sourceShape: SlideShapeData,
  options: CopyShapeOptions = {},
): SlideShapeData => copyShapes(targetSlide, [sourceShape], options)[0]!;

export type CopyShapeOptions = {
  preserveTextFormatting?: boolean;
  preservePaintFormatting?: boolean;
};

/**
 * Copies one selection in input order, allocating all shape identities before
 * rebinding native connector endpoints. Groups include their descendants.
 * Connections to selected shapes follow the copies regardless of input order.
 * Unselected endpoints remain attached when copying within the same slide;
 * across slides they are detached, retaining the authored connector geometry.
 * Source slides must share the target package. Repeated/overlapping selections
 * and exhausted shape identities are rejected before mutation.
 */
export const copyShapes = (
  targetSlide: SlideData,
  sourceShapes: ReadonlyArray<SlideShapeData>,
  options: CopyShapeOptions = {},
): SlideShapeData[] => {
  if (!sourceShapes.length) return [];
  const pkg = targetSlide[INTERNAL_PACKAGE];
  const seen = new Set<XmlElement>();
  for (const shape of sourceShapes) {
    if (shape[SHAPE_SLIDE][INTERNAL_PACKAGE] !== pkg)
      throw new Error(
        "copyShape: source and target must be in the same package. Use importSlide for cross-deck copies.",
      );
    walkElements(shape[SHAPE_ELEMENT], (el) => {
      if (seen.has(el))
        throw new Error("copyShapes: repeated or overlapping source shapes");
      seen.add(el);
    });
  }

  const spTree = requireSpTree(targetSlide);
  let lastId = 1;
  walkElements(spTree, (el) => {
    if (el.name.namespaceURI === NS.pml && el.name.localName === "cNvPr") {
      const id = drawingId(getAttrValue(el, qname("", "id", "")));
      if (id !== null) lastId = Math.max(lastId, id);
    }
  });
  // A mapping is scoped to the source slide, never to its package: two slides
  // may legitimately use identical cNvPr identities. Ambiguous malformed
  // duplicate source IDs cannot identify an endpoint and are detached.
  const maps = new Map<SlideData, Map<number, number | null>>();
  const prepared = sourceShapes.map((shape) => {
    const sourceSlide = shape[SHAPE_SLIDE];
    const cloned = cloneXmlElement(shape[SHAPE_ELEMENT]);
    const textCopy = createTextStyleCopy();
    if (options.preserveTextFormatting === true && sourceSlide !== targetSlide)
      preserveCopiedText(shape, cloned, textCopy);
    if (options.preservePaintFormatting === true && sourceSlide !== targetSlide)
      preserveCopiedPaint(
        shape,
        cloned,
        createPaintStyleCopy(textCopy.references),
      );
    if (
      getSlideLayout(sourceSlide)?.[LAYOUT_PART_NAME] !==
      getSlideLayout(targetSlide)?.[LAYOUT_PART_NAME]
    )
      preserveCopiedGeometry(shape, cloned);
    let ids = maps.get(sourceSlide);
    if (!ids) maps.set(sourceSlide, (ids = new Map()));
    walkElements(cloned, (el) => {
      if (el.name.namespaceURI !== NS.pml || el.name.localName !== "cNvPr")
        return;
      const attr = el.attrs.find(
        (a) => a.name.namespaceURI === "" && a.name.localName === "id",
      );
      if (!attr) return;
      if (lastId >= DRAWING_ID_MAX)
        throw new Error("copyShapes: shape identities exhausted");
      const oldId = drawingId(attr.value),
        id = ++lastId;
      if (oldId !== null) ids.set(oldId, ids.has(oldId) ? null : id);
      el.attrs = el.attrs.map((a) =>
        a === attr ? { name: a.name, value: String(id) } : a,
      );
    });
    return { shape, cloned, textCopy };
  });
  for (const { shape, cloned } of prepared)
    rebindConnections(
      cloned,
      maps.get(shape[SHAPE_SLIDE])!,
      shape[SHAPE_SLIDE] === targetSlide,
    );

  const fieldCopy = createTextFieldCopy(pkg);
  // Graph copying writes new parts and may replace relationship/theme bytes.
  // Keep immutable payload references rather than duplicating large media;
  // a failed later graph must leave the earlier copies uncommitted too.
  withPackageTransaction(pkg, () => {
    for (const { shape, cloned, textCopy } of prepared)
      copyPreparedShape(
        targetSlide,
        shape,
        cloned,
        textCopy,
        fieldCopy.fork(),
        options,
      );
  });
  for (const { cloned } of prepared) spTree.children.push(cloned);
  commitSlideData(targetSlide);
  rebuildShapesFromDocument(targetSlide);
  const handles = new Map(
    targetSlide[SLIDE_SHAPES].map((shape) => [shape[SHAPE_ELEMENT], shape]),
  );
  return prepared.map(({ cloned }) => {
    const shape = handles.get(cloned);
    if (!shape) throw new Error("copyShapes: post-condition failed");
    return shape;
  });
};

const DRAWING_ID_MAX = 4294967295; // ST_DrawingElementId: unsignedInt.
const drawingId = (value: string | null): number | null => {
  if (value === null || !/^\s*\+?\d+\s*$/.test(value)) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= DRAWING_ID_MAX
    ? number
    : null;
};

const rebindConnections = (
  root: XmlElement,
  ids: ReadonlyMap<number, number | null>,
  sameSlide: boolean,
): void => {
  walkElements(root, (el) => {
    if (el.name.namespaceURI !== NS.pml || el.name.localName !== "cNvCxnSpPr")
      return;
    el.children = el.children.filter((child) => {
      if (
        child.kind !== "element" ||
        child.name.namespaceURI !== NS.dml ||
        !["stCxn", "endCxn"].includes(child.name.localName)
      )
        return true;
      const attr = child.attrs.find(
        (a) => a.name.namespaceURI === "" && a.name.localName === "id",
      );
      const oldId = drawingId(attr?.value ?? null);
      if (oldId === null) return true; // Opaque/malformed source data remains intact.
      if (!ids.has(oldId)) return sameSlide;
      const id = ids.get(oldId);
      if (id == null) return false;
      // ISO 29500 stCxn/endCxn@id names a shape; idx names its connection site.
      // Rebind only identity, preserving the site and all other authored data.
      child.attrs = child.attrs.map((a) =>
        a === attr ? { name: a.name, value: String(id) } : a,
      );
      return true;
    });
  });
};

const copyPreparedShape = (
  targetSlide: SlideData,
  sourceShape: SlideShapeData,
  cloned: XmlElement,
  textCopy: ReturnType<typeof createTextStyleCopy>,
  fieldCopy: ReturnType<typeof createTextFieldCopy>,
  options: CopyShapeOptions,
): void => {
  const sourceSlide = sourceShape[SHAPE_SLIDE];
  const pkg = targetSlide[INTERNAL_PACKAGE];
  const sourceEl = sourceShape[SHAPE_ELEMENT];

  // Walk the cloned element for r:embed / r:link references. For each
  // referenced rId in the source slide's rels, copy the rel onto the
  // target slide's rels (allocating a fresh rId) and update the cloned
  // attribute. This covers picture blips + media references.
  const sourceRels = pkg.getRels(sourceSlide[SLIDE_PART_NAME]);
  {
    const targetRels = pkg.getRels(targetSlide[SLIDE_PART_NAME]) ?? emptyRels();
    const usedIds = new Set(targetRels.items.map((r) => r.id));
    // Only frames and groups can contain diagram references. Keep the common
    // text/shape/picture copy path to one relationship-attribute traversal.
    const mayHaveDiagram =
      cloned.name.localName === "graphicFrame" ||
      cloned.name.localName === "grpSp";
    const refs =
      mayHaveDiagram &&
      sourceRels?.items.some((r) => isDiagramRelationship(r.type))
        ? getDiagramRelationshipIds(cloned)
        : null;
    const diagrams = refs?.size
      ? copyDiagramRelationships(
          pkg,
          sourceSlide[SLIDE_PART_NAME],
          sourceRels!,
          pkg,
          () => {
            const id = nextRelId([...usedIds]);
            usedIds.add(id);
            return id;
          },
          refs,
          sourceSlide !== targetSlide
            ? {
                sourceSlide,
                sourceRoot: sourceEl,
                ...options,
                targetThemeOwner: targetSlide[SLIDE_PART_NAME],
              }
            : undefined,
          fieldCopy,
        )
      : null;
    if (diagrams) targetRels.items.push(...diagrams.values());
    const chartIds = new Set<string>();
    if (
      mayHaveDiagram &&
      sourceRels?.items.some((r) => r.type === REL_TYPES.chart)
    )
      walkElements(cloned, (el) => {
        for (const a of el.attrs)
          if (a.name.namespaceURI === NS.officeDocRels) chartIds.add(a.value);
      });
    const charts =
      chartIds.size && sourceRels
        ? copyChartRelationships(
            pkg,
            sourceSlide[SLIDE_PART_NAME],
            sourceRels,
            pkg,
            () => {
              const id = nextRelId([...usedIds]);
              usedIds.add(id);
              return id;
            },
            chartIds,
            sourceSlide !== targetSlide
              ? { sourceSlide, ...options }
              : undefined,
            fieldCopy,
          )
        : null;
    if (charts) targetRels.items.push(...charts.values());
    rewriteRIdReferences(cloned, (oldRId, attribute) => {
      const owner =
        textCopy.references.get(attribute) ?? sourceSlide[SLIDE_PART_NAME];
      const sameDirectory =
        dirname(owner) === dirname(targetSlide[SLIDE_PART_NAME]);
      const diagram =
        owner === sourceSlide[SLIDE_PART_NAME] ? diagrams?.get(oldRId) : null;
      if (diagram) return diagram.id;
      const chart =
        owner === sourceSlide[SLIDE_PART_NAME] ? charts?.get(oldRId) : null;
      if (chart) return chart.id;
      const sourceRel = (
        owner === sourceSlide[SLIDE_PART_NAME] ? sourceRels : pkg.getRels(owner)
      )?.items.find((r) => r.id === oldRId);
      if (!sourceRel) return oldRId;
      const target =
        sameDirectory || sourceRel.targetMode === "External"
          ? sourceRel.target
          : resolveTarget(owner, sourceRel.target);
      // Look for an existing rel on target with the same type+target;
      // reuse if found to avoid duplicates.
      const existing = targetRels.items.find(
        (r) =>
          r.type === sourceRel.type &&
          (sameDirectory || r.targetMode === "External"
            ? r.target === target
            : resolveTarget(
                targetSlide[SLIDE_PART_NAME],
                r.target,
              ).toLowerCase() === target.toLowerCase()) &&
          r.targetMode === sourceRel.targetMode,
      );
      if (existing) return existing.id;
      const newRId = nextRelId([...usedIds]);
      usedIds.add(newRId);
      targetRels.items.push({ ...sourceRel, id: newRId, target });
      return newRId;
    });
    pkg.setRels(targetSlide[SLIDE_PART_NAME], targetRels);
  }

  fieldCopy.rewrite(cloned);
};

/** Recursively clone an XML element (no parent, deep). */
const cloneXmlElement = (el: XmlElement): XmlElement => ({
  kind: "element",
  name: el.name,
  attrs: el.attrs.map((a) => ({ name: a.name, value: a.value })),
  prefixDecls: new Map(el.prefixDecls),
  children: el.children.map((c) => {
    if (c.kind === "element") return cloneXmlElement(c);
    return { ...c };
  }),
});

const rewriteRIdReferences = (
  root: XmlElement,
  map: (oldRId: string, attribute: XmlAttr) => string,
): void => {
  const walk = (el: XmlElement): void => {
    el.attrs = el.attrs.map((a) => {
      if (a.name.namespaceURI === NS.officeDocRels) {
        return { name: a.name, value: map(a.value, a) };
      }
      return a;
    });
    for (const c of el.children) {
      if (c.kind === "element") walk(c);
    }
  };
  walk(root);
};

// ---------------------------------------------------------------------------
// Z-order — move shapes forward / backward inside the slide's spTree.
//
// OOXML shape z-order is just the document order of children of
// `<p:spTree>`: the first child renders behind, the last in front.
// Bring-to-front / send-to-back operations translate
// directly to reordering those children.
//
// Each function targets only "real" shape children — `<p:sp>`, `<p:pic>`,
// `<p:cxnSp>`, `<p:graphicFrame>`, `<p:grpSp>`. The required
// `<p:nvGrpSpPr>` / `<p:grpSpPr>` preface stays at the top.

const SHAPE_CHILD_LOCALS = new Set([
  "sp",
  "pic",
  "cxnSp",
  "graphicFrame",
  "grpSp",
]);

const isShapeChild = (node: {
  kind: string;
  name?: { namespaceURI: string; localName: string };
}): boolean =>
  node.kind === "element" &&
  node.name?.namespaceURI === NS.pml &&
  SHAPE_CHILD_LOCALS.has(node.name.localName);

/** Move `shape` to the end of its spTree (render in front of all others). */
export const bringShapeToFront = (shape: SlideShapeData): void => {
  const slide = shape[SHAPE_SLIDE];
  const spTree = requireSpTree(slide);
  const target = shape[SHAPE_ELEMENT];
  const idx = spTree.children.indexOf(target);
  if (idx < 0) return;
  if (idx === spTree.children.length - 1) return; // already at front
  spTree.children.splice(idx, 1);
  spTree.children.push(target);
  commitSlideData(slide);
  rebuildShapesFromDocument(slide);
};

/**
 * Move `shape` behind every other shape on the slide. The
 * `<p:nvGrpSpPr>` / `<p:grpSpPr>` preface — required by the schema —
 * stays at the top.
 */
export const sendShapeToBack = (shape: SlideShapeData): void => {
  const slide = shape[SHAPE_SLIDE];
  const spTree = requireSpTree(slide);
  const target = shape[SHAPE_ELEMENT];
  const idx = spTree.children.indexOf(target);
  if (idx < 0) return;

  // First "shape child" position — after nvGrpSpPr / grpSpPr.
  let firstShapeAt = spTree.children.length;
  for (let i = 0; i < spTree.children.length; i++) {
    const c = spTree.children[i];
    if (c && isShapeChild(c)) {
      firstShapeAt = i;
      break;
    }
  }
  if (idx <= firstShapeAt) return;
  spTree.children.splice(idx, 1);
  spTree.children.splice(firstShapeAt, 0, target);
  commitSlideData(slide);
  rebuildShapesFromDocument(slide);
};

/** Swap `shape` with the next shape sibling (move one step forward). */
export const bringShapeForward = (shape: SlideShapeData): void => {
  const slide = shape[SHAPE_SLIDE];
  const spTree = requireSpTree(slide);
  const target = shape[SHAPE_ELEMENT];
  const idx = spTree.children.indexOf(target);
  if (idx < 0) return;
  // Find next shape sibling.
  for (let i = idx + 1; i < spTree.children.length; i++) {
    const c = spTree.children[i];
    if (c && isShapeChild(c)) {
      const next = c;
      spTree.children[idx] = next;
      spTree.children[i] = target;
      commitSlideData(slide);
      rebuildShapesFromDocument(slide);
      return;
    }
  }
};

/**
 * Returns the shape's z-index among the slide's "real" shape children
 * (`<p:sp>` / `<p:pic>` / `<p:cxnSp>` / `<p:graphicFrame>` / `<p:grpSp>`),
 * skipping the required `<p:nvGrpSpPr>` / `<p:grpSpPr>` preface.
 * Higher numbers render in front.
 */
export const getShapeZIndex = (shape: SlideShapeData): number => {
  const slide = shape[SHAPE_SLIDE];
  const spTree = requireSpTree(slide);
  let i = 0;
  for (const c of spTree.children) {
    if (!isShapeChild(c)) continue;
    if (c === shape[SHAPE_ELEMENT]) return i;
    i++;
  }
  return -1;
};

/**
 * Moves the shape to a specific z-index among the slide's "real"
 * shape children. Index is clamped to the available range. Higher
 * numbers render in front. The required preface elements stay at the
 * top of `<p:spTree>`.
 */
export const setShapeZIndex = (
  shape: SlideShapeData,
  toIndex: number,
): void => {
  const slide = shape[SHAPE_SLIDE];
  const spTree = requireSpTree(slide);
  const target = shape[SHAPE_ELEMENT];
  const allShapeChildren = spTree.children.filter((c): c is XmlElement =>
    isShapeChild(c),
  );
  const clamped = Math.max(0, Math.min(toIndex, allShapeChildren.length - 1));

  // Remove the target from the tree, then re-insert at the position
  // corresponding to z-index `clamped` among the remaining shapes.
  spTree.children = spTree.children.filter((c) => c !== target);
  const remainingShapes = spTree.children.filter((c): c is XmlElement =>
    isShapeChild(c),
  );
  if (clamped >= remainingShapes.length) {
    spTree.children.push(target);
  } else {
    const anchor = remainingShapes[clamped]!;
    const anchorIdx = spTree.children.indexOf(anchor);
    spTree.children.splice(anchorIdx, 0, target);
  }
  commitSlideData(slide);
  rebuildShapesFromDocument(slide);
};

/** Swap `shape` with the previous shape sibling (move one step backward). */
export const sendShapeBackward = (shape: SlideShapeData): void => {
  const slide = shape[SHAPE_SLIDE];
  const spTree = requireSpTree(slide);
  const target = shape[SHAPE_ELEMENT];
  const idx = spTree.children.indexOf(target);
  if (idx < 0) return;
  for (let i = idx - 1; i >= 0; i--) {
    const c = spTree.children[i];
    if (c && isShapeChild(c)) {
      const prev = c;
      spTree.children[idx] = prev;
      spTree.children[i] = target;
      commitSlideData(slide);
      rebuildShapesFromDocument(slide);
      return;
    }
  }
};

/**
 * Removes the shape from its slide's shape tree. Subsequent property
 * reads on this handle reflect the stale snapshot — discard it after.
 *
 * Removing a picture does NOT delete the underlying media part — it
 * may be referenced from other slides.
 */
/**
 * Removes every shape (sp / pic / cxnSp / graphicFrame / grpSp) from
 * the slide's `<p:spTree>`. The required `<p:nvGrpSpPr>` and
 * `<p:grpSpPr>` preface stays in place, so the slide is still valid
 * and re-applies its layout's placeholders on the next open.
 *
 * Useful for "start this slide over but keep its layout binding."
 */
export const clearSlideShapes = (slide: SlideData): void => {
  const spTree = requireSpTree(slide);
  spTree.children = spTree.children.filter(
    (c) =>
      !(
        c.kind === "element" &&
        c.name.namespaceURI === NS.pml &&
        SHAPE_CHILD_LOCALS.has(c.name.localName)
      ),
  );
  commitSlideData(slide);
  rebuildShapesFromDocument(slide);
};

export const removeShape = (shape: SlideShapeData): void => {
  const slide = shape[SHAPE_SLIDE];
  const doc = slide[SLIDE_DOCUMENT];
  const cSld = firstChildElement(doc.root, qname("p", "cSld", NS.pml));
  if (!cSld) return;
  const spTree = firstChildElement(cSld, qname("p", "spTree", NS.pml));
  if (!spTree) return;
  const idx = spTree.children.indexOf(shape[SHAPE_ELEMENT]);
  if (idx < 0) return;
  spTree.children.splice(idx, 1);
  commitSlideData(slide);
  rebuildShapesFromDocument(slide);
};
