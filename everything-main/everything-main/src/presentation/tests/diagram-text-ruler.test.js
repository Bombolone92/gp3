import { describe, expect, it } from "vitest";
import native from "./data/diagram-text-ruler-native.json";
import { P, createDeck } from "../src/model.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  getAttrValue,
  qname,
  serializeFragment,
} from "../lib/pptx/src/internal/xml/index.ts";
import { buildTextBox } from "../lib/pptx/src/internal/presentationml/index.ts";
import { appendAndReturnNewShape } from "../lib/pptx/src/api/fn/_helpers.ts";
import { SHAPE_ELEMENT } from "../lib/pptx/src/api/_internal-symbols.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { resolveDiagramTextRuler } from "../lib/pptx/src/internal/diagram/text-ruler.ts";
import { projectDiagramTextParagraphs } from "../lib/pptx/src/api/fn/diagram-text-paragraphs.ts";

const child = (el, name) => firstChildElement(el, qname("", name, NS.dml));
const value = (el, name) => getAttrValue(el, qname("", name, ""));
const paragraph = (level = 1) => ({
  hierarchyLevel: level,
  level: 0,
  font: "secondary",
  source: { point: { text: null } },
});

describe("SmartArt paragraph rulers and default projection", () => {
  it.each(native.cases)("projects native paragraph defaults: $name", (row) => {
    const data = parseXml(native.models[row.model]),
      layout = parseXml(native.layouts[row.layout]),
      before = [serializeXml(data), serializeXml(layout)];
    const node = expandDiagramLayout(
      layout.root,
      readDiagramHierarchy(readDiagramDataModel(data.root)),
    ).children.find((n) => n.name === "text");
    const output = projectDiagramTextParagraphs(
      node,
      {
        dataOwner: "/ppt/diagrams/data1.xml",
        defaults: () => [],
        fontSize: (role) => {
          if (!(role in row.fonts)) throw Error("unexpected unresolved font");
          return row.fonts[role];
        },
      },
      new WeakMap(),
    );
    expect(
      output.map((p) => {
        const pr = child(p, "pPr"),
          bullet = child(pr, "buChar");
        return {
          properties: Object.fromEntries(
            ["marL", "indent", "defTabSz", "algn", "lvl"].map((k) => [
              k,
              value(pr, k),
            ]),
          ),
          lineSpacing: value(child(child(pr, "lnSpc"), "spcPct"), "val"),
          spaceAfter: value(child(child(pr, "spcAft"), "spcPct"), "val"),
          bullet: bullet ? value(bullet, "char") : null,
        };
      }),
    ).toEqual(row.expected);
    expect([serializeXml(data), serializeXml(layout)]).toEqual(before);
  });

  it("preserves projected text through export and copying in both directions", async () => {
    const row = native.cases.find(
      (c) => c.name === "diagram-custom-font-level: 6",
    );
    const node = expandDiagramLayout(
      parseXml(native.layouts[row.layout]).root,
      readDiagramHierarchy(
        readDiagramDataModel(parseXml(native.models[row.model]).root),
      ),
    ).children.find((n) => n.name === "text");
    const paragraphs = projectDiagramTextParagraphs(
      node,
      {
        dataOwner: "/ppt/diagrams/data1.xml",
        defaults: () => [],
        fontSize: (role) => row.fonts[role],
      },
      new WeakMap(),
    );
    const source = createDeck("blank"),
      target = createDeck("blank");
    const shape = buildTextBox({
      id: 1,
      name: "Projected text",
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
    const expected = paragraphs.map(serializeFragment);
    const inspect = (sh) =>
      firstChildElement(sh[SHAPE_ELEMENT], qname("", "txBody", NS.pml))
        .children.filter(
          (c) =>
            c.kind === "element" &&
            c.name.namespaceURI === NS.dml &&
            c.name.localName === "p",
        )
        .map(serializeFragment);
    const copied = P.copyShape(P.getSlides(source)[0], original);
    expect(inspect(copied)).toEqual(expected);
    P.importSlide(target, P.getSlides(source)[0], P.getSlideLayouts(target)[0]);
    const loadedTarget = await P.loadPresentation(
      await P.savePresentation(target),
    );
    const imported = P.getSlides(loadedTarget).at(-1);
    expect(P.getSlideShapes(imported).map(inspect)).toEqual([
      expected,
      expected,
    ]);
    const returned = P.importSlide(
      source,
      imported,
      P.getSlideLayouts(source)[0],
    );
    expect(P.getSlideShapes(returned).map(inspect)).toEqual([
      expected,
      expected,
    ]);
    const loadedSource = await P.loadPresentation(
      await P.savePresentation(source),
    );
    expect(
      P.getSlideShapes(P.getSlides(loadedSource).at(-1)).map(inspect),
    ).toEqual([expected, expected]);
  });

  it("uses the displayed floor without changing the fitted constraint", () => {
    // Independent native font-quantization-zero controls emit defTabSz=44450
    // and 57150 EMU indents, even when the retained font constraint is zero.
    expect(resolveDiagramTextRuler(paragraph(), false, () => 0)).toEqual({
      marginLeft: 57150,
      indent: -57150,
      defaultTabSize: 44450,
    });
  });
  it("uses hierarchy depth independently from emitted outline level", () => {
    expect(resolveDiagramTextRuler(paragraph(12), false, () => 26)).toEqual({
      marginLeft: 2743200,
      indent: -228600,
      defaultTabSize: 1155700,
    });
    expect(resolveDiagramTextRuler(paragraph(0), false, () => 26)).toEqual({
      marginLeft: 0,
      indent: 0,
      defaultTabSize: 1155700,
    });
  });
  it.each([NaN, Infinity, -1, 4000.01])(
    "rejects invalid fitted font %s",
    (font) => {
      expect(() =>
        resolveDiagramTextRuler(paragraph(), false, () => font),
      ).toThrow("invalid diagram ruler font size");
    },
  );
  it.each([NaN, -1, 1.5, Infinity])(
    "rejects invalid hierarchy level %s",
    (level) => {
      expect(() =>
        resolveDiagramTextRuler(paragraph(level), false, () => 18),
      ).toThrow("invalid diagram ruler hierarchy level");
    },
  );
});
