import {
  NS,
  firstChildElement,
  getAttrValue,
  qname,
  type XmlElement,
} from "../../internal/xml/index.ts";
import { SHAPE_ELEMENT, type SlideShapeData } from "../_internal-symbols.ts";
import { getPlaceholderInheritance } from "./placeholder-inheritance.ts";
import { themeForShape } from "./shape-theme.ts";

const child = (node: XmlElement | null, name: string, ns: string = NS.dml) =>
  node
    ? firstChildElement(node, qname(ns === NS.pml ? "p" : "a", name, ns))
    : null;
const integer = (node: XmlElement | null, name: string): number | null => {
  const raw = node && getAttrValue(node, qname("", name, ""));
  if (raw === null || !/^\+?\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};

/** A missing or malformed width is unspecified; zero remains explicit. */
export const readStrokeWidth = (line: XmlElement | null): number | null =>
  integer(line, "w");

/** Nearest-first native line sources. Direct properties precede the same
 * shape's style matrix, then its layout/master placeholder. Read only; line
 * properties inherit independently and must not be flattened during reads. */
export function* shapeLineSources(
  shape: SlideShapeData,
): Generator<XmlElement> {
  const own = shape[SHAPE_ELEMENT];
  let theme: ReturnType<typeof themeForShape> | undefined;
  const linesFor = function* (host: XmlElement): Generator<XmlElement> {
    const line = child(child(host, "spPr", NS.pml), "ln");
    if (line) yield line;
    const ref = child(child(host, "style", NS.pml), "lnRef");
    const index = integer(ref, "idx");
    if (index === null || index === 0) return;
    theme ??= themeForShape(shape);
    const list = child(
      child(child(theme?.root ?? null, "themeElements"), "fmtScheme"),
      "lnStyleLst",
    );
    const lines = list?.children.filter(
      (c): c is XmlElement =>
        c.kind === "element" &&
        c.name.namespaceURI === NS.dml &&
        c.name.localName === "ln",
    );
    const selected = lines?.[index - 1];
    if (selected) yield selected;
  };
  yield* linesFor(own);
  const inheritance = getPlaceholderInheritance(shape);
  for (const ancestor of [inheritance?.layout, inheritance?.master]) {
    if (!ancestor) continue;
    yield* linesFor(ancestor.element);
  }
}

/** Missing/malformed widths inherit independently; zero is explicit. */
export const getShapeStrokeWidthInherited = (
  shape: SlideShapeData,
): number | null => {
  for (const line of shapeLineSources(shape)) {
    const width = readStrokeWidth(line);
    if (width !== null) return width;
  }
  return null;
};
