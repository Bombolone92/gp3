import { P } from "../src/model.js";
import { diagramSpacerDeck } from "./diagram-spacer-fixture.js";
import { renderedDiagramDeck } from "./diagram-render-fixture.js";
import { diagramImage } from "./diagram-copy-fixture.js";
import { themeForShape } from "../lib/pptx/src/api/fn/shape-theme.ts";
import {
  NS,
  parseXml,
  serializeXml,
  firstChildElement,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { REL_TYPES } from "../lib/pptx/src/internal/presentationml/index.ts";
export const encode = (s) => new TextEncoder().encode(s);
export const decode = (p) => new TextDecoder().decode(p.data);
export const child = (e, n, ns = NS.dml) =>
  e && firstChildElement(e, qname("", n, ns));
export const xml = (text) =>
  parseXml(
    `<a:holder xmlns:a="${NS.dml}" xmlns:r="${NS.officeDocRels}">${text}</a:holder>`,
  ).root.children.filter((c) => c.kind === "element");
export const refs = ({ fill = 2, line = 2, effect = 2 } = {}) =>
  `<a:lnRef idx="${line}"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="${fill}"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="${effect}"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"/>`;
export async function diagramMatrixDeck({
  cached = false,
  image = false,
  fill = 2,
} = {}) {
  const base = cached ? await renderedDiagramDeck() : await diagramSpacerDeck(),
    p = base.p ?? base.pres,
    { frame, diagram } = base;
  P.setPresentationTheme(p, {
    accent1: "#6C2B8E",
    accent2: "#23895A",
    accent3: "#D26428",
  });
  const pkg = P._internalPackageOf(p),
    theme = themeForShape(frame),
    themePart = pkg.getPart(theme.partName),
    doc = parseXml(decode(themePart)),
    matrix = child(child(doc.root, "themeElements"), "fmtScheme");
  const replace = (name, content) => {
    const list = child(matrix, name),
      entries = list.children.filter((c) => c.kind === "element");
    list.children[list.children.indexOf(entries[1])] = xml(content)[0];
  };
  replace(
    "lnStyleLst",
    '<a:ln w="90000" cap="rnd"><a:solidFill><a:schemeClr val="accent2"><a:shade val="70000"/><a:alpha val="73000"/></a:schemeClr></a:solidFill><a:prstDash val="dashDot"/><a:round/><a:tailEnd type="triangle"/></a:ln>',
  );
  replace(
    "fillStyleLst",
    image
      ? '<a:blipFill><a:blip r:embed="source-pixel"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>'
      : '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="23000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="accent2"><a:alpha val="63000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="1"/></a:gradFill>',
  );
  replace(
    "effectStyleLst",
    '<a:effectStyle><a:effectLst><a:outerShdw blurRad="54000" dist="36000" dir="2700000" algn="ctr"><a:schemeClr val="accent3"><a:alpha val="32000"/></a:schemeClr></a:outerShdw></a:effectLst></a:effectStyle>',
  );
  replace(
    "bgFillStyleLst",
    '<a:pattFill prst="pct25"><a:fgClr><a:schemeClr val="accent2"/></a:fgClr><a:bgClr><a:schemeClr val="phClr"/></a:bgClr></a:pattFill>',
  );
  themePart.data = encode(serializeXml(doc));
  if (image) {
    pkg.addPart("/assets/theme-pixel.png", "image/png", diagramImage.slice());
    const rels = pkg.getRels(theme.partName) ?? { items: [] };
    rels.items.push({
      id: "source-pixel",
      type: REL_TYPES.image,
      target: "/assets/theme-pixel.png",
      targetMode: "Internal",
    });
    pkg.setRels(theme.partName, rels);
  }
  const labels = ["node1", "text"];
  diagram.quickStyle.part.data = encode(
    `<d:styleDef xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}">${labels.map((name) => `<d:styleLbl name="${name}"><d:style>${refs({ fill })}</d:style></d:styleLbl>`).join("")}</d:styleDef>`,
  );
  diagram.colors.part.data = encode(
    `<d:colorsDef xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}">${labels.map((name) => `<d:styleLbl name="${name}"><d:fillClrLst meth="cycle"><a:schemeClr val="accent1"/><a:schemeClr val="accent3"/></d:fillClrLst><d:linClrLst meth="repeat"><a:schemeClr val="accent1"/></d:linClrLst></d:styleLbl>`).join("")}</d:colorsDef>`,
  );
  if (cached) {
    const data = parseXml(decode(diagram.data.part)),
      points = child(data.root, "ptLst", NS.diagram),
      connections = child(data.root, "cxnLst", NS.diagram);
    points.children.unshift(
      parseXml(`<d:pt xmlns:d="${NS.diagram}" modelId="doc" type="doc"/>`).root,
    );
    connections.children.push(
      parseXml(
        `<d:cxn xmlns:d="${NS.diagram}" modelId="doc-edge" srcId="doc" destId="node-0" srcOrd="0" destOrd="0"/>`,
      ).root,
    );
    diagram.data.part.data = encode(serializeXml(data));
    const drawing = parseXml(decode(diagram.drawing.part)),
      tree = child(drawing.root, "spTree", NS.diagramDrawing),
      shape = child(tree, "sp", NS.diagramDrawing),
      properties = child(shape, "spPr", NS.diagramDrawing);
    properties.children = properties.children.filter(
      (c) =>
        c.kind !== "element" || ["xfrm", "prstGeom"].includes(c.name.localName),
    );
    const style = parseXml(
      `<dsp:style xmlns:dsp="${NS.diagramDrawing}" xmlns:a="${NS.dml}">${refs({ fill })}</dsp:style>`,
    ).root;
    shape.children.splice(shape.children.indexOf(properties) + 1, 0, style);
    diagram.drawing.part.data = encode(serializeXml(drawing));
  } else {
    const data = parseXml(decode(diagram.data.part)),
      points = child(data.root, "ptLst", NS.diagram);
    for (const point of points.children.filter((c) => c.kind === "element"))
      point.children = point.children.filter(
        (c) => c.kind !== "element" || c.name.localName !== "spPr",
      );
    diagram.data.part.data = encode(serializeXml(data));
  }
  return { p, frame, diagram, theme: themeForShape(frame) };
}
