import { describe, expect, it } from "vitest";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import {
  P,
  createDeck,
  parseDeck,
  preview,
  slideBounds,
} from "../src/model.js";
import {
  findTransform,
  readTransformBounds,
} from "../lib/pptx/src/internal/drawingml/index.ts";
import { parseXml } from "../lib/pptx/src/internal/xml/index.ts";
import {
  partialTransformFixture,
  transformOffset as off,
  transformExtent as ext,
} from "./partial-transform-fixture.js";

const shapeOf = (s) => P.getSlideShapes(s)[0];
const resolved = (p, s = P.getSlides(p)[0]) =>
  P.getShapeBoundsResolved(p, shapeOf(s));
const layoutBounds = { x: 370000, y: 540000, w: 2800000, h: 1600000 };
const masterBounds = { x: 610000, y: 830000, w: 4100000, h: 2200000 };
const cases = [
  ["absent", null, layoutBounds],
  ["empty", "", { x: 0, y: 0, w: 0, h: 0 }],
  ["offset only", off(-120000, 950000), { x: -120000, y: 950000, w: 0, h: 0 }],
  ["extent only", ext(1300000, 870000), { x: 0, y: 0, w: 1300000, h: 870000 }],
  [
    "complete",
    off(740000, 0) + ext(0, 1700000),
    { x: 740000, y: 0, w: 0, h: 1700000 },
  ],
];

