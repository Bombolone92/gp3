import { P } from "../src/model.js";
import { INTERNAL_PACKAGE } from "../lib/pptx/src/api/_internal-symbols.ts";
import { NS } from "../lib/pptx/src/internal/xml/index.ts";
import { partName } from "../lib/pptx/src/internal/opc/index.ts";
import { showSelectionDeck } from "./slide-show-fixture.js";

export const LASER_EXTENSION = "{EC167BDD-8182-4AB7-AECC-EB403E3ABB37}";
export function laserDeck(
  color = null,
  { timed = false, extension = LASER_EXTENSION } = {},
) {
  const pres = showSelectionDeck("<p:sldAll/>", {
    attrs: timed ? "" : 'useTimings="0"',
  });
  if (color !== null) {
    const part = pres[INTERNAL_PACKAGE].getPart(partName("/ppt/presProps.xml"));
    const xml = new TextDecoder()
      .decode(part.data)
      .replace(
        "</p:showPr>",
        `<p:extLst><p:ext uri="${extension}"><p14:laserClr xmlns:p14="${NS.p14}" xmlns:a="${NS.dml}">${color}</p14:laserClr></p:ext></p:extLst></p:showPr>`,
      );
    part.data = new TextEncoder().encode(xml);
  }
  return pres;
}

export function nextSlideLink(pres) {
  const shape = P.getSlideShapes(P.getSlides(pres)[0])[0];
  P.setShapeClickAction(shape, { kind: "nextSlide" });
}

export function laserCompatibilityDeck(unknown = false) {
  const pres = laserDeck('<a:prstClr val="green"/>');
  const part = pres[INTERNAL_PACKAGE].getPart(partName("/ppt/presProps.xml"));
  let source = new TextDecoder()
    .decode(part.data)
    .replace("<p:sldAll/>", '<p:sldRg st="2" end="4"/>');
  source = source.replace(
    '<p:showPr useTimings="0">',
    `<mc:AlternateContent xmlns:mc="${NS.mc}" xmlns:p14="${NS.p14}"><mc:Choice Requires="p14"><p:showPr useTimings="0" loop="1">`,
  );
  source = source.replace(
    "</p:showPr>",
    `${unknown ? "<p14:unimplementedShowFeature/>" : ""}</p:showPr></mc:Choice><mc:Fallback><p:showPr><p:sldAll/></p:showPr></mc:Fallback></mc:AlternateContent>`,
  );
  part.data = new TextEncoder().encode(source);
  return pres;
}
