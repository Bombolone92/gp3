import { describe, expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { diagramDeck } from "./diagram-copy-fixture.js";
import {
  isDiagramShape,
  readShapeDiagram,
} from "../lib/pptx/src/api/fn/diagram-read.ts";
import { diagramTextFontLayers } from "../lib/pptx/src/api/fn/diagram-text-fonts.ts";
import { projectDiagramTextParagraphs } from "../lib/pptx/src/api/fn/diagram-text-paragraphs.ts";
import {
  firstChildElement,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import native from "./data/diagram-style-index-native.json";
import {
  NS,
  parseXml,
  serializeXml,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { readDiagramLayoutStyles } from "../lib/pptx/src/internal/diagram/layout-styles.ts";
const prepare = (row) => {
  const data = parseXml(native.models[row.model]);
  const layout = parseXml(native.layouts[row.layout]);
  const model = readDiagramDataModel(data.root);
  const root = expandDiagramLayout(layout.root, readDiagramHierarchy(model));
  return { data, layout, root };
};
const xml = (contents) =>
  parseXml(
    `<d:styleDef xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}">${contents}</d:styleDef>`,
  ).root;

describe("semantic SmartArt layout styles", () => {
  it.each(native.cases)("matches native reference style metadata: $name", (row) => {
    const { data, layout, root } = prepare(row);
    const before = [serializeXml(data), serializeXml(layout)];
    const styles = readDiagramLayoutStyles(root, null, null);
    expect(
      [...styles].map(([node, style]) => ({
        name: node.name,
        label: style.label,
        styleIndex: style.styleIndex,
        styleCount: style.styleCount,
      })),
    ).toEqual(row.expected);
    expect([...styles.values()].flatMap((s) => s.issues)).toEqual([]);
    expect([serializeXml(data), serializeXml(layout)]).toEqual(before);
  });
  it("selects each shared-label palette interval and retains source style nodes", () => {
    const { root } = prepare(native.cases.find((c) => c.name === ":pairs"));
    const quick = xml(
      '<d:styleLbl name="node1"><d:style><a:fontRef idx="major"><a:schemeClr val="tx1"/></a:fontRef></d:style></d:styleLbl>',
    );
    const colors = xml(
      '<d:styleLbl name="node1"><d:txFillClrLst><a:schemeClr val="accent1"/><a:schemeClr val="accent6"/></d:txFillClrLst></d:styleLbl>',
    );
    const before = JSON.stringify([quick, colors]);
    const styles = [
      ...readDiagramLayoutStyles(root, quick, colors).values(),
    ].slice(1);
    expect(styles.map((s) => s.textFill.amount)).toEqual([
      0, 0.2, 0.4, 0.6, 0.8, 1,
    ]);
    for (const style of styles) {
      expect(style.quickStyle).toBe(quick.children[0]);
      expect(style.colors).toBe(colors.children[0]);
      expect(style.issues).toEqual([]);
    }
    expect(JSON.stringify([quick, colors])).toBe(before);
  });
  it("reports ambiguous definitions without choosing an arbitrary style", () => {
    const { root } = prepare(native.cases[0]);
    const duplicate = xml(
      '<d:styleLbl name="node1"/><d:styleLbl name="node1"/>',
    );
    const styles = [
      ...readDiagramLayoutStyles(root, duplicate, duplicate).values(),
    ].slice(1);
    for (const style of styles) {
      expect(style.quickStyle).toBeNull();
      expect(style.colors).toBeNull();
      expect(style.issues).toEqual([
        "duplicate diagram quick-style label node1",
        "duplicate diagram color-style label node1",
      ]);
    }
  });
  it.each(["yes", "2", ""])("rejects invalid hideGeom %j", (hidden) => {
    const { root } = prepare(native.cases[0]);
    root.children[0].shape.attrs.push({
      name: { prefix: "", localName: "hideGeom", namespaceURI: "" },
      value: hidden,
    });
    expect(() => readDiagramLayoutStyles(root, null, null)).toThrow(
      "invalid diagram shape hideGeom",
    );
  });
  it("keeps resolved counts local to each expansion after editing the hierarchy", () => {
    const { root } = prepare(native.cases[0]);
    const first = readDiagramLayoutStyles(root, null, null);
    root.children.splice(2, 2);
    const second = readDiagramLayoutStyles(root, null, null);
    expect([...first.values()].slice(1).map((s) => s.styleCount)).toEqual([
      6, 6, 6, 6, 6, 6,
    ]);
    expect(
      [...second.values()].slice(1).map((s) => [s.styleIndex, s.styleCount]),
    ).toEqual([
      [0, 4],
      [1, 4],
      [2, 4],
      [3, 4],
    ]);
  });
  it("projects semantic fonts and colors with provenance through copy and export both ways", async () => {
    const source = await diagramDeck({ count: 1 }),
      target = createDeck("blank");
    const frame = P.getSlideShapes(P.getSlides(source)[0]).find(isDiagramShape),
      d = readShapeDiagram(frame),
      row = native.cases[0];
    const put = (part, text) => (part.data = new TextEncoder().encode(text));
    put(d.data.part, native.models[row.model]);
    put(
      d.layout.part,
      native.layouts[row.layout].replaceAll(
        "<dgm:presOf/>",
        '<dgm:presOf axis="self"/>',
      ),
    );
    put(
      d.quickStyle.part,
      `<d:styleDef xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}"><d:styleLbl name="node1"><d:style><a:fontRef idx="major"><a:srgbClr val="FF0000"/></a:fontRef></d:style></d:styleLbl></d:styleDef>`,
    );
    put(
      d.colors.part,
      `<d:colorsDef xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}"><d:styleLbl name="node1"><d:txFillClrLst meth="repeat"><a:schemeClr val="accent2"><a:alpha val="42000"/></a:schemeClr><a:srgbClr val="336699"/></d:txFillClrLst></d:styleLbl></d:colorsDef>`,
    );
    const inspect = (frame) => {
      const d = readShapeDiagram(frame),
        root = expandDiagramLayout(
          d.layout.root,
          readDiagramHierarchy(d.model),
        ),
        styles = readDiagramLayoutStyles(
          root,
          d.quickStyle.root,
          d.colors.root,
        ),
        result = [];
      const child = (e, n) => firstChildElement(e, qname("", n, NS.dml)),
        value = (e, n) => getAttrValue(e, qname("", n, ""));
      for (const [node, style] of styles) {
        if (style.label === null) continue;
        expect(style.issues).toEqual([]);
        const sources = new WeakMap(),
          defaults = diagramTextFontLayers(style, {
            quickOwner: d.quickStyle.part.name,
            colorOwner: d.colors.part.name,
            theme: () => {
              throw Error("repeat palette must retain theme tokens");
            },
            colorMap: null,
            report: (message) => {
              throw Error(message);
            },
          });
        const paragraphs = projectDiagramTextParagraphs(
          node,
          {
            dataOwner: d.data.part.name,
            fontSize: () => 18,
            defaults: () => defaults,
          },
          sources,
        );
        const properties = child(child(paragraphs[0], "pPr"), "defRPr"),
          latin = child(properties, "latin"),
          fill = child(properties, "solidFill"),
          color = fill.children[0];
        expect(sources.get(latin)).toBe(d.quickStyle.part.name);
        expect(sources.get(color)).toBe(d.colors.part.name);
        result.push([
          style.styleIndex,
          style.styleCount,
          value(latin, "typeface"),
          color.name.localName,
          value(color, "val"),
          child(color, "alpha") ? value(child(color, "alpha"), "val") : null,
        ]);
      }
      return result;
    };
    const expected = Array.from({ length: 6 }, (_, i) => [
      i,
      6,
      "+mj-lt",
      i % 2 ? "srgbClr" : "schemeClr",
      i % 2 ? "336699" : "accent2",
      i % 2 ? null : "42000",
    ]);
    expect(inspect(frame)).toEqual(expected);
    expect(inspect(P.copyShape(P.getSlides(source)[0], frame))).toEqual(
      expected,
    );
    P.importSlide(target, P.getSlides(source)[0], P.getSlideLayouts(target)[0]);
    const reopened = await P.loadPresentation(await P.savePresentation(target)),
      slide = P.getSlides(reopened).at(-1);
    for (const shape of P.getSlideShapes(slide).filter(isDiagramShape))
      expect(inspect(shape)).toEqual(expected);
    P.importSlide(source, slide, P.getSlideLayouts(source)[0]);
    const returned = await P.loadPresentation(await P.savePresentation(source));
    for (const shape of P.getSlideShapes(P.getSlides(returned).at(-1)).filter(
      isDiagramShape,
    ))
      expect(inspect(shape)).toEqual(expected);
  });
});
