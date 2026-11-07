import {
  getShapeStrokeWidthInherited,
  readStrokeWidth,
} from "./shape-stroke-width.ts";
import { shapePaintSources } from "./shape-style-reference.ts";

// Shape reads: fill and stroke.

import { resolveDrawingOpacity } from "./shape-color.ts";
import { resolveShapeColor } from "./shape-color-context.ts";

import {
  NS,
  type XmlElement,
  firstChildElement,
  getAttrValue,
  qname,
} from "../../internal/xml/index.ts";
import {
  type PresentationData,
  SHAPE_ELEMENT,
  type SlideShapeData,
} from "../_internal-symbols.ts";
export type ShapeFill =
  | {
      readonly kind: "solid";
      readonly color: string;
      /** Resolved color alpha; omitted when fully opaque. */
      readonly opacity?: number;
    }
  | { readonly kind: "gradient" }
  | { readonly kind: "pattern" }
  | { readonly kind: "image" }
  | { readonly kind: "none" }
  | { readonly kind: "inherit" };

/**
 * Reads back the shape's stroke (`<a:ln>`). Returns:
 *
 *   - `{ kind: 'solid', color, widthEmu? }` for a solid-color outline.
 *   - `{ kind: 'none' }` when an `<a:noFill>` sits inside `<a:ln>`.
 *   - `{ kind: 'inherit' }` when no `<a:ln>` is present.
 */
export type ShapeStroke =
  | {
      readonly kind: "solid";
      readonly color: string;
      readonly widthEmu?: number;
      /** Resolved color alpha; omitted when fully opaque. */
      readonly opacity?: number;
    }
  | { readonly kind: "none" }
  | { readonly kind: "inherit" };

/**
 * Convenience over `getShapeStroke(shape)`: returns the solid-
 * stroke color (`#RRGGBB` / `scheme:<token>`) or `null` when the
 * stroke is inherited / removed.
 */
export const getShapeStrokeColor = (shape: SlideShapeData): string | null => {
  const stroke = getShapeStroke(shape);
  return stroke.kind === "solid" ? stroke.color : null;
};

/**
 * Convenience over `getShapeStroke(shape)`: returns the stroke
 * width in EMU when the stroke is solid and an explicit width is
 * set, or `null` otherwise.
 */
export const getShapeStrokeWidth = (shape: SlideShapeData): number | null => {
  const stroke = getShapeStroke(shape);
  return stroke.kind === "solid" && stroke.widthEmu !== undefined
    ? stroke.widthEmu
    : null;
};

/**
 * Returns the shape's stroke color resolved to a concrete `#RRGGBB`:
 * scheme tokens are mapped through the deck's color scheme and
 * `<a:lumMod>` / `<a:tint>` / `<a:shade>` / etc. transform children
 * are applied. Returns `null` when the stroke isn't a solid color
 * (inherits / `noFill`) or when the color can't be resolved.
 *
 * Companion to `getShapeStrokeColor`, which surfaces only the raw
 * `#RRGGBB` / `scheme:<token>` string — fine for round-tripping but
 * wrong for rendering, because the painted color is the *transformed*
 * color, not the base one.
 */
export const getShapeStrokeColorResolved = (
  pres: PresentationData,
  shape: SlideShapeData,
  colorMap?: Readonly<Record<string, string>> | null,
): string | null => {
  const spPr = firstChildElement(
    shape[SHAPE_ELEMENT],
    qname("p", "spPr", NS.pml),
  );
  if (!spPr) return null;
  const ln = firstChildElement(spPr, qname("a", "ln", NS.dml));
  if (!ln) return null;
  const solid = firstChildElement(ln, qname("a", "solidFill", NS.dml));
  if (!solid) return null;
  for (const inner of solid.children) {
    if (inner.kind !== "element" || inner.name.namespaceURI !== NS.dml)
      continue;
    return resolveShapeColor(pres, shape, inner, colorMap);
  }
  return null;
};

// Keep the selected paint XML, including bound phClr transforms, for rendering.
const effectivePaintSource = (
  shape: SlideShapeData,
  stroke: boolean,
): XmlElement | null =>
  shapePaintSources(shape, stroke).next().value?.element ?? null;

