import { P, createDeck } from "../src/model.js";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import native from "./data/geometry-arc-native.json" with { type: "json" };

// Owned custom-path controls printed natively before changing conversion.
export async function geometryArcFixture(set = "ordinary") {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0],
    specs = native.sets[set];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i],
      shape = P.addSlideShape(slide, {
        preset: "rect",
        x: P.inches(0.5 + (i % 4) * 3.1),
        y: P.inches(0.65 + Math.floor(i / 4) * 3.25),
        w: P.inches(spec.w),
        h: P.inches(spec.h),
      });
    P.setShapeNoFill(shape);
    P.setShapeStroke(shape, { color: "#1267B2", widthEmu: P.pt(3) });
  }
  const files = unzipSync(await P.savePresentation(p)),
    part = P.getSlidePartName(slide).slice(1);
  let i = 0;
  files[part] = strToU8(
    strFromU8(files[part]).replace(
      /<a:prstGeom\b[\s\S]*?<\/a:prstGeom>/g,
      () => {
        const spec = specs[i++];
        return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/><a:pathLst><a:path fill="none"><a:moveTo><a:pt x="hc" y="vc"/></a:moveTo><a:arcTo wR="${spec.wR}" hR="${spec.hR}" stAng="${spec.start * 60000}" swAng="${spec.sweep * 60000}"/>${set === "ordinary" ? "" : '<a:lnTo><a:pt x="r" y="b"/></a:lnTo>'}</a:path></a:pathLst></a:custGeom>`;
      },
    ),
  );
  return zipSync(files);
}
