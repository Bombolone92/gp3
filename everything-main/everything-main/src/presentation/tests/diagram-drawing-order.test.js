import { describe, expect, it } from "vitest";
import {
  readDiagramZOrderOffset,
  orderDiagramDrawing,
} from "../lib/pptx/src/internal/diagram/drawing-order.ts";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
import { diagramDrawingOrderDeck } from "./diagram-drawing-order-fixture.js";
import { P, createDeck, preview } from "../src/model.js";
import { reflowShapeDiagram } from "../lib/pptx/src/api/fn/diagram-reflow.ts";
import { buildDiagramDrawing } from "../lib/pptx/src/api/fn/diagram-build.ts";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";

const ordered = (values) => {
  const shapes = Object.freeze(values.map((_, i) => Object.freeze({ id: i }))),
    offsets = new Map(shapes.map((s, i) => [s, values[i]])),
    result = orderDiagramDrawing(shapes, offsets);
  expect(shapes.map((s) => s.id)).toEqual(values.map((_, i) => i));
  expect([...offsets.values()]).toEqual(values);
  expect(new Set(result)).toEqual(new Set(shapes));
  return result.map((s) => s.id);
};
const draw = (frame) =>
  buildDiagramDrawing(
    frame,
    reflowShapeDiagram(frame, { textFits: () => true }),
  );
const textOrder = (frame) =>
  P.getGroupChildren(draw(frame).root).map(P.getShapeText);

