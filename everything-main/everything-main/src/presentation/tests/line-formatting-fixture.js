import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, parseDeck } from "../src/model.js";
import { paintStyleFixture } from "./paint-style-copy-fixture.js";

export const lineStyleRef = (idx) =>
  `<p:style><a:lnRef idx="${idx}"><a:srgbClr val="315E87"/></a:lnRef><a:fillRef idx="0"><a:srgbClr val="FFFFFF"/></a:fillRef><a:effectRef idx="0"><a:srgbClr val="000000"/></a:effectRef><a:fontRef idx="minor"><a:srgbClr val="000000"/></a:fontRef></p:style>`;
export const lineFill = '<a:solidFill><a:srgbClr val="315E87"/></a:solidFill>';
export const lineProperties = (children = "", attrs = "") =>
  `<a:ln w="57150" ${attrs}>${lineFill}${children}</a:ln>`;

export async function lineFormattingFixture({
  local = lineProperties(),
  layout = lineProperties('<a:prstDash val="dash"/><a:round/>', 'cap="rnd"'),
  master = "",
  localStyle = "",
  layoutStyle = "",
  themeLines = "",
  shapeKind = "picture",
  bounds,
} = {}) {
  const f = await paintStyleFixture({
    local,
    layout,
    master,
    style: layoutStyle,
    shapeKind,
    bounds,
  });
  const files = unzipSync(await P.savePresentation(f.pres));
  const slideName = P.getSlidePartName(f.slide).slice(1);
  files[slideName] = strToU8(
    strFromU8(files[slideName]).replace("</p:spPr>", `</p:spPr>${localStyle}`),
  );
  const themeName = Object.keys(files).find((n) =>
    /^ppt\/theme\/.*\.xml$/.test(n),
  );
  if (themeLines)
    files[themeName] = strToU8(
      strFromU8(files[themeName]).replace(
        /<a:lnStyleLst>[\s\S]*?<\/a:lnStyleLst>/,
        `<a:lnStyleLst>${themeLines}</a:lnStyleLst>`,
      ),
    );
  const bytes = zipSync(files),
    pres = await parseDeck(bytes),
    slide = P.getSlides(pres)[0],
    shape = P.getSlideShapes(slide)[0];
  return { pres, slide, shape, bytes, themeName };
}
