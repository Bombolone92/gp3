import { NS, firstChildElement, qname, type XmlElement } from "../xml/index.ts";

/** MS-ODRAWXML 2.32.1.2: formatting for the parent diagram element.
 * Recognize the qualified payload, not a producer-specific extension URI.
 * Unknown extension content remains opaque; never search its descendants.
 */
export const readDiagramLayoutShapeProperties = (
  shape: XmlElement,
): XmlElement | null => {
  const list = firstChildElement(shape, qname("", "extLst", NS.diagram));
  let result: XmlElement | null = null;
  for (const extension of list?.children ?? []) {
    if (
      extension.kind !== "element" ||
      extension.name.namespaceURI !== NS.dml ||
      extension.name.localName !== "ext"
    )
      continue;
    for (const property of extension.children) {
      if (
        property.kind !== "element" ||
        property.name.namespaceURI !== NS.dgm1612 ||
        property.name.localName !== "spPr"
      )
        continue;
      if (result) throw new Error("multiple diagram layout shape properties");
      result = property;
    }
  }
  return result;
};
