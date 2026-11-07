import { describe, expect, it } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  qname,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readDiagramLayoutShapeProperties } from "../lib/pptx/src/internal/diagram/shape-properties.ts";
import { reflowShapeDiagram } from "../lib/pptx/src/api/fn/diagram-reflow.ts";
import { buildDiagramDrawing } from "../lib/pptx/src/api/fn/diagram-build.ts";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
import { createDiagramColorCopy } from "../lib/pptx/src/api/fn/diagram-color-copy.ts";
import { REL_TYPES } from "../lib/pptx/src/internal/presentationml/index.ts";
import {
  SHAPE_ELEMENT,
  SHAPE_XML_SOURCES,
} from "../lib/pptx/src/api/_internal-symbols.ts";
import { semanticPaintDeck } from "./diagram-build-fixture.js";
import { diagramImage } from "./diagram-copy-fixture.js";
import {
  diagramLayoutPropertiesDeck,
  layoutPropertyExtension,
  layoutProperties,
  encode,
  decode,
} from "./diagram-layout-properties-fixture.js";

const child = (e, name, ns = NS.dml) =>
  firstChildElement(e, qname("", name, ns));
const properties = (s) => child(s[SHAPE_ELEMENT], "spPr", NS.pml);
const shapes = (frame) =>
  P.getGroupChildren(
    buildDiagramDrawing(
      frame,
      reflowShapeDiagram(frame, { textFits: () => true }),
    ).root,
  );
const xml = (e) => serializeXml({ root: e, prolog: [], epilog: [] });
const svg = (p) =>
  decodeURIComponent(
    preview(p, P.getSlides(p)[0]).split(",").slice(1).join(","),
  );
const wrap = (body) =>
  parseXml(
    `<d:shape xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}" xmlns:s="${NS.dgm1612}" xmlns:o="urn:opaque">${body}</d:shape>`,
  ).root;

