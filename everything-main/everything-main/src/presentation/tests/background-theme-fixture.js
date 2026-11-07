import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck, preview } from "../src/model.js";
import { importSlideTemplate } from "../lib/pptx/src/api/fn/template-import.ts";
import { createTransformedBackgroundDeck } from "./fixtures.js";

// Original controls use unrelated fills at each inheritance level. Importing
// their native template into a different deck keeps the source theme attached.
export async function backgroundThemeFixture({
  level = "master",
  kind = "solid",
} = {}) {
  const files = unzipSync(await createTransformedBackgroundDeck({ level }));
  const fills = {
    gradient:
      '<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="accent5"/></a:gs><a:gs pos="100000"><a:schemeClr val="accent2"/></a:gs></a:gsLst><a:lin ang="2700000" scaled="1"/></a:gradFill>',
    pattern:
      '<a:pattFill prst="diagCross"><a:fgClr><a:schemeClr val="accent5"><a:tint val="15000"/></a:schemeClr></a:fgClr><a:bgClr><a:schemeClr val="accent2"/></a:bgClr></a:pattFill>',
  };
  for (const [name, bytes] of Object.entries(files)) {
    if (/^ppt\/(slides|slideLayouts|slideMasters)\/[^/]+\.xml$/.test(name)) {
      let xml = strFromU8(bytes);
      if (kind === "inherit") xml = xml.replace(/<p:bg>[\s\S]*?<\/p:bg>/g, "");
      else if (fills[kind])
        xml = xml.replace(
          /(<p:bgPr>)<a:solidFill>[\s\S]*?<\/a:solidFill>/g,
          (_, start) => start + fills[kind],
        );
      files[name] = strToU8(xml);
    } else if (/^ppt\/theme\/[^/]+\.xml$/.test(name)) {
      files[name] = strToU8(
        strFromU8(bytes).replace(
          /<a:lt1>[\s\S]*?<\/a:lt1>/,
          '<a:lt1><a:srgbClr val="E6F4DA"/></a:lt1>',
        ),
      );
    }
  }
  // Sort after the destination's existing theme, making a blanket first-theme
  // lookup observably different from the owning-master relationship.
  const oldTheme = Object.keys(files).find((name) =>
    /^ppt\/theme\/[^/]+\.xml$/.test(name),
  );
  const newTheme = "ppt/theme/user-template.xml";
  files[newTheme] = files[oldTheme];
  delete files[oldTheme];
  for (const [name, bytes] of Object.entries(files)) {
    if (name === "[Content_Types].xml" || name.endsWith(".rels"))
      files[name] = strToU8(
        strFromU8(bytes)
          .replaceAll(oldTheme, newTheme)
          .replaceAll(oldTheme.slice(4), newTheme.slice(4)),
      );
  }
  return parseDeck(zipSync(files));
}

export async function backgroundThemeTransferFixture() {
  const pres = createDeck("blank"),
    expected = [preview(pres, P.getSlides(pres)[0])],
    cases = ["slide", "layout", "master"].flatMap((level) =>
      ["solid", "gradient", "pattern"].map((kind) => ({ level, kind })),
    );
  cases.push({ level: "master", kind: "inherit" });
  for (const options of cases) {
    const source = await backgroundThemeFixture(options),
      slide = P.getSlides(source)[0];
    expected.push(preview(source, slide));
    P.importSlide(pres, slide, importSlideTemplate(pres, slide), {
      preserveGeometry: false,
    });
  }
  return { pres, expected, cases };
}
