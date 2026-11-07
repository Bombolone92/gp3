import { P, createDeck } from "../src/model.js";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export async function presetGeometryFixture() {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0];
  P.setSlideBackground(slide, "#FFFFFF");
  for (const [i, preset] of [
    "rightArrow",
    "diamond",
    "cube",
    "bevel",
    "ellipseRibbon",
    "circularArrow",
  ].entries()) {
    const sh = P.addSlideTextBox(slide, {
      x: P.inches(0.5 + (i % 3) * 4.2),
      y: P.inches(0.6 + Math.floor(i / 3) * 3.2),
      w: P.inches(3.6),
      h: P.inches(2.5),
      text: `${preset} adjustable text bounds`,
    });
    P.setShapeFill(sh, "#4080C0");
    P.setShapeStroke(sh, { color: "#203060", widthEmu: P.pt(2) });
    P.setShapeTextFormat(sh, { font: "Arial", size: 18 });
    P.setShapeTextAnchor(sh, "top");
    P.setShapeTextAutoFit(sh, "none");
  }
  const files = unzipSync(await P.savePresentation(p)),
    part = P.getSlidePartName(slide).slice(1);
  let i = 0;
  const presets = [
    "rightArrow",
    "diamond",
    "cube",
    "bevel",
    "ellipseRibbon",
    "circularArrow",
  ];
  files[part] = strToU8(
    strFromU8(files[part])
      .replace(/prst="rect"/g, () => `prst="${presets[i++]}"`)
      .replace(
        '<a:prstGeom prst="rightArrow"><a:avLst/>',
        '<a:prstGeom prst="rightArrow"><a:avLst><a:gd name="adj1" fmla="val 25000"/><a:gd name="adj2" fmla="*/ 50000 3 2"/></a:avLst>',
      ),
  );
  return zipSync(files);
}
