import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { P, createDeck, parseDeck, preview } from "../src/model.js";
import { INTERNAL_PACKAGE } from "../lib/pptx/src/api/_internal-symbols.ts";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
  NS,
} from "../lib/pptx/src/internal/xml/index.ts";
import { resolveTarget } from "../lib/pptx/src/internal/opc/index.ts";
import { geometryImage } from "./geometry-fixture.js";
import { replacementImage } from "./image-replacement-fixture.js";
import {
  svgImageFixture,
  vectorImage,
  replacementVector,
  SVG_NS,
} from "./svg-image-fixture.js";

const contexts = [
  "picture",
  "shape fill",
  "slide background",
  "layout artwork",
  "master artwork",
  "layout background",
  "master background",
  "bullet",
];
const svg = (f) => decodeURIComponent(preview(f.pres, f.slide));
const shape = (f) => P.getSlideShapes(f.slide)[0];
const encoded = (bytes) => Buffer.from(bytes).toString("base64");

describe("SVG image references", () => {
  for (const context of contexts)
    it.each([false, true])(
      `resolves ${context} with raster fallback=%s without changing source XML`,
      async (fallback) => {
        const f = await svgImageFixture({ context, fallback });
        const before = unzipSync(await P.savePresentation(f.pres));
        expect(svg(f)).toContain(
          `data:image/svg+xml;base64,${encoded(vectorImage)}`,
        );
        if (context === "picture" || context === "shape fill") {
          const s = shape(f);
          expect(P.getShapeImageFormat(s)).toBe("svg");
          expect(P.getShapeImagePartName(s)).toBe(f.vectorName);
          expect(
            context === "picture"
              ? P.getShapeImageBytes(s)
              : P.getShapeImageFillBytes(s),
          ).toEqual(vectorImage);
          expect(P.hasShapeImage(s)).toBe(true);
        }
        expect(unzipSync(await P.savePresentation(f.pres))).toEqual(before);
        const restored = await parseDeck(await P.savePresentation(f.pres));
        expect(svg({ pres: restored, slide: P.getSlides(restored)[0] })).toBe(
          svg(f),
        );
      },
    );

  it.each([
    "missing relationship",
    "missing part",
    "wrong type",
    "external",
    "non-vector data",
    "foreign namespace",
  ])(
    "uses the authored raster fallback for %s, without following external resources",
    async (kind) => {
      const f = await svgImageFixture({
        fallback: true,
        relationship: kind,
        vectorBytes:
          kind === "non-vector data"
            ? new Uint8Array(geometryImage)
            : vectorImage,
        namespace: kind === "foreign namespace" ? "urn:unrelated" : undefined,
      });
      expect(P.getShapeImageBytes(shape(f))).toEqual(
        new Uint8Array(geometryImage),
      );
      expect(P.getShapeImageFormat(shape(f))).toBe("png");
      expect(svg(f)).toContain(
        `data:image/png;base64,${encoded(geometryImage)}`,
      );
    },
  );

  it("does not manufacture a picture when both embedded sources are unresolved", async () => {
    const f = await svgImageFixture({ relationship: "missing relationship" });
    expect(P.getShapeImageBytes(shape(f))).toBeNull();
    expect(P.getShapeImagePartName(shape(f))).toBeNull();
    expect(svg(f)).not.toContain("<image ");
    const before = unzipSync(await P.savePresentation(f.pres));
    expect(() => P.setShapeImage(shape(f), replacementImage)).toThrow();
    expect(unzipSync(await P.savePresentation(f.pres))).toEqual(before);
  });

  const metadata =
    '<a:ext uri="urn:retained"><cache:keep xmlns:cache="urn:cache" value="retained"/></a:ext><a:ext uri="urn:empty"/>';
  for (const fallback of [false, true])
    for (const replacement of ["raster", "vector"])
      it(`replaces ${fallback ? "dual-source" : "SVG-only"} pictures with ${replacement} media and retains independent formatting`, async () => {
        const f = await svgImageFixture({ fallback, metadata });
        const s = shape(f),
          bytes =
            replacement === "raster" ? replacementImage : replacementVector;
        P.setShapeImageCrop(s, {
          left: 0.125,
          top: 0.05,
          right: 0.2,
          bottom: 0,
        });
        P.setShapeRotation(s, 23);
        const bounds = P.getShapeBounds(s),
          crop = P.getShapeImageCrop(s);
        P.setShapeImage(s, bytes);
        expect(P.getShapeImageBytes(s)).toEqual(bytes);
        expect(P.getShapeBounds(s)).toEqual(bounds);
        expect(P.getShapeImageCrop(s)).toEqual(crop);
        expect(P.getShapeRotation(s)).toBe(23);
        expect(P.getShapeImageOpacity(s)).toBe(0.8);
        const xml = P.getShapeXmlString(s);
        expect(xml).toContain('uri="urn:retained"');
        expect(xml).toContain('uri="urn:empty"');
        expect(xml).toContain('value="retained"');
        expect(xml.includes("svgBlip")).toBe(replacement === "vector");
        if (replacement === "vector") {
          const refs = [];
          walkElements(parseXml(xml).root, (e) => {
            if (
              e.name.namespaceURI === SVG_NS &&
              e.name.localName === "svgBlip"
            )
              refs.push(getAttrValue(e, qname("r", "embed", NS.officeDocRels)));
          });
          expect(refs).toHaveLength(1);
          const owner = P.getSlidePartName(f.slide),
            pkg = f.pres[INTERNAL_PACKAGE],
            rel = pkg.getRels(owner).items.find((r) => r.id === refs[0]);
          expect(pkg.getPart(resolveTarget(owner, rel.target)).data).toEqual(
            bytes,
          );
        }
        const restored = await parseDeck(await P.savePresentation(f.pres)),
          rs = P.getSlideShapes(P.getSlides(restored)[0])[0];
        expect(P.getShapeImageBytes(rs)).toEqual(bytes);
        expect(P.getShapeImageOpacity(rs)).toBe(0.8);
      });

  it("isolates replacement of duplicated SVG sources and their raster compatibility media", async () => {
    const f = await svgImageFixture({ fallback: true }),
      original = svg(f),
      copied = P.duplicateSlide(f.pres, f.slide),
      picture = P.getSlideShapes(copied)[0];
    P.setShapeImage(picture, replacementVector);
    expect(P.getShapeImageBytes(shape(f))).toEqual(vectorImage);
    expect(P.getShapeImageBytes(picture)).toEqual(replacementVector);
    expect(svg(f)).toBe(original);
    expect(P.getShapeImagePartName(picture)).not.toBe(f.vectorName);
  });

  it("retains SVG image fills and pictures through the object clipboard boundaries in both directions", async () => {
    for (const context of ["picture", "shape fill"]) {
      const f = await svgImageFixture({ context }),
        target = createDeck("blank"),
        layout = P.getSlideLayouts(target)[0];
      const held = P.importSlide(target, f.slide, layout, {
        preserveTextFormatting: true,
        preservePaintFormatting: true,
      });
      const copied = P.copyShape(
        P.getSlides(target)[0],
        P.getSlideShapes(held)[0],
      );
      P.removeSlide(target, held);
      P.compactPackage(target);
      const imageBytes = (s) =>
        P.getShapeImageBytes(s) ?? P.getShapeImageFillBytes(s);
      expect(imageBytes(copied)).toEqual(vectorImage);
      const saved = await parseDeck(await P.savePresentation(target)),
        back = createDeck("blank");
      const returned = P.importSlide(
        back,
        P.getSlides(saved)[0],
        P.getSlideLayouts(back)[0],
        { preserveTextFormatting: true, preservePaintFormatting: true },
      );
      expect(imageBytes(P.getSlideShapes(returned)[0])).toEqual(vectorImage);
      expect(
        P.validatePresentation(saved).filter((i) => i.severity === "error"),
      ).toEqual([]);
    }
  });

  it("copies SVG template artwork with its owning relationships in both directions", async () => {
    for (const context of ["layout artwork", "master artwork"]) {
      const f = await svgImageFixture({ context }),
        target = createDeck("blank");
      const copied = P.importSlide(
        target,
        f.slide,
        P.importSlideTemplate(target, f.slide),
        { preserveGeometry: false },
      );
      expect(decodeURIComponent(preview(target, copied))).toContain(
        `data:image/svg+xml;base64,${encoded(vectorImage)}`,
      );
      expect(preview(target, copied)).toBe(preview(f.pres, f.slide));
      const saved = await parseDeck(await P.savePresentation(target)),
        back = createDeck("blank"),
        savedSlide = P.getSlides(saved).at(-1);
      const returned = P.importSlide(
        back,
        savedSlide,
        P.importSlideTemplate(back, savedSlide),
        { preserveGeometry: false },
      );
      expect(preview(back, returned)).toBe(preview(f.pres, f.slide));
    }
  });

  it("recognizes prefixed SVG document roots and refreshes live media changes", async () => {
    const f = await svgImageFixture({ vectorBytes: replacementVector });
    expect(P.getShapeImageFormat(shape(f))).toBe("svg");
    expect(P.getShapeImageBytes(shape(f))).toEqual(replacementVector);
    f.pres[INTERNAL_PACKAGE].getPart(f.vectorName).data = vectorImage;
    expect(P.getShapeImageBytes(shape(f))).toEqual(vectorImage);
  });
});
