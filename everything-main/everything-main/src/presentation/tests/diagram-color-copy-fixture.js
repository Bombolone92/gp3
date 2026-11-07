import { P } from "../src/model.js";
import { renderedDiagramDeck } from "./diagram-render-fixture.js";
import { NS } from "../lib/pptx/src/internal/xml/index.ts";

export const encode = (text) => new TextEncoder().encode(text);
export const decode = (part) => new TextDecoder().decode(part.data);
export const scheme = (token = "accent1") =>
  `<a:schemeClr val="${token}"><a:shade val="68000"/><a:tint val="23000"/><a:alpha val="43000"/></a:schemeClr>`;
export const rgb = (value = "4179B2") =>
  scheme()
    .replace("schemeClr", "srgbClr")
    .replace('val="accent1"', `val="${value}"`)
    .replace("/a:schemeClr", "/a:srgbClr");
export const namespaces = `xmlns:dgm="${NS.diagram}" xmlns:dsp="${NS.diagramDrawing}" xmlns:a="${NS.dml}"`;

export async function sourceDeck() {
  const { pres, frame, diagram } = await renderedDiagramDeck();
  P.setPresentationTheme(pres, {
    dark1: "#213141",
    light1: "#EFF1F3",
    accent1: "#4179B2",
    accent2: "#8329A5",
  });
  diagram.colors.part.data = encode(
    `<dgm:colorsDef ${namespaces}><dgm:styleLbl name="text"><dgm:txFillClrLst meth="cycle" hueDir="cw">${scheme()}${scheme("accent2")}</dgm:txFillClrLst><dgm:fillClrLst meth="span">${scheme()}${scheme("accent2")}</dgm:fillClrLst></dgm:styleLbl></dgm:colorsDef>`,
  );
  diagram.drawing.part.data = encode(
    decode(diagram.drawing.part).replace('<a:srgbClr val="123456"/>', scheme()),
  );
  diagram.data.part.data = encode(
    decode(diagram.data.part).replace(
      'presName="root"',
      'presName="root" presStyleIdx="1" presStyleCnt="3"',
    ),
  );
  return { pres, frame, diagram };
}
