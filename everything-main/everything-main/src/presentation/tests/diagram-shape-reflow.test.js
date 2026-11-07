import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { P } from "../src/model.js";
import { diagramDeck } from "./diagram-copy-fixture.js";
import native from "./data/diagram-allocation-geometry-native.json";
import {
  reflowShapeDiagram,
  createDiagramTextProjector,
} from "../lib/pptx/src/api/fn/diagram-reflow.ts";
import {
  SHAPE_ELEMENT,
  SHAPE_XML_SOURCES,
} from "../lib/pptx/src/api/_internal-symbols.ts";
import {
  NS,
  elem,
  firstChildElement,
  getAttrValue,
  qname,
  serializeFragment,
} from "../lib/pptx/src/internal/xml/index.ts";
const encode = (text) => new TextEncoder().encode(text);
const frameOf = (p) => P.getSlideShapes(P.getSlides(p)[0])[0];
const child = (el, name) => firstChildElement(el, qname("", name, NS.dml));
const value = (el, name) => getAttrValue(el, qname("", name, ""));
async function fixture({ custom = false } = {}) {
  const pres = await diagramDeck({ count: 1 }),
    pkg = P._internalPackageOf(pres);
  const row = native.cases.find(
    (c) => Array.isArray(c.required.wide) && c.required.wide.length === 3,
  );
  let model = native.models[row.model];
  if (custom)
    model = model
      .replaceAll("<dgm:prSet/>", '<dgm:prSet custT="1"/>')
      .replaceAll(
        '<a:rPr lang="en-US">',
        '<a:rPr lang="en-US"><a:hlinkClick xmlns:r="' +
          NS.officeDocRels +
          '" r:id="link"/>',
      );
  pkg.getPart("/assets/smart/item0-data.xml").data = encode(model);
  pkg.getPart("/assets/smart/item0-layout.xml").data = encode(
    native.layouts[row.layout].replaceAll('type="sp"', 'type="tx"'),
  );
  // A malformed unrelated cache cannot supply semantic geometry or formatting.
  pkg.getPart("/assets/smart/item0-drawing.xml").data =
    encode("<not-a-drawing/>");
  P.setShapeBounds(frameOf(pres), {
    x: 10000,
    y: 20000,
    w: row.available.w * 36000,
    h: row.available.h * 36000,
  });
  return pres;
}
const reflow = (frame) =>
  reflowShapeDiagram(frame, { textFits: (_shape, state) => state.size.h >= 7 });
const describeResult = (result) =>
  [...result.text].map(([node, shape]) => ({
    name: node.name,
    bounds: P.getShapeBounds(shape),
    text: P.getShapeText(shape),
    xml: serializeFragment(shape[SHAPE_ELEMENT]),
  }));
describe("semantic diagram shape reflow entry point", () => {
  it("projects layout order and final geometry without changing any package part", async () => {
    const p = await fixture(),
      before = unzipSync(new Uint8Array(await P.savePresentation(p)));
    const result = reflow(frameOf(p));
    expect(result.fits).toBe(true);
    expect([...result.text.keys()].map((n) => n.name)).toEqual([
      "header",
      "body",
      "header",
      "body",
      "header",
      "body",
    ]);
    for (const [node, shape] of result.text) {
      const rect = result.bounds.get(node);
      expect(P.getShapeBounds(shape)).toEqual(
        Object.fromEntries(
          Object.entries(rect).map(([k, v]) => [k, Math.trunc(v * 36000)]),
        ),
      );
      expect(P.getShapeText(shape)).not.toContain("Rendered");
    }
    expect(unzipSync(new Uint8Array(await P.savePresentation(p)))).toEqual(
      before,
    );
    expect(describeResult(reflow(frameOf(p)))).toEqual(describeResult(result));
  });
  it("reflows identically after export/reopen and copy into another slide", async () => {
    const p = await fixture(),
      result = describeResult(reflow(frameOf(p)));
    const dest = P.addSlide(p, { layout: P.getSlideLayouts(p)[0] });
    const copied = P.copyShape(dest, frameOf(p));
    expect(describeResult(reflow(copied))).toEqual(result);
    const reopened = await P.loadPresentation(await P.savePresentation(p));
    for (const slide of P.getSlides(reopened))
      expect(describeResult(reflow(P.getSlideShapes(slide)[0]))).toEqual(
        result,
      );
  });
  it("uses original algorithm fonts for custom mixed-text rulers and preserves link owners", async () => {
    const p = await fixture({ custom: true }),
      frame = frameOf(p),
      diagram = reflow(frame);
    const node = [...diagram.text.keys()][0],
      state = diagram.drawing.get(node);
    const projector = createDiagramTextProjector(
      frame,
      diagram.diagram,
      diagram.root,
    );
    const algorithm = {
      ...state,
      values: new Map([...state.values, ["primFontSz", 21], ["secFontSz", 13]]),
    };
    // Partially sized contributor with an unsized first run: custT is 36pt,
    // but its ruler uses the algorithm preference preceding that override.
    const point = node.contributors[0].point;
    const paragraph = child(point.text, "p"),
      end = child(paragraph, "endParaRPr");
    if (end) end.attrs.push({ name: qname("", "sz", ""), value: "2400" });
    else
      paragraph.children.push(
        elem(qname("a", "endParaRPr", NS.dml), {
          attrs: [{ name: qname("", "sz", ""), value: "2400" }],
        }),
      );
    const projected = projector.project(node, state, algorithm),
      tx = firstChildElement(
        projected[SHAPE_ELEMENT],
        qname("", "txBody", NS.pml),
      ),
      para = child(tx, "p");
    expect(value(child(para, "pPr"), "defTabSz")).toBe(
      String(Math.trunc(21 * 12700 * 3.5)),
    );
    const link = child(child(child(para, "r"), "rPr"), "hlinkClick");
    expect(projected[SHAPE_XML_SOURCES].get(link)).toBe(
      "/assets/smart/item0-data.xml",
    );
    const second = projector.project(node, state, algorithm);
    expect(second[SHAPE_ELEMENT]).not.toBe(projected[SHAPE_ELEMENT]);
    expect(serializeFragment(second[SHAPE_ELEMENT])).toBe(
      serializeFragment(projected[SHAPE_ELEMENT]),
    );
  });
  it("rejects an exhausted work budget rather than returning partial geometry", async () => {
    const p = await fixture();
    expect(() =>
      reflowShapeDiagram(frameOf(p), {
        maxOperations: 2,
        textFits: () => true,
      }),
    ).toThrow("operation budget exceeded");
  });
});
