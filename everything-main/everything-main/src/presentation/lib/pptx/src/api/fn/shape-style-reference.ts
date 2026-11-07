import {
  NS,
  elem,
  firstChildElement,
  getAttrValue,
  qname,
  type XmlElement,
} from "../../internal/xml/index.ts";
import type { SlideShapeData } from "../_internal-symbols.ts";
import { themeForShape } from "./shape-theme.ts";
import { styleMatrixEntries } from "./theme-style-matrix.ts";
import {
  iterateShapePropertySources,
  type ShapePropertySource,
} from "./shape-property-sources.ts";

const child = (el: XmlElement | null, name: string, ns: string = NS.dml) =>
  el && firstChildElement(el, qname("", name, ns));
const colors = new Set([
  "srgbClr",
  "scrgbClr",
  "hslClr",
  "schemeClr",
  "sysClr",
  "prstClr",
]);
const fills = new Set([
  "noFill",
  "solidFill",
  "gradFill",
  "pattFill",
  "blipFill",
  "grpFill",
]);

/** Replace the theme's phClr with the reference color, retaining transform
 * order (reference transforms first). This is a read-only view: opaque
 * extension XML, relationship scope, and the native style entry stay intact. */
export const bindStyleColor = (
  entry: XmlElement,
  reference: XmlElement,
): XmlElement => {
  const placeholder = reference.children.find(
    (c): c is XmlElement =>
      c.kind === "element" &&
      c.name.namespaceURI === NS.dml &&
      colors.has(c.name.localName),
  );
  if (!placeholder) return entry;
  const views = new WeakMap<XmlElement, XmlElement>();
  const pending = [{ el: entry, visited: false }];
  while (pending.length) {
    const { el, visited } = pending.pop()!;
    if (el.name.namespaceURI !== NS.dml || el.name.localName === "extLst")
      continue;
    if (
      el.name.localName === "schemeClr" &&
      getAttrValue(el, qname("", "val", "")) === "phClr"
    ) {
      views.set(el, {
        ...placeholder,
        children: [...placeholder.children, ...el.children],
      });
      continue;
    }
    if (!visited) {
      pending.push({ el, visited: true });
      for (const c of el.children)
        if (c.kind === "element") pending.push({ el: c, visited: false });
    } else if (el.children.some((c) => c.kind === "element" && views.has(c)))
      views.set(el, {
        ...el,
        children: el.children.map((c) =>
          c.kind === "element" ? (views.get(c) ?? c) : c,
        ),
      });
  }
  return views.get(entry) ?? entry;
};

/** ECMA-376 CT_StyleMatrixReference: unsigned, one-based indices; fill
 * indices 1001+ select the background list. An explicit zero is no paint.
 * Unavailable/malformed entries remain unspecified, never invented paint. */
export const shapeStyleReference = (
  shape: SlideShapeData,
  source: ShapePropertySource,
  type: "fillRef" | "lnRef" | "effectRef",
): ShapePropertySource | null => {
  const ref = child(child(source.element, "style", NS.pml), type);
  const raw = ref && getAttrValue(ref, qname("", "idx", ""));
  if (raw === null || !/^\+?\d+$/.test(raw.trim())) return null;
  const index = Number(raw);
  if (!Number.isSafeInteger(index) || index > 0xffffffff) return null;
  if (index === 0 || (type === "fillRef" && index === 1000)) {
    const none = elem(qname("a", "noFill", NS.dml));
    return {
      ...source,
      element:
        type === "fillRef"
          ? none
          : elem(qname("a", type === "lnRef" ? "ln" : "effectLst", NS.dml), {
              children: type === "lnRef" ? [none] : [],
            }),
    };
  }
  const theme = themeForShape(shape);
  if (!theme) return null;
  const listName =
    type === "fillRef"
      ? index > 1000
        ? "bgFillStyleLst"
        : "fillStyleLst"
      : type === "lnRef"
        ? "lnStyleLst"
        : "effectStyleLst";
  const list = child(
    child(child(theme.root, "themeElements"), "fmtScheme"),
    listName,
  );
  const entry = styleMatrixEntries(list, listName)[
    type === "fillRef" && index > 1000 ? index - 1001 : index - 1
  ];
  if (
    !entry ||
    (type === "fillRef"
      ? !fills.has(entry.name.localName)
      : entry.name.localName !== (type === "lnRef" ? "ln" : "effectStyle"))
  )
    return null;
  const bound = bindStyleColor(entry, ref!);
  const element =
    type === "effectRef"
      ? (child(bound, "effectLst") ?? child(bound, "effectDag"))
      : bound;
  return element ? { element, root: theme.root, owner: theme.partName } : null;
};

/** Nearest paint choice wins; direct properties precede the same layer's
 * theme reference, then layout/master placeholders. Each declaration retains
 * its own relationship owner. Line properties such as width inherit separately. */
export function* shapePaintSources(
  shape: SlideShapeData,
  stroke = false,
): Generator<ShapePropertySource> {
  for (const source of iterateShapePropertySources(shape)) {
    const props = child(source.element, "spPr", NS.pml);
    const parent = stroke ? child(props, "ln") : props;
    const direct = parent?.children.find(
      (c): c is XmlElement =>
        c.kind === "element" &&
        c.name.namespaceURI === NS.dml &&
        fills.has(c.name.localName),
    );
    if (direct) yield { ...source, element: direct };
    const style = shapeStyleReference(
      shape,
      source,
      stroke ? "lnRef" : "fillRef",
    );
    if (style) {
      const paint = stroke
        ? style.element.children.find(
            (c): c is XmlElement =>
              c.kind === "element" &&
              c.name.namespaceURI === NS.dml &&
              fills.has(c.name.localName),
          )
        : style.element;
      if (paint) yield { ...style, element: paint };
    }
  }
}
