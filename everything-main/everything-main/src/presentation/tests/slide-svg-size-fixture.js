import { P, createDeck } from "../src/model.js";

export const slidePixelSizes = [
  [1280, 720],
  [960, 720],
  [720, 960],
  [960, 960],
  [1000, 625],
];

export function slideSvgSizeDeck(width, height) {
  const pres = createDeck("blank"),
    slide = P.getSlides(pres)[0];
  P.setSlideSize(pres, {
    width: P.emu(Math.round(width * 9525)),
    height: P.emu(Math.round(height * 9525)),
    type: "custom",
  });
  P.setSlideBackground(slide, "#FFFFFF");
  const shape = P.addSlideShape(slide, {
    x: P.emu(Math.round((width * 9525) / 4)),
    y: P.emu(Math.round((height * 9525) / 4)),
    w: P.emu(Math.round((width * 9525) / 2)),
    h: P.emu(Math.round((height * 9525) / 2)),
    preset: "rect",
  });
  P.setShapeFill(shape, "#1267B2");
  P.setShapeNoStroke(shape);
  return { pres, slide, shape };
}
