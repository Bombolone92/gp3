import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import native from "./data/diagram-paint-native.json";
import { P } from "../src/model.js";
import { semanticPaintDeck } from "./diagram-build-fixture.js";
import { reflowShapeDiagram } from "../lib/pptx/src/api/fn/diagram-reflow.ts";
import { buildDiagramDrawing } from "../lib/pptx/src/api/fn/diagram-build.ts";
import { diagramTextFontLayers } from "../lib/pptx/src/api/fn/diagram-text-fonts.ts";
import { SHAPE_ELEMENT } from "../lib/pptx/src/api/_internal-symbols.ts";
import {
  NS,
  parseXml,
  firstChildElement,
  qname,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
const child = (e, n) => firstChildElement(e, qname("", n, NS.dml));
// Neutral palette offsets are explicitly emitted in native output; their
// absence does not change the color expression or subsequent theme transforms.
const tree = (e) => ({
  name: e.name.localName,
  attrs: Object.fromEntries(e.attrs.map((a) => [a.name.localName, a.value])),
  children: e.children
    .filter((c) => c.kind === "element")
    .filter(
      (c) =>
        !(
          c.name.namespaceURI === NS.dml &&
          ["hueOff", "satOff", "lumOff", "alphaOff"].includes(
            c.name.localName,
          ) &&
          c.attrs.find((a) => a.name.localName === "val")?.value === "0"
        ),
    )
    .filter(
      (c) =>
        !(
          c.name.localName === "sp3d" &&
          c.attrs.length === 0 &&
          c.children.length === 0
        ),
    )
    .map(tree),
});
describe("semantic SmartArt drawing builder", () => {
  it("uses the native major-font default for an empty style label while preserving saved font overrides", () => {
    const style = {
      quickStyle: parseXml(
        `<dgm:styleLbl xmlns:dgm="${NS.diagram}" name="empty"/>`,
      ).root,
      textFill: null,
    };
    const options = {
      quickOwner: "/ppt/diagrams/quickStyle1.xml",
      colorOwner: "/ppt/diagrams/colors1.xml",
      theme: () => null,
      colorMap: null,
      report: (message) => {
        throw new Error(message);
      },
    };
    const xml = (layers) =>
      layers
        .map((l) => serializeXml({ root: l.element, prolog: [], epilog: [] }))
        .join("");
    expect(xml(diagramTextFontLayers(style, options))).toContain("+mj-lt");
    expect(
      xml(
        diagramTextFontLayers(style, {
          ...options,
          fontOverride: {
            owner: "/ppt/diagrams/drawing1.xml",
            element: parseXml(`<a:fontRef xmlns:a="${NS.dml}" idx="minor"/>`)
              .root,
          },
        }),
      ),
    ).toContain("+mn-lt");
  });
  it.each(native.cases)(
    "matches native paint and unrotated geometry: $name",
    async (row) => {
      const { p, frame } = await semanticPaintDeck(row),
        before = unzipSync(new Uint8Array(await P.savePresentation(p))),
        result = reflowShapeDiagram(frame, { textFits: () => true });
      if (row.unsupported) {
        expect(() => buildDiagramDrawing(frame, result)).toThrow(
          row.unsupported,
        );
        return;
      }
      const drawing = buildDiagramDrawing(frame, result),
        shapes = P.getGroupChildren(drawing.root);
      expect(shapes).toHaveLength(row.expected.length);
      for (const [index, shape] of shapes.entries()) {
        const properties = firstChildElement(
          shape[SHAPE_ELEMENT],
          qname("", "spPr", NS.pml),
        );
        expect(tree(properties)).toEqual(
          tree(parseXml(row.expected[index]).root),
        );
        expect(drawing.information(shape).textTransform).not.toBeNull();
      }
      expect(unzipSync(new Uint8Array(await P.savePresentation(p)))).toEqual(
        before,
      );
    },
  );
});
