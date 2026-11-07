import { describe, expect, it } from "vitest";
import native from "./data/diagram-custom-display-native.json";
import { P, createDeck } from "../src/model.js";
import { buildTextBox } from "../lib/pptx/src/internal/presentationml/index.ts";
import { appendAndReturnNewShape } from "../lib/pptx/src/api/fn/_helpers.ts";
import { SHAPE_ELEMENT } from "../lib/pptx/src/api/_internal-symbols.ts";
import {
  NS,
  parseXml,
  serializeXml,
  serializeFragment,
  firstChildElement,
  getAttrValue,
  qname,
  textContent,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { readDiagramStyles } from "../lib/pptx/src/internal/diagram/styles.ts";
import { evaluateDiagramInitialConstraints } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import { projectDiagramTextParagraphs } from "../lib/pptx/src/api/fn/diagram-text-paragraphs.ts";
const child = (e, n) => firstChildElement(e, qname("", n, NS.dml));
const value = (e, n) => (e ? getAttrValue(e, qname("", n, "")) : null);
const prepare = (row) => {
  const data = parseXml(native.models[row.model]),
    layout = parseXml(native.layouts[row.layout]);
  const model = readDiagramDataModel(data.root),
    root = expandDiagramLayout(layout.root, readDiagramHierarchy(model));
  const node = root.children.find((n) => n.name === "text");
  // Custom ruler fallback uses algorithm preferences before the independent
  // primary-font customization override. Fully unsized points synthesize36.
  const state = evaluateDiagramInitialConstraints(
    root,
    { w: 220, h: 100 },
    { quantizeFonts: true },
  ).get(node);
  const list = readDiagramStyles(model, layout.root, null, null).listStyle;
  const options = {
    dataOwner: "/ppt/diagrams/data1.xml",
    defaults: () => [],
    fontSize: (role) =>
      state.values.get(role === "primary" ? "primFontSz" : "secFontSz"),
    layoutListStyle: list
      ? { element: list, owner: "/ppt/diagrams/layout1.xml" }
      : undefined,
  };
  return { data, layout, node, options };
};
const characters = (p) =>
  p.children.flatMap((r) => {
    if (
      r.kind !== "element" ||
      r.name.namespaceURI !== NS.dml ||
      !["r", "br", "fld"].includes(r.name.localName)
    )
      return [];
    const text = r.name.localName === "br" ? "\n" : textContent(child(r, "t"));
    return Array.from(text, (ch) => [ch, value(child(r, "rPr"), "sz")]);
  });
describe("custom SmartArt displayed font synthesis", () => {
  it.each(native.cases)(
    "matches native character sizes and rulers: $name",
    (row) => {
      const { data, layout, node, options } = prepare(row),
        before = [serializeXml(data), serializeXml(layout)];
      const paragraphs = projectDiagramTextParagraphs(
        node,
        options,
        new WeakMap(),
      );
      expect(paragraphs).toHaveLength(row.expected.length);
      for (const [pindex, expected] of row.expected.entries()) {
        const p = paragraphs[pindex],
          actual = characters(p);
        expect(
          expected.literalPrefix === null
            ? actual
            : actual.slice(0, expected.literalPrefix),
        ).toEqual(expected.characters);
        if (expected.literalPrefix !== null) {
          // Native output expands this field and moves its formatting to the
          // end marker. Keep our semantic field and its authored cached text.
          const field = child(p, "fld");
          expect(value(field, "type")).toBe("slidenum");
          expect(textContent(child(field, "t"))).toBe("7");
          expect(value(child(field, "rPr"), "sz")).toBe(expected.endSize);
        } else if (expected.endSize !== null)
          expect(value(child(p, "endParaRPr"), "sz")).toBe(expected.endSize);
        expect(
          Object.fromEntries(
            ["marL", "indent", "defTabSz"].map((k) => [
              k,
              value(child(p, "pPr"), k),
            ]),
          ),
        ).toEqual(expected.ruler);
      }
      expect([serializeXml(data), serializeXml(layout)]).toEqual(before);
    },
  );
  it("preserves synthesized and authored formatting through export and copying both ways", async () => {
    const { node, options } = prepare(
      native.cases.find((r) => r.name === "diagram-custom-display: 36"),
    );
    const paragraphs = projectDiagramTextParagraphs(
        node,
        options,
        new WeakMap(),
      ),
      expected = paragraphs.map(serializeFragment);
    const source = createDeck("blank"),
      target = createDeck("blank"),
      shape = buildTextBox({
        id: 1,
        name: "Custom text",
        x: 0,
        y: 0,
        w: 4000000,
        h: 3000000,
        text: "",
      });
    const body = firstChildElement(shape, qname("", "txBody", NS.pml));
    body.children = [
      ...body.children.filter(
        (c) => c.kind !== "element" || c.name.localName !== "p",
      ),
      ...paragraphs,
    ];
    const original = appendAndReturnNewShape(P.getSlides(source)[0], shape);
    const inspect = (sh) =>
      firstChildElement(sh[SHAPE_ELEMENT], qname("", "txBody", NS.pml))
        .children.filter(
          (c) =>
            c.kind === "element" &&
            c.name.namespaceURI === NS.dml &&
            c.name.localName === "p",
        )
        .map(serializeFragment);
    expect(inspect(P.copyShape(P.getSlides(source)[0], original))).toEqual(
      expected,
    );
    P.importSlide(target, P.getSlides(source)[0], P.getSlideLayouts(target)[0]);
    const loaded = await P.loadPresentation(await P.savePresentation(target)),
      imported = P.getSlides(loaded).at(-1);
    expect(P.getSlideShapes(imported).map(inspect)).toEqual([
      expected,
      expected,
    ]);
    P.importSlide(source, imported, P.getSlideLayouts(source)[0]);
    const returned = await P.loadPresentation(await P.savePresentation(source));
    expect(P.getSlideShapes(P.getSlides(returned).at(-1)).map(inspect)).toEqual(
      [expected, expected],
    );
  });
});
