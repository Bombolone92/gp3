import { getPlaceholderInheritance } from "./placeholder-inheritance.ts";
// Geometry belongs to both shapes and pictures. Inheritance is resolved before
// evaluating guides, using the instance's extents rather than the template's.
import {
  parseCustomGeometry,
  parsePresetGeometry,
  type CustomGeometry,
} from "../../internal/drawingml/index.ts";

import {
  NS,
  type XmlElement,
  firstChildElement,
  getAttrValue,
  qname,
} from "../../internal/xml/index.ts";
import {
  SHAPE_ELEMENT,
  SHAPE_SNAPSHOT,
  type PresentationData,
  type SlideShapeData,
} from "../_internal-symbols.ts";
import { getShapeBoundsResolved } from "./shape-read-base.ts";

const child = (el: XmlElement, ns: string, name: string): XmlElement | null =>
  firstChildElement(el, qname("", name, ns));
const value = (el: XmlElement, name: string): string | null =>
  getAttrValue(el, qname("", name, ""));

/** Internal read-only element, never attach it directly to an editable tree. */
export const ownGeometry = (el: XmlElement): XmlElement | null => {
  const spPr = child(el, NS.pml, "spPr");
  return (
    spPr?.children.find(
      (c): c is XmlElement =>
        c.kind === "element" &&
        c.name.namespaceURI === NS.dml &&
        (c.name.localName === "custGeom" || c.name.localName === "prstGeom"),
    ) ?? null
  );
};

export const effectiveGeometryElement = (
  shape: SlideShapeData,
): XmlElement | null => {
  const local = ownGeometry(shape[SHAPE_ELEMENT]);
  if (local) return local; // Explicit geometry, even malformed, stops inheritance.
  const inheritance = getPlaceholderInheritance(shape);
  if (!inheritance) return null;
  for (const ancestor of [inheritance.layout, inheritance.master]) {
    if (!ancestor) continue;
    const geometry = ownGeometry(ancestor.element);
    if (geometry) return geometry;
  }
  return null;
};

export type ShapeGeometry =
  | {
      readonly kind: "preset";
      readonly preset: string;
      readonly adjustments: Readonly<Record<string, number>>;
    }
  | { readonly kind: "custom"; readonly geometry: CustomGeometry | null };

/** Preset identity plus paths/text bounds evaluated at the instance extents. */
export type ShapeGeometryResolved = ShapeGeometry & {
  readonly geometry: CustomGeometry | null;
};

export const getShapeGeometryResolved = (
  pres: PresentationData,
  shape: SlideShapeData,
  extents?: { readonly w: number; readonly h: number },
): ShapeGeometryResolved | null => {
  const metadata = getShapeGeometryEffective(pres, shape, extents);
  if (!metadata || metadata.kind === "custom") return metadata;
  const bounds = extents ?? getShapeBoundsResolved(pres, shape);
  const el = effectiveGeometryElement(shape)!;
  return {
    ...metadata,
    geometry: bounds
      ? parsePresetGeometry(
          metadata.preset,
          bounds.w,
          bounds.h,
          child(el, NS.dml, "avLst"),
        )
      : null,
  };
};

/**
 * Effective native geometry; a null custom model denotes malformed guides.
 * Layout candidates may supply local extents without mutating the shape.
 */
export const getShapeGeometryEffective = (
  pres: PresentationData,
  shape: SlideShapeData,
  extents?: { readonly w: number; readonly h: number },
): ShapeGeometry | null => {
  const kind = shape[SHAPE_SNAPSHOT].kind;
  if (kind !== "shape" && kind !== "picture" && kind !== "connector")
    return null;
  const el = effectiveGeometryElement(shape);
  if (!el) return null;
  if (el.name.localName === "custGeom") {
    const bounds = extents ?? getShapeBoundsResolved(pres, shape);
    return {
      kind: "custom",
      geometry: bounds ? parseCustomGeometry(el, bounds.w, bounds.h) : null,
    };
  }
  const adjustments: Record<string, number> = {};
  const avLst = child(el, NS.dml, "avLst");
  for (const gd of avLst?.children ?? []) {
    if (
      gd.kind !== "element" ||
      gd.name.namespaceURI !== NS.dml ||
      gd.name.localName !== "gd"
    )
      continue;
    const name = value(gd, "name"),
      formula = value(gd, "fmla");
    const match = formula && /^val\s+(-?\d+(?:\.\d+)?)$/.exec(formula);
    if (name && match && Number.isFinite(Number(match[1])))
      adjustments[name] = Number(match[1]);
  }
  return { kind: "preset", preset: value(el, "prst") ?? "rect", adjustments };
};
