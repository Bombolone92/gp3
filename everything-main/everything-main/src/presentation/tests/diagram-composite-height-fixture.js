import { P } from "../src/model.js";
import { diagramDeck } from "./diagram-copy-fixture.js";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
import native from "./data/diagram-composite-height-rules-native.json" with { type: "json" };

// Authored semantic XML supplies the text and geometry. The invisible marker observes the reserved height ruler.
export async function diagramCompositeHeightDeck() {
  const p = await diagramDeck({ count: 1 }),
    frame = P.getSlideShapes(P.getSlides(p)[0])[0],
    diagram = readShapeDiagram(frame),
    row = native.cases[0];
  diagram.data.part.data = new TextEncoder().encode(
    row.data.replace(
      "<d:t>",
      '<d:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="1B52C1"/></a:solidFill></a:ln></d:spPr><d:t>',
    ),
  );
  diagram.layout.part.data = new TextEncoder().encode(
    row.layout.replace(
      '<d:layoutNode name="marker" styleLbl="node1"><d:alg type="sp"/><d:shape type="rect"/>',
      '<d:layoutNode name="marker" styleLbl="node1"><d:alg type="sp"/><d:shape type="none"/>',
    ),
  );
  P.setShapeBounds(frame, { x: 360000, y: 360000, w: 3600000, h: 3600000 });
  return { p, frame, diagram };
}
