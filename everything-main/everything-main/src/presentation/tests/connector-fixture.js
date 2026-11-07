import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck } from "../src/model.js";

export async function connectorDeck(preset = "line", outline = "none") {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  P.setSlideBackground(s, "#FFFFFF");
  const shape = P.addSlideLine(s, {
    from: { x: P.inches(1), y: P.inches(1) },
    to: { x: P.inches(5), y: P.inches(3) },
    color: "#1267B2",
    widthEmu: P.pt(3),
  });
  P.setShapeStrokeArrow(shape, "head", { type: "triangle" });
  P.setShapeStrokeArrow(shape, "tail", { type: "oval" });
  P.setShapeStrokeDash(shape, "dash");
  if (outline === "none") P.setShapeNoStroke(shape);
  if (outline === "inherit") P.clearShapeStroke(shape);
  const files = unzipSync(await P.savePresentation(p));
  const name = P.getSlidePartName(s).slice(1);
  files[name] = strToU8(
    strFromU8(files[name]).replace('prst="line"', `prst="${preset}"`),
  );
  return zipSync(files);
}