const resolveEffectiveSolidColor = (
  pres: PresentationData,
  shape: SlideShapeData,
  stroke: boolean,
  colorMap?: Readonly<Record<string, string>> | null,
): string | null => {
  const paint = effectivePaintSource(shape, stroke);
  if (paint?.name.localName !== "solidFill") return null;
  const color = paint.children.find(
    (c): c is XmlElement =>
      c.kind === "element" && c.name.namespaceURI === NS.dml,
  );
  return color ? resolveShapeColor(pres, shape, color, colorMap) : null;
};

/** Resolved solid outline color through the layout/master placeholder cascade.
 * Width and line decorations inherit independently. Local-property readers
 * remain local, and reads never materialize or modify inherited formatting. */
export const getShapeStrokeColorResolvedEffective = (
  pres: PresentationData,
  shape: SlideShapeData,
  colorMap?: Readonly<Record<string, string>> | null,
): string | null => resolveEffectiveSolidColor(pres, shape, true, colorMap);

/**
 * Reads the stroke's line cap style — `'rnd'` (round), `'sq'` (square),
 * `'flat'`, or `null` when the attribute isn't set. Per ECMA-376
 * §20.1.2.3.10 (`ST_LineCap`).
 */
export const getShapeStrokeCap = (
  shape: SlideShapeData,
): "rnd" | "sq" | "flat" | null => {
  const spPr = firstChildElement(
    shape[SHAPE_ELEMENT],
    qname("p", "spPr", NS.pml),
  );
  if (!spPr) return null;
  const ln = firstChildElement(spPr, qname("a", "ln", NS.dml));
  if (!ln) return null;
  const v = getAttrValue(ln, qname("", "cap", ""));
  if (v === "rnd" || v === "sq" || v === "flat") return v;
  return null;
};

/**
 * Reads the stroke's line join style — `'round'` / `'bevel'` / `'miter'`,
 * or `null` when no explicit join element is present. Maps from the
 * three child-element variants `<a:round/>`, `<a:bevel/>`, `<a:miter/>`.
 */
export const getShapeStrokeJoin = (
  shape: SlideShapeData,
): "round" | "bevel" | "miter" | null => {
  const spPr = firstChildElement(
    shape[SHAPE_ELEMENT],
    qname("p", "spPr", NS.pml),
  );
  if (!spPr) return null;
  const ln = firstChildElement(spPr, qname("a", "ln", NS.dml));
  if (!ln) return null;
  for (const c of ln.children) {
    if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
    if (c.name.localName === "round") return "round";
    if (c.name.localName === "bevel") return "bevel";
    if (c.name.localName === "miter") return "miter";
  }
  return null;
};

/**
 * Reads the stroke's compound-line style (`<a:ln cmpd="…">`) — single,
 * double, triple, or thick/thin / thin/thick parallel lines. ECMA-376
 * §20.1.2.3.11 (`ST_CompoundLine`).
 */
export const getShapeStrokeCompound = (
  shape: SlideShapeData,
): "sng" | "dbl" | "thickThin" | "thinThick" | "tri" | null => {
  const spPr = firstChildElement(
    shape[SHAPE_ELEMENT],
    qname("p", "spPr", NS.pml),
  );
  if (!spPr) return null;
  const ln = firstChildElement(spPr, qname("a", "ln", NS.dml));
  if (!ln) return null;
  const v = getAttrValue(ln, qname("", "cmpd", ""));
  if (
    v === "sng" ||
    v === "dbl" ||
    v === "thickThin" ||
    v === "thinThick" ||
    v === "tri"
  )
    return v;
  return null;
};

/**
 * Same as `getShapeStroke` but resolves direct paint, theme references, then
 * layout/master placeholders. Width inherits independently of paint.
 */
export const getShapeStrokeEffective = (
  pres: PresentationData,
  shape: SlideShapeData,
): ShapeStroke => {
  const own = getShapeStroke(shape);
  if (
    own.kind === "none" ||
    (own.kind === "solid" && own.widthEmu !== undefined)
  )
    return own;
  const paint = effectivePaintSource(shape, true);
  if (!paint) return own;
  const fill = readFillChoice(paint);
  if (fill.kind === "none") return fill;
  if (fill.kind !== "solid") return { kind: "inherit" };
  const widthEmu = getShapeStrokeWidthInherited(shape);
  return { ...fill, ...(widthEmu === null ? {} : { widthEmu }) };
};

