import native from "./data/diagram-text-aspect-references-native.json" with { type: "json" };
import { P } from "../src/model.js";
import { diagramDeck } from "./diagram-copy-fixture.js";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
import { NS } from "../lib/pptx/src/internal/xml/index.ts";

export async function diagramAspectReferenceDeck(caseIndex = 0) {
  const p = await diagramDeck({ count: 1 }),
    frame = P.getSlideShapes(P.getSlides(p)[0])[0],
    diagram = readShapeDiagram(frame),
    row = native.cases[caseIndex],
    encode = (xml) => new TextEncoder().encode(xml);
  diagram.data.part.data = encode(row.data);
  diagram.layout.part.data = encode(row.layout);
  diagram.quickStyle.part.data = encode(
    `<d:styleDef xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}" uniqueId="urn:owned:transparent-text"><d:styleLbl name="node1"><d:style><a:lnRef idx="0"><a:srgbClr val="000000"/></a:lnRef><a:fillRef idx="0"><a:srgbClr val="FFFFFF"/></a:fillRef><a:effectRef idx="0"><a:srgbClr val="000000"/></a:effectRef><a:fontRef idx="minor"><a:srgbClr val="000000"/></a:fontRef></d:style></d:styleLbl></d:styleDef>`,
  );
  P.setShapeBounds(frame, {
    x: 0,
    y: 0,
    w: row.available.w * 36000,
    h: row.available.h * 36000,
  });
  return { p, frame, nativeHeight: row.expected[0].bounds.h };
}
