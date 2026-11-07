import {
  NS,
  type XmlElement,
  attr,
  elem,
  firstChildElement,
  qname,
} from "../../internal/xml/index.ts";
import {
  SHAPE_ELEMENT,
  SHAPE_SNAPSHOT,
  type SlideShapeData,
} from "../_internal-symbols.ts";

/**
 * Read-only text-layout handle for a saved diagram text rectangle. The DSP
 * text transform already describes its text box, so the painted shape's
 * preset text inscribing rectangle must not be applied a second time.
 * Keep the original text nodes (and relationship provenance) shared; this
 * handle is only passed to readers, never to authoring/export operations.
 */
export const diagramTextShape = (
  shape: SlideShapeData,
  transform: XmlElement,
): SlideShapeData => {
  const original = shape[SHAPE_ELEMENT];
  const originalProperties = firstChildElement(
    original,
    qname("p", "spPr", NS.pml),
  );
  const geometry =
    originalProperties &&
    firstChildElement(originalProperties, qname("a", "xfrm", NS.dml));
  const transformChildren = [...transform.children];
  for (const name of ["off", "ext"]) {
    if (firstChildElement(transform, qname("a", name, NS.dml))) continue;
    const fallback =
      geometry && firstChildElement(geometry, qname("a", name, NS.dml));
    if (fallback) transformChildren.push(fallback);
  }
  const properties = elem(qname("p", "spPr", NS.pml), {
    children: [
      {
        ...transform,
        name: qname("a", "xfrm", NS.dml),
        children: transformChildren,
      },
      elem(qname("a", "prstGeom", NS.dml), {
        attrs: [attr(qname("", "prst", ""), "rect")],
      }),
    ],
  });
  const element: XmlElement = {
    ...original,
    children: original.children.map((node) =>
      node.kind === "element" &&
      node.name.namespaceURI === NS.pml &&
      node.name.localName === "spPr"
        ? properties
        : node,
    ),
  };
  return {
    ...shape,
    [SHAPE_ELEMENT]: element,
    [SHAPE_SNAPSHOT]: { ...shape[SHAPE_SNAPSHOT], element },
  };
};
