import { P, createDeck, parseDeck } from "../src/model.js";
import { INTERNAL_PACKAGE } from "../lib/pptx/src/api/_internal-symbols.ts";
import { geometryImage } from "./geometry-fixture.js";

export const replacementImage = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
    "base64",
  ),
);
export const originalImage = new Uint8Array(geometryImage);

// Two independent pictures can share one relationship, as in producer-authored
// files; different relationships can also share one media part after deduping.
export async function sharedImageFixture({ sameRelationship = true } = {}) {
  const source = createDeck("blank"),
    slide = P.getSlides(source)[0];
  P.addSlideImage(slide, geometryImage, {
    x: P.inches(1),
    y: P.inches(1),
    w: P.inches(4),
    h: P.inches(2),
  });
  P.addSlideImage(slide, geometryImage, {
    x: P.inches(6),
    y: P.inches(1),
    w: P.inches(3),
    h: P.inches(2),
  });
  const pkg = source[INTERNAL_PACKAGE],
    name = P.getSlidePartName(slide),
    rels = pkg.getRels(name),
    images = rels.items.filter((r) => r.type.endsWith("/image"));
  if (sameRelationship) {
    const part = pkg.getPart(name);
    part.data = new TextEncoder().encode(
      new TextDecoder()
        .decode(part.data)
        .replace(`r:embed="${images[1].id}"`, `r:embed="${images[0].id}"`),
    );
    rels.items = rels.items.filter((r) => r.id !== images[1].id);
  } else images[1].target = images[0].target;
  pkg.setRels(name, rels);
  const pres = await parseDeck(await P.savePresentation(source));
  return {
    pres,
    slide: P.getSlides(pres)[0],
    pictures: P.getSlideShapes(P.getSlides(pres)[0]),
  };
}