describe("SmartArt layout shape-property extensions", () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "preserves layout colors only under the paint option, text=%s paint=%s",
    async (text, paint) => {
      const { p } = await diagramLayoutPropertiesDeck(),
        root = wrap(
          layoutPropertyExtension(
            '<a:solidFill><a:schemeClr val="accent1"><a:tint val="12000"/><a:alpha val="43000"/></a:schemeClr></a:solidFill>',
          ),
        );
      const opaque = parseXml(
        '<o:wrapper xmlns:o="urn:opaque" xmlns:s="' +
          NS.dgm1612 +
          '" xmlns:a="' +
          NS.dml +
          '"><s:spPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></s:spPr></o:wrapper>',
      ).root;
      root.children.push(opaque);
      const before = xml(opaque),
        copy = createDiagramColorCopy({
          sourceSlide: P.getSlides(p)[0],
          preserveTextFormatting: text,
          preservePaintFormatting: paint,
        });
      expect(copy(root)).toBe(paint);
      const props = readDiagramLayoutShapeProperties(root),
        fill = child(props, "solidFill"),
        color = child(fill, paint ? "srgbClr" : "schemeClr");
      expect(color.attrs[0].value).toBe(paint ? "D0263E" : "accent1");
      expect(color.children.map((c) => c.name.localName)).toEqual([
        "tint",
        "alpha",
      ]);
      expect(xml(opaque)).toBe(before);
    },
  );
  it.each([
    ["no extension", ""],
    ["wrong list namespace", "<o:extLst><a:ext><s:spPr/></a:ext></o:extLst>"],
    [
      "wrong wrapper namespace",
      "<d:extLst><o:ext><s:spPr/></o:ext></d:extLst>",
    ],
    [
      "wrong payload namespace",
      "<d:extLst><a:ext><o:spPr/></a:ext></d:extLst>",
    ],
    [
      "nested opaque payload",
      "<d:extLst><a:ext><o:wrapper><s:spPr/></o:wrapper></a:ext></d:extLst>",
    ],
  ])("keeps %s opaque", (_, body) => {
    const root = wrap(body),
      before = xml(root);
    expect(readDiagramLayoutShapeProperties(root)).toBeNull();
    expect(xml(root)).toBe(before);
  });

  it("recognizes qualified formatting independently of the extension URI and prefix", () => {
    const root = wrap(layoutPropertyExtension('<a:ln w="36000"/>')),
      before = xml(root),
      result = readDiagramLayoutShapeProperties(root);
    expect(result.name.namespaceURI).toBe(NS.dgm1612);
    expect(xml(result)).toContain('w="36000"');
    expect(xml(root)).toBe(before);
  });

  it.each([
    layoutPropertyExtension("") + layoutPropertyExtension(""),
    "<d:extLst><a:ext><s:spPr/><s:spPr/></a:ext></d:extLst>",
  ])("diagnoses competing shape-property payloads", (body) => {
    // Distinct extension entries belong in one list.
    body = body.replace("</d:extLst><d:extLst>", "");
    expect(() => readDiagramLayoutShapeProperties(wrap(body))).toThrow(
      "multiple diagram layout shape properties",
    );
  });

  it("retains theme line paint and width when layout supplies only dash and endings", async () => {
    const { p, frame } = await semanticPaintDeck(),
      diagram = readShapeDiagram(frame),
      before = shapes(frame).map((s) => xml(child(properties(s), "ln"))),
      doc = parseXml(decode(diagram.layout.part));
    walkElements(doc.root, (e) => {
      if (e.name.namespaceURI === NS.diagram && e.name.localName === "shape") {
        e.children.push(
          wrap(
            layoutPropertyExtension(
              '<a:ln><a:prstDash val="lgDash"/><a:tailEnd type="triangle"/></a:ln>',
            ),
          ).children[0],
        );
      }
    });
    diagram.layout.part.data = encode(serializeXml(doc));
    const untouched = diagram.layout.part.data.slice();
    shapes(frame).forEach((s, i) => {
      const line = child(properties(s), "ln"),
        old = parseXml(before[i]).root;
      expect(line.attrs).toEqual(old.attrs);
      expect(xml(child(line, "solidFill"))).toBe(xml(child(old, "solidFill")));
      expect(P.getShapeStrokeDash(s)).toBe("lgDash");
      expect(child(line, "tailEnd")).not.toBeNull();
    });
    expect(svg(p)).not.toContain("data-pptx-diagram-issues");
    expect(diagram.layout.part.data).toEqual(untouched);
  });

  it("composes fill, line, geometry, effects and attributes before direct customization", async () => {
    const { frame, diagram } = await diagramLayoutPropertiesDeck({
      properties: [
        null,
        null,
        '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="123456"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill><a:ln w="72000" cap="rnd"><a:solidFill><a:srgbClr val="2468AC"/></a:solidFill><a:custDash><a:ds d="100000" sp="50000"/></a:custDash><a:round/><a:headEnd type="oval"/></a:ln><a:effectLst><a:glow rad="36000"><a:srgbClr val="ABCDEF"/></a:glow></a:effectLst>',
      ],
      direct: [
        "",
        "",
        '<a:noFill/><a:ln w="108000"><a:prstDash val="dashDot"/><a:miter lim="400000"/><a:tailEnd type="triangle"/></a:ln><a:effectDag name="direct"/>',
      ],
    });
    diagram.layout.part.data = encode(
      decode(diagram.layout.part).replace(
        "<s:spPr >",
        '<s:spPr bwMode="gray">',
      ),
    );
    const before = diagram.layout.part.data.slice(),
      s = shapes(frame)[2],
      props = properties(s),
      line = child(props, "ln");
    expect(props.attrs.find((a) => a.name.localName === "bwMode").value).toBe(
      "gray",
    );
    expect(child(props, "gradFill")).toBeNull();
    expect(child(props, "noFill")).not.toBeNull();
    expect(
      child(props, "prstGeom").attrs.find((a) => a.name.localName === "prst")
        .value,
    ).toBe("ellipse");
    expect(child(props, "effectLst")).toBeNull();
    expect(child(props, "effectDag")).not.toBeNull();
    expect(child(line, "custDash")).toBeNull();
    expect(child(line, "round")).toBeNull();
    expect(P.getShapeStrokeDash(s)).toBe("dashDot");
    expect(P.getShapeStrokeWidth(s)).toBe(108000);
    expect(P.getShapeStrokeColor(s)).toBe("#2468AC");
    expect(line.attrs.find((a) => a.name.localName === "cap").value).toBe(
      "rnd",
    );
    expect(child(line, "headEnd")).not.toBeNull();
    expect(child(line, "tailEnd")).not.toBeNull();
    expect(diagram.layout.part.data).toEqual(before);
  });

  it.each([
    [
      '<a:scene3d><a:camera prst="perspectiveFront"/></a:scene3d>',
      "unsupported diagram custom 3D shape",
    ],
    ['<a:sp3d z="36000"/>', "unsupported diagram custom 3D shape"],
    ['<a:xfrm rot="600000"/>', "unsupported diagram layout shape transform"],
    [
      '<a:xfrm><a:off x="0" y="0"/></a:xfrm>',
      "unsupported diagram layout shape transform",
    ],
    ["<s:ln/>", "unsupported diagram shape property namespace"],
    [
      "<a:ln><s:prstDash/></a:ln>",
      "unsupported diagram shape property namespace",
    ],
  ])(
    "does not silently flatten unsupported layout properties: %s",
    async (body, issue) => {
      const { p, frame, diagram } = await diagramLayoutPropertiesDeck({
          properties: [body, null, null],
        }),
        before = diagram.layout.part.data.slice();
      expect(() => shapes(frame)).toThrow(issue);
      expect(svg(p)).toContain(issue);
      expect(diagram.layout.part.data).toEqual(before);
    },
  );

  it("keeps empty transform/3D defaults and hidden geometry valid", async () => {
    const { p, frame } = await diagramLayoutPropertiesDeck({
      properties: layoutProperties.map(
        (v) => v + "<a:xfrm/><a:scene3d/><a:sp3d/>",
      ),
      hidden: true,
    });
    for (const s of shapes(frame)) {
      expect(child(properties(s), "noFill")).not.toBeNull();
      expect(child(child(properties(s), "ln"), "noFill")).not.toBeNull();
    }
    expect(svg(p)).not.toContain("data-pptx-diagram-issues");
    expect(svg(p)).not.toContain('stroke="#D0263E"');
  });

  it("retains layout image ownership through semantic rendering, export and two-way transfer", async () => {
    const { p, frame, diagram } = await diagramLayoutPropertiesDeck({
      properties: [
        null,
        null,
        '<a:blipFill xmlns:r="' +
          NS.officeDocRels +
          '"><a:blip r:embed="rIdOwnedImage"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>',
      ],
    });
    const pkg = P._internalPackageOf(p);
    pkg.addPart(
      "/assets/smart/layout-image.png",
      "image/png",
      diagramImage.slice(),
    );
    pkg.setRels(diagram.layout.part.name, {
      items: [
        {
          id: "rIdOwnedImage",
          type: REL_TYPES.image,
          target: "layout-image.png",
          targetMode: "Internal",
        },
      ],
    });
    const s = shapes(frame)[2],
      blip = child(child(properties(s), "blipFill"), "blip");
    expect(s[SHAPE_XML_SOURCES].get(blip)).toBe(diagram.layout.part.name);
    expect(blip.attrs[0].value).toBe("rIdOwnedImage");
    expect(P.getShapeImageFillBytes(s)).toEqual(diagramImage);
    expect(svg(p)).toContain("data:image/png;base64,");
    const target = createDeck("blank"),
      imported = P.importSlide(
        target,
        P.getSlides(p)[0],
        P.getSlideLayouts(target)[0],
      ),
      reopened = await P.loadPresentation(await P.savePresentation(target)),
      returned = P.importSlide(
        p,
        P.getSlides(reopened)[1],
        P.getSlideLayouts(p)[0],
      );
    for (const slide of [imported, P.getSlides(reopened)[1], returned]) {
      const f = P.getSlideShapes(slide)[0],
        image = shapes(f)[2];
      expect(P.getShapeImageFillBytes(image)).toEqual(diagramImage);
      const reference = child(child(properties(image), "blipFill"), "blip");
      expect(image[SHAPE_XML_SOURCES].get(reference)).toBe(
        readShapeDiagram(f).layout.part.name,
      );
    }
    for (const pres of [p, target, reopened])
      expect(P.validatePresentation(pres)).toEqual([]);
  });

  it.each([false, true])(
    "preserves semantic parts and layout paint through export and two-way transfer, source paint=%s",
    async (preserve) => {
      const { p, frame, diagram } = await diagramLayoutPropertiesDeck(),
        before = new Map(
          ["data", "layout", "quickStyle", "colors"].map((k) => [
            k,
            diagram[k].part.data.slice(),
          ]),
        );
      const target = createDeck("blank"),
        options = {
          preservePaintFormatting: preserve,
          preserveTextFormatting: true,
        },
        imported = P.importSlide(
          target,
          P.getSlides(p)[0],
          P.getSlideLayouts(target)[0],
          options,
        ),
        copied = P.getSlideShapes(imported)[0],
        reopened = await P.loadPresentation(await P.savePresentation(target)),
        loaded = P.getSlideShapes(P.getSlides(reopened)[1])[0],
        returnedSlide = P.importSlide(
          p,
          P.getSlides(reopened)[1],
          P.getSlideLayouts(p)[0],
          options,
        ),
        returned = P.getSlideShapes(returnedSlide)[0],
        duplicate = P.copyShape(returnedSlide, returned);
      for (const s of [frame, copied, loaded, returned, duplicate]) {
        const draw = shapes(s),
          line = child(properties(draw[0]), "ln"),
          d = readShapeDiagram(s);
        expect(P.getShapeStrokeDash(draw[0])).toBe("dash");
        expect(child(line, "tailEnd")).not.toBeNull();
        expect(P.getShapeStrokeWidth(draw[0])).toBe(72000);
        expect(P.getShapeStrokeDash(draw[2])).toBe("dot");
        expect(d.drawing).toBeNull();
        const color = child(
          child(line, "solidFill"),
          preserve && s !== frame ? "srgbClr" : "schemeClr",
        );
        expect(color).not.toBeNull();
        if (preserve && s !== frame)
          expect(color.attrs[0].value).toBe("D0263E");
        for (const k of ["data", "quickStyle", "colors"])
          expect(d[k].part.data).toEqual(before.get(k));
        if (!preserve) expect(d.layout.part.data).toEqual(before.get("layout"));
      }
      for (const [k, bytes] of before)
        expect(diagram[k].part.data).toEqual(bytes);
      for (const pres of [p, target, reopened])
        expect(P.validatePresentation(pres)).toEqual([]);
    },
  );
});
