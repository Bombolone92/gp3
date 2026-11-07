import { P, createDeck } from "../src/model.js";
import { NS } from "../lib/pptx/src/internal/xml/index.ts";
import { REL_TYPES } from "../lib/pptx/src/internal/presentationml/index.ts";
import { SLIDE_PART_NAME } from "../lib/pptx/src/api/_internal-symbols.ts";

export const diagramImage = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGMwSJjwH4QZYAwARzQIfaOzYgMAAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);
const diagramType = (name) =>
  `application/vnd.openxmlformats-officedocument.drawingml.diagram${name}+xml`;

export async function diagramDeck({ count = 2, group = false } = {}) {
  const pres = createDeck("blank"),
    pkg = P._internalPackageOf(pres),
    slide = P.getSlides(pres)[0],
    owner = slide[SLIDE_PART_NAME],
    part = pkg.getPart(owner),
    rels = pkg.getRels(owner);
  const put = (name, xml, type = "application/xml") =>
    pkg.addPart(name, type, new TextEncoder().encode(xml));
  const rel = (id, type, target, targetMode = "Internal") => ({
    id,
    type,
    target,
    targetMode,
  });
  put(
    "/assets/smart/shared-style.xml",
    `<dgm:styleDef xmlns:dgm="${NS.diagram}" uniqueId="custom-style"/>`,
    diagramType("Style"),
  );
  pkg.addPart("/assets/smart/pixel.dat", "image/png", diagramImage.slice());
  const frames = [];
  for (let i = 0; i < count; i++) {
    const ids = {
      dm: `model${i}`,
      lo: `layout${i}`,
      qs: `style${i}`,
      cs: `color${i}`,
      drawing: `savedDrawing${i}`,
    };
    const prefix = `/assets/smart/item${i}`;
    put(
      `${prefix}-data.xml`,
      `<dgm:dataModel xmlns:dgm="${NS.diagram}" xmlns:a="${NS.dml}" xmlns:cache="${NS.diagramDrawing}"><dgm:ptLst><dgm:pt modelId="node-${i}"><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Semantic ${i}</a:t></a:r></a:p></dgm:t></dgm:pt></dgm:ptLst><dgm:cxnLst/><dgm:bg/><dgm:whole/><dgm:extLst><a:ext uri="${NS.diagramDrawing}"><cache:dataModelExt relId="${ids.drawing}" minVer="${NS.diagram}"/></a:ext><a:ext uri="urn:other"><other:dataModelExt xmlns:other="urn:other" relId="${ids.drawing}"/></a:ext></dgm:extLst></dgm:dataModel>`,
      diagramType("Data"),
    );
    put(
      `${prefix}-layout.xml`,
      `<dgm:layoutDef xmlns:dgm="${NS.diagram}" uniqueId="layout-${i}"><dgm:layoutNode name="root"><dgm:alg type="tx"/></dgm:layoutNode></dgm:layoutDef>`,
      diagramType("Layout"),
    );
    put(
      `${prefix}-color.xml`,
      `<dgm:colorsDef xmlns:dgm="${NS.diagram}" uniqueId="colors-${i}"/>`,
      diagramType("Colors"),
    );
    put(
      `${prefix}-drawing.xml`,
      `<dsp:drawing xmlns:dsp="${NS.diagramDrawing}" xmlns:a="${NS.dml}" xmlns:r="${NS.officeDocRels}"><dsp:spTree><dsp:nvGrpSpPr/><dsp:grpSpPr/><dsp:sp modelId="node-${i}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""><a:hlinkClick r:id="visit"/></dsp:cNvPr><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:blipFill><a:blip r:embed="image"/></a:blipFill></dsp:spPr><dsp:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Rendered ${i}</a:t></a:r></a:p></dsp:txBody></dsp:sp></dsp:spTree></dsp:drawing>`,
      "application/vnd.ms-office.drawingml.diagramDrawing+xml",
    );
    pkg.setRels(`${prefix}-drawing.xml`, {
      items: [
        rel("image", REL_TYPES.image, "pixel.dat"),
        rel(
          "visit",
          REL_TYPES.hyperlink,
          `https://example.org/${i}?a=1&b=2`,
          "External",
        ),
      ],
    });
    for (const [key, type, target] of [
      ["dm", REL_TYPES.diagramData, `${prefix}-data.xml`],
      ["lo", REL_TYPES.diagramLayout, `${prefix}-layout.xml`],
      ["qs", REL_TYPES.diagramQuickStyle, "/assets/smart/shared-style.xml"],
      ["cs", REL_TYPES.diagramColors, `${prefix}-color.xml`],
      ["drawing", REL_TYPES.diagramDrawing, `${prefix}-drawing.xml`],
    ])
      rels.items.push(rel(ids[key], type, target));
    frames.push(
      `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${20 + i}" name="Diagram ${i}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${100 + i * 1000000}" y="200"/><a:ext cx="900000" cy="600000"/></p:xfrm><a:graphic><a:graphicData uri="${NS.diagram}"><dgm:relIds xmlns:dgm="${NS.diagram}" xmlns:rel="${NS.officeDocRels}" rel:dm="${ids.dm}" rel:lo="${ids.lo}" rel:qs="${ids.qs}" rel:cs="${ids.cs}"/></a:graphicData></a:graphic></p:graphicFrame>`,
    );
  }
  let body = frames.join("");
  if (group)
    body = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="Diagram group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${body}</p:grpSp>`;
  part.data = new TextEncoder().encode(
    new TextDecoder()
      .decode(part.data)
      .replace("</p:spTree>", `${body}</p:spTree>`),
  );
  pkg.setRels(owner, rels);
  return P.loadPresentation(await P.savePresentation(pres));
}
