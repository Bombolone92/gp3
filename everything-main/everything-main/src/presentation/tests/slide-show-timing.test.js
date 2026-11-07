import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { P, createDeck, parseDeck } from "../src/model.js";
import { INTERNAL_PACKAGE } from "../lib/pptx/src/api/_internal-symbols.ts";
import { partName } from "../lib/pptx/src/internal/opc/index.ts";
import { NS } from "../lib/pptx/src/internal/xml/index.ts";
const enc = new TextEncoder();
const defaults = { useTimings: true, loop: false };
function setup(content = "<p:showPr/>") {
  const pres = createDeck("blank");
  const pkg = pres[INTERNAL_PACKAGE];
  const part = pkg.getPart(partName("/ppt/presProps.xml"));
  part.data = enc.encode(
    `<p:presentationPr xmlns:p="${NS.pml}" xmlns:mc="${NS.mc}">${content}</p:presentationPr>`,
  );
  return { pres, pkg, part };
}
describe("presentation-wide slide-show timing options", () => {
  it.each(["", "<p:showPr/>"])(
    "uses the schema defaults for %s",
    async (content) => {
      const { pres } = setup(content);
      const before = unzipSync(await P.savePresentation(pres));
      expect(P.getSlideShowTimingOptions(pres)).toEqual(defaults);
      expect(unzipSync(await P.savePresentation(pres))).toEqual(before);
    },
  );
  it.each([
    ['useTimings="0" loop="1"', { useTimings: false, loop: true }],
    ['useTimings="false" loop="true"', { useTimings: false, loop: true }],
    ['useTimings=" true " loop=" 0 "', defaults],
    ['useTimings="FALSE" loop="anything"', defaults],
  ])("reads boolean timing properties %s", (attrs, expected) => {
    expect(
      P.getSlideShowTimingOptions(setup(`<p:showPr ${attrs}/>`).pres),
    ).toEqual(expected);
  });
  it("uses namespace identities rather than local names or prefixes", () => {
    const f = setup(
      `<other:showPr xmlns:other="urn:foreign" useTimings="0" loop="1"/><alias:showPr xmlns:alias="${NS.pml}" useTimings="false"/>`,
    );
    expect(P.getSlideShowTimingOptions(f.pres)).toEqual({
      useTimings: false,
      loop: false,
    });
  });
  it("selects the understood compatibility fallback without rewriting alternatives", async () => {
    const f = setup(
      '<mc:AlternateContent xmlns:new="urn:future"><mc:Choice Requires="new"><p:showPr loop="1"/></mc:Choice><mc:Fallback><p:showPr useTimings="0"/></mc:Fallback></mc:AlternateContent>',
    );
    const before = unzipSync(await P.savePresentation(f.pres));
    expect(P.getSlideShowTimingOptions(f.pres)).toEqual({
      useTimings: false,
      loop: false,
    });
    expect(unzipSync(await P.savePresentation(f.pres))).toEqual(before);
  });
  it.each(["../settings/show.xml", "/settings/show.xml"])(
    "resolves the presentation-properties relationship %s",
    (target) => {
      const f = setup('<p:showPr loop="1"/>');
      const rels = f.pkg.getRels(partName("/ppt/presentation.xml"));
      rels.items.find((r) => r.type.endsWith("/presProps")).target = target;
      f.pkg.setRels(partName("/ppt/presentation.xml"), rels);
      f.pkg.addPart(
        partName("/settings/show.xml"),
        f.part.contentType,
        f.part.data,
      );
      f.pkg.removePart(f.part.name);
      expect(P.getSlideShowTimingOptions(f.pres)).toEqual({
        useTimings: true,
        loop: true,
      });
    },
  );
  it("locates the main presentation from its package-root relationship", () => {
    const f = setup('<p:showPr useTimings="0" loop="1"/>');
    const main = f.pkg.getPart(partName("/ppt/presentation.xml"));
    const rels = f.pkg.getRels(main.name);
    f.pkg.addPart(partName("/deck/main.xml"), main.contentType, main.data);
    rels.items.find((r) => r.type.endsWith("/presProps")).target =
      "/ppt/presProps.xml";
    f.pkg.setRels(partName("/deck/main.xml"), rels);
    f.pkg.removePart(main.name);
    const root = f.pkg.getPart(partName("/_rels/.rels"));
    root.data = enc.encode(
      new TextDecoder()
        .decode(root.data)
        .replace('Target="ppt/presentation.xml"', 'Target="./deck/main.xml"'),
    );
    expect(P.getSlideShowTimingOptions(f.pres)).toEqual({
      useTimings: false,
      loop: true,
    });
  });
  it.each(["missing", "external", "unrelated"])(
    "does not guess options from an unreachable %s properties part",
    (reason) => {
      const f = setup('<p:showPr useTimings="0" loop="1"/>');
      const rels = f.pkg.getRels(partName("/ppt/presentation.xml"));
      const rel = rels.items.find((r) => r.type.endsWith("/presProps"));
      if (reason === "missing") rel.target = "missing.xml";
      if (reason === "external") rel.targetMode = "External";
      if (reason === "unrelated")
        rels.items = rels.items.filter((r) => r !== rel);
      f.pkg.setRels(partName("/ppt/presentation.xml"), rels);
      expect(P.getSlideShowTimingOptions(f.pres)).toEqual(defaults);
    },
  );
  it("re-reads changed property bytes and relationships without cross-package cache leakage", async () => {
    const f = setup('<p:showPr useTimings="0"/>');
    const other = setup('<p:showPr loop="1"/>');
    expect(P.getSlideShowTimingOptions(f.pres)).toEqual({
      useTimings: false,
      loop: false,
    });
    f.part.data = enc.encode(
      `<p:presentationPr xmlns:p="${NS.pml}"><p:showPr loop="1"/></p:presentationPr>`,
    );
    expect(P.getSlideShowTimingOptions(f.pres)).toEqual({
      useTimings: true,
      loop: true,
    });
    expect(P.getSlideShowTimingOptions(other.pres)).toEqual({
      useTimings: true,
      loop: true,
    });
    const rels = f.pkg.getRels(partName("/ppt/presentation.xml"));
    rels.items.find((r) => r.type.endsWith("/presProps")).target =
      "../settings/new.xml";
    f.pkg.addPart(
      partName("/settings/new.xml"),
      f.part.contentType,
      enc.encode(
        `<p:presentationPr xmlns:p="${NS.pml}"><p:showPr useTimings="0"/></p:presentationPr>`,
      ),
    );
    f.pkg.setRels(partName("/ppt/presentation.xml"), rels);
    expect(P.getSlideShowTimingOptions(f.pres)).toEqual({
      useTimings: false,
      loop: false,
    });
    const restored = await parseDeck(await P.savePresentation(f.pres));
    expect(P.getSlideShowTimingOptions(restored)).toEqual({
      useTimings: false,
      loop: false,
    });
  });
  it("copies slide timers in both directions without replacing destination show preferences", async () => {
    const source = setup('<p:showPr useTimings="0" loop="1"/>').pres;
    const target = setup('<p:showPr useTimings="1" loop="0"/>').pres;
    const slide = P.getSlides(source)[0];
    P.setSlideTransition(slide, {
      effect: "none",
      advanceAfterMs: 3210,
      advanceOnClick: false,
    });
    const copied = P.importSlide(
      target,
      slide,
      P.getSlideLayout(P.getSlides(target)[0]),
    );
    const back = P.importSlide(source, copied, P.getSlideLayout(slide));
    for (const item of [copied, back])
      expect(P.getSlideTransition(item)).toEqual({
        effect: "none",
        advanceAfterMs: 3210,
        advanceOnClick: false,
      });
    expect(
      P.getSlideShowTimingOptions(
        await parseDeck(await P.savePresentation(target)),
      ),
    ).toEqual(defaults);
    expect(
      P.getSlideShowTimingOptions(
        await parseDeck(await P.savePresentation(source)),
      ),
    ).toEqual({ useTimings: false, loop: true });
  });
});
