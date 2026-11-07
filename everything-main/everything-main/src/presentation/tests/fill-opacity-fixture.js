import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck } from "../src/model.js";
import { geometryImage, holeGeometry } from "./geometry-fixture.js";

export async function fillOpacityDeck({
  transforms = '<a:alpha val="30000"/>',
  color = 'srgbClr val="FFFFFF"',
  level = "slide",
  localFill = "",
  preset = "rect",
  text = "",
} = {}) {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  P.setSlideBackgroundImage(s, geometryImage);
  const shape = P.addSlideShape(s, {
    x: P.inches(1),
    y: P.inches(1),
    w: P.inches(4),
    h: P.inches(2),
    preset: preset === "custom" ? "rect" : preset,
    ...(text ? { text } : {}),
  });
  P.setShapeFill(shape, "#FFFFFF");
  P.setShapeStroke(shape, { color: "#1267B2", widthEmu: P.pt(8) });
  const files = unzipSync(await P.savePresentation(p));
  const slide = P.getSlidePartName(s).slice(1),
    layout = P.getSlideLayoutPartName(P.getSlideLayout(s)).slice(1),
    master = P.getSlideMasterPartName(s).slice(1);
  const tag = color.split(" ")[0];
  const fill = `<a:solidFill><a:${color}>${transforms}</a:${tag}></a:solidFill>`;
  let xml = strFromU8(files[slide]).replace(
    /<a:solidFill\b[\s\S]*?<\/a:solidFill>/,
    fill,
  );
  if (preset === "custom")
    xml = xml.replace(/<a:prstGeom\b[\s\S]*?<\/a:prstGeom>/, holeGeometry);
  if (level !== "slide") {
    const decoration = level.endsWith("Decoration");
    if (!decoration)
      xml = xml.replace(/<p:sp\b[\s\S]*?<\/p:sp>/, (element) =>
        element.replace(
          "<p:nvPr/>",
          '<p:nvPr><p:ph type="body" idx="42"/></p:nvPr>',
        ),
      );
    const element = xml.match(/<p:sp\b[\s\S]*?<\/p:sp>/)[0];
    xml = decoration ? xml.replace(element, "") : xml.replace(fill, localFill);
    if (level === "master")
      files[layout] = strToU8(
        strFromU8(files[layout])
          .replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, "")
          .replace("</p:spTree>", element.replace(fill, "") + "</p:spTree>"),
      );
    const target = level.startsWith("layout") ? layout : master;
    files[target] = strToU8(
      strFromU8(files[target])
        .replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, "")
        .replace("</p:spTree>", element + "</p:spTree>"),
    );
  }
  files[slide] = strToU8(xml);
  return zipSync(files);
}
