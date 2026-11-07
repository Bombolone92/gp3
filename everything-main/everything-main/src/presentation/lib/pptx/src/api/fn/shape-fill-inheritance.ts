import {
  NS,
  attr,
  elem,
  firstChildElement,
  getAttrValue,
  qname,
  type XmlElement,
} from "../../internal/xml/index.ts";
import {
  SHAPE_ELEMENT,
  SHAPE_SLIDE,
  type SlideShapeData,
} from "../_internal-symbols.ts";
import {
  shapePropertySources,
  type ShapePropertySource,
} from "./shape-property-sources.ts";
import { shapeStyleReference } from "./shape-style-reference.ts";
import { getEffectiveColorMap } from "./color-map.ts";
import { resolveDrawingColor, resolveDrawingOpacity } from "./shape-color.ts";
import { themeForShape } from "./shape-theme.ts";

const fills = new Set([
  "noFill",
  "solidFill",
  "gradFill",
  "pattFill",
  "blipFill",
  "grpFill",
]);
const colors = new Set([
  "srgbClr",
  "scrgbClr",
  "schemeClr",
  "sysClr",
  "prstClr",
  "hslClr",
]);
const child = (
  node: XmlElement | null,
  name: string,
  ns: string = NS.dml,
): XmlElement | null =>
  node
    ? firstChildElement(node, qname(ns === NS.pml ? "p" : "a", name, ns))
    : null;
const value = (node: XmlElement, name: string): string | null =>
  getAttrValue(node, qname("", name, ""));
const elements = (node: XmlElement | null): XmlElement[] =>
  node?.children.filter(
    (c): c is XmlElement =>
      c.kind === "element" && c.name.namespaceURI === NS.dml,
  ) ?? [];
const sameName = (
  a: { localName: string; namespaceURI: string },
  b: { localName: string; namespaceURI: string },
) => a.localName === b.localName && a.namespaceURI === b.namespaceURI;

const inheritAttributes = (
  own: XmlElement,
  fallback: XmlElement,
): XmlElement => {
  const missing = fallback.attrs.filter(
    (a) => !own.attrs.some((b) => sameName(a.name, b.name)),
  );
  return missing.length ? { ...own, attrs: [...own.attrs, ...missing] } : own;
};

/** MS-OI29500 20.1.8: stop lists are atomic; linear/path shading is a choice.
 * Schema-defaulted rectangles also inherit as complete elements. Never edit
 * either input: this view is only for effective reads, not serialization. */
export const inheritGradientFill = (
  own: XmlElement,
  fallback: XmlElement,
): XmlElement => {
  if (
    own.name.namespaceURI !== NS.dml ||
    fallback.name.namespaceURI !== NS.dml ||
    own.name.localName !== "gradFill" ||
    fallback.name.localName !== "gradFill"
  )
    return own;
  const base = inheritAttributes(own, fallback),
    ownShade = child(own, "lin") ?? child(own, "path"),
    fallbackShade = child(fallback, "lin") ?? child(fallback, "path");
  let children = base.children;
  if (
    ownShade &&
    fallbackShade &&
    sameName(ownShade.name, fallbackShade.name)
  ) {
    let shade = inheritAttributes(ownShade, fallbackShade);
    if (shade.name.localName === "path" && !child(shade, "fillToRect")) {
      const rect = child(fallbackShade, "fillToRect");
      if (rect) shade = { ...shade, children: [...shade.children, rect] };
    }
    if (shade !== ownShade)
      children = children.map((c) => (c === ownShade ? shade : c));
  } else if (!ownShade && fallbackShade)
    children = [...children, fallbackShade];
  for (const name of ["gsLst", "tileRect"]) {
    const inherited = child(fallback, name);
    if (!child(own, name) && inherited) children = [...children, inherited];
  }
  return children === base.children ? base : { ...base, children };
};

/** Pattern preset and color channels inherit independently. A present channel
 * owns its complete color choice and transforms; never merge different colors. */
export const inheritPatternFill = (
  own: XmlElement,
  fallback: XmlElement,
): XmlElement => {
  if (
    own.name.namespaceURI !== NS.dml ||
    fallback.name.namespaceURI !== NS.dml ||
    own.name.localName !== "pattFill" ||
    fallback.name.localName !== "pattFill"
  )
    return own;
  const base = inheritAttributes(own, fallback);
  let children = base.children;
  for (const name of ["fgClr", "bgClr"]) {
    const inherited = child(fallback, name);
    if (!child(own, name) && inherited) children = [...children, inherited];
  }
  return children === base.children ? base : { ...base, children };
};

