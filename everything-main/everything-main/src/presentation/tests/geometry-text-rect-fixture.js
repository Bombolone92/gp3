import { P, createDeck } from "../src/model.js";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

// Text coordinates are in shape EMU, independently of this path's 100 × 100 grid.
export const textRectGeometry = (
  rect = '<a:rect l="left" t="hd4" r="right" b="b"/>',
) =>
  `<a:custGeom><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst><a:gdLst><a:gd name="left" fmla="*/ w adj 100000"/><a:gd name="right" fmla="+- w 0 left"/></a:gdLst>${rect}<a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:lnTo><a:pt x="100" y="100"/></a:lnTo><a:lnTo><a:pt x="0" y="100"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>`;

export async function geometryTextRectFixture() {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0];
  for (let i = 0; i < 3; i++) {
    const sh = P.addSlideTextBox(slide, {
      text: "Geometry text rectangle wraps these words inside its authored bounds.",
      x: P.inches(0.5 + i * 4.2),
      y: P.inches(1),
      w: P.inches(3.5),
      h: P.inches(3),
    });
    P.setShapeFill(sh, "#F0F5FF");
    P.setShapeStroke(sh, { color: "#1267B2", widthEmu: P.pt(2) });
    P.setShapeTextFormat(sh, { font: "Arial", size: 20 });
    P.setShapeTextAnchor(sh, "top");
    P.setParagraphAlignment(sh, 0, "left");
    P.setShapeTextMargins(sh, {
      left: P.inches(0.1),
      top: P.inches(0.15),
      right: P.inches(0.2),
      bottom: P.inches(0.05),
    });
    P.setShapeTextAutoFit(sh, "none");
    P.setShapeTextWrap(sh, "square");
  }
  const files = unzipSync(await P.savePresentation(p)),
    part = P.getSlidePartName(slide).slice(1);
  const rects = [
    undefined,
    '<a:rect l="-91440" t="hd4" r="r" b="b"/>',
    '<a:rect l="l" t="t" r="r" b="b"/>',
  ];
  let i = 0;
  files[part] = strToU8(
    strFromU8(files[part]).replace(/<a:prstGeom\b[\s\S]*?<\/a:prstGeom>/g, () =>
      textRectGeometry(rects[i++]),
    ),
  );
  return zipSync(files);
}
