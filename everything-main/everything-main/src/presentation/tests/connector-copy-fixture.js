import { P, createDeck } from "../src/model.js";
import { SHAPE_ELEMENT } from "../lib/pptx/src/api/_internal-symbols.ts";
import {
  NS,
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

export function connections(shape) {
  const result = [];
  walkElements(parseXml(P.getShapeXmlString(shape)).root, (el) => {
    if (
      el.name.namespaceURI === NS.dml &&
      ["stCxn", "endCxn"].includes(el.name.localName)
    )
      result.push({
        end: el.name.localName,
        id: getAttrValue(el, qname("", "id", "")),
        site: getAttrValue(el, qname("", "idx", "")),
      });
  });
  return result;
}

// Independently authored native connections, with the connector preceding its
// targets. Sparse IDs make accidental number preservation easy to detect.
export async function connectorCopyDeck({ grouped = false } = {}) {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0];
  const line = P.addSlideLine(slide, {
    name: "Attached line",
    from: { x: P.inches(2), y: P.inches(2) },
    to: { x: P.inches(7), y: P.inches(3) },
    color: "235789",
  });
  const boxes = [2, 7].map((x, i) =>
    P.addSlideShape(slide, {
      preset: "rect",
      name: `Endpoint ${i + 1}`,
      x: P.inches(x),
      y: P.inches(i + 1),
      w: P.inches(1),
      h: P.inches(1),
      text: `Node ${i + 1}`,
    }),
  );
  for (const [shape, id] of [
    [line, "11"],
    [boxes[0], "47"],
    [boxes[1], "103"],
  ]) {
    walkElements(shape[SHAPE_ELEMENT], (el) => {
      if (el.name.namespaceURI === NS.pml && el.name.localName === "cNvPr")
        el.attrs.find(
          (a) => a.name.namespaceURI === "" && a.name.localName === "id",
        ).value = id;
    });
  }
  const nv = line[SHAPE_ELEMENT].children
    .find((el) => el.kind === "element" && el.name.localName === "nvCxnSpPr")
    .children.find(
      (el) => el.kind === "element" && el.name.localName === "cNvCxnSpPr",
    );
  nv.children.push(
    ...parseXml(
      `<a:holder xmlns:a="${NS.dml}"><a:stCxn id="47" idx="2"/><a:endCxn id="103" idx="0"/></a:holder>`,
    ).root.children,
  );
  P.renameShape(line, "Attached line");
  const loaded = await P.loadPresentation(await P.savePresentation(p)),
    s = P.getSlides(loaded)[0];
  if (grouped) P.groupShapes(P.getSlideShapes(s), { name: "Connected group" });
  return { p: loaded, slide: s };
}
