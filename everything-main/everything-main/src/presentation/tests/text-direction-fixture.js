import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck } from "../src/model.js";

// Independently authored direction at all three levels. Keeping run and
// paragraph properties explicit isolates text-body inheritance in previews.
export async function fixture({
  slideDirection = null,
  layoutDirection = "vert270",
  masterDirection = "vert",
} = {}) {
  const pres = createDeck("blank"),
    slide = P.getSlides(pres)[0];
  const shape = P.addSlideTextBox(slide, {
    x: P.inches(0.9),
    y: P.inches(0.8),
    w: P.inches(7.3),
    h: P.inches(3.1),
    text: "Direction override\nAnother line",
  });
  P.setShapeTextFormat(shape, { font: "Arial", size: 29, color: "#123456" });
  P.setParagraphBullet(shape, 0, "none");
  P.setParagraphBullet(shape, 1, "none");
  const files = unzipSync(await P.savePresentation(pres));
  const slideName = P.getSlidePartName(slide).slice(1),
    layoutName = P.getSlideLayoutPartName(P.getSlideLayout(slide)).slice(1),
    masterName = P.getSlideMasterPartName(slide).slice(1);
  const xml = strFromU8(files[slideName]);
  const original = xml.match(/<p:sp\b[\s\S]*?<\/p:sp>/)[0];
  const slot = original.replace(
    /<p:nvPr\s*\/>/,
    '<p:nvPr><p:ph type="body" idx="42"/></p:nvPr>',
  );
  const withDirection = (direction) =>
    slot.replace(
      /<a:bodyPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:bodyPr>)/,
      `<a:bodyPr${direction === null ? "" : ` vert="${direction}"`} lIns="0" rIns="0" tIns="0" bIns="0"><a:noAutofit/></a:bodyPr>`,
    );
  files[slideName] = strToU8(
    xml.replace(original, withDirection(slideDirection)),
  );
  for (const [name, direction] of [
    [layoutName, layoutDirection],
    [masterName, masterDirection],
  ]) {
    files[name] = strToU8(
      strFromU8(files[name])
        .replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, "")
        .replace("</p:spTree>", withDirection(direction) + "</p:spTree>"),
    );
  }
  const loaded = await parseDeck(zipSync(files));
  return {
    pres: loaded,
    slide: P.getSlides(loaded)[0],
    shape: P.getSlideShapes(P.getSlides(loaded)[0])[0],
    files,
  };
}
