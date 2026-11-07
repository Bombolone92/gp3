// Preserve layout-owned geometry when a copy is rebound to another template.
// Normal reads and saves keep the authored inheritance untouched.
import {
  findTransform,
  setPosition,
  setSize,
} from "../../internal/drawingml/index.ts";
import {
  readGroupChildren,
  readShapeTreeFromCsldRoot,
} from "../../internal/presentationml/index.ts";
import {
  NS,
  type XmlElement,
  elem,
  firstChildElement,
  qname,
} from "../../internal/xml/index.ts";
import {
  INTERNAL_PACKAGE,
  SHAPE_ELEMENT,
  SHAPE_SLIDE,
  SHAPE_SNAPSHOT,
  SLIDE_SHAPES,
  type PresentationData,
  type SlideData,
  type SlideShapeData,
} from "../_internal-symbols.ts";
import { effectiveGeometryElement, ownGeometry } from "./shape-geometry.ts";
import { getGroupChildren, getShapeBoundsResolved } from "./shape-read-base.ts";

const cloneElement = (el: XmlElement): XmlElement => ({
  ...el,
  name: { ...el.name },
  attrs: el.attrs.map((a) => ({ name: { ...a.name }, value: a.value })),
  prefixDecls: new Map(el.prefixDecls),
  children: el.children.map((c) =>
    c.kind === "element" ? cloneElement(c) : { ...c },
  ),
});

const preserveOne = (source: SlideShapeData, clone: XmlElement): boolean => {
  const geometry = effectiveGeometryElement(source);
  if (!geometry) return false;
  let changed = false;
  if (!ownGeometry(clone)) {
    const spPrName = qname("p", "spPr", NS.pml);
    let spPr = firstChildElement(clone, spPrName);
    if (!spPr) {
      spPr = elem(spPrName);
      // nv*Pr precedes spPr for shapes, pictures, and connectors.
      clone.children.splice(1, 0, spPr);
    }
    const xfrmIndex = spPr.children.findIndex(
      (c) =>
        c.kind === "element" &&
        c.name.namespaceURI === NS.dml &&
        c.name.localName === "xfrm",
    );
    spPr.children.splice(xfrmIndex + 1, 0, cloneElement(geometry));
    changed = true;
  }
  const kind = source[SHAPE_SNAPSHOT].kind;
  const own = source[SHAPE_ELEMENT];
  if (!findTransform(own, kind)) {
    const sourcePresentation: PresentationData = {
      [INTERNAL_PACKAGE]: source[SHAPE_SLIDE][INTERNAL_PACKAGE],
      _slidesCache: null,
    };
    const bounds = getShapeBoundsResolved(sourcePresentation, source);
    if (bounds) {
      setPosition(clone, kind, bounds.x, bounds.y);
      setSize(clone, kind, bounds.w, bounds.h);
      changed = true;
    }
  }
  return changed;
};

/** Internal companion for cross-layout shape copies, including nested groups. */
export const preserveCopiedGeometry = (
  source: SlideShapeData,
  clone: XmlElement,
): void => {
  preserveOne(source, clone);
  if (source[SHAPE_SNAPSHOT].kind !== "group") return;
  const children = getGroupChildren(source),
    clones = readGroupChildren(clone);
  children.forEach((child, i) => {
    const target = clones[i];
    if (target) preserveCopiedGeometry(child, target.element);
  });
};

/** Called on the untouched clone, before any unsupported frames are removed. */
export const preserveImportedGeometry = (
  source: SlideData,
  clone: XmlElement,
): boolean => {
  const copied = readShapeTreeFromCsldRoot(clone, "sld").shapes;
  let changed = false;
  source[SLIDE_SHAPES].forEach((shape, i) => {
    const target = copied[i];
    if (target) changed = preserveOne(shape, target.element) || changed;
  });
  return changed;
};
