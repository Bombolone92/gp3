import { P } from "../src/model.js";
import { diagramDeck } from "./diagram-copy-fixture.js";
import {
  readShapeDiagram,
  isDiagramShape,
} from "../lib/pptx/src/api/fn/diagram-read.ts";
import { NS } from "../lib/pptx/src/internal/xml/index.ts";

const xfrm = (
  name,
  {
    x = 0,
    y = 0,
    w = 914400,
    h = 914400,
    rotation = 0,
    flipH = false,
    flipV = false,
  } = {},
) =>
  `<${name} rot="${rotation * 60000}" flipH="${flipH ? 1 : 0}" flipV="${flipV ? 1 : 0}"><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></${name}>`;
export async function renderedDiagramDeck({
  geometry = {},
  textTransform = null,
  preset = "rect",
  image = false,
  nested = false,
} = {}) {
  const pres = await diagramDeck({ count: 1 }),
    slide = P.getSlides(pres)[0],
    frame = P.getSlideShapes(slide).find(isDiagramShape),
    diagram = readShapeDiagram(frame);
  P.setShapePosition(frame, P.inches(1), P.inches(2));
  P.setShapeSize(frame, P.inches(6), P.inches(4));
  const edit = (part, fn) => {
    part.data = new TextEncoder().encode(
      fn(new TextDecoder().decode(part.data)),
    );
  };
  edit(diagram.data.part, (xml) =>
    xml
      .replace("Semantic 0", "Rendered 0")
      .replace(
        '<dgm:pt modelId="node-0">',
        '<dgm:pt modelId="node-0"><dgm:prSet presName="root"/>',
      ),
  );
  edit(diagram.layout.part, (xml) =>
    xml.replace('name="root"', 'name="root" styleLbl="text"'),
  );
  diagram.colors.part.data = new TextEncoder().encode(
    `<dgm:colorsDef xmlns:dgm="${NS.diagram}" xmlns:a="${NS.dml}"><dgm:styleLbl name="text"><dgm:txFillClrLst meth="repeat"><a:srgbClr val="A12BCD"/></dgm:txFillClrLst></dgm:styleLbl></dgm:colorsDef>`,
  );
  edit(diagram.drawing.part, (xml) => {
    let output = xml
      .replace(
        "<dsp:spPr>",
        `<dsp:spPr>${xfrm("a:xfrm", geometry)}<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>`,
      )
      .replace(
        "<a:bodyPr/>",
        '<a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0" anchor="t"/>',
      )
      .replace("<a:p>", '<a:p><a:pPr algn="l"><a:buNone/></a:pPr>')
      .replace("<a:r>", '<a:r><a:rPr sz="1200"/>');
    if (!image)
      output = output.replace(
        /<a:blipFill>[\s\S]*?<\/a:blipFill>/,
        '<a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:ln><a:noFill/></a:ln>',
      );
    if (textTransform)
      output = output.replace(
        "</dsp:sp>",
        xfrm("dsp:txXfrm", textTransform) + "</dsp:sp>",
      );
    if (nested) {
      const sp = output.match(/<dsp:sp modelId[\s\S]*?<\/dsp:sp>/)[0];
      output = output.replace(
        sp,
        `<dsp:grpSp><dsp:nvGrpSpPr><dsp:cNvPr id="0" name="Nested"/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr><a:xfrm><a:off x="914400" y="0"/><a:ext cx="1828800" cy="1828800"/><a:chOff x="0" y="0"/><a:chExt cx="914400" cy="914400"/></a:xfrm></dsp:grpSpPr>${sp}</dsp:grpSp>`,
      );
    }
    return output;
  });
  return { pres, frame, diagram };
}
