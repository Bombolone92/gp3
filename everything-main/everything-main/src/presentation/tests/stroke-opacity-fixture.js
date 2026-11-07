import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck } from "../src/model.js";

export async function strokeOpacityDeck({
  transforms = '<a:alpha val="50000"/>',
  color = 'srgbClr val="1267B2"',
  kind = "shape",
  preset = "rect",
  level = "slide",
  fill = "#FFFF00",
  arrows = false,
  localLine = null,
  text = "",
} = {}) {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  P.setSlideBackground(s, "#FFFFFF");
  const bounds = {
    x: P.inches(1),
    y: P.inches(1),
    w: P.inches(4),
    h: P.inches(
      kind === "connector" && (preset === "rect" || preset === "line") ? 0 : 2,
    ),
  };
  let sh;
  if (kind === "picture") {
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFUlEQVR4nGP8//8/AzbAhFV00EoAAFbUAw037MyjAAAAAElFTkSuQmCC",
      ),
      (c) => c.charCodeAt(0),
    );
    sh = P.addSlideImage(s, png, bounds);
  } else if (kind === "connector")
    sh = P.addSlideLine(s, {
      from: { x: bounds.x, y: bounds.y },
      to: { x: P.inches(5), y: bounds.y + bounds.h },
      color: "#1267B2",
      widthEmu: P.pt(8),
    });
  else
    sh = P.addSlideShape(s, { ...bounds, preset, ...(text ? { text } : {}) });
  if (kind === "shape") {
    P.setShapeFill(sh, fill);
  }
  P.setShapeStroke(sh, { color: "#1267B2", widthEmu: P.pt(8) });
  const files = unzipSync(await P.savePresentation(p)),
    slide = P.getSlidePartName(s).slice(1),
    layout = P.getSlideLayoutPartName(P.getSlideLayout(s)).slice(1),
    master = P.getSlideMasterPartName(s).slice(1);
  const tag = color.split(" ")[0];
  const line = `<a:ln w="101600"><a:solidFill><a:${color}>${transforms}</a:${tag}></a:solidFill>${arrows ? '<a:headEnd type="triangle"/><a:tailEnd type="triangle"/>' : ""}</a:ln>`;
  let xml = strFromU8(files[slide])
    .replace(
      /prst="[^"]+"/,
      `prst="${kind === "connector" && preset === "rect" ? "line" : preset}"`,
    )
    .replace(/<a:ln\b[\s\S]*?<\/a:ln>/, line);
  if (preset === "custom" || preset === "customSingle")
    xml = xml.replace(
      /<a:prstGeom\b[\s\S]*?<\/a:prstGeom>/,
      '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="400" h="200" fill="none"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="400" y="200"/></a:lnTo></a:path><a:path w="400" h="200" fill="none"><a:moveTo><a:pt x="400" y="0"/></a:moveTo><a:lnTo><a:pt x="0" y="200"/></a:lnTo></a:path></a:pathLst></a:custGeom>',
    );
  if (preset === "customSingle")
    xml = xml.replace('</a:path><a:path w="400" h="200" fill="none">', "");
  if (level !== "slide") {
    xml = xml.replace(/<p:sp\b[\s\S]*?<\/p:sp>/, (shape) =>
      shape.replace(
        "<p:nvPr/>",
        '<p:nvPr><p:ph type="body" idx="4"/></p:nvPr>',
      ),
    );
    const shape = xml.match(/<p:sp\b[\s\S]*?<\/p:sp>/)[0];
    xml = xml.replace(line, localLine ?? '<a:ln w="101600"/>');
    if (level === "master")
      files[layout] = strToU8(
        strFromU8(files[layout]).replace(
          "</p:spTree>",
          shape.replace(line, "") + "</p:spTree>",
        ),
      );
    const target = level === "layout" ? layout : master;
    files[target] = strToU8(
      strFromU8(files[target])
        .replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, "")
        .replace("</p:spTree>", shape + "</p:spTree>"),
    );
  }
  files[slide] = strToU8(xml);
  return zipSync(files);
}
