import { P } from "../src/model.js";
import { diagramDeck } from "./diagram-copy-fixture.js";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
import native from "./data/diagram-ancestor-font-rules-native.json" with { type: "json" };

export async function diagramAncestorFontDeck(caseIndex = 0) {
  const p = await diagramDeck({ count: 1 }),
    frame = P.getSlideShapes(P.getSlides(p)[0])[0],
    diagram = readShapeDiagram(frame),
    row = native.cases[caseIndex];
  diagram.data.part.data = new TextEncoder().encode(row.data);
  diagram.layout.part.data = new TextEncoder().encode(row.layout);
  P.setShapeBounds(frame, {
    x: 360000,
    y: 360000,
    w: row.available.w * 36000,
    h: row.available.h * 36000,
  });
  return {
    p,
    frame,
    diagram,
    nativeFont: row.expected[0].displayFont ?? row.expected[0].font,
    nativeHeight: row.expected[0].bounds.h,
    nodeName: row.expected[0].name ?? "a",
    originalText: P.getShapeDiagramTextEntries(frame)[0].text,
  };
}