const withStrokeOpacity = (
  stroke: Extract<ShapeStroke, { kind: "solid" }>,
  color: XmlElement | undefined,
): ShapeStroke => {
  // Most outlines have no color transforms. Reuse the original result so
  // opaque outlines do not allocate or parse an additional paint object.
  if (!color?.children.length) return stroke;
  const opacity = resolveDrawingOpacity(color);
  return opacity === 1 ? stroke : { ...stroke, opacity };
};

export const getShapeStroke = (shape: SlideShapeData): ShapeStroke => {
  const spPr = firstChildElement(
    shape[SHAPE_ELEMENT],
    qname("p", "spPr", NS.pml),
  );
  if (!spPr) return { kind: "inherit" };
  const ln = firstChildElement(spPr, qname("a", "ln", NS.dml));
  if (!ln) return { kind: "inherit" };

  const widthEmu = readStrokeWidth(ln) ?? undefined;

  for (const c of ln.children) {
    if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
    if (c.name.localName === "noFill") return { kind: "none" };
    if (c.name.localName === "solidFill") {
      for (const inner of c.children) {
        if (inner.kind !== "element" || inner.name.namespaceURI !== NS.dml)
          continue;
        if (inner.name.localName === "srgbClr") {
          const val = getAttrValue(inner, qname("", "val", ""));
          if (val !== null) {
            return withStrokeOpacity(
              {
                kind: "solid",
                color: `#${val.toUpperCase()}`,
                ...(widthEmu !== undefined ? { widthEmu } : {}),
              },
              inner,
            );
          }
        }
        if (inner.name.localName === "schemeClr") {
          const val = getAttrValue(inner, qname("", "val", ""));
          if (val !== null) {
            return withStrokeOpacity(
              {
                kind: "solid",
                color: `scheme:${val}`,
                ...(widthEmu !== undefined ? { widthEmu } : {}),
              },
              inner,
            );
          }
        }
      }
      return withStrokeOpacity(
        {
          kind: "solid",
          color: "",
          ...(widthEmu !== undefined ? { widthEmu } : {}),
        },
        c.children.find(
          (child): child is XmlElement =>
            child.kind === "element" && child.name.namespaceURI === NS.dml,
        ),
      );
    }
  }
  return { kind: "inherit" };
};

/**
 * Convenience over `getShapeFill(shape)`: returns the solid-fill
 * color string (`#RRGGBB` or `scheme:<token>`) when the shape has
 * one, or `null` otherwise. Use when the caller only cares about
 * the color and doesn't need to distinguish "inherit" / "no fill" /
 * "gradient" / "pattern" / "image" from each other.
 */
export const getShapeFillColor = (shape: SlideShapeData): string | null => {
  const fill = getShapeFill(shape);
  return fill.kind === "solid" ? fill.color : null;
};

/**
 * Returns the shape's solid fill resolved to a concrete `#RRGGBB`:
 * scheme tokens are mapped through the deck's color scheme and
 * `<a:lumMod>` / `<a:tint>` / `<a:shade>` / etc. transform children
 * are applied. Returns `null` when the fill isn't solid (gradient,
 * pattern, image, none, inherit) or when the color can't be resolved.
 *
 * Companion to `getShapeFillColor`, which surfaces only the raw
 * `#RRGGBB` / `scheme:<token>` string. Renderers and exporters that
 * need the color that is actually painted should call this.
 */
export const getShapeFillColorResolved = (
  pres: PresentationData,
  shape: SlideShapeData,
  colorMap?: Readonly<Record<string, string>> | null,
): string | null => {
  const spPr = firstChildElement(
    shape[SHAPE_ELEMENT],
    qname("p", "spPr", NS.pml),
  );
  if (!spPr) return null;
  const solid = firstChildElement(spPr, qname("a", "solidFill", NS.dml));
  if (!solid) return null;
  for (const inner of solid.children) {
    if (inner.kind !== "element" || inner.name.namespaceURI !== NS.dml)
      continue;
    return resolveShapeColor(pres, shape, inner, colorMap);
  }
  return null;
};

