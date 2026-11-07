import { afterEach, expect, it, vi } from "vitest";
import { P, createDeck, text } from "../src/model.js";
import { strToU8, unzipSync } from "fflate";

const deck = (family = "Raleway") => {
  const p = createDeck("blank");
  const shape = text(P.getSlides(p)[0], "Different words", 1, 1, 6, 1);
  P.setShapeTextFormat(shape, { font: family });
  return { p, shape };
};
async function resources({ installed = false, failItalic = false } = {}) {
  vi.resetModules();
  const fonts = new Set();
  class Face {
    constructor(family, source, descriptors) {
      Object.assign(this, { family, source, descriptors });
    }
    async load() {
      if (typeof this.source === "string" && !installed)
        throw Error("not installed");
      return this;
    }
  }
  const fetch = vi.fn(async (url) => ({
    ok: !(failItalic && url.includes("Italic")),
    status: 404,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  }));
  vi.stubGlobal("document", { fonts });
  vi.stubGlobal("FontFace", Face);
  vi.stubGlobal("fetch", fetch);
  return { ...(await import("../src/font-resources.js")), fonts, fetch };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("../src/font-catalog.js");
});

it("loads a referenced missing family once and embeds only the styles actually used", async () => {
  const r = await resources(),
    { p } = deck(" rAlEwAy ");
  const original = unzipSync(await P.savePresentation(p));
  await Promise.all([
    r.preparePresentationFonts(p),
    r.preparePresentationFonts(p),
  ]);
  expect(r.fetch).toHaveBeenCalledTimes(4);
  expect(r.fonts.size).toBe(4);
  expect(
    [...r.fonts]
      .map((face) => face.descriptors)
      .sort((a, b) =>
        `${a.style}/${a.weight}`.localeCompare(`${b.style}/${b.weight}`),
      ),
  ).toEqual(
    ["italic", "normal"].flatMap((style) =>
      ["400", "700"].map((weight) => ({
        style,
        weight,
        featureSettings: '"kern" 0',
      })),
    ),
  );
  expect(await r.preparePresentationFonts(p)).toBe(false);
  const css = r.embeddedFontStyles(new Map([["RALEWAY", new Set(["italic"])]]));
  expect(css.match(/@font-face/g)).toHaveLength(2);
  expect(css).toContain('font-family:"Raleway"');
  expect(css).toContain("font-style:italic");
  expect(css).toContain("data:font/woff2;base64,AQID");
  expect(css).toContain("font-weight:400;");
  expect(css).toContain("font-weight:700;");
  expect(css).toContain('font-feature-settings:"kern" 0;');
  for (const family of ["Raleway", '"rAlEwAy", Arial, sans-serif'])
    for (const bold of [false, true])
      for (const italic of [false, true])
        expect(
          r.resolveFontKerning({ family, bold, italic, kerning: "normal" }),
        ).toBe("none");
  expect(r.resolveFontKerning({ family: "Arial", kerning: "normal" })).toBe(
    "normal",
  );
  expect(
    r.resolveFontKerning({ family: '"Unknown", "Raleway"', kerning: "normal" }),
  ).toBe("normal");
  expect(
    r
      .embeddedFontStyles(
        new Map([
          ["Raleway", new Set(["normal"])],
          ["raleway", new Set(["normal", "italic"])],
        ]),
      )
      .match(/@font-face/g),
  ).toHaveLength(4);
  // ZIP entry timestamps may advance while fonts load; package parts must not.
  expect(unzipSync(await P.savePresentation(p))).toEqual(original);
});

