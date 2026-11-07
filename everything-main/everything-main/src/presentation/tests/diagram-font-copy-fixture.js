import { P } from "../src/model.js";
import { renderedDiagramDeck } from "./diagram-render-fixture.js";
import { diagramSpacerDeck } from "./diagram-spacer-fixture.js";

export const encode = (s) => new TextEncoder().encode(s);
export const decode = (part) => new TextDecoder().decode(part.data);
export const sourceFonts = {
  majorLatin: "Georgia",
  minorLatin: "Verdana",
  majorEastAsian: "Owned major East Asian",
  minorEastAsian: "Owned minor East Asian",
  majorComplexScript: "Owned major complex script",
  minorComplexScript: "Owned minor complex script",
};

// Independently authored text controls, with and without a saved drawing.
// Typeface names/descriptors are metadata; no font binary is introduced.
export async function diagramFontDeck({ cached = false } = {}) {
  const base = cached ? await renderedDiagramDeck() : await diagramSpacerDeck(),
    p = base.p ?? base.pres,
    { frame, diagram } = base;
  P.setPresentationFonts(p, sourceFonts);
  for (const view of [diagram.data, ...(cached ? [diagram.drawing] : [])])
    view.part.data = encode(
      decode(view.part)
        .replace(/<a:rPr([^<>]*?)\/>/g, "<a:rPr$1></a:rPr>")
        .replaceAll("</a:rPr>", '<a:latin typeface="+mn-lt"/></a:rPr>')
        .replaceAll(
          "<a:r><a:t>",
          '<a:r><a:rPr><a:latin typeface="+mn-lt"/></a:rPr><a:t>',
        ),
    );
  return { p, frame, diagram };
}
