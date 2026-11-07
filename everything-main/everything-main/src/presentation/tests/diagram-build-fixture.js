import native from "./data/diagram-paint-native.json" with { type: "json" };
import { P } from "../src/model.js";
import { diagramDeck } from "./diagram-copy-fixture.js";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
import { themeForShape } from "../lib/pptx/src/api/fn/shape-theme.ts";
const encode = (s) => new TextEncoder().encode(s);
export async function semanticPaintDeck(row = native.cases[0]) {
  const p = await diagramDeck({ count: 1 }),
    frame = P.getSlideShapes(P.getSlides(p)[0])[0],
    d = readShapeDiagram(frame),
    pkg = P._internalPackageOf(p);
  for (const k of ["data", "layout", "quickStyle", "colors"])
    d[k].part.data = encode(native.sources[row.sources[k]]);
  pkg.getPart(themeForShape(frame).partName).data = encode(
    native.themes[row.theme],
  );
  P.setShapeBounds(frame, row.available);
  return { p, frame };
}
