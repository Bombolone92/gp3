import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck } from "../src/model.js";
import { NS } from "../lib/pptx/src/internal/xml/index.ts";

export const alternate = (
  content,
  fallback = '<p:transition spd="slow" advTm="7300"><p:fade/></p:transition>',
) =>
  `<mc:AlternateContent xmlns:mc="${NS.mc}" xmlns:new="urn:future-transition"><mc:Choice Requires="new">${content}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`;
export async function fixture(content, { layout = "", master = "" } = {}) {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  const files = unzipSync(await P.savePresentation(p));
  const name = P.getSlidePartName(s).slice(1);
  files[name] = strToU8(
    strFromU8(files[name]).replace("</p:sld>", `${content}</p:sld>`),
  );
  const layoutName = P.getSlideLayoutPartName(P.getSlideLayout(s)).slice(1);
  const masterName = P.getSlideMasterPartName(s).slice(1);
  for (const [part, root, transition] of [
    [layoutName, "sldLayout", layout],
    [masterName, "sldMaster", master],
  ]) {
    let xml = strFromU8(files[part]);
    // Insert in the schema sequence before timing/header/footer/text styles.
    const at = xml.search(/<p:(?:timing|hf|txStyles|extLst)\b/);
    const end = at < 0 ? xml.lastIndexOf(`</p:${root}>`) : at;
    files[part] = strToU8(xml.slice(0, end) + transition + xml.slice(end));
  }
  const bytes = zipSync(files),
    pres = await parseDeck(bytes);
  return { pres, slide: P.getSlides(pres)[0], bytes, layoutName, masterName };
}
