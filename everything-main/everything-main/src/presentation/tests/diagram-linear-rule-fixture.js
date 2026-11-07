import { P } from "../src/model.js";
import { diagramDeck } from "./diagram-copy-fixture.js";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
import { NS } from "../lib/pptx/src/internal/xml/index.ts";
import native from "./data/diagram-linear-rules-native.json" with { type: "json" };

// Independently authored source data and native-measured numeric layout.
export async function diagramLinearRuleDeck() {
  const p = await diagramDeck({ count: 1 }),
    frame = P.getSlideShapes(P.getSlides(p)[0])[0],
    diagram = readShapeDiagram(frame),
    row = native.cases.find((c) => c.name === "fromL positive");
  diagram.data.part.data = new TextEncoder().encode(
    `<d:dataModel xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}"><d:ptLst><d:pt modelId="0" type="doc"/>${["Before", "Spare"].map((text, i) => `<d:pt modelId="${i + 1}" type="node"><d:spPr><a:solidFill><a:srgbClr val="1B52C1"/></a:solidFill><a:ln><a:noFill/></a:ln></d:spPr><d:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1000"/><a:t>${text}</a:t></a:r></a:p></d:t></d:pt>`).join("")}</d:ptLst><d:cxnLst><d:cxn modelId="101" srcId="0" destId="1" srcOrd="0" destOrd="0"/><d:cxn modelId="102" srcId="0" destId="2" srcOrd="1" destOrd="0"/></d:cxnLst><d:bg/><d:whole/></d:dataModel>`,
  );
  diagram.layout.part.data = new TextEncoder().encode(
    `<dgm:layoutDef xmlns:dgm="${NS.diagram}" uniqueId="owned-linear-rule-control"><dgm:layoutNode name="root"><dgm:alg type="lin">${row.params}</dgm:alg><dgm:constrLst>${row.constraints}</dgm:constrLst><dgm:ruleLst>${row.rules}</dgm:ruleLst>${row.body}</dgm:layoutNode></dgm:layoutDef>`,
  );
  P.setShapeBounds(frame, { x: 360000, y: 360000, w: 3600000, h: 3600000 });
  return { p, frame, diagram };
}
