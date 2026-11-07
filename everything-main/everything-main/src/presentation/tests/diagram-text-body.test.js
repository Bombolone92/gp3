import { describe, expect, it } from "vitest";
import native from "./data/diagram-text-body-native.json";
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
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramDataModel } from "../lib/pptx/src/internal/diagram/data-model.ts";
import { readDiagramHierarchy } from "../lib/pptx/src/internal/diagram/hierarchy.ts";
import { expandDiagramLayout } from "../lib/pptx/src/internal/diagram/layout.ts";
import { evaluateDiagramInitialConstraints } from "../lib/pptx/src/internal/diagram/initial-constraints.ts";
import { readDiagramTextCustomization } from "../lib/pptx/src/internal/diagram/text-customization.ts";
import { projectDiagramTextBodyProperties } from "../lib/pptx/src/api/fn/diagram-text-body.ts";

const child = (el, name) => firstChildElement(el, qname("", name, NS.dml));
const value = (el, name) => getAttrValue(el, qname("", name, ""));
const owner = "/ppt/diagrams/data1.xml";
const options = { dataOwner: owner, margins: { l: 1, r: 2, t: 3, b: 4 } };
const xml = (content) =>
  parseXml(
    `<a:root xmlns:a="${NS.dml}" xmlns:x="urn:foreign" xmlns:r="${NS.officeDocRels}">${content}</a:root>`,
  ).root.children[0];
const node = (body = "<a:bodyPr/>", params = "") => ({
  algorithm: parseXml(
    `<d:alg xmlns:d="${NS.diagram}" type="tx">${params}</d:alg>`,
  ).root,
  contributors: [
    {
      depth: 1,
      point: {
        text: body === null ? null : xml(`<a:txBody>${body}<a:p/></a:txBody>`),
      },
    },
  ],
});
const project = (n, opts = options, sources = new WeakMap()) =>
  projectDiagramTextBodyProperties(n, opts, sources);
const expandedName = (name) =>
  name.namespaceURI
    ? `{${name.namespaceURI}}${name.localName}`
    : name.localName;
const tree = (el) => ({
  name: expandedName(el.name),
  attrs: Object.fromEntries(
    el.attrs.map((a) => [expandedName(a.name), a.value]),
  ),
  children: el.children.filter((c) => c.kind === "element").map(tree),
});

