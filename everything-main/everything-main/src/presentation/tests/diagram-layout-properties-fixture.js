import { P } from "../src/model.js";
import { diagramDeck } from "./diagram-copy-fixture.js";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";
import { NS } from "../lib/pptx/src/internal/xml/index.ts";

export const encode = (text) => new TextEncoder().encode(text);
export const decode = (part) => new TextDecoder().decode(part.data);
export const layoutPropertyExtension = (xml, attrs = "") =>
  `<d:extLst><a:ext uri="urn:owned-layout-properties"><s:spPr ${attrs}>${xml}</s:spPr></a:ext></d:extLst>`;
export const layoutProperties = [
  '<a:ln w="72000"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:prstDash val="dash"/><a:tailEnd type="triangle" w="lg" len="lg"/></a:ln>',
  '<a:ln w="54000"><a:solidFill><a:srgbClr val="2475BD"/></a:solidFill><a:headEnd type="diamond" w="med" len="med"/></a:ln>',
  '<a:solidFill><a:srgbClr val="F2BE47"/></a:solidFill><a:ln w="36000"><a:solidFill><a:srgbClr val="24563A"/></a:solidFill><a:prstDash val="dot"/><a:round/></a:ln>',
];

// Owned semantic controls, with no corpus XML or saved drawing. Shape formatting
// is split between theme paint, layout defaults and point customization.
export async function diagramLayoutPropertiesDeck({
  properties = layoutProperties,
  direct = [],
  hidden = false,
} = {}) {
  const p = await diagramDeck({ count: 1 }),
    frame = P.getSlideShapes(P.getSlides(p)[0])[0],
    diagram = readShapeDiagram(frame);
  P.setPresentationTheme(p, { accent1: "#D0263E" });
  const entries = [
    { name: "horizontal", type: "line", l: 5, t: 15, w: 90, h: 0 },
    { name: "vertical", type: "line", l: 105, t: 10, w: 0, h: 50 },
    { name: "box", type: "rect", l: 20, t: 35, w: 60, h: 25 },
  ];
  diagram.data.part.data = encode(
    `<d:dataModel xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}"><d:ptLst><d:pt modelId="doc" type="doc"/>${entries.map((e, i) => `<d:pt modelId="n${i}"><d:spPr>${direct[i] ?? ""}</d:spPr></d:pt>`).join("")}</d:ptLst><d:cxnLst>${entries.map((e, i) => `<d:cxn modelId="edge${i}" srcId="doc" destId="n${i}" srcOrd="${i}" destOrd="0"/>`).join("")}</d:cxnLst><d:bg/><d:whole/></d:dataModel>`,
  );
  diagram.layout.part.data = encode(
    `<d:layoutDef xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}" xmlns:s="${NS.dgm1612}"><d:layoutNode name="root"><d:alg type="composite"/>${entries.map((e, i) => `<d:layoutNode name="${e.name}"><d:alg type="sp"/><d:shape type="${e.type}"${hidden ? ' hideGeom="true"' : ""}>${properties[i] === null ? "" : layoutPropertyExtension(properties[i] ?? "")}</d:shape><d:presOf axis="ch" st="${i + 1}" cnt="1"/><d:constrLst>${["l", "t", "w", "h"].map((k) => `<d:constr type="${k}" val="${e[k]}"/>`).join("")}</d:constrLst></d:layoutNode>`).join("")}</d:layoutNode></d:layoutDef>`,
  );
  P.setShapeBounds(frame, {
    x: 10 * 36000,
    y: 10 * 36000,
    w: 120 * 36000,
    h: 80 * 36000,
  });
  return { p, frame, diagram };
}
