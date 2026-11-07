import { P, createDeck } from "../src/model.js";
import { INTERNAL_PACKAGE } from "../lib/pptx/src/api/_internal-symbols.ts";
import { resolveTarget } from "../lib/pptx/src/internal/opc/index.ts";
import { REL_TYPES } from "../lib/pptx/src/internal/presentationml/index.ts";
import { NS } from "../lib/pptx/src/internal/xml/index.ts";
const enc = new TextEncoder(),
  dec = new TextDecoder();
const pkg = (pres) => pres[INTERNAL_PACKAGE];
const replace = (part, from, to) => {
  part.data = enc.encode(dec.decode(part.data).replace(from, to));
};
const masterOfLayout = (pres, layout) => {
  const name = P.getSlideLayoutPartName(layout);
  const r = pkg(pres)
    .getRels(name)
    .items.find((r) => r.type === REL_TYPES.slideMaster);
  return pkg(pres).getPart(resolveTarget(name, r.target));
};
export function templateFixture() {
  const pres = createDeck("blank"),
    slide = P.getSlides(pres)[0];
  const layout = P.getSlideLayout(slide),
    master = masterOfLayout(pres, layout);
  replace(
    master,
    "</p:spTree>",
    '<p:sp><p:nvSpPr><p:cNvPr id="41" name="Master decoration"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="762000" y="1234567"/><a:ext cx="2540000" cy="571500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="2C8A73"/></a:solidFill></p:spPr></p:sp></p:spTree>',
  );
  const layoutPart = pkg(pres).getPart(P.getSlideLayoutPartName(layout));
  replace(
    layoutPart,
    "</p:sldLayout>",
    '<mc:AlternateContent xmlns:mc="' +
      NS.mc +
      '" xmlns:future="urn:future-effect"><mc:Choice Requires="future"><p:transition advTm="4300"><future:turn strength="varied"/></p:transition></mc:Choice><mc:Fallback><p:transition advTm="4300"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent></p:sldLayout>',
  );
  return { pres, slide, layout, master, layoutPart };
}
