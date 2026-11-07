import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck } from "../src/model.js";
import { importSlideTemplate } from "../lib/pptx/src/api/fn/template-import.ts";
import { createMappedColorDeck } from "./fixtures.js";

export async function masterShapeVisibilityFixture({
  slideFlag = null,
  layoutFlag = null,
  foreign = false,
} = {}) {
  const files = unzipSync(
    await createMappedColorDeck({ decorations: true, painted: true }),
  );
  for (const [name, bytes] of Object.entries(files)) {
    const layer = /^ppt\/slides\/[^/]+\.xml$/.test(name)
      ? "sld"
      : /^ppt\/slideLayouts\/[^/]+\.xml$/.test(name)
        ? "sldLayout"
        : null;
    const flag = layer === "sld" ? slideFlag : layoutFlag;
    if (layer && flag !== null) {
      files[name] = strToU8(
        strFromU8(bytes).replace(
          new RegExp(`<p:${layer}\\b`),
          `<p:${layer} ${foreign ? 'xmlns:x="urn:visibility-extension" x:' : ""}showMasterSp="${flag}"`,
        ),
      );
    }
  }
  return parseDeck(zipSync(files));
}

export async function masterShapeVisibilityTransferFixture() {
  const pres = createDeck("blank"),
    seed = P.getSlides(pres)[0];
  const cases = [
    { slideFlag: null, layoutFlag: null, master: true, layout: true },
    { slideFlag: null, layoutFlag: "0", master: false, layout: true },
    { slideFlag: "0", layoutFlag: "1", master: false, layout: false },
  ];
  for (const options of cases) {
    const source = await masterShapeVisibilityFixture(options),
      slide = P.getSlides(source)[0];
    P.importSlide(pres, slide, importSlideTemplate(pres, slide), {
      preserveGeometry: false,
    });
  }
  P.removeSlide(pres, seed);
  return { pres, cases };
}