describe("DiagramML relative drawing order", () => {
  it.each([
    [null, 0],
    ["0", 0],
    ["-0", 0],
    ["+00001", 1],
    ["-00002", -2],
    [" \t+2\r\n", 2],
    ["2147483647", 2147483647],
    ["-2147483648", -2147483648],
  ])("reads the XML Schema int %s", (raw, expected) => {
    const document = parseXml(
        `<d:shape xmlns:d="${NS.diagram}"${raw === null ? "" : ` zOrderOff="${raw}"`}/>`,
      ),
      before = serializeXml(document);
    expect(readDiagramZOrderOffset(document.root)).toBe(expected);
    expect(serializeXml(document)).toBe(before);
  });

  it.each([
    "",
    " ",
    "1.0",
    "1.5",
    "1e2",
    "NaN",
    "Infinity",
    "-",
    "++1",
    "true",
    "2147483648",
    "-2147483649",
    "9999999999999999999999",
    "1 2",
    "\u00a01\u00a0",
  ])("rejects malformed/out-of-range offsets: %s", (raw) => {
    const document = parseXml(
      `<d:shape xmlns:d="${NS.diagram}" zOrderOff="${raw}"/>`,
    );
    expect(() => readDiagramZOrderOffset(document.root)).toThrow(
      "invalid diagram shape z-order offset",
    );
  });

  it.each([
    [[], []],
    [
      [0, 0, 0],
      [0, 1, 2],
    ],
    [
      [1, 0, 0],
      [1, 0, 2],
    ],
    [
      [0, -1, 0],
      [1, 0, 2],
    ],
    [
      [2, 0, 0],
      [1, 2, 0],
    ],
    [
      [0, 0, -2],
      [2, 0, 1],
    ],
    [
      [0, 1, 0],
      [0, 2, 1],
    ],
    [
      [0, 0, -1],
      [0, 2, 1],
    ],
    [
      [1, 1, 0],
      [0, 2, 1],
    ],
    [
      [-1, -1, 0],
      [0, 1, 2],
    ],
    [
      [3, 3, -2, 0],
      [2, 3, 0, 1],
    ],
    [
      [2147483647, 2147483647, 0],
      [2, 0, 1],
    ],
    [
      [-2147483648, -2147483648, 0],
      [0, 1, 2],
    ],
  ])(
    "applies offsets %s to immutable base stack positions",
    (values, expected) => expect(ordered(values)).toEqual(expected),
  );

  it("handles a large stack without successive array splices or spread argument limits", () => {
    const count = 150000,
      shapes = Array.from({ length: count }, (_, i) => i),
      offsets = new Map(
        shapes.map((s) => [s, s % 2 ? -2147483648 : 2147483647]),
      ),
      result = orderDiagramDrawing(shapes, offsets);
    expect(result.slice(0, 3)).toEqual([1, 3, 5]);
    expect(result.slice(count / 2, count / 2 + 3)).toEqual([0, 2, 4]);
    expect(new Set(result).size).toBe(count);
  });

  it("ignores a foreign namespace's similarly named attribute", () => {
    const document = parseXml(
        `<d:shape xmlns:d="${NS.diagram}" xmlns:foreign="urn:opaque" foreign:zOrderOff="bad"/>`,
      ),
      before = serializeXml(document);
    expect(readDiagramZOrderOffset(document.root)).toBe(0);
    expect(serializeXml(document)).toBe(before);
  });

  it("does not allocate stack slots for exact points or absorbed hidden text", async () => {
    const { frame, diagram } = await diagramDrawingOrderDeck([2, 0, 0]);
    const extra =
      '<d:layoutNode name="point"><d:alg type="sp"/><d:shape type="rect" zOrderOff="2147483647"/><d:constrLst><d:constr type="w" val="0"/><d:constr type="h" val="0"/></d:constrLst></d:layoutNode><d:layoutNode name="hidden"><d:alg type="tx"/><d:shape type="rect" hideGeom="true" zOrderOff="-2147483648"/><d:presOf axis="ch" st="1" cnt="1"/><d:constrLst><d:constr type="w" val="34"/><d:constr type="h" val="20"/><d:constr type="primFontSz" val="10"/></d:constrLst></d:layoutNode>';
    diagram.layout.part.data = new TextEncoder().encode(
      new TextDecoder()
        .decode(diagram.layout.part.data)
        .replace(
          "</d:layoutNode></d:layoutDef>",
          `${extra}</d:layoutNode></d:layoutDef>`,
        ),
    );
    const before = diagram.layout.part.data.slice();
    expect(textOrder(frame)).toEqual(["Central", "East", "West"]);
    expect(diagram.layout.part.data).toEqual(before);
  });

  it("reports malformed offsets on semantic drawings without rewriting the source", async () => {
    const { p, frame, diagram } = await diagramDrawingOrderDeck(["1.5", 0, 0]),
      before = diagram.layout.part.data.slice();
    expect(() => draw(frame)).toThrow("invalid diagram shape z-order offset");
    const svg = decodeURIComponent(
      preview(p, P.getSlides(p)[0]).split(",").slice(1).join(","),
    );
    expect(svg).toContain(
      'data-pptx-diagram-issues="invalid diagram shape z-order offset"',
    );
    expect(diagram.layout.part.data).toEqual(before);
  });

  it.each([
    [
      [2, 0, 0],
      ["Central", "East", "West"],
    ],
    [
      [0, 0, -2],
      ["East", "West", "Central"],
    ],
    [
      [0, 1, 0],
      ["West", "East", "Central"],
    ],
    [
      [0, 0, -1],
      ["West", "East", "Central"],
    ],
  ])(
    "orders emitted shapes across non-drawing nodes and preserves semantics through export/copy: %s",
    async (offsets, expected) => {
      const { p, frame, diagram } = await diagramDrawingOrderDeck(
          offsets.slice(),
        ),
        before = new Map(
          ["data", "layout", "quickStyle", "colors"].map((key) => [
            key,
            diagram[key].part.data.slice(),
          ]),
        );
      expect(textOrder(frame)).toEqual(expected);
      const sourceSvg = decodeURIComponent(
        preview(p, P.getSlides(p)[0]).split(",").slice(1).join(","),
      );
      expect(sourceSvg).toContain('data-pptx-diagram="semantic-layout"');
      expect(sourceSvg).not.toContain("data-pptx-diagram-issues");
      const target = createDeck("blank"),
        slide = P.importSlide(
          target,
          P.getSlides(p)[0],
          P.getSlideLayouts(target)[0],
        ),
        copied = P.getSlideShapes(slide)[0],
        reopened = await P.loadPresentation(await P.savePresentation(target)),
        returnedSlide = P.importSlide(p, slide, P.getSlideLayouts(p)[0]),
        returned = P.getSlideShapes(returnedSlide)[0],
        duplicated = P.copyShape(returnedSlide, returned);
      for (const shape of [
        copied,
        P.getSlideShapes(P.getSlides(reopened)[1])[0],
        returned,
        duplicated,
      ]) {
        expect(textOrder(shape)).toEqual(expected);
        for (const [key, bytes] of before)
          expect(readShapeDiagram(shape)[key].part.data).toEqual(bytes);
      }
      for (const [key, bytes] of before)
        expect(diagram[key].part.data).toEqual(bytes);
      expect(P.validatePresentation(p)).toEqual([]);
      expect(P.validatePresentation(target)).toEqual([]);
      expect(P.validatePresentation(reopened)).toEqual([]);
    },
  );
});