/** Shared effective-read/copy merge; different fill choices remain barriers. */
export const inheritFill = (
  own: XmlElement,
  fallback: XmlElement,
): XmlElement =>
  own.name.localName === "pattFill"
    ? inheritPatternFill(own, fallback)
    : inheritGradientFill(own, fallback);

/** Resolve each placeholder layer before merging it into its descendant.
 * A layout solid/no-fill blocks a master gradient, while an own gradient can
 * obtain missing fields from its own style and then the resolved layout.
 * Native reference controls distinguish this from a flat ancestor scan. */
export const getShapeGradientSource = (
  shape: SlideShapeData,
  colorMap?: Readonly<Record<string, string>> | null,
) => getShapeFillSource(shape, "gradFill", colorMap);

export const getShapePatternSource = (
  shape: SlideShapeData,
  colorMap?: Readonly<Record<string, string>> | null,
) => getShapeFillSource(shape, "pattFill", colorMap);

const getShapeFillSource = (
  shape: SlideShapeData,
  kind: "gradFill" | "pattFill",
  colorMap?: Readonly<Record<string, string>> | null,
) => {
  const inherit = inheritFill;
  let theme: ReturnType<typeof themeForShape> | undefined;
  const view = () =>
    theme === undefined ? (theme = themeForShape(shape)) : theme;
  let map = colorMap;
  const styleFill = (
    source: ShapePropertySource,
    needsColors: boolean,
  ): XmlElement | null => {
    const fill = shapeStyleReference(shape, source, "fillRef")?.element;
    if (!fill) return null;
    if (fill.name.localName !== kind || !needsColors) return fill;
    const theme = view();
    if (!theme) return fill;
    const resolve = (node: XmlElement): XmlElement => {
      if (
        node.name.namespaceURI === NS.dml &&
        colors.has(node.name.localName)
      ) {
        const color = node;
        const hex = resolveDrawingColor(
          color,
          theme.theme,
          (map ??= getEffectiveColorMap(shape[SHAPE_SLIDE])),
        );
        if (!hex) return node;
        const opacity = resolveDrawingOpacity(color);
        return elem(qname("a", "srgbClr", NS.dml), {
          attrs: [attr(qname("", "val", ""), hex.slice(1))],
          children:
            opacity === 1
              ? []
              : [
                  elem(qname("a", "alpha", NS.dml), {
                    attrs: [
                      attr(qname("", "val", ""), String(opacity * 100000)),
                    ],
                  }),
                ],
        });
      }
      return {
        ...node,
        children: node.children.map((c) =>
          c.kind === "element" ? resolve(c) : c,
        ),
      };
    };
    return resolve(fill);
  };
  const literal = (host: XmlElement) =>
    elements(child(host, "spPr", NS.pml)).find((c) =>
      fills.has(c.name.localName),
    ) ?? null;
  const own = literal(shape[SHAPE_ELEMENT]);
  if (own && own.name.localName !== kind) return null;
  const result = (element: XmlElement) => ({
    element,
    get theme() {
      return view()?.theme ?? null;
    },
  });
  // Skip fallback only when all properties consumed by the reader are present.
  // In particular, full stops/linear shading do not specify the tile rectangle.
  // Extend this completeness check when the reader exposes other properties.
  const linear = child(own, "lin");
  if (
    own &&
    (kind === "gradFill"
      ? child(own, "gsLst") &&
        linear &&
        value(linear, "ang") !== null &&
        value(linear, "scaled") !== null &&
        child(own, "tileRect")
      : value(own, "prst") !== null &&
        child(own, "fgClr") &&
        child(own, "bgClr"))
  )
    return result(own);
  let resolved: XmlElement | null = null;
  for (const source of shapePropertySources(shape).reverse()) {
    const host = source.element;
    const direct = host === shape[SHAPE_ELEMENT] ? own : literal(host),
      style = styleFill(
        source,
        kind === "gradFill"
          ? !child(direct, "gsLst")
          : !child(direct, "fgClr") || !child(direct, "bgClr"),
      );
    let current = direct ?? style;
    if (direct && style) current = inherit(direct, style);
    resolved = current
      ? resolved
        ? inherit(current, resolved)
        : current
      : resolved;
  }
  return resolved?.name.localName === kind ? result(resolved) : null;
};
