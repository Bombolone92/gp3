import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck } from "../src/model.js";

// Eight 32px-wide solid PNG swatches, including partial and zero alpha.
export const duotoneSamples = [
  [0, 0, 0, 255],
  [255, 255, 255, 255],
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [0, 0, 255, 255],
  [128, 128, 128, 255],
  [32, 96, 192, 128],
  [120, 40, 80, 0],
];
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAQAAAAAgCAYAAAD9qabkAAAApElEQVR4nO3UQQHCAAwEwRRlyEBOcVAJyEEGToqMPHbGwCWfPWbmnkX3vTo/cxy788vvbx9wnu/V/c/vuXrA63udm/uPzXFglwBAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmADAdP0BEKUMMDnxSQQAAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);
export const colorXml = (hex) => `<a:srgbClr val="${hex.replace("#", "")}"/>`;
export async function duotoneDeck({
  first = colorXml("204080"),
  second = colorXml("E0A030"),
  kind = "picture",
  background = "#FFFFFF",
  level = "slide",
} = {}) {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  P.setSlideBackground(s, background);
  const bounds = {
    x: P.emu(32 * 9525),
    y: P.emu(32 * 9525),
    w: P.emu(256 * 9525),
    h: P.emu(32 * 9525),
  };
  if (kind === "picture") P.addSlideImage(s, png, bounds);
  else {
    const shape = P.addSlideShape(s, { ...bounds, preset: "rect" });
    P.setShapeImageFill(shape, png);
    P.setShapeNoStroke(shape);
  }
  const files = unzipSync(await P.savePresentation(p)),
    name = P.getSlidePartName(s).slice(1),
    effect = `<a:duotone>${first}${second}</a:duotone>`;
  let xml = strFromU8(files[name]).replace(
    /<a:blip\b([^>]*?)(?:\/>|>)/,
    `<a:blip$1>${effect}</a:blip>`,
  );
  // Newly authored images have self-closing blips and no effect children.
  if (level === "layout") {
    const layout = P.getSlideLayoutPartName(P.getSlideLayout(s)).slice(1),
      tag = kind === "picture" ? "pic" : "sp";
    const shape = xml.match(new RegExp(`<p:${tag}\\b[\\s\\S]*?</p:${tag}>`))[0];
    xml = xml.replace(shape, "");
    files[layout] = strToU8(
      strFromU8(files[layout]).replace("</p:spTree>", shape + "</p:spTree>"),
    );
    const slideRels = name.replace(/([^/]+)$/, "_rels/$1.rels"),
      layoutRels = layout.replace(/([^/]+)$/, "_rels/$1.rels");
    const imageRel = strFromU8(files[slideRels]).match(
      /<Relationship\b[^>]*Type="[^"]*\/image"[^>]*\/>/,
    )[0];
    files[layoutRels] = strToU8(
      strFromU8(files[layoutRels]).replace(
        "</Relationships>",
        imageRel + "</Relationships>",
      ),
    );
  }
  files[name] = strToU8(xml);
  return zipSync(files);
}
