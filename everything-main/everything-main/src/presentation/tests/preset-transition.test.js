import { describe, expect, it } from "vitest";
import { P, createDeck, parseDeck } from "../src/model.js";
import { NS } from "../lib/pptx/src/internal/xml/index.ts";
import { fixture } from "./slide-transition-fixture.js";
import { presetTransition } from "./preset-transition-fixture.js";

const legacy = { effect: "fade", speed: "med", advanceAfterMs: 9200 };
const modern = (effect, extra = {}) => ({
  effect,
  speed: "slow",
  durationMs: 2450,
  advanceOnClick: false,
  advanceAfterMs: 8100,
  ...extra,
});

describe("p15 preset transition semantics", () => {
  for (const effect of ["pageCurlDouble", "pageCurlSingle"]) {
    it.each([
      ["", {}],
      ['invX="true" invY="0"', { invertX: true, invertY: false }],
      ['invX="false" invY="1"', { invertX: false, invertY: true }],
      ['invX="1" invY="true"', { invertX: true, invertY: true }],
      ['invX="invalid" invY=""', {}],
    ])(
      `reads ${effect} coordinate inversions %s without rewriting XML`,
      async (inversion, extra) => {
        const f = await fixture(presetTransition(effect, { inversion }));
        const original = P.getSlideXmlString(f.slide);
        expect(P.getSlideTransition(f.slide)).toEqual(modern(effect, extra));
        expect(P.getEffectiveSlideTransition(f.slide)).toEqual(
          modern(effect, extra),
        );
        const restored = await parseDeck(await P.savePresentation(f.pres));
        expect(P.getSlideXmlString(P.getSlides(restored)[0])).toBe(original);
      },
    );
    it.each([new Set(["fade"]), new Set()])(
      `selects ${effect}'s authored fallback for a consumer lacking the preset`,
      async (supportedEffects) => {
        const f = await fixture(presetTransition(effect));
        expect(P.getSlideTransition(f.slide, { supportedEffects })).toEqual(
          legacy,
        );
        expect(
          P.getSlideTransition(f.slide, {
            supportedEffects: new Set([effect]),
          }),
        ).toEqual(modern(effect));
      },
    );
    it.each([undefined, 0, 3670])(
      `authors ${effect} with duration %s and a legacy alternative`,
      async (durationMs) => {
        const f = await fixture("");
        const options = {
          effect,
          invertX: true,
          invertY: false,
          speed: "fast",
          advanceAfterMs: 6700,
          advanceOnClick: false,
          ...(durationMs === undefined ? {} : { durationMs }),
        };
        P.setSlideTransition(f.slide, options);
        expect(P.getSlideTransition(f.slide)).toEqual(options);
        const xml = P.getSlideXmlString(f.slide);
        expect(xml).toContain(
          `<p15:prstTrans prst="${effect}" invX="1" invY="0"/>`,
        );
        expect(xml).not.toContain(`<p:${effect}`);
        expect(
          P.getSlideTransition(f.slide, {
            supportedEffects: new Set(["fade"]),
          }),
        ).toEqual({
          effect: "fade",
          speed: "fast",
          advanceAfterMs: 6700,
          advanceOnClick: false,
        });
        const restored = await parseDeck(await P.savePresentation(f.pres));
        expect(P.getSlideTransition(P.getSlides(restored)[0])).toEqual(options);
      },
    );
  }
  it("selects a later known preset choice after an unknown preset", async () => {
    const xml = presetTransition("pageCurlSingle").replace(
      '<mc:Choice Requires="preset">',
      '<mc:Choice Requires="preset"><p:transition><preset:prstTrans prst="future"/></p:transition></mc:Choice><mc:Choice Requires="preset">',
    );
    const f = await fixture(xml);
    expect(P.getSlideTransition(f.slide)).toEqual(modern("pageCurlSingle"));
  });
  it("does not infer support from a familiar prefix bound to a foreign URI", async () => {
    const f = await fixture(presetTransition().replace(NS.p15, "urn:foreign"));
    expect(P.getSlideTransition(f.slide)).toEqual(legacy);
  });
  it.each(["future", "", "pageCurlSingle "])(
    "retains unknown preset %s and selects the authored fallback",
    async (preset) => {
      const f = await fixture(presetTransition(preset, { fallback: "push" }));
      expect(P.getSlideTransition(f.slide)).toEqual({
        ...legacy,
        effect: "push",
      });
      expect(P.getSlideXmlString(f.slide)).toContain(`prst="${preset}"`);
    },
  );
  it("handles a direct preset and nested compatibility wrappers", async () => {
    const direct = `<p:transition xmlns:c="${NS.p15}"><c:prstTrans prst="pageCurlSingle" invX="1"/></p:transition>`;
    const f = await fixture(direct);
    expect(P.getSlideTransition(f.slide)).toEqual({
      effect: "pageCurlSingle",
      invertX: true,
    });
    const wrapped = await fixture(
      `<mc:AlternateContent xmlns:mc="${NS.mc}" xmlns:p="${NS.pml}"><mc:Choice Requires="p">${presetTransition("pageCurlSingle")}</mc:Choice></mc:AlternateContent>`,
    );
    expect(P.getSlideTransition(wrapped.slide)).toEqual(
      modern("pageCurlSingle"),
    );
  });
  it.each(["layout", "master"])(
    "inherits the nearest %s preset as a whole",
    async (level) => {
      const f = await fixture("", {
        [level]: presetTransition("pageCurlSingle", { inversion: 'invX="1"' }),
      });
      expect(P.getSlideTransition(f.slide)).toBeNull();
      expect(P.getEffectiveSlideTransition(f.slide)).toEqual(
        modern("pageCurlSingle", { invertX: true }),
      );
      P.setSlideTransition(f.slide, { effect: "none" });
      expect(P.getEffectiveSlideTransition(f.slide)).toEqual({
        effect: "none",
      });
      P.clearSlideTransition(f.slide);
      expect(P.getEffectiveSlideTransition(f.slide)?.effect).toBe(
        "pageCurlSingle",
      );
    },
  );
  it("retains presets through editing, duplication, source-template and clipboard transfers both ways", async () => {
    const f = await fixture("", {
      layout: presetTransition("pageCurlDouble", { inversion: 'invX="1"' }),
    });
    const duplicate = P.duplicateSlide(f.pres, f.slide);
    const options = {
      ...P.getEffectiveSlideTransition(duplicate),
      durationMs: 3150,
      invertY: true,
    };
    P.setSlideTransition(duplicate, options);
    const target = createDeck("blank");
    const template = P.importSlideTemplate(target, f.slide);
    const inherited = P.importSlide(target, f.slide, template, {
      preserveGeometry: false,
    });
    expect(P.getEffectiveSlideTransition(inherited)).toEqual(
      modern("pageCurlDouble", { invertX: true }),
    );
    const copied = P.importSlide(
      target,
      duplicate,
      P.getSlideLayouts(target)[0],
    );
    expect(P.getSlideTransition(copied)).toEqual(options);
    const returned = P.importSlide(f.pres, copied, P.getSlideLayout(f.slide));
    expect(P.getSlideTransition(returned)).toEqual(options);
    const restored = await parseDeck(await P.savePresentation(f.pres));
    expect(
      P.getSlides(restored)
        .slice(1)
        .map((s) => P.getSlideTransition(s)),
    ).toEqual([options, options]);
  });
  it("replaces every alternative when changing a preset to a base effect", async () => {
    const f = await fixture(presetTransition());
    P.setSlideTransition(f.slide, {
      ...P.getSlideTransition(f.slide),
      effect: "push",
      direction: "l",
    });
    expect(P.getSlideTransition(f.slide)).toEqual(
      modern("push", { direction: "l" }),
    );
    expect(P.getSlideXmlString(f.slide)).not.toContain("prstTrans");
  });
  it.each([-1, NaN, Infinity])(
    "rejects invalid preset duration %s atomically",
    async (durationMs) => {
      const f = await fixture(presetTransition());
      const before = P.getSlideXmlString(f.slide);
      expect(() =>
        P.setSlideTransition(f.slide, { effect: "pageCurlSingle", durationMs }),
      ).toThrow();
      expect(P.getSlideXmlString(f.slide)).toBe(before);
    },
  );
});