describe("semantic SmartArt text-body projection", () => {
  it.each(native.cases)("matches native body properties: $name", (row) => {
    const data = parseXml(native.models[row.model]),
      layout = parseXml(native.layouts[row.layout]);
    const before = [serializeXml(data), serializeXml(layout)];
    const root = expandDiagramLayout(
      layout.root,
      readDiagramHierarchy(readDiagramDataModel(data.root)),
    );
    const text = root.children.find((n) => n.name === "text"),
      custom = readDiagramTextCustomization(text);
    const states = evaluateDiagramInitialConstraints(
      root,
      { w: 300, h: 100 },
      {
        quantizeFonts: true,
        changes: custom
          ? [
              {
                owner: text,
                property: {
                  type: "primFontSz",
                  selector: {
                    relationship: "self",
                    name: "",
                    pointType: "all",
                  },
                },
                value: custom.primaryFontSize,
              },
            ]
          : [],
      },
    );
    const margins = Object.fromEntries(
      ["l", "r", "t", "b"].map((s) => [
        s,
        states.get(text).values.get(`${s}Marg`),
      ]),
    );
    const body = project(text, { dataOwner: owner, margins });
    expect(tree(body)).toEqual({
      ...row.expected,
      attrs: { compatLnSpc: "0", ...row.expected.attrs },
    });
    expect([serializeXml(data), serializeXml(layout)]).toEqual(before);
  });

  it("uses algorithm anchoring and writing direction when unformatted", () => {
    const text = node(
      "<a:bodyPr/>",
      '<d:param type="txAnchorVert" val="b"/><d:param type="txAnchorVertCh" val="mid"/><d:param type="txAnchorHorz" val="none"/><d:param type="txAnchorHorzCh" val="ctr"/><d:param type="txBlDir" val="vert"/>',
    );
    expect(tree(project(text)).attrs).toMatchObject({
      anchor: "b",
      anchorCtr: "0",
      vert: "vert",
    });
    text.contributors.push({ depth: 2, point: { text: null } });
    expect(tree(project(text)).attrs).toMatchObject({
      anchor: "ctr",
      anchorCtr: "1",
      vert: "vert",
    });
  });

  it("uses neither the context point nor a later contributor when the first has no body", () => {
    const text = node(null),
      later = node('<a:bodyPr anchor="b" rot="5400000"/>').contributors[0];
    text.context = later;
    text.contributors.push(later);
    expect(tree(project(text)).attrs).toMatchObject({
      anchor: "ctr",
      lIns: "12700",
    });
    expect(value(project(text), "rot")).toBeNull();
    text.contributors.reverse();
    expect(tree(project(text)).attrs).toMatchObject({
      anchor: "b",
      rot: "5400000",
    });
  });

  it("preserves signed authored insets and only clamps realized constraint margins", () => {
    const text = node('<a:bodyPr lIns="-12345" bIns="0"/>');
    const body = project(text, {
      ...options,
      margins: { l: -3, r: -0.25, t: 0.12345, b: 10 },
    });
    expect(tree(body).attrs).toMatchObject({
      lIns: "-12345",
      rIns: "0",
      tIns: "1568",
      bIns: "0",
    });
  });

  it("preserves extensions, namespace declarations and provenance without sharing mutable XML", () => {
    const text = node(
      '<a:bodyPr x:wrap="foreign" wrap="none"><a:prstTxWarp prst="textWave1"><a:avLst/></a:prstTxWarp><a:normAutofit fontScale="50000"/><a:scene3d><a:camera prst="orthographicFront"/></a:scene3d><a:flatTx z="0"/><a:extLst><a:ext uri="test"><x:asset r:embed="image"/></a:ext></a:extLst><x:noAutofit/></a:bodyPr>',
    );
    const source = child(text.contributors[0].point.text, "bodyPr"),
      before = serializeFragment(source),
      sources = new WeakMap();
    const asset = child(source, "extLst").children[0].children[0];
    sources.set(asset, "/ppt/diagrams/colors1.xml");
    const result = project(text, options, sources);
    expect(result.children.map((c) => expandedName(c.name))).toEqual(
      ["prstTxWarp", "noAutofit", "scene3d", "flatTx", "extLst"]
        .map((n) => `{${NS.dml}}${n}`)
        .concat("{urn:foreign}noAutofit"),
    );
    expect(value(result, "wrap")).toBe("square");
    expect(getAttrValue(result, qname("", "wrap", "urn:foreign"))).toBe(
      "foreign",
    );
    expect(sources.get(child(result, "scene3d"))).toBe(owner);
    expect(sources.get(child(result, "extLst").children[0].children[0])).toBe(
      "/ppt/diagrams/colors1.xml",
    );
    result.attrs[0].value = "changed";
    child(result, "prstTxWarp").attrs[0].value = "changed";
    child(result, "extLst").children[0].children[0].attrs[0].value = "changed";
    result.prefixDecls.set("new", "urn:new");
    expect(serializeFragment(source)).toBe(before);
    expect(serializeFragment(project(text, options, sources))).not.toContain(
      "changed",
    );
  });

  it("replaces all DrawingML autofit alternatives, independently of foreign names", () => {
    const result = project(
      node(
        "<a:bodyPr><a:noAutofit/><a:normAutofit/><a:spAutoFit/><a:extLst/><x:spAutoFit/></a:bodyPr>",
      ),
    );
    expect(result.children.map((c) => expandedName(c.name))).toEqual([
      `{${NS.dml}}noAutofit`,
      `{${NS.dml}}extLst`,
      "{urn:foreign}spAutoFit",
    ]);
  });

  it("can project algorithm properties for a node with no contributors", () => {
    const text = node();
    text.contributors = [];
    expect(tree(project(text)).attrs).toMatchObject({
      compatLnSpc: "0",
      anchor: "ctr",
      wrap: "square",
    });
  });

  it.each([NaN, Infinity, -Infinity, 2147483648 / 12700, Number.MAX_VALUE])(
    "rejects an unrepresentable realized margin %s",
    (margin) => {
      expect(() =>
        project(node(), {
          ...options,
          margins: { ...options.margins, r: margin },
        }),
      ).toThrow("invalid diagram text margin");
    },
  );

  it("preserves projected properties through export and copying in both directions", async () => {
    const body = project(
      node(
        '<a:bodyPr rot="2700000" compatLnSpc="1" lIns="-123"><a:prstTxWarp prst="textWave1"><a:avLst/></a:prstTxWarp><a:flatTx z="23000"/></a:bodyPr>',
      ),
    );
    const source = createDeck("blank"),
      target = createDeck("blank");
    const shape = buildTextBox({
      id: 1,
      name: "Projected body",
      x: 0,
      y: 0,
      w: 4000000,
      h: 3000000,
      text: "Text",
    });
    const tx = firstChildElement(shape, qname("", "txBody", NS.pml));
    tx.children[tx.children.indexOf(child(tx, "bodyPr"))] = body;
    const original = appendAndReturnNewShape(P.getSlides(source)[0], shape),
      expected = tree(body);
    const inspect = (sh) =>
      tree(
        child(
          firstChildElement(sh[SHAPE_ELEMENT], qname("", "txBody", NS.pml)),
          "bodyPr",
        ),
      );
    expect(inspect(P.copyShape(P.getSlides(source)[0], original))).toEqual(
      expected,
    );
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
});