/** Resolved solid fill color through the layout/master placeholder cascade.
 * Keeps the chosen color's transforms and the host slide's theme/color map.
 * A nearer non-solid fill or unresolvable color blocks farther solid fills. */
export const getShapeFillColorResolvedEffective = (
  pres: PresentationData,
  shape: SlideShapeData,
  colorMap?: Readonly<Record<string, string>> | null,
): string | null => resolveEffectiveSolidColor(pres, shape, false, colorMap);

const withFillOpacity = (
  fill: Extract<ShapeFill, { kind: "solid" }>,
  color: XmlElement | undefined,
): ShapeFill => {
  if (!color?.children.length) return fill;
  const opacity = resolveDrawingOpacity(color);
  return opacity === 1 ? fill : { ...fill, opacity };
};

/**
 * Same as `getShapeFill` but walks the layout → master placeholder
 * cascade when the shape itself reports `'inherit'`. Returns the first
 * non-inherit fill found, or `{ kind: 'inherit' }` when neither layer
 * supplies one. Useful for renderers that want the actual fill the
 * placeholder will paint with.
 */
export const getShapeFillEffective = (
  pres: PresentationData,
  shape: SlideShapeData,
): ShapeFill => {
  const own = getShapeFill(shape);
  if (own.kind !== "inherit") return own;
  const paint = effectivePaintSource(shape, false);
  return paint ? readFillChoice(paint) : own;
};

const readFillChoice = (paint: XmlElement): ShapeFill => {
  switch (paint.name.localName) {
    case "noFill":
      return { kind: "none" };
    case "gradFill":
      return { kind: "gradient" };
    case "pattFill":
      return { kind: "pattern" };
    case "blipFill":
      return { kind: "image" };
    case "solidFill": {
      const color = paint.children.find(
        (c): c is XmlElement =>
          c.kind === "element" && c.name.namespaceURI === NS.dml,
      );
      const val = color && getAttrValue(color, qname("", "val", ""));
      return withFillOpacity(
        {
          kind: "solid",
          color:
            color?.name.localName === "srgbClr" && val !== null
              ? `#${val!.toUpperCase()}`
              : color?.name.localName === "schemeClr" && val !== null
                ? `scheme:${val}`
                : "",
        },
        color,
      );
    }
    default:
      return { kind: "inherit" };
  }
};

export const getShapeFill = (shape: SlideShapeData): ShapeFill => {
  const spPrName = qname("p", "spPr", NS.pml);
  const spPr = firstChildElement(shape[SHAPE_ELEMENT], spPrName);
  if (!spPr) return { kind: "inherit" };
  for (const c of spPr.children) {
    if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
    switch (c.name.localName) {
      case "noFill":
        return { kind: "none" };
      case "solidFill": {
        // Look for the immediate color choice; report sRGB verbatim,
        // scheme colors as "scheme:<token>".
        for (const inner of c.children) {
          if (inner.kind !== "element" || inner.name.namespaceURI !== NS.dml)
            continue;
          if (inner.name.localName === "srgbClr") {
            const val = getAttrValue(inner, qname("", "val", ""));
            if (val !== null)
              return withFillOpacity(
                { kind: "solid", color: `#${val.toUpperCase()}` },
                inner,
              );
          }
          if (inner.name.localName === "schemeClr") {
            const val = getAttrValue(inner, qname("", "val", ""));
            if (val !== null)
              return withFillOpacity(
                { kind: "solid", color: `scheme:${val}` },
                inner,
              );
          }
        }
        return withFillOpacity(
          { kind: "solid", color: "" },
          c.children.find(
            (child): child is XmlElement =>
              child.kind === "element" && child.name.namespaceURI === NS.dml,
          ),
        );
      }
      case "gradFill":
        return { kind: "gradient" };
      case "pattFill":
        return { kind: "pattern" };
      case "blipFill":
        return { kind: "image" };
    }
  }
  return { kind: "inherit" };
};
