import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultMeasurer } from "../lib/pptx-preview/src/index.ts";
import { createTextMeasurer } from "../src/text-measure.js";

const spec = {
  family: "Arial, sans-serif",
  sizePx: 24,
  bold: false,
  italic: false,
  letterSpacingPx: 1,
};

afterEach(() => vi.unstubAllGlobals());

describe("text measurement without canvas", () => {
  it("keeps server-side previews usable", () => {
    const measure = createTextMeasurer();
    expect(measure("Text 日本語 😀", spec).approximate).toBe(true);
    expect(measure("Text 日本語 😀", spec)).toEqual(
      defaultMeasurer("Text 日本語 😀", spec),
    );
  });

  it.each([null, "unavailable"])(
    "falls back when a browser cannot create a canvas context (%s)",
    (result) => {
      vi.stubGlobal("document", {
        createElement: () => ({
          getContext: () => {
            if (result) throw new Error("Canvas unavailable");
            return null;
          },
        }),
      });
      expect(createTextMeasurer()("A valid presentation", spec)).toEqual(
        defaultMeasurer("A valid presentation", spec),
      );
    },
  );
});

describe("browser font metrics", () => {
  function canvas(
    metrics = { fontBoundingBoxAscent: 900, fontBoundingBoxDescent: 220 },
  ) {
    const context = {
      font: "",
      measureText: vi.fn((text) => {
        const em = Number(context.font.match(/([\d.]+)px/)[1]);
        return {
          width: text === "Hg" ? (42 * em) / 1024 : 42,
          ...Object.fromEntries(
            Object.entries(metrics).map(([key, value]) => [
              key,
              (value * em) / 1024,
            ]),
          ),
        };
      }),
    };
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => context }),
    });
    return context;
  }
  it("measures and caches enabled, disabled and default kerning independently", () => {
    const ctx = canvas();
    ctx.measureText.mockImplementation(() => ({
      width:
        ctx.fontKerning === "normal"
          ? 30
          : ctx.fontKerning === "none"
            ? 40
            : 35,
      fontBoundingBoxAscent: 900,
      fontBoundingBoxDescent: 220,
    }));
    const measure = createTextMeasurer();
    for (const [kerning, width] of [
      ["normal", 30],
      ["none", 40],
      [undefined, 35],
      ["normal", 30],
    ]) {
      expect(
        measure("AVA", { ...spec, letterSpacingPx: 0, kerning }).widthPx,
      ).toBe(width);
    }
    expect(
      ctx.measureText.mock.calls.filter(([text]) => text === "AVA"),
    ).toHaveLength(3);
  });
  it("uses whole-run CSS shaping when Canvas lacks kerning, caches widths and removes probes", () => {
    const ctx = canvas({});
    const probe = {
      style: {},
      textContent: "",
      getBoundingClientRect: vi.fn(() => {
        expect(probe.textContent).toBe(content);
        return {
          width: probe.style.cssText.includes("font-kerning:none") ? 40 : 30,
        };
      }),
      remove: vi.fn(),
    };
    const append = vi.fn();
    const createElement = vi.fn((type) =>
      type === "canvas" ? { getContext: () => ctx } : probe,
    );
    vi.stubGlobal("document", { body: { append }, createElement });
    const measure = createTextMeasurer();
    const content = " A\u0301 ffi <&> ";
    for (const [kerning, width] of [
      ["none", 40],
      ["normal", 30],
      ["none", 40],
    ]) {
      expect(
        measure(content, { ...spec, kerning, letterSpacingPx: 0 }).widthPx,
      ).toBe(width);
      expect(probe.textContent).toBe("");
    }
    expect(append).toHaveBeenCalledTimes(2);
    expect(probe.remove).toHaveBeenCalledTimes(2);
    expect(ctx.measureText).toHaveBeenCalledTimes(1); // Font metrics only.
    probe.getBoundingClientRect.mockImplementationOnce(() => {
      throw Error("layout failed");
    });
    expect(() => measure("different", { ...spec, kerning: "none" })).toThrow(
      "layout failed",
    );
    expect(probe.remove).toHaveBeenCalledTimes(3);
    expect(probe.textContent).toBe("");
    expect(
      createElement.mock.calls.filter(([tag]) => tag === "span"),
    ).toHaveLength(1);
    measure.clear();
    expect(
      measure(content, { ...spec, kerning: "normal", letterSpacingPx: 0 })
        .widthPx,
    ).toBe(30);
    expect(
      createElement.mock.calls.filter(([tag]) => tag === "span"),
    ).toHaveLength(2);
    expect(probe.remove).toHaveBeenCalledTimes(4);
  });
  it("uses font-wide bounds, scales them by font size, and caches metrics across sizes", () => {
    const ctx = canvas({
      fontBoundingBoxAscent: 900,
      fontBoundingBoxDescent: 220,
      actualBoundingBoxAscent: 1,
      actualBoundingBoxDescent: 0,
    });
    const measure = createTextMeasurer();
    const a = measure("AB", spec),
      b = measure("AB", { ...spec, sizePx: 48 });
    expect(a).toEqual({
      widthPx: 43,
      ascentPx: (900 / 1024) * 24,
      descentPx: (220 / 1024) * 24,
      lineGapPx: 0,
    });
    expect(b.ascentPx).toBe(a.ascentPx * 2);
    expect(ctx.measureText.mock.calls.filter(([t]) => t === "Hg")).toHaveLength(
      2,
    );
    measure("AB", spec);
    expect(ctx.measureText).toHaveBeenCalledTimes(4);
    measure("AB", { ...spec, bold: true });
    expect(ctx.measureText.mock.calls.filter(([t]) => t === "Hg")).toHaveLength(
      4,
    );
  });
  it("refreshes cached widths and vertical metrics after a font becomes available", () => {
    const ctx = canvas(),
      measure = createTextMeasurer();
    const before = measure("AB", spec);
    ctx.measureText.mockImplementation((text) => {
      const em = Number(ctx.font.match(/([\d.]+)px/)[1]);
      return {
        width: text === "Hg" ? (56 * em) / 1024 : 56,
        fontBoundingBoxAscent: em,
        fontBoundingBoxDescent: em / 4,
      };
    });
    expect(measure("AB", spec)).toEqual(before);
    measure.clear();
    expect(measure("AB", spec)).toEqual({
      widthPx: 57,
      ascentPx: 24,
      descentPx: 6,
      lineGapPx: 0,
    });
  });
  it.each([
    {},
    { fontBoundingBoxAscent: NaN, fontBoundingBoxDescent: 2 },
    { fontBoundingBoxAscent: -1, fontBoundingBoxDescent: 5 },
    { fontBoundingBoxAscent: 0, fontBoundingBoxDescent: 0 },
    { fontBoundingBoxAscent: 1e308, fontBoundingBoxDescent: 1e308 },
  ])(
    "retains measured widths when vertical metrics are missing or invalid (%j)",
    (metrics) => {
      canvas(metrics);
      expect(createTextMeasurer()("AB", spec)).toEqual({ widthPx: 43 });
    },
  );
  it("reads the normal line gap once and removes the hidden measurement element", () => {
    const ctx = canvas();
    const probe = {
      style: {},
      getBoundingClientRect: () => ({
        height:
          (1200 * Number(probe.style.cssText.match(/([\d.]+)px/)[1])) / 1024,
      }),
      remove: vi.fn(),
    };
    const append = vi.fn();
    vi.stubGlobal("document", {
      body: { append },
      createElement: (type) =>
        type === "canvas" ? { getContext: () => ctx } : probe,
    });
    const measure = createTextMeasurer();
    expect(measure("A", spec).lineGapPx).toBe((80 / 1024) * 24);
    measure("Different content", spec);
    expect(append).toHaveBeenCalledTimes(1);
    expect(probe.remove).toHaveBeenCalledTimes(1);
  });
  it("preserves fractional font units through rounded browser metrics", () => {
    // Independent font design metrics with half-pixel bounds or line gaps at
    // a 1024px reference. Browser APIs round the probe, not the design values.
    for (const [ascent, descent, gap] of [
      [1854, 434, 67],
      [1825, 443, 87],
      [1705, 615, 0],
    ]) {
      const units = 2048;
      const requestedSize = (font) => Number(font.match(/([\d.]+)px/)[1]);
      const ctx = {
        font: "",
        measureText: (text) => {
          const em = Math.min(10000, requestedSize(ctx.font));
          return {
            width: text === "Hg" ? (42 * em) / 1024 : 42,
            fontBoundingBoxAscent: Math.round((ascent * em) / units),
            fontBoundingBoxDescent: Math.round((descent * em) / units),
          };
        },
      };
      const probe = {
        style: {},
        getBoundingClientRect: () => ({
          height: Math.round(
            ((ascent + descent + gap) *
              Math.min(10000, requestedSize(probe.style.cssText))) /
              units,
          ),
        }),
        remove: vi.fn(),
      };
      vi.stubGlobal("document", {
        body: { append: vi.fn() },
        createElement: (type) =>
          type === "canvas" ? { getContext: () => ctx } : probe,
      });
      const measure = createTextMeasurer();
      for (const sizePx of [24, 26 * (4 / 3), 48]) {
        const actual = measure("Eight lines of text", { ...spec, sizePx });
        expect(actual.ascentPx).toBeCloseTo((ascent * sizePx) / units, 10);
        expect(actual.descentPx).toBeCloseTo((descent * sizePx) / units, 10);
        expect(actual.lineGapPx).toBeCloseTo((gap * sizePx) / units, 10);
        expect(actual.widthPx).toBe(42 + "Eight lines of text".length - 1);
      }
      expect(probe.remove).toHaveBeenCalledTimes(1);
    }
  });
  it.each([384, 1500, 2000, 3000, 10000])(
    "calibrates rounded font metrics below a rendering ceiling of %ipx",
    (ceiling) => {
      // Design metrics and rendering limits are independent of the production
      // probe. Above the ceiling both Canvas and CSS silently clamp the em.
      const units = 2048,
        ascent = 1825,
        descent = 443,
        gap = 87;
      const size = (font) => Number(font.match(/([\d.]+)px/)[1]);
      const ctx = {
        font: "",
        measureText: vi.fn((text) => {
          const em = Math.min(ceiling, size(ctx.font));
          return {
            width: text === "Hg" ? 1.25 * em : 42,
            fontBoundingBoxAscent: Math.round((ascent * em) / units),
            fontBoundingBoxDescent: Math.round((descent * em) / units),
          };
        }),
      };
      const probe = {
        style: {},
        getBoundingClientRect: () => ({
          height: Math.round(
            ((ascent + descent + gap) *
              Math.min(ceiling, size(probe.style.cssText))) /
              units,
          ),
        }),
        remove: vi.fn(),
      };
      const append = vi.fn();
      vi.stubGlobal("document", {
        body: { append },
        createElement: (type) =>
          type === "canvas" ? { getContext: () => ctx } : probe,
      });
      const measure = createTextMeasurer();
      for (const face of [
        {},
        { bold: true },
        { italic: true },
        { family: "Other family" },
      ]) {
        for (const sizePx of [13.33, 24, 48]) {
          const actual = measure("Unrelated content", {
            ...spec,
            ...face,
            sizePx,
          });
          // One rounding pixel per bound at a probe at least half the ceiling;
          // line gap subtracts two rounded bounds from one rounded CSS height.
          const resolution = sizePx / Math.min(8192, ceiling / 2);
          expect(
            Math.abs(actual.ascentPx - (ascent * sizePx) / units),
          ).toBeLessThanOrEqual(resolution);
          expect(
            Math.abs(actual.descentPx - (descent * sizePx) / units),
          ).toBeLessThanOrEqual(resolution);
          expect(
            Math.abs(actual.lineGapPx - (gap * sizePx) / units),
          ).toBeLessThanOrEqual(3 * resolution);
          expect(actual.widthPx).toBe(42 + "Unrelated content".length - 1);
        }
      }
      expect(append).toHaveBeenCalledTimes(4);
      expect(probe.remove).toHaveBeenCalledTimes(4);
      expect(size(probe.style.cssText)).toBeLessThanOrEqual(ceiling);
      const coldCalls = ctx.measureText.mock.calls.length;
      measure("Unrelated content", spec);
      expect(ctx.measureText).toHaveBeenCalledTimes(coldCalls);
      ceiling = 10000; // A newly available backend/font may have a new limit.
      measure.clear();
      const refreshed = measure("Unrelated content", spec);
      expect(refreshed.ascentPx).toBe((ascent * spec.sizePx) / units);
      expect(refreshed.descentPx).toBe((descent * spec.sizePx) / units);
      expect(refreshed.lineGapPx).toBe((gap * spec.sizePx) / units);
      expect(append).toHaveBeenCalledTimes(5);
    },
  );
  it.each([0, NaN, Infinity, -1, 0.1, 42])(
    "retains widths when metric advances cannot establish a usable scale (%s)",
    (advance) => {
      const ctx = canvas();
      ctx.measureText.mockImplementation((text) => ({
        width: text === "Hg" ? advance : 42,
        fontBoundingBoxAscent: 900,
        fontBoundingBoxDescent: 220,
      }));
      expect(createTextMeasurer()("AB", spec)).toEqual({ widthPx: 43 });
      expect(ctx.measureText.mock.calls.length).toBeLessThanOrEqual(15);
    },
  );
  it("rejects invalid bounds at the smaller calibration size", () => {
    const ctx = canvas();
    const native = ctx.measureText.getMockImplementation();
    ctx.measureText.mockImplementation((text) => ({
      ...native(text),
      ...(ctx.font.includes("4096px") ? { fontBoundingBoxAscent: NaN } : {}),
    }));
    expect(createTextMeasurer()("AB", spec)).toEqual({ widthPx: 43 });
    expect(ctx.measureText).toHaveBeenCalledTimes(3);
  });
  it.each([NaN, Infinity, -1, 0])(
    "ignores invalid CSS line heights (%s)",
    (height) => {
      const ctx = canvas();
      const probe = {
        style: {},
        getBoundingClientRect: () => ({ height }),
        remove: vi.fn(),
      };
      vi.stubGlobal("document", {
        body: { append: vi.fn() },
        createElement: (type) =>
          type === "canvas" ? { getContext: () => ctx } : probe,
      });
      const actual = createTextMeasurer()("AB", spec);
      expect(actual.ascentPx).toBe((900 * 24) / 1024);
      expect(actual.descentPx).toBe((220 * 24) / 1024);
      expect(actual.lineGapPx).toBe(0);
      expect(probe.remove).toHaveBeenCalledTimes(1);
    },
  );
  it("bounds font-metric storage even for many authored families", () => {
    const ctx = canvas(),
      measure = createTextMeasurer();
    for (let i = 0; i < 300; i++)
      measure("A", { ...spec, family: `Family ${i}` });
    const before = ctx.measureText.mock.calls.length;
    measure("A", { ...spec, family: "Family 0" });
    expect(ctx.measureText.mock.calls.length).toBe(before + 2);
  });
});
