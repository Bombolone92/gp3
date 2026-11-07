import { P } from "../src/model.js";
import { diagramDeck } from "./diagram-copy-fixture.js";
import {
  NS,
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

export const copyFieldIds = [
  "{6246FC38-EB72-4F70-B846-1A29D980A047}",
  "{0152BF7E-0192-44E4-A985-3C22789E3162}",
  "{FEA11D47-127C-42AB-A415-12FA5B49978C}",
];
export const fieldXml = (id, value = "native cache", type = "owned.custom") =>
  `<a:fld id="${id}" type="${type}"><a:rPr lang="en-CA" b="1" sz="1200"><a:solidFill><a:srgbClr val="314159"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:pPr><a:defRPr i="1"/></a:pPr><a:t>${value}</a:t></a:fld>`;
export const nativeFields = (root) => {
  const result = [];
  walkElements(root, (el) => {
    if (el.name.namespaceURI === NS.dml && el.name.localName === "fld")
      result.push(el);
  });
  return result;
};
export const fieldToken = (field) => getAttrValue(field, qname("", "id", ""));
export const partFields = (part) =>
  nativeFields(parseXml(new TextDecoder().decode(part.data)).root);
export const shapeFields = (shape) =>
  nativeFields(parseXml(P.getShapeXmlString(shape)).root);

// Owned native fields in ordinary text, a table, semantic data and its saved
// drawing. The two diagram representations identify the same logical field.
export async function textFieldCopyDeck({ group = false } = {}) {
  const p = await diagramDeck({ count: 1 }),
    slide = P.getSlides(p)[0];
  P.addSlideTextBox(slide, {
    x: 100000,
    y: 1000000,
    w: 4000000,
    h: 700000,
    text: "FIELD_BOX",
  });
  P.addSlideTable(slide, {
    x: 100000,
    y: 2000000,
    w: 4000000,
    h: 700000,
    rows: [["FIELD_TABLE"]],
  });
  const pkg = P._internalPackageOf(p),
    part = pkg.getPart(P.getSlidePartName(slide));
  const replace = (part, pattern, value) => {
    part.data = new TextEncoder().encode(
      new TextDecoder().decode(part.data).replace(pattern, () => value),
    );
  };
  for (const [marker, id] of [
    ["FIELD_BOX", copyFieldIds[0]],
    ["FIELD_TABLE", copyFieldIds[1]],
  ])
    replace(
      part,
      new RegExp(`<a:r>[\\s\\S]*?<a:t>${marker}</a:t></a:r>`),
      fieldXml(id),
    );
  replace(
    pkg.getPart("/assets/smart/item0-data.xml"),
    /<a:r><a:t>Semantic 0<\/a:t><\/a:r>/,
    fieldXml(copyFieldIds[2]),
  );
  replace(
    pkg.getPart("/assets/smart/item0-drawing.xml"),
    /<a:r><a:t>Rendered 0<\/a:t><\/a:r>/,
    fieldXml(copyFieldIds[2].toLowerCase()),
  );
  const loaded = await P.loadPresentation(await P.savePresentation(p)),
    source = P.getSlides(loaded)[0];
  if (group) P.groupShapes(P.getSlideShapes(source).slice(1));
  return { p: loaded, slide: source };
}
