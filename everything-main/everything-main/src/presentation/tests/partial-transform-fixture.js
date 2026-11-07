import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, parseDeck } from "../src/model.js";
import { createGeometryDeck, presetGeometry } from "./geometry-fixture.js";

export const transformOffset = (x, y) => `<a:off x="${x}" y="${y}"/>`;
export const transformExtent = (w, h) => `<a:ext cx="${w}" cy="${h}"/>`;
export const transformXml = (children = "", attributes = "") =>
  `<a:xfrm${attributes ? ` ${attributes}` : ""}>${children}</a:xfrm>`;

// Independent values at every level make unwanted component inheritance
// observable. null removes the transform; an empty string keeps an empty one.
export async function partialTransformFixture({
  kind = "picture",
  local = null,
  localAttributes = "",
  layout = transformOffset(370000, 540000) + transformExtent(2800000, 1600000),
  master = transformOffset(610000, 830000) + transformExtent(4100000, 2200000),
  placeholder = true,
} = {}) {
  const bytes = await createGeometryDeck({
    shapeKind: kind,
    geometry: presetGeometry("rect"),
    level: "master",
    placeholder: placeholder ? '<p:ph type="pic" idx="42"/>' : "",
  });
  const source = await parseDeck(bytes),
    slide = P.getSlides(source)[0];
  const files = unzipSync(bytes);
  for (const [name, content] of [
    [P.getSlidePartName(slide), local],
    [P.getSlideLayoutPartName(P.getSlideLayout(slide)), layout],
    [P.getSlideMasterPartName(slide), master],
  ]) {
    const key = name.slice(1);
    files[key] = strToU8(
      strFromU8(files[key]).replace(
        /<p:spPr>([\s\S]*?)<\/p:spPr>/,
        (_, properties) => {
          return (
            "<p:spPr>" +
            properties.replace(
              /<a:xfrm\b[\s\S]*?<\/a:xfrm>/,
              content === null
                ? ""
                : transformXml(
                    content,
                    name === P.getSlidePartName(slide) ? localAttributes : "",
                  ),
            ) +
            "</p:spPr>"
          );
        },
      ),
    );
  }
  return zipSync(files);
}
