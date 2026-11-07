import { P, createDeck } from "../src/model.js";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
const blue = '<a:schemeClr val="accent1"/>',
  dark = '<a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr>';
const sf = (c) => `<a:solidFill>${c}</a:solidFill>`,
  line = (c) => `<a:ln w="76200">${sf(c)}</a:ln>`;
const solidPaintCasesData = [
  { label: "Own luminance", own: sf(dark) + line(dark) },
  { label: "Layout luminance", layout: sf(dark) + line(dark) },
  { label: "Master luminance", layout: "" },
  {
    label: "Layout tint",
    layout:
      sf('<a:schemeClr val="accent1"><a:tint val="20000"/></a:schemeClr>') +
      line('<a:schemeClr val="accent1"><a:tint val="20000"/></a:schemeClr>'),
  },
  {
    label: "Layout shade",
    layout:
      sf('<a:srgbClr val="315E87"><a:shade val="60000"/></a:srgbClr>') +
      line('<a:srgbClr val="315E87"><a:shade val="60000"/></a:srgbClr>'),
  },
  {
    label: "Luminance with alpha",
    layout:
      sf(
        '<a:schemeClr val="accent1"><a:lumMod val="50000"/><a:alpha val="75000"/></a:schemeClr>',
      ) + line(dark),
  },
  {
    label: "scRGB",
    layout:
      sf(
        '<a:scrgbClr r="20000" g="40000" b="60000"><a:lumMod val="50000"/></a:scrgbClr>',
      ) + line(blue),
  },
  {
    label: "HSL",
    layout:
      sf(
        '<a:hslClr hue="12600000" sat="50000" lum="40000"><a:lumMod val="50000"/></a:hslClr>',
      ) + line(blue),
  },
  {
    label: "System last color",
    layout:
      sf(
        '<a:sysClr val="windowText" lastClr="315E87"><a:lumMod val="50000"/></a:sysClr>',
      ) + line(blue),
  },
  {
    label: "Preset color",
    layout:
      sf('<a:prstClr val="steelBlue"><a:lumMod val="50000"/></a:prstClr>') +
      line(blue),
  },
  {
    label: "Own fill overrides ancestors",
    own: sf('<a:srgbClr val="D04432"/>') + "<a:ln><a:noFill/></a:ln>",
    layout: sf(dark) + line(dark),
  },
  {
    label: "Own no-fill blocks master",
    own: "<a:noFill/><a:ln><a:noFill/></a:ln>",
    layout: sf(dark) + line(dark),
  },
];
export const solidPaintCases = solidPaintCasesData.map((c, i) => ({
  ...c,
  rgb: [
    [24, 47, 67],
    [24, 47, 67],
    [24, 47, 67],
    [232, 234, 237],
    [37, 73, 106],
    [24, 47, 67],
    [46, 87, 117],
    [25, 51, 77],
    [24, 47, 67],
    [35, 65, 90],
    [208, 68, 50],
    null,
  ][i],
  strokeRgb: [
    [24, 47, 67],
    [24, 47, 67],
    [24, 47, 67],
    [232, 234, 237],
    [37, 73, 106],
    [24, 47, 67],
    [49, 94, 135],
    [49, 94, 135],
    [49, 94, 135],
    [49, 94, 135],
    null,
    null,
  ][i],
  opacity: i === 5 ? 0.75 : 1,
}));

export async function solidPaintInheritanceFixture() {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  for (const [i, c] of solidPaintCases.entries()) {
    const x = 0.55 + (i % 4) * 3.2,
      y = 0.35 + Math.floor(i / 4) * 2.4;
    const sh = P.addSlideShape(s, {
      preset: "rect",
      x: P.inches(x),
      y: P.inches(y + 0.35),
      w: P.inches(2.6),
      h: P.inches(1.5),
    });
    P.setShapeFill(sh, "#FFFFFF");
    P.setShapeStroke(sh, { color: "#000000", widthEmu: P.pt(6) });
    P.addSlideTextBox(s, {
      x: P.inches(x),
      y: P.inches(y),
      w: P.inches(2.9),
      h: P.inches(0.3),
      text: c.label,
    });
  }
  const files = unzipSync(await P.savePresentation(p));
  const slide = P.getSlidePartName(s).slice(1),
    layout = P.getSlideLayoutPartName(P.getSlideLayout(s)).slice(1),
    master = P.getSlideMasterPartName(s).slice(1);
  const part = (id, idx, props) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Paint control ${idx}"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="${idx}"/></p:nvPr></p:nvSpPr><p:spPr>${props}</p:spPr></p:sp>`;
  let index = 0;
  files[slide] = strToU8(
    strFromU8(files[slide]).replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, (el) => {
      const i = index++;
      if (i % 2)
        return el.replace(
          /<a:rPr([^>]*)\/>/g,
          '<a:rPr$1><a:latin typeface="Arial"/></a:rPr>',
        );
      const c = solidPaintCases[i / 2];
      return el
        .replace(
          "<p:nvPr/>",
          `<p:nvPr><p:ph type="body" idx="${i / 2 + 50}"/></p:nvPr>`,
        )
        .replace(/<p:spPr>[\s\S]*?<\/p:spPr>/, (m) =>
          m
            .replace(/<a:solidFill\b[\s\S]*?<\/a:solidFill>/g, "")
            .replace(/<a:ln\b[\s\S]*?<\/a:ln>/g, "")
            .replace("</p:spPr>", `${c.own ?? ""}</p:spPr>`),
        );
    }),
  );
  files[layout] = strToU8(
    strFromU8(files[layout])
      .replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, "")
      .replace(
        "</p:spTree>",
        solidPaintCases
          .map((c, i) => part(i + 100, i + 50, c.layout ?? ""))
          .join("") + "</p:spTree>",
      ),
  );
  files[master] = strToU8(
    strFromU8(files[master])
      .replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, "")
      .replace(
        "</p:spTree>",
        part(200, 0, sf(dark) + line(dark)) + "</p:spTree>",
      ),
  );
  for (const name of Object.keys(files).filter((n) =>
    /^ppt\/theme\/.*\.xml$/.test(n),
  ))
    files[name] = strToU8(
      strFromU8(files[name]).replace(
        /<a:accent1>[\s\S]*?<\/a:accent1>/,
        '<a:accent1><a:srgbClr val="315E87"/></a:accent1>',
      ),
    );
  return zipSync(files);
}
