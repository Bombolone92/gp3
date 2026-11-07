import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { P, createDeck, parseDeck, preview } from "../src/model.js";
import { REL_TYPES } from "../lib/pptx/src/internal/presentationml/index.ts";
import { resolveTarget } from "../lib/pptx/src/internal/opc/index.ts";
import {
  originalImage,
  replacementImage,
  sharedImageFixture,
} from "./image-replacement-fixture.js";

const pkg = (pres) => P._internalPackageOf(pres);
const snapshot = (pres) => unzipSync(pkg(pres).save());
const imageRel = (pres, slide) =>
  pkg(pres)
    .getRels(P.getSlidePartName(slide))
    .items.find((r) => r.type === REL_TYPES.image);
const related = (pres, slide, id) => {
  const owner = P.getSlidePartName(slide);
  const r = pkg(pres)
    .getRels(owner)
    .items.find((r) => r.id === id);
  expect(r).toBeDefined();
  return pkg(pres).getPart(resolveTarget(owner, r.target));
};
const copy = (target, source) =>
  P.importSlide(target, source, P.getSlideLayouts(target)[0]);

describe("slide resource transfers", () => {
  it("preserves shared media across distinct relationship IDs and isolates later edits", async () => {
    const f = await sharedImageFixture({ sameRelationship: false });
    const before = snapshot(f.pres),
      target = createDeck("blank");
    const copied = copy(target, f.slide),
      owner = P.getSlidePartName(copied);
    const images = pkg(target)
      .getRels(owner)
      .items.filter((r) => r.type === REL_TYPES.image);
    expect(images).toHaveLength(2);
    expect(resolveTarget(owner, images[0].target)).toBe(
      resolveTarget(owner, images[1].target),
    );
    expect(preview(target, copied)).toBe(preview(f.pres, f.slide));
    expect(snapshot(f.pres)).toEqual(before);
    P.setShapeImage(P.getSlideShapes(copied)[0], replacementImage);
    expect(P.getShapeImageBytes(P.getSlideShapes(copied)[1])).toEqual(
      originalImage,
    );
    const reopened = await parseDeck(await P.savePresentation(target));
    const returned = copy(f.pres, P.getSlides(reopened).at(-1));
    expect(P.getShapeImageBytes(P.getSlideShapes(returned)[0])).toEqual(
      replacementImage,
    );
    expect(P.getShapeImageBytes(f.pictures[0])).toEqual(originalImage);
    expect(before[P.getSlidePartName(f.slide).slice(1)]).toEqual(
      snapshot(f.pres)[P.getSlidePartName(f.slide).slice(1)],
    );
  });

  it("uses part overrides without changing an existing extension default", async () => {
    const f = await sharedImageFixture(),
      target = createDeck("blank"),
      oldName = "/assets/existing.png";
    pkg(target).contentTypes.defaults.push({
      extension: "png",
      contentType: "application/custom-existing",
    });
    pkg(target).addPart(
      oldName,
      "application/custom-existing",
      replacementImage,
    );
    const defaults = structuredClone(pkg(target).contentTypes.defaults),
      copied = copy(target, f.slide),
      resource = related(target, copied, imageRel(f.pres, f.slide).id);
    expect(resource.contentType).toBe("image/png");
    expect(pkg(target).contentTypes.defaults).toEqual(defaults);
    const restored = await parseDeck(await P.savePresentation(target));
    expect(pkg(restored).getPart(oldName).contentType).toBe(
      "application/custom-existing",
    );
    expect(pkg(restored).getPart(oldName).data).toEqual(replacementImage);
    expect(pkg(restored).getPart(resource.name).contentType).toBe("image/png");
    expect(pkg(restored).getPart(resource.name).data).toEqual(originalImage);
  });

  it("copies resource dependencies and sharing across different relationship kinds", async () => {
    const source = createDeck("blank"),
      slide = P.getSlides(source)[0],
      name = P.getSlidePartName(slide),
      asset = "/clips/shared clip.mp4",
      sidecar = "/clips/metadata.xml";
    pkg(source).addPart(asset, "video/mp4", new Uint8Array([1, 7, 3]));
    pkg(source).addPart(
      sidecar,
      "application/xml",
      new TextEncoder().encode("<metadata/>"),
    );
    pkg(source).setRels(asset, {
      items: [
        {
          id: "nativeMetadata",
          type: "urn:metadata",
          target: "metadata.xml",
          targetMode: "Internal",
        },
      ],
    });
    pkg(source).setRels(sidecar, {
      items: [
        {
          id: "nativeClip",
          type: "urn:clip",
          target: "shared clip.mp4",
          targetMode: "Internal",
        },
      ],
    });
    const rels = pkg(source).getRels(name);
    for (const kind of ["video", "media"])
      rels.items.push({
        id: kind,
        type: REL_TYPES[kind],
        target: asset,
        targetMode: "Internal",
      });
    pkg(source).setRels(name, rels);
    for (const target of [createDeck("blank"), source]) {
      const before = snapshot(source),
        copied = copy(target, slide),
        video = related(target, copied, "video"),
        media = related(target, copied, "media");
      expect(video).toBe(media);
      expect(video.data).toEqual(new Uint8Array([1, 7, 3]));
      const metadata = pkg(target).getPart(
        resolveTarget(
          video.name,
          pkg(target).getRels(video.name).items[0].target,
        ),
      );
      const back = resolveTarget(
        metadata.name,
        pkg(target).getRels(metadata.name).items[0].target,
      );
      expect(back).toBe(video.name);
      expect(new TextDecoder().decode(metadata.data)).toBe("<metadata/>");
      if (target !== source) expect(snapshot(source)).toEqual(before);
      else expect(video.name).not.toBe(asset);
      const restored = await parseDeck(await P.savePresentation(target));
      expect(
        related(restored, P.getSlides(restored).at(-1), "video").data,
      ).toEqual(video.data);
    }
  });

  it.each([
    "case collision",
    "dangling relationship",
    "orphan relationship part",
  ])(
    "reserves %s names without altering the target's previous resources",
    async (kind) => {
      const f = await sharedImageFixture(),
        target = createDeck("blank");
      const sourceImage = related(
        f.pres,
        f.slide,
        imageRel(f.pres, f.slide).id,
      );
      // Include the legacy allocator's next name as well as the source name.
      const occupied = [
        ...new Set([sourceImage.name, "/ppt/media/image1.png"]),
      ];
      for (const name of occupied) {
        if (kind === "case collision")
          pkg(target).addPart(
            name.toUpperCase(),
            "image/png",
            replacementImage,
          );
        if (kind === "dangling relationship") {
          const owner = P.getSlidePartName(P.getSlides(target)[0]),
            rels = pkg(target).getRels(owner);
          rels.items.push({
            id: `missing${rels.items.length}`,
            type: REL_TYPES.image,
            target: name.toUpperCase(),
            targetMode: "Internal",
          });
          pkg(target).setRels(owner, rels);
        }
        if (kind === "orphan relationship part")
          pkg(target).setRels(name, { items: [] });
      }
      const before = snapshot(target),
        copied = copy(target, f.slide);
      const resource = related(target, copied, imageRel(f.pres, f.slide).id);
      expect(occupied.map((n) => n.toLowerCase())).not.toContain(
        resource.name.toLowerCase(),
      );
      for (const [name, bytes] of Object.entries(before)) {
        if (
          [
            "ppt/presentation.xml",
            "ppt/_rels/presentation.xml.rels",
            "[Content_Types].xml",
          ].includes(name)
        )
          continue;
        expect(snapshot(target)[name]).toEqual(bytes);
      }
      expect(P.getShapeImageBytes(P.getSlideShapes(copied)[0])).toEqual(
        originalImage,
      );
    },
  );

  it("retains external picture relationships and their authored URLs without fetching them", async () => {
    const f = await sharedImageFixture(),
      name = P.getSlidePartName(f.slide);
    const rels = pkg(f.pres).getRels(name),
      r = imageRel(f.pres, f.slide);
    Object.assign(
      rels.items.find((x) => x.id === r.id),
      {
        target: "https://example.com/image.png?size=large#asset",
        targetMode: "External",
      },
    );
    pkg(f.pres).setRels(name, rels);
    const part = pkg(f.pres).getPart(name);
    part.data = new TextEncoder().encode(
      new TextDecoder()
        .decode(part.data)
        .replaceAll(`r:embed="${r.id}"`, `r:link="${r.id}"`),
    );
    const source = await parseDeck(pkg(f.pres).save()),
      target = createDeck("blank");
    const copied = copy(target, P.getSlides(source)[0]);
    expect(
      pkg(target)
        .getRels(P.getSlidePartName(copied))
        .items.find((x) => x.id === r.id),
    ).toEqual({
      ...r,
      target: "https://example.com/image.png?size=large#asset",
      targetMode: "External",
    });
    const reopened = await parseDeck(await P.savePresentation(target));
    const returned = copy(createDeck("blank"), P.getSlides(reopened).at(-1));
    expect(P.getSlideXmlString(returned)).toContain(`r:link="${r.id}"`);
  });

  it.each([
    [
      "audio",
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio",
    ],
    [
      "video",
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/video",
    ],
    ["media", "http://schemas.microsoft.com/office/2007/relationships/media"],
  ])("uses the specified %s relationship URI", (key, uri) => {
    expect(REL_TYPES[key]).toBe(uri);
  });

  it.each(["audio", "video", "media"])(
    "retains internal and external %s resources through both transfer legs",
    async (kind) => {
      const source = createDeck("blank"),
        slide = P.getSlides(source)[0],
        name = P.getSlidePartName(slide);
      const uri =
        kind === "media"
          ? "http://schemas.microsoft.com/office/2007/relationships/media"
          : `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}`;
      const asset = `/assets/native clip.${kind === "audio" ? "wav" : "mp4"}`,
        bytes = new Uint8Array([0, 9, 2, 7]);
      const type = kind === "audio" ? "audio/wav" : "video/mp4";
      pkg(source).addPart(asset, type, bytes);
      const rels = pkg(source).getRels(name);
      rels.items.push(
        {
          id: "embeddedResource",
          type: uri,
          target: asset,
          targetMode: "Internal",
        },
        {
          id: "linkedResource",
          type: uri,
          target: "https://example.com/clip",
          targetMode: "External",
        },
      );
      pkg(source).setRels(name, rels);
      const before = snapshot(source),
        target = createDeck("blank"),
        copied = copy(target, slide);
      const r = related(target, copied, "embeddedResource");
      expect(r.data).toEqual(bytes);
      expect(r.contentType).toBe(type);
      expect(r.data).not.toBe(pkg(source).getPart(asset).data);
      const restored = await parseDeck(await P.savePresentation(target)),
        back = createDeck("blank");
      const returned = copy(back, P.getSlides(restored).at(-1));
      expect(related(back, returned, "embeddedResource").data).toEqual(bytes);
      expect(
        pkg(back)
          .getRels(P.getSlidePartName(returned))
          .items.find((r) => r.id === "linkedResource").targetMode,
      ).toBe("External");
      expect(snapshot(source)).toEqual(before);
    },
  );

  it("preserves a transition's native sound action and audio payload without rewriting its slide body", async () => {
    const source = createDeck("blank"),
      slide = P.getSlides(source)[0],
      owner = P.getSlidePartName(slide);
    P.setSlideTransition(slide, { effect: "fade", advanceAfterMs: 4300 });
    const part = pkg(source).getPart(owner);
    part.data = new TextEncoder().encode(
      new TextDecoder()
        .decode(part.data)
        .replace(
          "</p:transition>",
          '<p:sndAc><p:stSnd loop="1"><p:snd r:embed="nativeSound" name="Cue"/></p:stSnd></p:sndAc></p:transition>',
        ),
    );
    pkg(source).addPart(
      "/assets/cue.wav",
      "audio/wav",
      new Uint8Array([4, 3, 2, 1]),
    );
    const rels = pkg(source).getRels(owner);
    rels.items.push({
      id: "nativeSound",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio",
      target: "/assets/cue.wav",
      targetMode: "Internal",
    });
    pkg(source).setRels(owner, rels);
    const reloaded = await parseDeck(pkg(source).save()),
      target = createDeck("blank");
    const copied = copy(target, P.getSlides(reloaded)[0]);
    expect(P.getSlideXmlString(copied)).toBe(
      P.getSlideXmlString(P.getSlides(reloaded)[0]),
    );
    expect(related(target, copied, "nativeSound").data).toEqual(
      new Uint8Array([4, 3, 2, 1]),
    );
    expect(
      P.validatePresentation(target).filter((i) => i.severity === "error"),
    ).toEqual([]);
  });

  it.each(["image", "audio"])(
    "rejects a missing %s part atomically instead of exporting a dangling reference",
    async (kind) => {
      const f = await sharedImageFixture(),
        target = createDeck("blank"),
        owner = P.getSlidePartName(f.slide);
      if (kind === "image")
        pkg(f.pres).removePart(
          related(f.pres, f.slide, imageRel(f.pres, f.slide).id).name,
        );
      else {
        const rels = pkg(f.pres).getRels(owner);
        rels.items.push({
          id: "missingSound",
          type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio",
          target: "/missing.wav",
          targetMode: "Internal",
        });
        pkg(f.pres).setRels(owner, rels);
      }
      const before = snapshot(target),
        slides = P.getSlides(target);
      expect(() => copy(target, f.slide)).toThrow(/missing dependency/);
      expect(snapshot(target)).toEqual(before);
      expect(P.getSlides(target)).toBe(slides);
    },
  );
});
