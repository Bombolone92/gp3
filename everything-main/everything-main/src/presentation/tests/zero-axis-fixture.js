import { P, parseDeck } from "../src/model.js";
import { createGeometryDeck, presetGeometry } from "./geometry-fixture.js";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export async function zeroAxisFixture({
  axis = "horizontal",
  geometry = "line",
  level = "local",
  stroke = true,
  alpha = null,
  rotation = 0,
  flip = null,
  bounds = null,
} = {}) {
  const requested = bounds ?? {
    x: P.inches(1),
    y: P.inches(1),
    w: axis === "vertical" ? 0 : P.inches(4),
    h: axis === "horizontal" ? 0 : P.inches(3),
  };
  const path =
    geometry === "custom" || geometry === "scaledCustom"
      ? `<a:custGeom><a:avLst/><a:gdLst/><a:pathLst><a:path fill="none"${geometry === "scaledCustom" ? ' w="137" h="91"' : ""}><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="${geometry === "scaledCustom" ? 137 : "w"}" y="${geometry === "scaledCustom" ? 91 : "h"}"/></a:lnTo></a:path></a:pathLst></a:custGeom>`
      : presetGeometry(geometry);
  const p = await parseDeck(
      await createGeometryDeck({
        shapeKind: "shape",
        level,
        geometry: path,
        bounds: {
          ...requested,
          w: Math.abs(requested.w),
          h: Math.abs(requested.h),
        },
      }),
    ),
    s = P.getSlides(p)[0],
    sh = P.getSlideShapes(s)[0];
  P.setShapeNoFill(sh);
  if (stroke) {
    P.setShapeStroke(sh, { color: "#1267B2", widthEmu: P.pt(3) });
    P.setShapeStrokeCap(sh, "flat");
    P.setShapeStrokeArrow(sh, "tail", { type: "triangle" });
  } else P.setShapeNoStroke(sh);
  P.setShapeRotation(sh, rotation);
  if (flip) P.setShapeFlip(sh, flip);
  const bytes = await P.savePresentation(p);
  if (alpha === null && requested.w >= 0 && requested.h >= 0) return bytes;
  const files = unzipSync(bytes),
    name = P.getSlidePartName(s).slice(1);
  let xml = strFromU8(files[name]);
  // Authoring APIs reject negative extents. Inject them only in malformed-input controls.
  if (requested.w < 0 || requested.h < 0)
    xml = xml.replace(
      /(<p:sp\b[^]*?<a:ext )cx="[^"]+" cy="[^"]+"/,
      `$1cx="${requested.w}" cy="${requested.h}"`,
    );
  if (alpha !== null)
    xml = xml.replace(
      '<a:srgbClr val="1267B2"/>',
      `<a:srgbClr val="1267B2"><a:alpha val="${alpha * 100000}"/></a:srgbClr>`,
    );
  files[name] = strToU8(xml);
  return zipSync(files);
}
