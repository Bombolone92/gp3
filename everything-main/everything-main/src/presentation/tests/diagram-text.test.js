import { describe, expect, it } from "vitest";
import { P } from "../src/model.js";
import { diagramDeck } from "./diagram-copy-fixture.js";
import { readDiagramDrawing } from "../lib/pptx/src/api/fn/diagram-drawing.ts";
import { materializeDiagramText } from "../lib/pptx/src/api/fn/diagram-text.ts";
import {
  isDiagramShape,
  readShapeDiagram,
} from "../lib/pptx/src/api/fn/diagram-read.ts";
import { SHAPE_ELEMENT } from "../lib/pptx/src/api/_internal-symbols.ts";
import {
  NS,
  firstChildElement,
  qname,
  getAttrValue,
  serializeFragment,
} from "../lib/pptx/src/internal/xml/index.ts";
import { REL_TYPES } from "../lib/pptx/src/internal/presentationml/index.ts";

const child = (el, name, ns = NS.dml) =>
  el && firstChildElement(el, qname("", name, ns));
const value = (el, name) => el && getAttrValue(el, qname("", name, ""));
const run = (text, properties = "") =>
  `<a:r>${properties ? `<a:rPr ${properties}/>` : ""}<a:t>${text}</a:t></a:r>`;
const paragraph = (properties = "", content = run("Text")) =>
  `<a:p>${properties}${content}</a:p>`;
const body = (p, list = "", attributes = "") =>
  `<a:bodyPr ${attributes}/><a:lstStyle>${list}</a:lstStyle>${p}`;
const d16 = "http://schemas.microsoft.com/office/drawing/2016/12/diagram";

async function fixture({
  source = paragraph(),
  cache = source,
  sourceList = "",
  cacheList = "",
  cacheBodyAttributes = "",
  diagramList = "",
  quick = '<a:fontRef idx="minor"/>',
  savedStyle = "",
  palette = '<a:schemeClr val="accent2"><a:alpha val="42000"/></a:schemeClr>',
  method = "repeat",
  index = 0,
  count = 1,
  nodeDepth = 0,
} = {}) {
  const pres = await diagramDeck({ count: 1 });
  const frame = P.getSlideShapes(P.getSlides(pres)[0]).find(isDiagramShape);
  const diagram = readShapeDiagram(frame);
  const put = (part, xml) => {
    part.data = new TextEncoder().encode(xml);
  };
  const edit = (part, fn) => put(part, fn(new TextDecoder().decode(part.data)));
  edit(diagram.data.part, (xml) =>
    xml.replace(
      /<dgm:ptLst>[\s\S]*?<dgm:cxnLst\/>/,
      `<dgm:ptLst>${Array.from({ length: nodeDepth }, (_, i) => `<dgm:pt modelId="parent-${i}"/>`).join("")}<dgm:pt modelId="node-0"><dgm:t xmlns:r="${NS.officeDocRels}">${body(source, sourceList)}</dgm:t></dgm:pt><dgm:pt modelId="presentation" type="pres"><dgm:prSet presName="root" presStyleIdx="${index}" presStyleCnt="${count}"/></dgm:pt></dgm:ptLst><dgm:cxnLst>${Array.from({ length: nodeDepth }, (_, i) => `<dgm:cxn modelId="edge-${i}" srcId="parent-${i}" destId="${i === nodeDepth - 1 ? "node-0" : `parent-${i + 1}`}"/>`).join("")}<dgm:cxn modelId="presentation-edge" srcId="node-0" destId="presentation" type="presOf"/></dgm:cxnLst>`,
    ),
  );
  edit(diagram.drawing.part, (xml) =>
    xml
      .replace('modelId="node-0"', 'modelId="presentation"')
      .replace(
        /<dsp:txBody>[\s\S]*?<\/dsp:txBody>/,
        `<dsp:txBody>${body(cache, cacheList, cacheBodyAttributes)}</dsp:txBody>`,
      )
      .replace(
        "</dsp:spPr>",
        `</dsp:spPr>${savedStyle ? `<dsp:style>${savedStyle}</dsp:style>` : ""}`,
      ),
  );
  edit(diagram.layout.part, (xml) =>
    xml
      .replace('name="root"', 'name="root" styleLbl="text"')
      .replace(
        "</dgm:layoutDef>",
        `<dgm:extLst><a:ext xmlns:a="${NS.dml}" uri="urn:diagram-list"><d16:lstStyle xmlns:d16="${d16}">${diagramList}</d16:lstStyle></a:ext></dgm:extLst></dgm:layoutDef>`,
      ),
  );
  put(
    diagram.quickStyle.part,
    `<dgm:styleDef xmlns:dgm="${NS.diagram}" xmlns:a="${NS.dml}"><dgm:styleLbl name="text"><dgm:style>${quick}</dgm:style></dgm:styleLbl></dgm:styleDef>`,
  );
  put(
    diagram.colors.part,
    `<dgm:colorsDef xmlns:dgm="${NS.diagram}" xmlns:a="${NS.dml}"><dgm:styleLbl name="text"><dgm:txFillClrLst meth="${method}">${palette}</dgm:txFillClrLst></dgm:styleLbl></dgm:colorsDef>`,
  );
  const view = readDiagramDrawing(frame),
    shape = P.getGroupChildren(view.root)[0];
  expect(view.issues).toEqual([]);
  expect(view.information(shape).textStyle).not.toBeNull();
  return { pres, frame, diagram, view, shape };
}
const paragraphs = (shape) =>
  child(shape[SHAPE_ELEMENT], "txBody", NS.pml).children.filter(
    (e) => e.kind === "element" && e.name.localName === "p",
  );
