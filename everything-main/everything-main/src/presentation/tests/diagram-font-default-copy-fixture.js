import { P } from "../src/model.js";
import { diagramSpacerDeck } from "./diagram-spacer-fixture.js";
import { sourceFonts, encode, decode } from "./diagram-font-copy-fixture.js";
import { NS } from "../lib/pptx/src/internal/xml/index.ts";
import { readShapeDiagram } from "../lib/pptx/src/api/fn/diagram-read.ts";

// Owned complete semantic tree and independently authored saved projection.
// Quick font references are deliberately the only font declarations.
export async function implicitFontDeck({
  cached = false,
  indices = ["major", "minor", "major"],
  savedIndex,
} = {}) {
  const { p, frame, diagram } = await diagramSpacerDeck();
  P.setPresentationFonts(p, sourceFonts);
  diagram.layout.part.data = encode(
    decode(diagram.layout.part).replace(
      /name="box(\d)"/g,
      (_, i) => `name="box${i}" styleLbl="font${i}"`,
    ),
  );
  diagram.quickStyle.part.data = encode(
    `<d:styleDef xmlns:d="${NS.diagram}" xmlns:a="${NS.dml}">${indices.map((index, i) => `<d:styleLbl name="font${i}">${index === "empty" ? "" : `<d:style><a:fontRef idx="${index}"/></d:style>`}</d:styleLbl>`).join("")}</d:styleDef>`,
  );
  if (cached) {
    diagram.data.part.data = encode(
      decode(diagram.data.part)
        .replace(
          "</d:ptLst>",
          indices
            .map(
              (_, i) =>
                `<d:pt modelId="pres${i}" type="pres"><d:prSet presName="box${i}" presStyleLbl="font${i}"/></d:pt>`,
            )
            .join("") + "</d:ptLst>",
        )
        .replace(
          "</d:cxnLst>",
          indices
            .map(
              (_, i) =>
                `<d:cxn modelId="text${i}" type="presOf" srcId="node${i}" destId="pres${i}" srcOrd="0" destOrd="0"/>`,
            )
            .join("") + "</d:cxnLst>",
        )
        .replace(
          "</d:dataModel>",
          `<d:extLst><a:ext uri="${NS.diagramDrawing}"><dsp:dataModelExt xmlns:dsp="${NS.diagramDrawing}" relId="savedDrawing0"/></a:ext></d:extLst></d:dataModel>`,
        ),
    );
    diagram.drawing.part.data = encode(
      `<dsp:drawing xmlns:dsp="${NS.diagramDrawing}" xmlns:a="${NS.dml}"><dsp:spTree><dsp:nvGrpSpPr/><dsp:grpSpPr/>${["West", "Central", "East"].map((text, i) => `<dsp:sp modelId="pres${i}"><dsp:nvSpPr><dsp:cNvPr id="${i + 1}" name="Saved ${i}"/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="${i * 600000}" y="0"/><a:ext cx="600000" cy="600000"/></a:xfrm><a:prstGeom prst="rect"/><a:noFill/><a:ln><a:noFill/></a:ln></dsp:spPr>${savedIndex ? `<dsp:style><a:fontRef idx="${savedIndex}"/></dsp:style>` : ""}<dsp:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1000"/><a:t>${text}</a:t></a:r></a:p></dsp:txBody></dsp:sp>`).join("")}</dsp:spTree></dsp:drawing>`,
    );
  }
  return { p, frame, diagram: readShapeDiagram(frame) };
}
