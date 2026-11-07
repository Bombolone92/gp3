import { diagramSpacerDeck } from "./diagram-spacer-fixture.js";
import {
  NS,
  parseXml,
  serializeXml,
  walkElements,
  getAttrValue,
  qname,
  attr,
} from "../lib/pptx/src/internal/xml/index.ts";

// Three independently authored, completely overlapping text rectangles. Empty
// layout nodes are retained between them to exercise emitted-shape stack slots.
export async function diagramDrawingOrderDeck(offsets = [2, 0, 0]) {
  const result = await diagramSpacerDeck(),
    data = parseXml(new TextDecoder().decode(result.diagram.data.part.data)),
    layout = parseXml(
      new TextDecoder().decode(result.diagram.layout.part.data),
    ),
    colors = ["FF0000", "00FF00", "0000FF"];
  let index = 0;
  walkElements(data.root, (e) => {
    if (
      e.name.namespaceURI === NS.dml &&
      e.name.localName === "srgbClr" &&
      getAttrValue(e, qname("", "val", "")) === "1B52C1"
    )
      e.attrs = [attr(qname("", "val", ""), colors[index++])];
  });
  let shapeIndex = 0;
  walkElements(layout.root, (e) => {
    if (e.name.namespaceURI !== NS.diagram) return;
    if (
      e.name.localName === "alg" &&
      getAttrValue(e, qname("", "type", "")) === "lin"
    ) {
      e.attrs = [attr(qname("", "type", ""), "composite")];
      e.children = [];
    }
    if (
      e.name.localName === "shape" &&
      getAttrValue(e, qname("", "type", "")) === "rect"
    ) {
      e.attrs.push(
        attr(qname("", "zOrderOff", ""), String(offsets[shapeIndex++] ?? 0)),
      );
    }
    if (
      e.name.localName === "constr" &&
      getAttrValue(e, qname("", "val", "")) === "-12"
    )
      e.attrs = e.attrs.map((a) =>
        a.name.localName === "val" ? { ...a, value: "0" } : a,
      );
  });
  result.diagram.data.part.data = new TextEncoder().encode(serializeXml(data));
  result.diagram.layout.part.data = new TextEncoder().encode(
    serializeXml(layout),
  );
  return result;
}
