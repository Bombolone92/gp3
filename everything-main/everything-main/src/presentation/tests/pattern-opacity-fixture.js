import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck } from "../src/model.js";
import { fillOpacityDeck } from "./fill-opacity-fixture.js";
import { shapeStyleDeck } from "./shape-style-reference-fixture.js";
import { geometryImage } from "./geometry-fixture.js";

export const patternXml = ({
  foreground = '<a:srgbClr val="ED3719"><a:alpha val="33333"/></a:srgbClr>',
  background = '<a:srgbClr val="29CD53"><a:alpha val="70001"/></a:srgbClr>',
  preset = "cross",
} = {}) =>
  `<a:pattFill${preset === null ? "" : ` prst="${preset}"`}><a:fgClr>${foreground}</a:fgClr><a:bgClr>${background}</a:bgClr></a:pattFill>`;

export async function patternOpacityDeck({
  kind = "shape",
  level = "slide",
  foreground,
  background,
  preset = "cross",
  geometry = "",
} = {}) {
  const paint = patternXml({ foreground, background, preset });
  if (kind === "reference") {
    const f = await shapeStyleDeck({
      level,
      fill: 1001,
      line: 0,
      effect: 0,
      refColor: foreground,
    });
    const files = unzipSync(await P.savePresentation(f.pres));
    files[f.themeName.slice(1)] = strToU8(
      strFromU8(files[f.themeName.slice(1)]).replace(
        /<a:pattFill\b[\s\S]*?<\/a:pattFill>/,
        patternXml({
          foreground: '<a:schemeClr val="phClr"/>',
          background,
          preset,
        }),
      ),
    );
    return zipSync(files);
  }
  if (kind === "shape") {
    const files = unzipSync(
      await fillOpacityDeck({ level, text: "Opaque text" }),
    );
    for (const [name, bytes] of Object.entries(files))
      if (/^ppt\/(slides|slideLayouts|slideMasters)\/[^/]+\.xml$/.test(name))
        files[name] = strToU8(
          strFromU8(bytes)
            .replace(
              /<a:solidFill><a:srgbClr val="FFFFFF">[\s\S]*?<\/a:solidFill>/,
              paint,
            )
            .replace(
              /<a:prstGeom\b[\s\S]*?<\/a:prstGeom>/,
              (old) => geometry || old,
            ),
        );
    return zipSync(files);
  }
  const pres = createDeck("blank"),
    slide = P.getSlides(pres)[0];
  if (kind === "table") {
    P.setSlideBackgroundImage(slide, geometryImage);
    P.addSlideTable(slide, {
      x: P.inches(1),
      y: P.inches(1),
      w: P.inches(4),
      h: P.inches(2),
      rows: [["Opaque table text"]],
    });
  } else P.setSlideBackground(slide, "#FFFFFF");
  const files = unzipSync(await P.savePresentation(pres)),
    names = [
      P.getSlidePartName(slide),
      P.getSlideLayoutPartName(P.getSlideLayout(slide)),
      P.getSlideMasterPartName(slide),
    ].map((n) => n.slice(1));
  if (kind === "table")
    files[names[0]] = strToU8(
      strFromU8(files[names[0]]).replace(
        /<a:tcPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:tcPr>)/,
        `<a:tcPr>${paint}</a:tcPr>`,
      ),
    );
  else {
    files[names[0]] = strToU8(
      strFromU8(files[names[0]]).replace(/<p:bg>[\s\S]*?<\/p:bg>/, ""),
    );
    const name = names[["slide", "layout", "master"].indexOf(level)];
    files[name] = strToU8(
      strFromU8(files[name])
        .replace(/<p:bg>[\s\S]*?<\/p:bg>/g, "")
        .replace(
          /(<p:cSld\b[^>]*>)/,
          `$1<p:bg><p:bgPr>${paint}</p:bgPr></p:bg>`,
        ),
    );
  }
  return zipSync(files);
}

export async function readPatternFixture(options) {
  const pres = await parseDeck(await patternOpacityDeck(options)),
    slide = P.getSlides(pres)[0],
    shape =
      options.level === "layoutDecoration"
        ? P.getSlideLayoutShapes(pres, P.getSlideLayout(slide))[0]
        : options.level === "masterDecoration"
          ? P.getSlideMasterShapes(pres, P.getSlideLayout(slide))[0]
          : P.getSlideShapes(slide)[0];
  const fill =
    options.kind === "background"
      ? P[
          {
            slide: "getSlideBackgroundPatternFill",
            layout: "getSlideLayoutBackgroundPatternFill",
            master: "getSlideMasterBackgroundPatternFill",
          }[options.level]
        ](pres, options.level === "slide" ? slide : P.getSlideLayout(slide))
      : options.kind === "table"
        ? P.getTableStyleResolver(pres, shape).cell(P.getTableCell(shape, 0, 0))
            .fill
        : P.getShapePatternFillEffective(pres, shape);
  return { pres, slide, shape, fill };
}
