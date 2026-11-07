import {
  NS,
  type XmlElement,
  firstChildElement,
  getAttrValue,
  qname,
} from "../xml/index.ts";

// MS-ODRAWXML 2.1.3 and 2.10.1.1: relId is stored in the data model,
// but resolves through the relationship set of its PresentationML owner.
export const diagramDrawingReferences = (root: XmlElement): XmlElement[] => {
  const list = firstChildElement(root, qname("dgm", "extLst", NS.diagram));
  if (!list) return [];
  const out: XmlElement[] = [];
  for (const ext of list.children) {
    if (
      ext.kind !== "element" ||
      ext.name.namespaceURI !== NS.dml ||
      ext.name.localName !== "ext" ||
      getAttrValue(ext, qname("", "uri", "")) !== NS.diagramDrawing
    )
      continue;
    for (const child of ext.children)
      if (
        child.kind === "element" &&
        child.name.namespaceURI === NS.diagramDrawing &&
        child.name.localName === "dataModelExt"
      )
        out.push(child);
  }
  return out;
};