const ppr = (shape, i = 0) => child(paragraphs(shape)[i], "pPr");

describe("SmartArt text materialization", () => {
  it.each([null, "0", "1", "false", "true"])(
    "keeps diagram line-spacing semantics when compatLnSpc is %s",
    async (setting) => {
      const { view, shape } = await fixture({
        cacheBodyAttributes: `tIns="18000" anchor="b"${setting === null ? "" : ` compatLnSpc="${setting}"`}`,
      });
      expect(materializeDiagramText(view)).toEqual([]);
      const bodyPr = child(
        child(shape[SHAPE_ELEMENT], "txBody", NS.pml),
        "bodyPr",
      );
      expect(value(bodyPr, "compatLnSpc")).toBe(setting ?? "0");
      expect(value(bodyPr, "tIns")).toBe("18000");
      expect(value(bodyPr, "anchor")).toBe("b");
    },
  );
  it("inherits individual default and node-level properties below calculated and explicit formatting", async () => {
    const { pres, view, shape } = await fixture({
      nodeDepth: 2,
      diagramList:
        '<a:defPPr marR="300" algn="ctr"><a:buChar char="•"/><a:defRPr b="1" i="1" sz="4200"/></a:defPPr><a:lvl1pPr marR="999"/><a:lvl3pPr algn="r"><a:defRPr i="0"/></a:lvl3pPr>',
      sourceList:
        '<a:defPPr indent="-100"><a:defRPr lang="fr-FR"/></a:defPPr><a:lvl2pPr><a:defRPr u="sng"/></a:lvl2pPr>',
      source: paragraph(
        '<a:pPr lvl="1"><a:defRPr b="0"/></a:pPr>',
        run("Text", 'sz="3600"'),
      ),
      cache: paragraph(
        '<a:pPr lvl="0" marL="250" algn="l"><a:buNone/></a:pPr>',
        run("Text", 'sz="1700"'),
      ),
    });
    expect(materializeDiagramText(view)).toEqual([]);
    const p = ppr(shape),
      d = child(p, "defRPr");
    expect(
      ["marR", "marL", "indent", "algn", "lvl"].map((n) => value(p, n)),
    ).toEqual(["300", "250", "-100", "l", "0"]);
    expect(["b", "i", "sz", "lang", "u"].map((n) => value(d, n))).toEqual([
      "0",
      "0",
      "4200",
      "fr-FR",
      "sng",
    ]);
    expect(child(p, "buChar")).toBeNull();
    expect(child(p, "buNone")).not.toBeNull();
    expect(P.getShapeRunFormatEffective(pres, shape, 0, 0)).toMatchObject({
      size: 17,
      bold: false,
      italic: false,
      underline: true,
    });
  });

  it("keeps theme and alpha tokens and lets explicit run fill and font override palette defaults", async () => {
    const source = paragraph(
      "",
      '<a:r><a:rPr><a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>Text</a:t></a:r>',
    );
    const { pres, view, shape } = await fixture({
      source,
      quick: '<a:fontRef idx="major"><a:schemeClr val="accent1"/></a:fontRef>',
    });
    expect(materializeDiagramText(view)).toEqual([]);
    const d = child(ppr(shape), "defRPr"),
      color = child(child(d, "solidFill"), "schemeClr");
    expect(value(color, "val")).toBe("accent2");
    expect(value(child(color, "alpha"), "val")).toBe("42000");
    expect(
      ["latin", "ea", "cs"].map((n) => value(child(d, n), "typeface")),
    ).toEqual(["+mj-lt", "+mj-ea", "+mj-cs"]);
    expect(P.getShapeRunFormatEffective(pres, shape, 0, 0)).toMatchObject({
      font: "Arial",
      color: "#123456",
    });
  });

  it("does not use insertion-point formatting for existing text, and respects saved fontRef none", async () => {
    const source = paragraph(
      "",
      run("Text") +
        '<a:endParaRPr b="1" sz="9600"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:endParaRPr>',
    );
    const { view, shape } = await fixture({
      source,
      quick: '<a:fontRef idx="major"/>',
      savedStyle: '<a:fontRef idx="none"/>',
      palette: "",
    });
    const before = serializeFragment(child(paragraphs(shape)[0], "endParaRPr"));
    expect(materializeDiagramText(view)).toEqual([]);
    const d = child(ppr(shape), "defRPr");
    expect(child(d, "latin")).toBeNull();
    expect(value(d, "sz")).toBeNull();
    expect(value(d, "b")).toBeNull();
    expect(serializeFragment(child(paragraphs(shape)[0], "endParaRPr"))).toBe(
      before,
    );
  });

  it("replaces mutually exclusive property choices and retains schema child order", async () => {
    const { view, shape } = await fixture({
      diagramList:
        '<a:defPPr><a:buClr><a:srgbClr val="123456"/></a:buClr><a:buSzPts val="1200"/><a:buFont typeface="Arial"/><a:buBlip><a:blip/></a:buBlip><a:defRPr><a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:effectLst/><a:uLn/><a:uFill><a:noFill/></a:uFill></a:defRPr></a:defPPr>',
      cache: paragraph(
        '<a:pPr><a:lnSpc><a:spcPct val="125000"/></a:lnSpc><a:buClrTx/><a:buSzTx/><a:buFontTx/><a:buNone/><a:defRPr><a:noFill/><a:effectDag/><a:uLnTx/><a:uFillTx/></a:defRPr></a:pPr>',
      ),
    });
    expect(materializeDiagramText(view)).toEqual([]);
    expect(ppr(shape).children.map((e) => e.name.localName)).toEqual([
      "lnSpc",
      "buClrTx",
      "buSzTx",
      "buFontTx",
      "buNone",
      "defRPr",
    ]);
    expect(
      child(ppr(shape), "defRPr").children.map((e) => e.name.localName),
    ).toEqual(["noFill", "effectDag", "uLnTx", "uFillTx", "latin", "ea", "cs"]);
  });

  it("retains semantic hyperlink and image owners across repeated materialization", async () => {
    const source = paragraph(
      '<a:pPr><a:buBlip><a:blip r:embed="image"/></a:buBlip></a:pPr>',
      '<a:r><a:rPr b="1"><a:hlinkClick r:id="visit"/></a:rPr><a:t>Text</a:t></a:r>',
    );
    const { pres, diagram, view, shape } = await fixture({
      source,
      cache: paragraph(),
    });
    const pkg = P._internalPackageOf(pres),
      bytes = new Uint8Array([4, 3, 2, 1]);
    pkg.addPart("/assets/smart/text-image.png", "image/png", bytes);
    pkg.setRels(diagram.data.part.name, {
      items: [
        {
          id: "visit",
          type: REL_TYPES.hyperlink,
          target: "https://example.org/semantic",
          targetMode: "External",
        },
        {
          id: "image",
          type: REL_TYPES.image,
          target: "text-image.png",
          targetMode: "Internal",
        },
      ],
    });
    for (let i = 0; i < 2; i++) {
      expect(materializeDiagramText(view)).toEqual([]);
      expect(P.getShapeRunHyperlink(shape, 0, 0)).toBe(
        "https://example.org/semantic",
      );
      expect(P.getParagraphBulletImageBytes(shape, 0)).toEqual(bytes);
      expect(P.getShapeClickAction(shape)).toEqual({
        kind: "url",
        url: "https://example.org/0?a=1&b=2",
      });
    }
  });

  it("handles fields, line breaks, empty paragraphs and XML indentation without changing text", async () => {
    const content =
      '<a:fld id="{00000000-0000-0000-0000-000000000001}" type="slidenum"><a:rPr i="1"/><a:t>7</a:t></a:fld>\n<a:br><a:rPr sz="2300"/></a:br>\n' +
      run(" tail");
    const { view, shape } = await fixture({
      source: paragraph("", content) + "<a:p/>",
      cache: paragraph("", content.replaceAll("\n", "\n     ")) + "<a:p/>",
    });
    const before = P.getShapeText(shape);
    expect(materializeDiagramText(view)).toEqual([]);
    expect(P.getShapeText(shape)).toBe(before);
    expect(value(child(child(paragraphs(shape)[0], "fld"), "rPr"), "i")).toBe(
      "1",
    );
    expect(value(child(child(paragraphs(shape)[0], "br"), "rPr"), "sz")).toBe(
      "2300",
    );
    expect(ppr(shape, 1)).not.toBeNull();
  });

  it.each([
    paragraph("", run("Different")),
    paragraph("", run("Te") + run("xt")),
    paragraph() + paragraph(),
  ])(
    "diagnoses stale or differently segmented text without altering its display tree",
    async (cache) => {
      const { view, shape } = await fixture({ cache });
      const before = serializeFragment(shape[SHAPE_ELEMENT]);
      expect(materializeDiagramText(view)).toEqual([
        "diagram text presentation: saved text differs from semantic text; layout reconciliation required",
      ]);
      expect(serializeFragment(shape[SHAPE_ELEMENT])).toBe(before);
    },
  );

  it("materializes interpolated palette colors into the text inheritance cascade", async () => {
    const { view, shape } = await fixture({
      palette: '<a:srgbClr val="FF0000"/><a:srgbClr val="00FF00"/>',
      method: "span",
      index: 1,
      count: 3,
    });
    expect(materializeDiagramText(view)).toEqual([]);
    expect(
      value(
        child(child(child(ppr(shape), "defRPr"), "solidFill"), "srgbClr"),
        "val",
      ),
    ).toBe("FFFF00");
  });

  it("uses the diagram owner's theme and rendering color map for interpolation", async () => {
    const { pres, view, shape } = await fixture({
      palette: '<a:schemeClr val="accent1"/><a:schemeClr val="accent3"/>',
      method: "span",
      index: 1,
      count: 3,
    });
    P.setPresentationTheme(pres, {
      accent1: "#0000FF",
      accent2: "#FF0000",
      accent3: "#00FF00",
    });
    expect(materializeDiagramText(view, { accent1: "accent2" })).toEqual([]);
    expect(P.getShapeRunFormatEffective(pres, shape, 0, 0).color).toBe(
      "#FFFF00",
    );
  });

  it("retains explicit formatting above an interpolated transparent palette", async () => {
    const source = paragraph(
      "",
      '<a:r><a:rPr><a:solidFill><a:srgbClr val="123456"/></a:solidFill></a:rPr><a:t>Text</a:t></a:r>',
    );
    const { pres, view, shape } = await fixture({
      source,
      palette:
        '<a:srgbClr val="FF0000"><a:alpha val="25000"/></a:srgbClr><a:srgbClr val="00FF00"><a:alpha val="75000"/></a:srgbClr>',
      method: "span",
      index: 1,
      count: 3,
    });
    expect(materializeDiagramText(view)).toEqual([]);
    const inherited = child(
      child(child(ppr(shape), "defRPr"), "solidFill"),
      "srgbClr",
    );
    expect(value(inherited, "val")).toBe("FFFF00");
    expect(value(child(inherited, "alpha"), "val")).toBe("50000");
    expect(P.getShapeRunFormatEffective(pres, shape, 0, 0).color).toBe(
      "#123456",
    );
  });

  it("resolves theme colors when the only text shape uses the final palette interval endpoint", async () => {
    const { pres, view, shape } = await fixture({
      palette: '<a:schemeClr val="accent1"/><a:schemeClr val="accent3"/>',
      method: "span",
      index: 1,
      count: 2,
    });
    P.setPresentationTheme(pres, {
      accent1: "#0000FF",
      accent2: "#808080",
      accent3: "#00FF00",
    });
    expect(materializeDiagramText(view, { accent1: "accent2" })).toEqual([]);
    // Native SmartArt executes hue/saturation/luminance offsets even at the
    // last entry; an achromatic start does not become the literal endpoint.
    expect(P.getShapeRunFormatEffective(pres, shape, 0, 0).color).toBe(
      "#FE0100",
    );
  });

  it("diagnoses an unresolved palette color without substituting an endpoint", async () => {
    const { view, shape } = await fixture({
      palette: '<a:schemeClr val="unknown"/><a:srgbClr val="00FF00"/>',
      method: "span",
      index: 1,
      count: 3,
    });
    expect(materializeDiagramText(view)).toEqual([
      "diagram text presentation: text palette contains an unresolved color",
    ]);
    expect(child(child(ppr(shape), "defRPr"), "solidFill")).toBeNull();
  });

  it("does not clamp semantic depths beyond the nine list-style levels", async () => {
    const { view, shape } = await fixture({
      nodeDepth: 9,
      diagramList: '<a:defPPr algn="ctr"/><a:lvl9pPr algn="r"/>',
    });
    expect(materializeDiagramText(view)).toEqual([]);
    expect(value(ppr(shape), "algn")).toBe("ctr");
  });

  it("maps ordered contributors to their own node-depth defaults", async () => {
    const { pres, frame, diagram } = await fixture({
      source: paragraph("", run("First")),
      cache: paragraph("", run("First")) + paragraph("", run("Second")),
      diagramList:
        '<a:lvl1pPr><a:defRPr b="1"/></a:lvl1pPr><a:lvl2pPr><a:defRPr i="1"/></a:lvl2pPr>',
    });
    const xml = new TextDecoder().decode(diagram.data.part.data);
    diagram.data.part.data = new TextEncoder().encode(
      xml
        .replace(
          "</dgm:ptLst>",
          `<dgm:pt modelId="second"><dgm:t>${body(paragraph("", run("Second")))}</dgm:t></dgm:pt></dgm:ptLst>`,
        )
        .replace(
          "</dgm:cxnLst>",
          '<dgm:cxn modelId="child" srcId="node-0" destId="second"/><dgm:cxn modelId="second-pres" srcId="second" destId="presentation" type="presOf" destOrd="1"/></dgm:cxnLst>',
        ),
    );
    const view = readDiagramDrawing(frame),
      shape = P.getGroupChildren(view.root)[0];
    expect(materializeDiagramText(view)).toEqual([]);
    expect(value(child(ppr(shape, 0), "defRPr"), "b")).toBe("1");
    expect(value(child(ppr(shape, 1), "defRPr"), "i")).toBe("1");
    expect(value(child(ppr(shape, 1), "defRPr"), "b")).toBeNull();
    expect(P.getShapeRunFormatEffective(pres, shape, 1, 0).italic).toBe(true);
  });

  it("leaves source parts, original shape handles, export and reopened semantic diagrams intact", async () => {
    const { pres, frame, view, shape } = await fixture({
      diagramList: '<a:defPPr algn="ctr"><a:defRPr b="1"/></a:defPPr>',
      palette: '<a:srgbClr val="FF0000"/><a:srgbClr val="00FF00"/>',
      method: "span",
      index: 1,
      count: 3,
    });
    const pkg = P._internalPackageOf(pres),
      before = pkg.parts.map((p) => [p.name, p.data.slice()]);
    const original = serializeFragment(frame[SHAPE_ELEMENT]);
    expect(materializeDiagramText(view)).toEqual([]);
    expect(value(ppr(shape), "algn")).toBe("ctr");
    expect(serializeFragment(frame[SHAPE_ELEMENT])).toBe(original);
    expect(pkg.parts.map((p) => [p.name, p.data])).toEqual(before);
    const reopened = await P.loadPresentation(await P.savePresentation(pres));
    expect(
      P._internalPackageOf(reopened).parts.map((p) => [p.name, p.data]),
    ).toEqual(before);
    const reread = readDiagramDrawing(frame);
    expect(ppr(P.getGroupChildren(reread.root)[0])).toBeNull();
  });
});
