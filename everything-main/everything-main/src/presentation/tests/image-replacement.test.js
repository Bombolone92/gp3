import { describe, expect, it } from "vitest";
import { P, createDeck, parseDeck, preview } from "../src/model.js";
import { INTERNAL_PACKAGE } from "../lib/pptx/src/api/_internal-symbols.ts";
import { resolveTarget } from "../lib/pptx/src/internal/opc/index.ts";
import { NS } from "../lib/pptx/src/internal/xml/index.ts";
import { unzipSync } from "fflate";
import {
  originalImage,
  replacementImage,
  sharedImageFixture,
} from "./image-replacement-fixture.js";

const pkg = (pres) => pres[INTERNAL_PACKAGE];
const replace = (part, from, to) => {
  part.data = new TextEncoder().encode(
    new TextDecoder().decode(part.data).replace(from, to),
  );
};
const imagePart = (pres, slide, index = 0) => {
  const rel = pkg(pres)
    .getRels(P.getSlidePartName(slide))
    .items.filter((r) => r.type.endsWith("/image"))[index];
  return pkg(pres).getPart(
    resolveTarget(P.getSlidePartName(slide), rel.target),
  );
};
describe("picture replacement isolation", () => {
  it("replaces a duplicated slide picture without changing its original shared media", async () => {
    const pres = createDeck("blank"),
      slide = P.getSlides(pres)[0];
    P.addSlideImage(slide, originalImage, {
      x: P.inches(1),
      y: P.inches(1),
      w: P.inches(4),
      h: P.inches(2),
    });
    const before = preview(pres, slide),
      original = imagePart(pres, slide),
      copy = P.duplicateSlide(pres, slide),
      picture = P.getSlideShapes(copy)[0],
      own = P.getShapeXmlString(picture);
    P.setShapeImage(picture, replacementImage);
    expect(preview(pres, slide)).toBe(before);
    expect(P.getShapeImageBytes(P.getSlideShapes(slide)[0])).toEqual(
      originalImage,
    );
    expect(original.data).toEqual(originalImage);
    expect(P.getShapeImageBytes(picture)).toEqual(replacementImage);
    expect(P.getShapeXmlString(picture)).toBe(own);
    const loaded = await parseDeck(await P.savePresentation(pres)),
      slides = P.getSlides(loaded);
    expect(P.getShapeImageBytes(P.getSlideShapes(slides[0])[0])).toEqual(
      originalImage,
    );
    expect(P.getShapeImageBytes(P.getSlideShapes(slides[1])[0])).toEqual(
      replacementImage,
    );
    expect(
      P.validatePresentation(loaded).filter((i) => i.severity === "error"),
    ).toEqual([]);
  });
  it.each([true, false])(
    "isolates pictures sharing a relationship=%s within one slide",
    async (sameRelationship) => {
      const { pres, slide, pictures } = await sharedImageFixture({
          sameRelationship,
        }),
        before = P.getShapeXmlString(pictures[1]);
      P.setShapeImage(pictures[0], replacementImage);
      expect(P.getShapeImageBytes(pictures[0])).toEqual(replacementImage);
      expect(P.getShapeImageBytes(pictures[1])).toEqual(originalImage);
      expect(P.getShapeXmlString(pictures[1])).toBe(before);
      const loaded = await parseDeck(await P.savePresentation(pres)),
        saved = P.getSlideShapes(P.getSlides(loaded)[0]);
      expect(P.getShapeImageBytes(saved[0])).toEqual(replacementImage);
      expect(P.getShapeImageBytes(saved[1])).toEqual(originalImage);
      expect(preview(loaded, P.getSlides(loaded)[0])).toBe(
        preview(pres, slide),
      );
    },
  );
  it("isolates a cross-format replacement even when the relationship is shared", async () => {
    const { pres, pictures } = await sharedImageFixture(),
      svg = new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="5"><rect width="9" height="5" fill="red"/></svg>',
      );
    P.setShapeImage(pictures[0], svg, { format: "svg" });
    expect(P.getShapeImageBytes(pictures[0])).toEqual(svg);
    expect(P.getShapeImageBytes(pictures[1])).toEqual(originalImage);
  });
  it("retains independent image edits through slide imports in both directions", async () => {
    const f = await sharedImageFixture(),
      target = createDeck("blank"),
      layout = P.importSlideTemplate(target, f.slide),
      copied = P.importSlide(target, f.slide, layout, {
        preserveGeometry: false,
      });
    P.setShapeImage(P.getSlideShapes(copied)[0], replacementImage);
    for (const picture of f.pictures)
      expect(P.getShapeImageBytes(picture)).toEqual(originalImage);
    const saved = await parseDeck(await P.savePresentation(target)),
      last = P.getSlides(saved).at(-1),
      returned = P.importSlide(
        f.pres,
        last,
        P.importSlideTemplate(f.pres, last),
        { preserveGeometry: false },
      ),
      pictures = P.getSlideShapes(returned);
    expect(P.getShapeImageBytes(pictures[0])).toEqual(replacementImage);
    expect(P.getShapeImageBytes(pictures[1])).toEqual(originalImage);
    expect(preview(f.pres, returned)).toBe(preview(saved, last));
  });
  it("retains a background that shares the edited picture's relationship", async () => {
    const f = await sharedImageFixture(),
      p = pkg(f.pres),
      name = P.getSlidePartName(f.slide),
      old = p.getRels(name).items.find((r) => r.type.endsWith("/image"));
    P.setSlideBackgroundImage(f.slide, originalImage);
    const rels = p.getRels(name),
      background = rels.items.filter((r) => r.type.endsWith("/image")).at(-1);
    replace(
      p.getPart(name),
      `r:embed="${background.id}"`,
      `r:embed="${old.id}"`,
    );
    rels.items = rels.items.filter((r) => r.id !== background.id);
    p.setRels(name, rels);
    const pres = await parseDeck(await P.savePresentation(f.pres)),
      slide = P.getSlides(pres)[0],
      picture = P.getSlideShapes(slide)[0];
    P.setShapeImage(picture, replacementImage);
    expect(P.getSlideBackgroundImageBytes(slide)).toEqual(originalImage);
    expect(P.getShapeImageBytes(picture)).toEqual(replacementImage);
  });
  it("keeps unique same-format media in place across repeated replacements", async () => {
    const pres = createDeck("blank"),
      slide = P.getSlides(pres)[0],
      picture = P.addSlideImage(slide, originalImage, {
        x: P.inches(1),
        y: P.inches(1),
        w: P.inches(4),
        h: P.inches(2),
      }),
      part = imagePart(pres, slide),
      count = pkg(pres).parts.length;
    P.setShapeImage(picture, replacementImage);
    expect(imagePart(pres, slide)).toBe(part);
    P.setShapeImage(picture, originalImage);
    expect(imagePart(pres, slide)).toBe(part);
    expect(pkg(pres).parts).toHaveLength(count);
  });
  it("isolates a grouped picture and updates all of its aliased relationship attributes", async () => {
    const f = await sharedImageFixture(),
      p = pkg(f.pres),
      name = P.getSlidePartName(f.slide),
      part = p.getPart(name),
      id = p.getRels(name).items.find((r) => r.type.endsWith("/image")).id;
    replace(
      part,
      "</a:blip>",
      `<a:extLst><a:ext uri="urn:retained"><foreign:resource xmlns:foreign="urn:cache" r:id="${id}"/></a:ext></a:extLst></a:blip>`,
    );
    // Self-closing blips are common, so add the extension to the first one.
    replace(
      part,
      `<a:blip r:embed="${id}"/>`,
      `<a:blip r:embed="${id}"><a:extLst><a:ext uri="urn:retained"><foreign:resource xmlns:foreign="urn:cache" r:id="${id}"/></a:ext></a:extLst></a:blip>`,
    );
    replace(part, "xmlns:r=", "xmlns:link=");
    part.data = new TextEncoder().encode(
      new TextDecoder().decode(part.data).replaceAll("r:", "link:"),
    );
    const pres = await parseDeck(await P.savePresentation(f.pres)),
      slide = P.getSlides(pres)[0],
      pictures = P.getSlideShapes(slide),
      group = P.groupShapes(pictures),
      children = P.getGroupChildren(group);
    P.setShapeImage(children[0], replacementImage, { fit: "contain" });
    expect(P.getShapeImageBytes(children[0])).toEqual(replacementImage);
    expect(P.getShapeImageBytes(children[1])).toEqual(originalImage);
    const xml = P.getShapeXmlString(children[0]),
      newId = xml.match(/link:embed="([^"]+)"/)[1];
    expect(newId).not.toBe(id);
    expect(xml).toContain(`link:id="${newId}"`);
    expect(P.getShapeBounds(children[0])).toMatchObject({
      w: P.inches(2),
      h: P.inches(2),
    });
  });
  it.each(["layout", "package root", "unknown part"])(
    "retains media referenced by a %s relationship",
    async (location) => {
      const pres = createDeck("blank"),
        slide = P.getSlides(pres)[0],
        picture = P.addSlideImage(slide, originalImage, {
          x: P.inches(1),
          y: P.inches(1),
          w: P.inches(4),
          h: P.inches(2),
        }),
        p = pkg(pres),
        old = imagePart(pres, slide);
      const reference = {
        id: "resource",
        type: "urn:retained-image-resource",
        target: old.name.toUpperCase(),
        targetMode: "Internal",
      };
      if (location === "package root")
        p.setRootRels({ items: [...p.rootRels().items, reference] });
      else if (location === "layout") {
        const name = P.getSlideLayoutPartName(P.getSlideLayout(slide));
        p.setRels(name, { items: [...p.getRels(name).items, reference] });
      } else {
        p.addPart(
          "/other/metadata.xml",
          "application/xml",
          new TextEncoder().encode("<metadata/>"),
        );
        p.setRels("/other/metadata.xml", { items: [reference] });
      }
      P.setShapeImage(picture, replacementImage);
      expect(old.data).toEqual(originalImage);
      expect(P.getShapeImageBytes(picture)).toEqual(replacementImage);
    },
  );
  it.each([false, true])(
    "distinguishes foreign attributes from native relationship references=%s",
    async (native) => {
      const f = await sharedImageFixture(),
        p = pkg(f.pres),
        name = P.getSlidePartName(f.slide),
        rel = p.getRels(name).items.find((r) => r.type.endsWith("/image"));
      // Make the second picture independent before adding the extension.
      P.setShapeImage(f.pictures[1], replacementImage);
      const part = p.getPart(name);
      replace(
        part,
        "</p:sld>",
        `<p:extLst><p:ext uri="urn:retained"><foreign:ref xmlns:foreign="urn:foreign" xmlns:link="${native ? NS.officeDocRels : "urn:foreign-link"}" link:id="${rel.id}"/></p:ext></p:extLst></p:sld>`,
      );
      const pres = await parseDeck(await P.savePresentation(f.pres)),
        slide = P.getSlides(pres)[0],
        picture = P.getSlideShapes(slide)[0],
        before = imagePart(pres, slide);
      P.setShapeImage(picture, replacementImage);
      expect(before.data).toEqual(native ? originalImage : replacementImage);
      expect(P.getSlideXmlString(slide)).toContain(`link:id="${rel.id}"`);
    },
  );
  it("preserves possible references in malformed unused relationship tables", async () => {
    const pres = createDeck("blank"),
      slide = P.getSlides(pres)[0],
      picture = P.addSlideImage(slide, originalImage, {
        x: P.inches(1),
        y: P.inches(1),
        w: P.inches(4),
        h: P.inches(2),
      }),
      p = pkg(pres),
      old = imagePart(pres, slide);
    p.addPart(
      "/other/_rels/opaque.xml.rels",
      "application/vnd.openxmlformats-package.relationships+xml",
      new TextEncoder().encode("<unreadable"),
    );
    P.setShapeImage(picture, replacementImage);
    expect(old.data).toEqual(originalImage);
    expect(P.getShapeImageBytes(picture)).toEqual(replacementImage);
  });
  it("invalidates sharing information when relationships are added and removed", () => {
    const pres = createDeck("blank"),
      slide = P.getSlides(pres)[0],
      picture = P.addSlideImage(slide, originalImage, {
        x: P.inches(1),
        y: P.inches(1),
        w: P.inches(4),
        h: P.inches(2),
      });
    P.setShapeImage(picture, replacementImage);
    const copy = P.duplicateSlide(pres, slide);
    P.setShapeImage(picture, originalImage);
    expect(P.getShapeImageBytes(P.getSlideShapes(copy)[0])).toEqual(
      replacementImage,
    );
    const part = imagePart(pres, slide),
      count = pkg(pres).parts.length;
    P.setShapeImage(picture, replacementImage);
    expect(imagePart(pres, slide)).toBe(part);
    expect(pkg(pres).parts).toHaveLength(count);
  });
  it.each(["external", "wrong type", "missing media"])(
    "rejects %s image references before any mutation",
    async (broken) => {
      const f = await sharedImageFixture(),
        p = pkg(f.pres),
        name = P.getSlidePartName(f.slide),
        rels = p.getRels(name),
        rel = rels.items.find((r) => r.type.endsWith("/image"));
      if (broken === "external") rel.targetMode = "External";
      else if (broken === "wrong type") rel.type = "urn:wrong-type";
      else p.removePart(resolveTarget(name, rel.target));
      p.setRels(name, rels);
      const before = unzipSync(p.save());
      expect(() => P.setShapeImage(f.pictures[0], replacementImage)).toThrow();
      expect(unzipSync(p.save())).toEqual(before);
    },
  );
});
