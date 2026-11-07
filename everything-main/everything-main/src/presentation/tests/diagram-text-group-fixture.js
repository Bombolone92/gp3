import native from "./data/diagram-text-group-rules-native.json" with { type: "json" };
import { semanticPaintDeck } from "./diagram-build-fixture.js";
import { P } from "../src/model.js";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
export async function semanticTextGroupDeck(
  row = native.cases.find(
    (r) => r.sharedHeight && r.name.includes("height-font") && r.width === 40,
  ),
) {
  const result = await semanticPaintDeck(),
    d = readShapeDiagram(result.frame);
  d.data.part.data = new TextEncoder().encode(row.data);
  d.layout.part.data = new TextEncoder().encode(row.layout);
  P.setShapeBounds(result.frame, {
    x: 0,
    y: 0,
    w: row.available.w * 36000,
    h: row.available.h * 36000,
  });
  return result;
}
