import { describe, expect, it } from "vitest";
import { strFromU8, strToU8 } from "fflate";
import { P, parseDeck, preview } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { createMappedColorDeck } from "./fixtures.js";

const fixture = async (light1 = "#ABCDEF") => {
  const pres = await parseDeck(
    await createMappedColorDeck({ decorations: true, painted: true }),
  );
  P.setPresentationTheme(pres, { light1 });
  const slide = P.getSlides(pres)[0];
  if (light1 !== "#ABCDEF") {
    const master = P._internalPackageOf(pres).getPart(
      P.getSlideMasterPartName(slide),
    );
    master.data = strToU8(
      strFromU8(master.data)
        .replace('tx1="lt1"', 'tx1="dk1"')
        .replace('bg1="dk1"', 'bg1="lt1"'),
    );
  }
  for (let i = 0; i < 2; i++) {
    const shape = P.addSlideShape(slide, {
      x: P.emu(100000 + i * 2000000),
      y: P.emu(100000),
      w: P.emu(1500000),
      h: P.emu(1500000),
      preset: "ellipse",
    });
    P.setShapeGradientFill(shape, {
      angleDeg: 30,
      stops: [
        { offset: 0, color: "scheme:tx1" },
        { offset: 1, color: "scheme:accent1" },
      ],
    });
    P.setShapeShadow(shape, {
      color: "#456789",
      opacity: 0.5,
      blurEmu: 38000,
      offsetEmu: 70000,
    });
  }
  return { pres, slide };
};
const render = ({ pres, slide }, options = {}) =>
  renderSlideToSvg(pres, slide, {
    textLayout: "svg",
    stableDefinitionIds: true,
    ...options,
  });
const expectValidReferences = (svg) => {
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  expect(ids.length).toBeGreaterThan(1);
  expect(new Set(ids).size).toBe(ids.length);
  for (const [, reference] of svg.matchAll(/url\(#([^)]*)\)/g))
    expect(ids).toContain(reference);
};

describe("slide render context", () => {
  it("keeps IDs unique across inline SVG documents by default", async () => {
    const a = await fixture();
    const first = render(a, { stableDefinitionIds: false });
    render(a);
    const second = render(a, { stableDefinitionIds: false });
    const ids = [...(first + second).matchAll(/\bid="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
    expectValidReferences(first);
    expectValidReferences(second);
  });
  it("keeps unchanged previews identical across intervening slide renders", async () => {
    const a = await fixture();
    const b = await fixture("#123456");
    const original = render(a);
    expectValidReferences(original);
    expect(render(a)).toBe(original);
    expect(render(b)).not.toBe(original);
    expect(render(a)).toBe(original);
    const originalUrl = preview(a.pres, a.slide);
    preview(b.pres, b.slide);
    expect(preview(a.pres, a.slide)).toBe(originalUrl);
    P.setSlideBackground(a.slide, "#019283");
    expect(preview(a.pres, a.slide)).not.toBe(originalUrl);
  });

  it("isolates definition IDs and theme colors during callback renders", async () => {
    const a = await fixture();
    const b = await fixture("#123456");
    const original = render(a, { resolveFontFamily: (family) => family });
    let callbacks = 0;
    const nested = render(a, {
      resolveFontFamily: (family) => {
        callbacks++;
        expectValidReferences(render(b));
        return family;
      },
    });
    expect(callbacks).toBeGreaterThan(0);
    expectValidReferences(nested);
    expect(nested.replace(/pkdef-[a-z0-9]+/g, "definition")).toBe(
      original.replace(/pkdef-[a-z0-9]+/g, "definition"),
    );
    expect(nested).toBe(original);
    expect(render(a)).toBe(render(a));
  });

  it("restores the caller's context when a nested callback render throws", async () => {
    const a = await fixture();
    const b = await fixture("#123456");
    const original = render(a, { resolveFontFamily: (family) => family });
    let failures = 0;
    const nested = render(a, {
      resolveFontFamily: (family) => {
        expect(() =>
          render(b, {
            resolveFontFamily: () => {
              failures++;
              throw new Error("font resolver failed");
            },
          }),
        ).toThrow("font resolver failed");
        return family;
      },
    });
    expect(failures).toBeGreaterThan(0);
    expectValidReferences(nested);
    expect(nested.replace(/pkdef-[a-z0-9]+/g, "definition")).toBe(
      original.replace(/pkdef-[a-z0-9]+/g, "definition"),
    );
    expect(nested).toBe(original);
    expect(render(a)).toBe(render(a));
  });
});