it("uses font-table capabilities rather than family names for pair kerning", async () => {
  vi.doMock("../src/font-catalog.js", () => ({
    default: [
      {
        family: "Independent test family",
        faces: [
          {
            style: "normal",
            weight: "400",
            variable: false,
            legacyKerning: false,
          },
          {
            style: "normal",
            weight: "700",
            variable: true,
            legacyKerning: false,
          },
          {
            style: "italic",
            weight: "400",
            variable: false,
            legacyKerning: true,
          },
        ].map((face) => ({ ...face, url: "test.woff2" })),
      },
    ],
  }));
  const r = await resources();
  await r.preparePresentationFonts(deck("Independent test family").p);
  expect([...r.fonts].map((face) => face.descriptors.featureSettings)).toEqual([
    '"kern" 0',
    "normal",
    "normal",
  ]);
  const css = r.embeddedFontStyles(
    new Map([["Independent test family", new Set(["normal", "italic"])]]),
  );
  expect(css.match(/font-feature-settings:"kern" 0/g)).toHaveLength(1);
  expect(css.match(/font-feature-settings:normal/g)).toHaveLength(2);
  expect(
    r.resolveFontKerning({
      family: "Independent test family",
      kerning: "normal",
    }),
  ).toBe("none");
  expect(
    r.resolveFontKerning({
      family: "Independent test family",
      bold: true,
      kerning: "normal",
    }),
  ).toBe("normal");
  expect(
    r.resolveFontKerning({
      family: "Independent test family",
      italic: true,
      kerning: "normal",
    }),
  ).toBe("normal");
  expect(
    r.resolveFontKerning({
      family: "Independent test family",
      bold: true,
      kerning: "none",
    }),
  ).toBe("none");
});

it("retains locally installed fonts and makes no font-resource request", async () => {
  const r = await resources({ installed: true });
  expect(await r.preparePresentationFonts(deck().p)).toBe(false);
  expect(r.fetch).not.toHaveBeenCalled();
  expect(r.fonts.size).toBe(0);
  expect(r.resolveFontKerning({ family: "Raleway", kerning: "normal" })).toBe(
    "normal",
  );
});

it("does not turn arbitrary font declarations into network URLs", async () => {
  const r = await resources();
  await r.preparePresentationFonts(
    deck("https://example.invalid/font.woff, Raleway").p,
  );
  expect(r.fetch).not.toHaveBeenCalled();
  expect(
    r.embeddedFontStyles(new Map([["Raleway", new Set(["normal"])]])),
  ).toBe("");
});

it("publishes no partial family on failure and allows a later retry", async () => {
  const r = await resources({ failItalic: true }),
    { p } = deck();
  expect(await r.preparePresentationFonts(p)).toBe(false);
  expect(r.fonts.size).toBe(0);
  r.fetch.mockImplementation(async () => ({
    ok: true,
    arrayBuffer: async () => new Uint8Array([4, 5]).buffer,
  }));
  expect(await r.preparePresentationFonts(p)).toBe(true);
  expect(r.fonts.size).toBe(4);
});

it("reads escaped typefaces by namespace and refreshes changed part bytes", async () => {
  const r = await resources(),
    { p, shape } = deck("Initial family");
  expect(r.presentationFontFamilies(p)).toContain("Initial family");
  P.setShapeTextFormat(shape, { font: "Playfair Display" });
  expect(r.presentationFontFamilies(p)).toContain("Playfair Display");
  const part = P._internalPackageOf(p).parts.find(
    (part) => part.name === P.getSlidePartName(P.getSlides(p)[0]),
  );
  const xml = new TextDecoder()
    .decode(part.data)
    .replaceAll('typeface="Playfair Display"', 'typeface="Ral&#101;way"');
  part.data = strToU8(xml);
  // Exercise the packaged-name prefilter before any all-font scan caches it.
  expect(await r.preparePresentationFonts(p)).toBe(true);
  expect(r.fetch).toHaveBeenCalledTimes(4);
  expect(r.presentationFontFamilies(p)).toContain("Raleway");
  part.data = strToU8('<x:latin xmlns:x="urn:other" typeface="Raleway"/>');
  expect(r.presentationFontFamilies(p)).not.toContain("Raleway");
});

it("retains literal typefaces beginning with plus while excluding only the six theme tokens", async () => {
  const r = await resources(),
    { p, shape } = deck("+Independent Book");
  expect(r.presentationFontFamilies(p)).toContain("+Independent Book");
  for (const kind of ["mj", "mn"])
    for (const script of ["lt", "ea", "cs"]) {
      P.setShapeTextFormat(shape, { font: `+${kind}-${script}` });
      expect(r.presentationFontFamilies(p)).not.toContain(`+${kind}-${script}`);
    }
  for (const name of ["+Independent Book", "+mj-literal"]) {
    P.setShapeTextFormat(shape, { font: name });
    expect(r.presentationFontFamilies(p)).toContain(name);
  }
});
