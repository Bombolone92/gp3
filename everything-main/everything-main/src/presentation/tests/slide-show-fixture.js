import { P, createDeck, text } from "../src/model.js";
import { INTERNAL_PACKAGE } from "../lib/pptx/src/api/_internal-symbols.ts";
import { partName } from "../lib/pptx/src/internal/opc/index.ts";
import { NS } from "../lib/pptx/src/internal/xml/index.ts";

const encode = (text) => new TextEncoder().encode(text);

export function setShowSelection(pres, selection = "<p:sldAll/>", attrs = "") {
  pres[INTERNAL_PACKAGE].getPart(partName("/ppt/presProps.xml")).data = encode(
    `<p:presentationPr xmlns:p="${NS.pml}" xmlns:mc="${NS.mc}"><p:showPr ${attrs}><p:present/>${selection}</p:showPr></p:presentationPr>`,
  );
}

export function setCustomShows(pres, shows) {
  const pkg = pres[INTERNAL_PACKAGE];
  const main = pkg.getPart(partName("/ppt/presentation.xml"));
  const rels = pkg.getRels(main.name);
  const slides = P.getSlides(pres);
  const xml = shows
    .map(({ id, sequence }) => {
      const refs = sequence.map((index) => {
        const target = P.getSlidePartName(slides[index]).slice("/ppt/".length);
        const rel = rels.items.find((rel) => rel.target === target);
        if (!rel) throw Error("fixture slide relationship not found");
        return `<p:sld r:id="${rel.id}"/>`;
      });
      return `<p:custShow id="${id}" name="Show ${id}"><p:sldLst>${refs.join("")}</p:sldLst></p:custShow>`;
    })
    .join("");
  let source = new TextDecoder().decode(main.data);
  source = source.replace(/<p:custShowLst>.*?<\/p:custShowLst>/s, "");
  source = source.replace(
    /(?=<p:defaultTextStyle|<p:extLst|<\/p:presentation>)/,
    `<p:custShowLst>${xml}</p:custShowLst>`,
  );
  main.data = encode(source);
}

export function showSelectionDeck(
  selection,
  { attrs = "", customShows = [], count = 5 } = {},
) {
  const pres = createDeck("blank");
  for (let i = 0; i < count; i++) {
    const slide = i ? P.addBlankSlide(pres) : P.getSlides(pres)[0];
    text(slide, `Selected show slide ${i + 1}`, 1, 1, 9, 2, 30);
    P.setSlideTransition(slide, { effect: "none", advanceAfterMs: 300 });
  }
  setShowSelection(pres, selection, attrs);
  if (customShows.length) setCustomShows(pres, customShows);
  return pres;
}
