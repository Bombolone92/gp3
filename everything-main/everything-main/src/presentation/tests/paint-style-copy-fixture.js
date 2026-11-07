import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, parseDeck } from "../src/model.js";
import { createGeometryDeck } from "./geometry-fixture.js";

export async function paintStyleFixture({
  shapeKind = "picture",
  color = "315E87",
  local = "",
  layout = "<a:noFill/><a:ln><a:noFill/></a:ln>",
  master = "",
  style = "",
  themeStyles = "",
  group = false,
  bounds,
} = {}) {
  const files = unzipSync(
    await createGeometryDeck({ shapeKind, extraProperties: local, bounds }),
  );
  const edit = (name, fn) => {
    files[name] = strToU8(fn(strFromU8(files[name])));
  };
  const source = await parseDeck(zipSync(files)),
    slide = P.getSlides(source)[0];
  const layoutName = P.getSlideLayoutPartName(P.getSlideLayout(slide)).slice(1),
    masterName = P.getSlideMasterPartName(slide).slice(1);
  edit(layoutName, (xml) =>
    xml.replace(
      /(<p:sp><p:nvSpPr><p:cNvPr id="87"[\s\S]*?)(<\/p:spPr>)/,
      `$1${layout}$2`,
    ),
  );
  // Style references belong alongside spPr, never inside it.
  if (style)
    edit(layoutName, (xml) =>
      xml.replace(
        /(<p:sp><p:nvSpPr><p:cNvPr id="87"[\s\S]*?<\/p:spPr>)/,
        `$1${style}`,
      ),
    );
  if (master)
    edit(masterName, (xml) =>
      xml
        .replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, "")
        .replace(
          "</p:spTree>",
          `<p:sp><p:nvSpPr><p:cNvPr id="91" name="Master paint"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr>${master}</p:spPr></p:sp></p:spTree>`,
        ),
    );
  const themeName = Object.keys(files).find(
    (n) => n.startsWith("ppt/theme/") && n.endsWith(".xml"),
  );
  edit(themeName, (xml) =>
    xml
      .replace(
        /<a:accent1>[\s\S]*?<\/a:accent1>/,
        `<a:accent1><a:srgbClr val="${color}"/></a:accent1>`,
      )
      .replace(
        /<a:fmtScheme\b[\s\S]*?<\/a:fmtScheme>/,
        (original) => themeStyles || original,
      ),
  );
  const pres = await parseDeck(zipSync(files)),
    s = P.getSlides(pres)[0],
    shape = P.getSlideShapes(s)[0];
  let root = shape;
  if (group)
    root = P.groupShapes([
      shape,
      P.addSlideShape(s, {
        preset: "rect",
        x: P.inches(6),
        y: P.inches(1),
        w: P.inches(1),
        h: P.inches(1),
      }),
    ]);
  return { pres, slide: s, shape, root, files };
}
