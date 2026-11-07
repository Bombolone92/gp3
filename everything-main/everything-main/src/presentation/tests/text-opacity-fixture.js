import { P, createDeck } from "../src/model.js";
export async function textOpacityDeck(opacity = 0.4) {
  const pres = createDeck("blank"),
    slide = P.getSlides(pres)[0];
  P.setSlideBackground(slide, "#FFFFFF");
  const shape = P.addSlideTextBox(slide, {
    x: P.inches(1),
    y: P.inches(1),
    w: P.inches(8),
    h: P.inches(2),
    text: "Transparent text",
  });
  P.setShapeTextFormat(shape, {
    font: "Arial",
    size: 48,
    color: "#CC2244",
    colorOpacity: opacity,
  });
  return P.savePresentation(pres);
}
