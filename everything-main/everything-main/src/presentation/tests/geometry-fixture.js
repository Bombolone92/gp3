import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck } from "../src/model.js";

export const geometryImage = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGMwSJjwH4QZYAwARzQIfaOzYgMAAAAASUVORK5CYII=",
  "base64",
);
export const triangleGeometry =
  '<a:custGeom><a:avLst/><a:gdLst/><a:pathLst><a:path><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="w" y="0"/></a:lnTo><a:lnTo><a:pt x="0" y="h"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>';
export const presetGeometry = (name, adjustments = "") =>
  `<a:prstGeom prst="${name}"><a:avLst>${adjustments}</a:avLst></a:prstGeom>`;

export async function createGeometryDeck({
  geometry = triangleGeometry,
  level = "layout",
  directGeometry = "",
  placeholder = '<p:ph type="pic" idx="42"/>',
  layoutPlaceholder = '<p:ph type="pic" idx="42"/>',
  masterPlaceholder = '<p:ph type="body" idx="17"/>',
  masterGeometry = "",
  bounds = { x: P.inches(1), y: P.inches(1), w: P.inches(4), h: P.inches(2) },
  inheritedBounds = false,
  shapeKind = "picture",
  extraProperties = "",
} = {}) {
  const pres = createDeck(),
    slide = P.getSlides(pres)[0];
  if (shapeKind === "picture") P.addSlideImage(slide, geometryImage, bounds);
  else {
    const shape = P.addSlideShape(slide, { ...bounds, preset: "rect" });
    P.setShapeImageFill(shape, geometryImage);
  }
  const files = unzipSync(await P.savePresentation(pres));
  const slidePart = P.getSlidePartName(slide).slice(1),
    layoutPart = P.getSlideLayoutPartName(P.getSlideLayout(slide)).slice(1),
    masterPart = P.getSlideMasterPartName(slide).slice(1);
  const kind = shapeKind === "picture" ? "pic" : "sp";
  const original = strFromU8(files[slidePart]);
  const shape = original.match(
    new RegExp(`<p:${kind}\\b[\\s\\S]*?</p:${kind}>`),
  )[0];
  let edited = shape
    .replace(/<a:prstGeom\b[\s\S]*?<\/a:prstGeom>/, "")
    .replace(/<p:nvPr\s*\/>/, `<p:nvPr>${placeholder}</p:nvPr>`)
    .replace(
      "</p:spPr>",
      (level === "local" ? geometry : directGeometry) +
        extraProperties +
        "</p:spPr>",
    );
  if (inheritedBounds)
    edited = edited.replace(/<a:xfrm\b[\s\S]*?<\/a:xfrm>/, "");
  files[slidePart] = strToU8(original.replace(shape, edited));
  const slot = (ph, geom) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="87" name="Geometry slot"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${bounds.x}" y="${bounds.y}"/><a:ext cx="${bounds.w}" cy="${bounds.h}"/></a:xfrm>${geom}</p:spPr></p:sp>`;
  files[layoutPart] = strToU8(
    strFromU8(files[layoutPart]).replace(
      "</p:spTree>",
      slot(layoutPlaceholder, level === "layout" ? geometry : "") +
        "</p:spTree>",
    ),
  );
  if (level === "master" || masterGeometry)
    files[masterPart] = strToU8(
      strFromU8(files[masterPart])
        .replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, "")
        .replace(
          "</p:spTree>",
          slot(masterPlaceholder, masterGeometry || geometry) + "</p:spTree>",
        ),
    );
  return zipSync(files);
}

// Same winding direction for both contours distinguishes even-odd clipping
// from SVG's default nonzero rule.
export const holeGeometry =
  '<a:custGeom><a:avLst/><a:gdLst/><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:lnTo><a:pt x="100" y="100"/></a:lnTo><a:lnTo><a:pt x="0" y="100"/></a:lnTo><a:close/><a:moveTo><a:pt x="25" y="25"/></a:moveTo><a:lnTo><a:pt x="75" y="25"/></a:lnTo><a:lnTo><a:pt x="75" y="75"/></a:lnTo><a:lnTo><a:pt x="25" y="75"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>';
