import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck } from "../src/model.js";
import { geometryImage } from "./geometry-fixture.js";
import { REL_TYPES } from "../lib/pptx/src/internal/presentationml/index.ts";
export const solid = (
  color = '<a:schemeClr val="phClr"><a:shade val="50000"/></a:schemeClr>',
) => `<a:solidFill>${color}</a:solidFill>`;
export const style = ({
  fill = 1,
  line = 1,
  effect = 1,
  color = '<a:schemeClr val="accent1"><a:tint val="20000"/><a:alpha val="60000"/></a:schemeClr>',
} = {}) =>
  `<p:style><a:lnRef idx="${line}">${color}</a:lnRef><a:fillRef idx="${fill}">${color}</a:fillRef><a:effectRef idx="${effect}">${color}</a:effectRef><a:fontRef idx="minor"/></p:style>`;
export async function shapeStyleDeck({
  fill = 1,
  line = 1,
  effect = 1,
  own = "",
  layout = "",
  master = "",
  level = "slide",
  refColor,
} = {}) {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  P.setPresentationTheme(p, { accent1: "#804020", accent2: "#228844" });
  P.addSlideShape(s, {
    x: P.inches(1),
    y: P.inches(1),
    w: P.inches(3),
    h: P.inches(2),
    preset: "rect",
  });
  const names = [
    P.getSlidePartName(s),
    P.getSlideLayoutPartName(P.getSlideLayout(s)),
    P.getSlideMasterPartName(s),
  ].map((n) => n.slice(1));
  const files = unzipSync(await P.savePresentation(p));
  const themeName = Object.keys(files).find((n) =>
    /^ppt\/theme\/theme\d+\.xml$/.test(n),
  );
  const gradient =
    '<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="accent2"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="1"/></a:gradFill>';
  const image =
    '<a:blipFill><a:blip r:embed="theme-pixel"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>';
  const pattern =
    '<a:pattFill prst="pct25"><a:fgClr><a:schemeClr val="phClr"/></a:fgClr><a:bgClr><a:schemeClr val="accent2"/></a:bgClr></a:pattFill>';
  files[themeName] = strToU8(
    strFromU8(files[themeName]).replace(
      /<a:fmtScheme\b[\s\S]*?<\/a:fmtScheme>/,
      `<a:fmtScheme xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" name="Owned control"><a:fillStyleLst>${solid()}${gradient}${image}</a:fillStyleLst><a:lnStyleLst>${[1, 2, 3].map((i) => `<a:ln w="${i * 30000}" cap="rnd">${solid()}<a:prstDash val="dash"/><a:round/></a:ln>`).join("")}</a:lnStyleLst><a:effectStyleLst>${[1, 2, 3].map((i) => `<a:effectStyle><a:effectLst><a:glow rad="${i * 20000}"><a:schemeClr val="phClr"><a:shade val="50000"/></a:schemeClr></a:glow></a:effectLst></a:effectStyle>`).join("")}</a:effectStyleLst><a:bgFillStyleLst>${pattern}${solid('<a:srgbClr val="AA2200"/>')}${gradient}</a:bgFillStyleLst></a:fmtScheme>`,
    ),
  );
  const slot = (paint, where) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="10" name="Style reference control"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="4"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="2743200" cy="1828800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${paint}</p:spPr>${level === where ? style({ fill, line, effect, color: refColor }) : ""}<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Style label</a:t></a:r></a:p></p:txBody></p:sp>`;
  for (let i = 0; i < 3; i++)
    files[names[i]] = strToU8(
      strFromU8(files[names[i]])
        .replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, "")
        .replace(
          "</p:spTree>",
          slot([own, layout, master][i], ["slide", "layout", "master"][i]) +
            "</p:spTree>",
        ),
    );
  const pres = await parseDeck(zipSync(files)),
    slide = P.getSlides(pres)[0],
    shape = P.getSlideShapes(slide)[0],
    pkg = P._internalPackageOf(pres);
  pkg.addPart("/assets/style-pixel.png", "image/png", geometryImage.slice());
  const rels = pkg.getRels("/" + themeName) ?? { items: [] };
  rels.items.push({
    id: "theme-pixel",
    type: REL_TYPES.image,
    target: "/assets/style-pixel.png",
    targetMode: "Internal",
  });
  pkg.setRels("/" + themeName, rels);
  return { pres, slide, shape, themeName: "/" + themeName, names, files };
}
