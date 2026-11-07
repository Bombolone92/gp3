import { P, createDeck } from "../src/model.js";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export const guideControlSizes = [
  [2.7, 1.4],
  [1.3, 2.3],
  [2, 2],
  [2.314159, 1.271828],
];
export const guideControlGeometry = (chained = false) =>
  `<a:custGeom>${
    chained
      ? '<a:avLst><a:gd name="wide" fmla="*/ wd32 3 1"/></a:avLst><a:gdLst><a:gd name="sum" fmla="+- ssd16 ssd32 0"/></a:gdLst>'
      : "<a:avLst/><a:gdLst/>"
  }<a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/><a:pathLst><a:path fill="none">${
    chained
      ? '<a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="wide" y="sum"/></a:lnTo><a:lnTo><a:pt x="ssd32" y="ssd16"/></a:lnTo>'
      : '<a:moveTo><a:pt x="wd32" y="ssd16"/></a:moveTo><a:lnTo><a:pt x="ssd32" y="wd32"/></a:lnTo><a:lnTo><a:pt x="r" y="b"/></a:lnTo>'
  }</a:path></a:pathLst></a:custGeom>`;

export async function geometryGuidesFixture() {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < guideControlSizes.length; col++) {
      const [w, h] = guideControlSizes[col],
        shape = P.addSlideShape(slide, {
          preset: "rect",
          x: P.inches(0.5 + col * 3.1),
          y: P.inches(0.5 + row * 3.3),
          w: P.inches(w),
          h: P.inches(h),
        });
      P.setShapeNoFill(shape);
      P.setShapeStroke(shape, { color: "#1267B2", widthEmu: P.pt(3) });
    }
  }
  const files = unzipSync(await P.savePresentation(p)),
    part = P.getSlidePartName(slide).slice(1);
  let index = 0;
  files[part] = strToU8(
    strFromU8(files[part]).replace(/<a:prstGeom\b[\s\S]*?<\/a:prstGeom>/g, () =>
      guideControlGeometry(index++ >= guideControlSizes.length),
    ),
  );
  return zipSync(files);
}
