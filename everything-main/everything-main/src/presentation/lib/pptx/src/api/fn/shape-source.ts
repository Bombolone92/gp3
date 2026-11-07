import type { PartName } from "../../internal/opc/index.ts";
import type { XmlElement } from "../../internal/xml/index.ts";
import {
  SHAPE_SLIDE,
  SHAPE_XML_SOURCES,
  SLIDE_PART_NAME,
  type SlideShapeData,
} from "../_internal-symbols.ts";

/** Owner of a relationship reference, independently of the shape's theme. */
export const shapeRelationshipOwner = (
  shape: SlideShapeData,
  reference: XmlElement,
): PartName =>
  shape[SHAPE_XML_SOURCES]?.get(reference) ??
  shape[SHAPE_SLIDE][SLIDE_PART_NAME];

/** Copies XML for a display view, retaining each reference's original owner. */
export const cloneShapeSource = (
  element: XmlElement,
  owner: PartName,
  sources: WeakMap<XmlElement, PartName>,
): XmlElement => {
  // Copy the XML tree and its provenance together. Text fitting creates many
  // short-lived views; a generic structured clone followed by two tree walks
  // spends most of that work rediscovering the same small AST structure.
  const copyElement = (source: XmlElement): XmlElement => {
    const copy: XmlElement = {
      kind: "element",
      name: { ...source.name },
      attrs: source.attrs.map((a) => ({ ...a, name: { ...a.name } })),
      prefixDecls: new Map(source.prefixDecls),
      children: [],
    };
    sources.set(copy, sources.get(source) ?? owner);
    return copy;
  };
  const copy = copyElement(element);
  // Extensions may contain deeply nested XML, so do not use the JS call stack.
  const pending = [{ source: element, copy }];
  while (pending.length) {
    const { source, copy } = pending.pop()!;
    for (const child of source.children) {
      if (child.kind === "element") {
        const next = copyElement(child);
        copy.children.push(next);
        pending.push({ source: child, copy: next });
      } else copy.children.push({ ...child });
    }
  }
  return copy;
};
