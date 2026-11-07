import { P, createDeck, parseDeck, text } from "../src/model.js";
import { INTERNAL_PACKAGE } from "../lib/pptx/src/api/_internal-symbols.ts";
import { emptyRels } from "../lib/pptx/src/internal/opc/index.ts";
import { geometryImage } from "./geometry-fixture.js";

export const SVG_NS =
  "http://schemas.microsoft.com/office/drawing/2016/SVG/main";
export const vectorImage = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#2468BC"/><path d="M20 60 L60 20 L100 60 Z" fill="#F2C94C"/></svg>',
);
export const replacementVector = new TextEncoder().encode(
  '<v:svg xmlns:v="http://www.w3.org/2000/svg" width="90" height="70" viewBox="0 0 90 70"><v:rect width="90" height="70" fill="#C73B51"/></v:svg>',
);

/** Independent source XML, including the optional raster fallback image. */
export async function svgImageFixture({
  context = "picture",
  fallback = false,
  namespace = SVG_NS,
  relationship = "valid",
  vectorBytes = vectorImage,
  metadata = "",
} = {}) {
  const source = createDeck("blank"),
    slide = P.getSlides(source)[0],
    pkg = source[INTERNAL_PACKAGE];
  const bounds = {
    x: P.inches(1),
    y: P.inches(1),
    w: P.inches(4),
    h: P.inches(2.5),
  };
  const picture = P.addSlideImage(slide, geometryImage, bounds);
  const slideName = P.getSlidePartName(slide),
    layoutName = P.getSlideLayoutPartName(P.getSlideLayout(slide)),
    masterName = P.getSlideMasterPartName(slide);
  const pictureXml = new TextDecoder()
      .decode(pkg.getPart(slideName).data)
      .match(/<p:pic\b[\s\S]*?<\/p:pic>/)[0],
    legacyId = pictureXml.match(/r:embed="([^"]+)"/)[1];
  const owner = context.startsWith("layout")
    ? layoutName
    : context.startsWith("master")
      ? masterName
      : slideName;
  const legacy = pkg.getRels(slideName).items.find((r) => r.id === legacyId);
  const vectorName = "/ppt/media/authored-vector.svg",
    vectorId = "rIdVectorSource",
    rasterId = "rIdRasterSource";
  pkg.contentTypes.defaults.push({
    extension: "svg",
    contentType: "image/svg+xml",
  });
  if (relationship !== "missing part")
    pkg.addPart(vectorName, "image/svg+xml", vectorBytes);
  const rels = pkg.getRels(owner) ?? emptyRels();
  rels.items.push({ ...legacy, id: rasterId });
  if (relationship !== "missing relationship")
    rels.items.push({
      id: vectorId,
      type:
        relationship === "wrong type" ? "urn:unrelated-resource" : legacy.type,
      target:
        relationship === "external"
          ? "https://example.invalid/vector.svg"
          : vectorName,
      targetMode: relationship === "external" ? "External" : "Internal",
    });
  pkg.setRels(owner, rels);
  const blip = `<a:blip${fallback ? ` r:embed="${rasterId}"` : ""}><a:alphaModFix amt="80000"/><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><vector:svgBlip xmlns:vector="${namespace}" xmlns:links="http://schemas.openxmlformats.org/officeDocument/2006/relationships" links:embed="${vectorId}"/></a:ext>${metadata}</a:extLst></a:blip>`;
  const converted = pictureXml.replace(/<a:blip\b[^>]*\/>/, blip);
  const decode = (p) => new TextDecoder().decode(p.data),
    encode = (p, s) => {
      p.data = new TextEncoder().encode(s);
    };
  const slidePart = pkg.getPart(slideName);
  if (context === "picture")
    encode(slidePart, decode(slidePart).replace(pictureXml, converted));
  else {
    P.removeShape(picture);
    if (context === "shape fill") {
      const shape = P.addSlideShape(slide, { ...bounds, preset: "ellipse" });
      P.setShapeImageFill(shape, geometryImage);
      encode(slidePart, decode(slidePart).replace(/<a:blip\b[^>]*\/>/, blip));
    } else if (context === "bullet") {
      const bulletShape = text(slide, "Vector bullet", 1, 1, 5, 2, 24);
      P.setParagraphBullet(bulletShape, 0, "bullet");
      encode(
        slidePart,
        decode(slidePart).replace(
          /<a:pPr\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/a:pPr>)/,
          `<a:pPr><a:buBlip>${blip}</a:buBlip></a:pPr>`,
        ),
      );
    } else {
      const part = pkg.getPart(owner);
      if (context.endsWith("background")) {
        if (owner !== slideName)
          encode(
            slidePart,
            decode(slidePart).replace(/<p:bg\b[^>]*>[\s\S]*?<\/p:bg>/, ""),
          );
        encode(
          part,
          decode(part)
            .replace(/<p:bg\b[^>]*>[\s\S]*?<\/p:bg>/, "")
            .replace(
              /(<p:cSld\b[^>]*>)/,
              `$1<p:bg><p:bgPr><a:blipFill>${blip}<a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>`,
            ),
        );
      } else
        encode(
          part,
          decode(part).replace("</p:spTree>", converted + "</p:spTree>"),
        );
    }
  }
  const pres = await parseDeck(await P.savePresentation(source));
  return {
    pres,
    slide: P.getSlides(pres)[0],
    owner,
    vectorName,
    vectorId,
    rasterId,
  };
}
