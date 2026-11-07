import { P, createDeck, parseDeck } from "../src/model.js";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export const bulletFontCases = ["Georgia", "Verdana"].flatMap((font) =>
  [
    ["Omitted number", "number", ""],
    ["Omitted character", "character", ""],
    ["Text number", "number", "<a:buFontTx/>"],
    ["Text character", "character", "<a:buFontTx/>"],
    ["Specified number", "number", '<a:buFont typeface="Courier New"/>'],
    ["Specified character", "character", '<a:buFont typeface="Courier New"/>'],
  ].map(([label, kind, properties]) => ({ font, label, kind, properties })),
);

export async function bulletFontFixture(cases = bulletFontCases) {
  const pres = createDeck("blank");
  const blank = P.getSlides(pres)[0];
  const slides = [];
  for (let start = 0; start < cases.length; start += 6) {
    const slide = P.addSlide(pres, { layout: P.getSlideLayouts(pres)[0] });
    const current = cases.slice(start, start + 6);
    for (let i = 0; i < current.length; i++)
      P.addSlideTextBox(slide, {
        x: P.inches(0.6),
        y: P.inches(0.4 + i * 0.9),
        w: P.inches(11.5),
        h: P.inches(0.8),
        text: current[i].label,
      });
    slides.push({ slide, current });
  }
  P.removeSlide(pres, blank);
  const files = unzipSync(await P.savePresentation(pres));
  for (const { slide, current } of slides) {
    const part = P.getSlidePartName(slide).slice(1);
    let i = 0;
    files[part] = strToU8(
      strFromU8(files[part]).replace(/<p:txBody>[\s\S]*?<\/p:txBody>/g, () => {
        const c = current[i++];
        const bullet =
          c.kind === "number"
            ? '<a:buAutoNum type="arabicPeriod"/>'
            : '<a:buChar char="•"/>';
        return `<p:txBody><a:bodyPr/><a:lstStyle>${c.listStyle ?? ""}</a:lstStyle><a:p><a:pPr marL="500000" indent="-400000">${c.properties}${bullet}</a:pPr><a:r><a:rPr sz="3000"><a:latin typeface="${c.font}"/></a:rPr><a:t>${c.label}</a:t></a:r></a:p></p:txBody>`;
      }),
    );
  }
  return parseDeck(zipSync(files));
}
