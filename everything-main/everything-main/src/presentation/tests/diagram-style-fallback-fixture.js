import native from "./data/diagram-style-fallback-native.json" with { type: "json" };
import { P } from "../src/model.js";
import { diagramDeck } from "./diagram-copy-fixture.js";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
import { themeForShape } from "../lib/pptx/src/api/fn/shape-theme.ts";
import { reflowShapeDiagram } from "../lib/pptx/src/api/fn/diagram-reflow.ts";
import { buildDiagramDrawing } from "../lib/pptx/src/api/fn/diagram-build.ts";
import { diagramTextFontLayers } from "../lib/pptx/src/api/fn/diagram-text-fonts.ts";
import { readDiagramLayoutStyles } from "../lib/pptx/src/internal/diagram/layout-styles.ts";
import { SHAPE_ELEMENT } from "../lib/pptx/src/api/_internal-symbols.ts";
import {
  NS,
  firstChildElement,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
const child = (el, name, ns = NS.dml) =>
  el && firstChildElement(el, qname("", name, ns));
const value = (el, name) => el && getAttrValue(el, qname("", name, ""));
// Native serialization can spell out zero additive color offsets. Normalize
// both independent native trees and engine trees, retaining all other values.
const normalize = (tree) =>
  tree && {
    ...tree,
    children: tree.children
      .filter(
        (c) =>
          !(
            ["hueOff", "satOff", "lumOff", "alphaOff"].includes(c.name) &&
            c.attrs.val === "0"
          ),
      )
      .map(normalize),
  };
const normalizedStyleTree = (el) =>
  el &&
  normalize({
    name: el.name.localName,
    attrs: Object.fromEntries(el.attrs.map((a) => [a.name.localName, a.value])),
    children: el.children
      .filter((c) => c.kind === "element")
      .map(normalizedStyleTree),
  });
export const expectedStyleFallback = (row) =>
  row.expected.map((shape) => ({
    ...shape,
    paint: shape.paint.map(normalize),
    font: { ...shape.font, color: normalize(shape.font.color) },
  }));
export async function styleFallbackDeck(row) {
  const p = await diagramDeck({ count: 1 }),
    frame = P.getSlideShapes(P.getSlides(p)[0])[0],
    d = readShapeDiagram(frame);
  for (const key of ["data", "layout", "quickStyle", "colors"])
    d[key].part.data = new TextEncoder().encode(
      native.sources[row.sources[key]],
    );
  P._internalPackageOf(p).getPart(themeForShape(frame).partName).data =
    new TextEncoder().encode(native.themes[row.theme]);
  P.setShapeBounds(frame, row.available);
  return { p, frame };
}
export function inspectStyleFallback(frame) {
  // These controls have fixed constraints and no font/content fitting rules.
  // Geometry is not the oracle here; use the real semantic paint/font paths.
  const result = reflowShapeDiagram(frame, { textFits: () => true }),
    d = result.diagram;
  const drawing = buildDiagramDrawing(frame, result);
  const styles = [
    ...readDiagramLayoutStyles(result.root, d.quickStyle.root, d.colors.root),
  ].filter(
    ([node]) => node.algorithm && value(node.algorithm, "type") === "tx",
  );
  return P.getGroupChildren(drawing.root).map((shape, i) => {
    const properties = child(shape[SHAPE_ELEMENT], "spPr", NS.pml);
    const defaults = diagramTextFontLayers(styles[i][1], {
      quickOwner: d.quickStyle.part.name,
      colorOwner: d.colors.part.name,
      theme: () => themeForShape(frame)?.theme ?? null,
      colorMap: null,
      report: (message) => {
        throw Error(message);
      },
    });
    const font = child(defaults[0]?.element ?? null, "defRPr");
    const latin = value(child(font, "latin"), "typeface");
    const fill = child(font, "solidFill");
    return {
      text: P.getShapeText(shape),
      paint: properties.children
        .filter(
          (c) =>
            c.kind === "element" &&
            !["xfrm", "prstGeom"].includes(c.name.localName),
        )
        .map(normalizedStyleTree),
      font: {
        family:
          latin === "+mj-lt" ? "major" : latin === "+mn-lt" ? "minor" : null,
        color: fill
          ? normalizedStyleTree(fill.children.find((c) => c.kind === "element"))
          : null,
      },
    };
  });
}
