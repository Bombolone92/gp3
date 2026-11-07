import { P } from "../src/model.js";
import { diagramDeck } from "./diagram-copy-fixture.js";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
import { NS } from "../lib/pptx/src/internal/xml/index.ts";

// Owned semantic control: independently authored overlapping rectangles. It
// contains no saved drawing reference and does not use corpus layout/data XML.
export async function diagramSpacerDeck({ direction = "fromL" } = {}) {
  const p = await diagramDeck({ count: 1 }),
    frame = P.getSlideShapes(P.getSlides(p)[0])[0],
    diagram = readShapeDiagram(frame),
    horizontal = direction === "fromL" || direction === "fromR";
  const labels = ["West", "Central", "East"];
  diagram.data.part.data = new TextEncoder().encode(
    `<d:dataModel xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}"><d:ptLst><d:pt modelId="doc" type="doc"/>${labels
      .map(
        (label, i) =>
          `<d:pt modelId="node${i}"><d:spPr><a:solidFill><a:srgbClr val="1B52C1"/></a:solidFill><a:ln><a:noFill/></a:ln></d:spPr><d:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1000"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>${label}</a:t></a:r></a:p></d:t></d:pt>`,
      )
      .join("")}</d:ptLst><d:cxnLst>${labels
      .map(
        (_, i) =>
          `<d:cxn modelId="edge${i}" srcId="doc" destId="node${i}" srcOrd="${i}" destOrd="0"/>`,
      )
      .join("")}</d:cxnLst><d:bg/><d:whole/></d:dataModel>`,
  );
  const axis = horizontal ? "w" : "h",
    other = horizontal ? "h" : "w";
  diagram.layout.part.data = new TextEncoder().encode(
    `<d:layoutDef xmlns:d="${NS.diagram}" uniqueId="owned-signed-spacing"><d:layoutNode name="root"><d:alg type="lin"><d:param type="linDir" val="${direction}"/></d:alg>${labels
      .map(
        (_, i) =>
          `<d:layoutNode name="box${i}"><d:alg type="tx"/><d:shape type="rect"/><d:presOf axis="ch" st="${i + 1}" cnt="1"/><d:constrLst><d:constr type="${axis}" val="34"/><d:constr type="${other}" val="20"/><d:constr type="primFontSz" val="10"/></d:constrLst></d:layoutNode>${i < labels.length - 1 ? `<d:layoutNode name="gap${i}"><d:alg type="sp"/><d:shape type="none"/><d:constrLst><d:constr type="${axis}" val="-12"/><d:constr type="${other}" val="0"/></d:constrLst></d:layoutNode>` : ""}`,
      )
      .join("")}</d:layoutNode></d:layoutDef>`,
  );
  P.setShapeBounds(frame, {
    x: 10 * 36000,
    y: 10 * 36000,
    w: (horizontal ? 80 : 40) * 36000,
    h: (horizontal ? 40 : 80) * 36000,
  });
  return { p, frame, diagram };
}
