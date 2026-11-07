import { describe, expect, it } from "vitest";
import { P } from "../src/model.js";
import { diagramDeck, diagramImage } from "./diagram-copy-fixture.js";
import {
  isDiagramShape,
  readShapeDiagram,
} from "../lib/pptx/src/api/fn/diagram-read.ts";
import { readDiagramDrawing } from "../lib/pptx/src/api/fn/diagram-drawing.ts";
import {
  SHAPE_ELEMENT,
  SHAPE_SLIDE,
} from "../lib/pptx/src/api/_internal-symbols.ts";
import {
  NS,
  firstChildElement,
  qname,
  getAttrValue,
  serializeFragment,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";

const frame = (pres) =>
  P.getSlideShapes(P.getSlides(pres)[0]).find(isDiagramShape);
const editDrawing = (pres, edit) => {
  const part = readShapeDiagram(frame(pres)).drawing.part;
  part.data = new TextEncoder().encode(
    edit(new TextDecoder().decode(part.data)),
  );
};
const attr = (el, name) => getAttrValue(el, qname("", name, ""));
const xfrm = (name, x, y, w, h, attrs = "", children = "") =>
  `<${name} ${attrs}><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/>${children}</${name}>`;

describe("Saved SmartArt drawing view", () => {
  it("exposes individual shapes and drawing-part resources without changing the semantic diagram", async () => {
    const pres = await diagramDeck(),
      pkg = P._internalPackageOf(pres);
    const before = pkg.parts.map((p) => [p.name, p.data.slice()]);
    const frames = P.getSlideShapes(P.getSlides(pres)[0]).filter(
      isDiagramShape,
    );
    for (const [i, original] of frames.entries()) {
      const view = readDiagramDrawing(original),
        [shape] = P.getGroupChildren(view.root);
      expect(view.issues).toEqual([]);
      expect(shape[SHAPE_SLIDE]).toBe(original[SHAPE_SLIDE]);
      expect(P.getShapeKind(shape)).toBe("shape");
      expect(P.getShapeText(shape)).toBe(`Rendered ${i}`);
      expect(P.getShapeImageFillBytes(shape)).toEqual(diagramImage);
      expect(P.getShapeClickAction(shape)).toEqual({
        kind: "url",
        url: `https://example.org/${i}?a=1&b=2`,
      });
      expect(view.information(shape).modelId).toBe(`node-${i}`);
      expect(view.information(shape).textStyle.sources[0].point.id).toBe(
        `node-${i}`,
      );
      expect(view.information(original)).toBeNull();
      expect(P.getShapeKind(original)).toBe("graphicFrame");
    }
    expect(pkg.parts.map((p) => [p.name, p.data])).toEqual(before);
    const reopened = await P.loadPresentation(await P.savePresentation(pres));
    expect(
      P._internalPackageOf(reopened).parts.map((p) => [p.name, p.data]),
    ).toEqual(before);
  });

  it("keeps geometry and text transforms separate, including negative offsets, rotation, and flips", async () => {
    const pres = await diagramDeck({ count: 1 });
    editDrawing(pres, (xml) =>
      xml
        .replace(
          "<dsp:spPr>",
          "<dsp:spPr>" +
            xfrm("a:xfrm", -120, 300, 9100, 7200, 'rot="1800000" flipH="1"'),
        )
        .replace(
          "</dsp:sp>",
          xfrm("dsp:txXfrm", 600, 750, 4000, 5000, 'rot="5400000" flipV="1"') +
            "</dsp:sp>",
        ),
    );
    const view = readDiagramDrawing(frame(pres)),
      [shape] = P.getGroupChildren(view.root);
    expect(P.getShapeBounds(shape)).toEqual({
      x: -120,
      y: 300,
      w: 9100,
      h: 7200,
    });
    expect(P.getShapeRotation(shape)).toBe(30);
    expect(P.getShapeFlip(shape)).toEqual({
      horizontal: true,
      vertical: false,
    });
    const text = view.information(shape).textTransform;
    expect(attr(text, "rot")).toBe("5400000");
    expect(attr(text, "flipV")).toBe("1");
    expect(attr(firstChildElement(text, qname("a", "off", NS.dml)), "x")).toBe(
      "600",
    );
    expect(attr(firstChildElement(text, qname("a", "ext", NS.dml)), "cy")).toBe(
      "5000",
    );
    expect(text.name.namespaceURI).toBe(NS.diagramDrawing);
  });

  it("retains nested group transforms, child order, and repeated numeric shape IDs", async () => {
    const pres = await diagramDeck({ count: 1 });
    editDrawing(pres, (xml) => {
      const original = xml.match(/<dsp:sp modelId[\s\S]*?<\/dsp:sp>/)[0];
      const children =
        original +
        original
          .replace('modelId="node-0"', 'modelId="another"')
          .replace("Rendered 0", "Second");
      const transform = xfrm(
        "a:xfrm",
        100,
        200,
        6000,
        4000,
        'rot="600000" flipV="1"',
        '<a:chOff x="-50" y="75"/><a:chExt cx="3000" cy="1000"/>',
      );
      return xml.replace(
        original,
        `<dsp:grpSp><dsp:nvGrpSpPr><dsp:cNvPr id="0" name="Nested"/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr>${transform}</dsp:grpSpPr>${children}</dsp:grpSp>`,
      );
    });
    const view = readDiagramDrawing(frame(pres)),
      [group] = P.getGroupChildren(view.root),
      shapes = P.getGroupChildren(group);
    expect(view.issues).toEqual([]);
    expect(P.getGroupTransform(group)).toEqual({
      outer: { x: 100, y: 200, w: 6000, h: 4000 },
      inner: { x: -50, y: 75, w: 3000, h: 1000 },
    });
    expect(P.getShapeRotation(group)).toBe(10);
    expect(P.getShapeFlip(group)).toEqual({
      horizontal: false,
      vertical: true,
    });
    expect(shapes.map(P.getShapeId)).toEqual([0, 0]);
    expect(shapes.map(P.getShapeText)).toEqual(["Rendered 0", "Second"]);
    expect(shapes.map((s) => view.information(s).modelId)).toEqual([
      "node-0",
      "another",
    ]);
    expect(P.getShapeImageFillBytes(shapes[1])).toEqual(diagramImage);
  });

  it("projects only schema wrappers and preserves extension XML and unfamiliar children for diagnosis", async () => {
    const pres = await diagramDeck({ count: 1 });
    editDrawing(pres, (xml) =>
      xml
        .replace(
          "</dsp:spPr>",
          '<a:extLst><a:ext uri="urn:future"><dsp:spPr future="1"/></a:ext></a:extLst></dsp:spPr>',
        )
        .replace(
          "</dsp:spTree>",
          '<future xmlns="urn:example">Unrecognized drawing content</future></dsp:spTree>',
        )
        .replaceAll("dsp:", "cache:")
        .replace("xmlns:dsp=", "xmlns:cache="),
    );
    const view = readDiagramDrawing(frame(pres)),
      [shape] = P.getGroupChildren(view.root);
    expect(view.issues).toEqual([
      "unrecognized saved diagram child {urn:example}future",
    ]);
    let extensionProperty;
    walkElements(shape[SHAPE_ELEMENT], (n) => {
      if (attr(n, "future") === "1") extensionProperty = n;
    });
    expect(extensionProperty.name.namespaceURI).toBe(NS.diagramDrawing);
    expect(serializeFragment(view.root[SHAPE_ELEMENT])).toContain(
      "Unrecognized drawing content",
    );
    expect(P.getShapeImageFillBytes(shape)).toEqual(diagramImage);
  });

  it("returns independent display XML and observes source replacements", async () => {
    const pres = await diagramDeck({ count: 1 }),
      original = frame(pres),
      first = readDiagramDrawing(original);
    const [shape] = P.getGroupChildren(first.root);
    shape[SHAPE_ELEMENT].children.length = 0;
    const second = readDiagramDrawing(original),
      [fresh] = P.getGroupChildren(second.root);
    expect(P.getShapeText(fresh)).toBe("Rendered 0");
    expect(P.getShapeImageFillBytes(fresh)).toEqual(diagramImage);
    editDrawing(pres, (xml) => xml.replace("Rendered 0", "Updated cache"));
    expect(
      P.getShapeText(P.getGroupChildren(readDiagramDrawing(original).root)[0]),
    ).toBe("Updated cache");
  });

  it("keeps a valid saved drawing available when semantic data is malformed, with its diagnostic", async () => {
    const pres = await diagramDeck({ count: 1 });
    const original = frame(pres),
      data = readShapeDiagram(original).data.part;
    data.data = new TextEncoder().encode(
      new TextDecoder()
        .decode(data.data)
        .replace("</dgm:ptLst>", '<dgm:pt modelId="node-0"/></dgm:ptLst>'),
    );
    const view = readDiagramDrawing(original),
      [shape] = P.getGroupChildren(view.root);
    expect(view.issues).toEqual(["duplicate diagram point node-0"]);
    expect(view.styles).toBeNull();
    expect(view.information(shape).textStyle).toBeNull();
    expect(P.getShapeText(shape)).toBe("Rendered 0");
  });
});