describe("nearest placeholder transform", () => {
  // The native reference normalizes missing off/ext children to zero on save.
  // The transform is an inheritance unit; components never mix between levels.
  // Saved native controls: tests/data/partial-transform-native.json. These
  // regressions vary positions/extents independently of those native controls.
  for (const kind of ["picture", "shape"]) {
    it.each(cases)(
      `resolves a ${kind} with %s local transform without rewriting XML`,
      async (_, local, expected) => {
        const bytes = await partialTransformFixture({ kind, local });
        const p = await parseDeck(bytes),
          s = P.getSlides(p)[0];
        const before = P.getSlideXmlString(s);
        expect(resolved(p)).toEqual(expected);
        expect(slideBounds(p, shapeOf(s))).toEqual(expected);
        // Authored component getters keep their original absent/present contract.
        if (local === null || local === "" || local.startsWith("<a:ext"))
          expect(P.getShapePosition(shapeOf(s))).toBeNull();
        if (local === null || local === "" || !local.includes("<a:ext"))
          expect(P.getShapeSize(shapeOf(s))).toBeNull();
        preview(p, s);
        const restored = await parseDeck(await P.savePresentation(p));
        expect(P.getSlideXmlString(P.getSlides(restored)[0])).toBe(before);
        expect(resolved(restored)).toEqual(expected);
      },
    );
    it.each([
      ["empty", "", { x: 0, y: 0, w: 0, h: 0 }],
      ["offset", off(1900000, 2700000), { x: 1900000, y: 2700000, w: 0, h: 0 }],
      ["extent", ext(750000, 420000), { x: 0, y: 0, w: 750000, h: 420000 }],
      ["absent", null, masterBounds],
    ])(
      `uses a ${kind}'s %s layout transform before the master`,
      async (_, layout, expected) => {
        const p = await parseDeck(
          await partialTransformFixture({ kind, layout }),
        );
        expect(resolved(p)).toEqual(expected);
      },
    );
  }
  it("uses a partial master transform when both nearer transforms are absent", async () => {
    const p = await parseDeck(
      await partialTransformFixture({
        layout: null,
        master: ext(3300000, 1400000),
      }),
    );
    expect(resolved(p)).toEqual({ x: 0, y: 0, w: 3300000, h: 1400000 });
  });
  it("treats a rotation-only transform as present rather than inheriting bounds", async () => {
    const p = await parseDeck(
      await partialTransformFixture({
        local: "",
        localAttributes: 'rot="1800000" flipH="1"',
      }),
    );
    expect(resolved(p)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    const shape = shapeOf(P.getSlides(p)[0]);
    expect(P.getShapeRotation(shape)).toBe(30);
    expect(P.getShapeFlip(shape)).toEqual({
      horizontal: true,
      vertical: false,
    });
  });
  it.each(["", ext(930000, 570000)])(
    "resolves a non-placeholder's present transform %s",
    async (local) => {
      const p = await parseDeck(
        await partialTransformFixture({ local, placeholder: false }),
      );
      expect(resolved(p)).toEqual({
        x: 0,
        y: 0,
        w: local ? 930000 : 0,
        h: local ? 570000 : 0,
      });
    },
  );
  it("leaves absent unrelated transforms unresolved", async () => {
    const p = await parseDeck(
      await partialTransformFixture({ placeholder: false }),
    );
    expect(resolved(p)).toBeNull();
  });
  it.each([off("bad", 100), '<a:ext cx="200"/>'])(
    "does not replace a malformed local transform with a parent's %s",
    async (local) => {
      const p = await parseDeck(await partialTransformFixture({ local }));
      expect(resolved(p)).toBeNull();
    },
  );
  it("resolves namespace aliases by URI", async () => {
    const bytes = await partialTransformFixture({
      local: ext(1800000, 970000),
    });
    const files = unzipSync(bytes);
    for (const name of Object.keys(files).filter((n) => n.endsWith(".xml")))
      files[name] = strToU8(
        strFromU8(files[name])
          .replaceAll("xmlns:a=", "xmlns:draw=")
          .replaceAll("<a:", "<draw:")
          .replaceAll("</a:", "</draw:"),
      );
    const p = await parseDeck(zipSync(files));
    expect(resolved(p)).toEqual({ x: 0, y: 0, w: 1800000, h: 970000 });
  });
  it.each(["picture", "shape"])(
    "preserves partial %s transforms through source-template and clipboard transfers in both directions",
    async (kind) => {
      const source = await parseDeck(
        await partialTransformFixture({ kind, local: ext(1600000, 760000) }),
      );
      const s = P.getSlides(source)[0],
        original = P.getSlideXmlString(s);
      const target = createDeck("blank");
      const inherited = P.importSlide(
        target,
        s,
        P.importSlideTemplate(target, s),
        { preserveGeometry: false },
      );
      expect(P.getSlideXmlString(inherited)).toBe(original);
      const clipboard = P.importSlide(target, s, P.getSlideLayouts(target)[0]);
      expect(P.getShapePosition(shapeOf(clipboard))).toBeNull();
      expect(resolved(target, clipboard)).toEqual(resolved(source));
      expect(preview(target, clipboard)).toBe(preview(source, s));
      const copiedObject = P.copyShape(
        P.getSlides(target)[0],
        shapeOf(inherited),
      );
      expect(P.getShapePosition(copiedObject)).toBeNull();
      expect(P.getShapeBoundsResolved(target, copiedObject)).toEqual(
        resolved(source),
      );
      const restored = await parseDeck(await P.savePresentation(target));
      const back = createDeck("blank");
      const returned = P.importSlide(
        back,
        P.getSlides(restored).at(-1),
        P.getSlideLayouts(back)[0],
      );
      expect(P.getShapePosition(shapeOf(returned))).toBeNull();
      expect(resolved(back, returned)).toEqual(resolved(source));
      expect(preview(back, returned)).toBe(preview(source, s));
      expect(
        P.validatePresentation(back).filter((x) => x.severity === "error"),
      ).toEqual([]);
    },
  );
  it("materializes an inherited partial transform when copying into a different layout", async () => {
    const source = await parseDeck(
      await partialTransformFixture({ layout: ext(1500000, 920000) }),
    );
    const target = createDeck("blank");
    const copied = P.importSlide(
      target,
      P.getSlides(source)[0],
      P.getSlideLayouts(target)[0],
    );
    expect(P.getShapeBounds(shapeOf(copied))).toEqual(resolved(source));
    expect(resolved(target, copied)).toEqual(resolved(source));
  });
});

describe("transform bounds wrappers", () => {
  it.each([
    ["shape", '<p:spPr><a:xfrm><a:ext cx="500" cy="800"/></a:xfrm></p:spPr>'],
    ["picture", '<p:spPr><a:xfrm><a:ext cx="500" cy="800"/></a:xfrm></p:spPr>'],
    [
      "connector",
      '<p:spPr><a:xfrm><a:ext cx="500" cy="800"/></a:xfrm></p:spPr>',
    ],
    [
      "group",
      '<p:grpSpPr><a:xfrm><a:ext cx="500" cy="800"/></a:xfrm></p:grpSpPr>',
    ],
    ["graphicFrame", '<p:xfrm><a:ext cx="500" cy="800"/></p:xfrm>'],
  ])("locates the native %s wrapper", (kind, body) => {
    const root = parseXml(
      `<p:root xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${body}</p:root>`,
    ).root;
    expect(readTransformBounds(findTransform(root, kind))).toEqual({
      x: 0,
      y: 0,
      w: 500,
      h: 800,
    });
  });
});
