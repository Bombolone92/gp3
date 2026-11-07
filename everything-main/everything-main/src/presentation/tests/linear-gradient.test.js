import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";

const stops = [
  { offset: 0, color: "#FF0000" },
  { offset: 0.5, color: "#00FF00" },
  { offset: 1, color: "#0000FF" },
];
function fixture(angleDeg = 45, scaled = false, w = 300, h = 180) {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  const shape = P.addSlideShape(s, {
    x: P.emu(1270000),
    y: P.emu(1270000),
    w: P.emu(w * 12700),
    h: P.emu(h * 12700),
    preset: "rect",
  });
  P.setShapeGradientFill(shape, { stops, angleDeg, scaled });
  return { p, s, shape };
}
const svg = (p, s = P.getSlides(p)[0]) =>
  renderSlideToSvg(p, s, { textLayout: "svg" });
function axis(source) {
  const tag = source.match(/<linearGradient\b[^>]*>/)?.[0];
  expect(tag).toBeTruthy();
  return ["x1", "y1", "x2", "y2"].map((name) =>
    Number(tag.match(new RegExp(`${name}="([^"]+)"`))[1]),
  );
}
function valueAt([x1, y1, x2, y2], x, y) {
  const dx = x2 - x1,
    dy = y2 - y1;
  return ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
}
const xmlGradient = (scaled) =>
  `<a:gradFill><a:gsLst>${stops.map((s) => `<a:gs pos="${s.offset * 100000}"><a:srgbClr val="${s.color.slice(1)}"/></a:gs>`).join("")}</a:gsLst><a:lin ang="2700000"${scaled === null ? "" : ` scaled="${scaled}"`}/></a:gradFill>`;

describe("linear gradient geometry", () => {
  // Independently authored native controls: actual PDF shading axes in EMU.
  // These cover scaled/unscaled 30° and 45° fills on a 300×180-point rectangle.
  it.each([
    [45, false, [381000, -381000, 3429000, 2667000]],
    [45, true, [896470.6, -537882.4, 2913530, 2823882]],
    [30, false, [-18683.52, 32360.8, 3828684, 2253639]],
    [30, true, [344788.2, -358314.5, 3465212, 2644314]],
  ])("matches native %s° scaled=%s shading", (angle, scaled, nativeAxis) => {
    const actual = axis(svg(fixture(angle, scaled).p));
    for (const [u, v] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [0.2, 0.7],
      [0.8, 0.4],
    ])
      expect(valueAt(actual, u, v)).toBeCloseTo(
        valueAt(nativeAxis, u * 3810000, v * 2286000),
        3,
      );
  });
  it.each([0, 30, 45, 90, 125, 180, 225, 270, 315])(
    "spans the full bounds at %s°",
    (angle) => {
      for (const scaled of [false, true])
        for (const [w, h] of [
          [80, 420],
          [420, 80],
          [150, 150],
        ]) {
          const a = axis(svg(fixture(angle, scaled, w, h).p));
          const values = [
            [0, 0],
            [0, 1],
            [1, 0],
            [1, 1],
          ].map(([x, y]) => valueAt(a, x, y));
          expect(Math.min(...values)).toBeCloseTo(0, 3);
          expect(Math.max(...values)).toBeCloseTo(1, 3);
        }
    },
  );
  it.each([
    [0, [0, 0.5, 1, 0.5]],
    [90, [0.5, 0, 0.5, 1]],
    [180, [1, 0.5, 0, 0.5]],
    [270, [0.5, 1, 0.5, 0]],
  ])("preserves cardinal %s° fills", (angle, expected) => {
    expect(axis(svg(fixture(angle).p))).toEqual(expected);
  });
  it.each([false, true])(
    "preserves scaled=%s through reading, copying, editing, and export",
    async (scaled) => {
      const { p, s, shape } = fixture(30, scaled);
      const before = unzipSync(await P.savePresentation(p));
      const check = (p, sh) =>
        expect(P.getShapeGradientFill(sh)).toMatchObject({
          angleDeg: 30,
          ...(scaled ? { scaled: true } : {}),
        });
      check(p, shape);
      const original = axis(svg(p));
      expect(unzipSync(await P.savePresentation(p))).toEqual(before);
      check(p, P.copyShape(s, shape));
      const target = createDeck("blank"),
        imported = P.importSlide(
          target,
          s,
          P.getSlideLayout(P.getSlides(target)[0]),
        );
      const copy = P.getSlideShapes(imported)[0];
      P.setShapeRotation(copy, 15);
      check(target, copy);
      expect(axis(svg(target, imported))).toEqual(original);
      const returned = P.importSlide(p, imported, P.getSlideLayout(s));
      const reopened = await parseDeck(await P.savePresentation(p));
      expect(axis(svg(reopened, P.getSlides(reopened).at(-1)))).toEqual(
        original,
      );
      P.setShapeGradientFill(shape, {
        ...P.getShapeGradientFill(shape),
        scaled: !scaled,
      });
      expect(Boolean(P.getShapeGradientFill(shape).scaled)).toBe(!scaled);
      expect(P.getSlideShapes(returned)).toHaveLength(2);
    },
  );
  it.each([null, "0", "false", "1", "true", "invalid"])(
    "reads XML scaled=%s consistently in shapes and backgrounds",
    async (token) => {
      const { p, s } = fixture();
      const base = unzipSync(await P.savePresentation(p));
      const names = [
        P.getSlidePartName(s),
        P.getSlideLayoutPartName(P.getSlideLayout(s)),
        P.getSlideMasterPartName(s),
      ].map((n) => n.slice(1));
      const expected = token === "1" || token === "true";
      for (const [i, name] of names.entries()) {
        const files = { ...base };
        files[names[0]] = strToU8(
          strFromU8(files[names[0]]).replace(
            /<a:gradFill\b[^>]*>[\s\S]*?<\/a:gradFill>/,
            xmlGradient(token),
          ),
        );
        files[name] = strToU8(
          strFromU8(files[name])
            .replace(/<p:bg\b[\s\S]*?<\/p:bg>/g, "")
            .replace(
              /(<p:cSld\b[^>]*>)/,
              `$1<p:bg><p:bgPr>${xmlGradient(token)}</p:bgPr></p:bg>`,
            ),
        );
        const loaded = await parseDeck(zipSync(files)),
          slide = P.getSlides(loaded)[0],
          layout = P.getSlideLayout(slide);
        const grad =
          i === 0
            ? P.getSlideBackgroundGradientFill(slide)
            : i === 1
              ? P.getSlideLayoutBackgroundGradientFill(layout)
              : P.getSlideMasterBackgroundGradientFill(loaded, layout);
        expect(Boolean(grad.scaled)).toBe(expected);
        expect(
          Boolean(P.getShapeGradientFill(P.getSlideShapes(slide)[0]).scaled),
        ).toBe(expected);
        // Background aspect ratio differs from the shape: both must cover their own bounds.
        const a = axis(svg(loaded));
        expect(valueAt(a, 0, 0)).toBeCloseTo(0, 3);
        expect(valueAt(a, 1, 1)).toBeCloseTo(1, 3);
      }
    },
  );
  it.each([false, true])(
    "uses each table cell's own bounds for scaled=%s",
    async (scaled) => {
      const p = createDeck("blank"),
        s = P.getSlides(p)[0];
      const table = P.addSlideTable(s, {
        x: P.inches(1),
        y: P.inches(1),
        w: P.inches(5),
        h: P.inches(3),
        rows: [["A", "B"]],
      });
      P.setTableColumnWidth(table, 0, P.inches(1));
      P.setTableColumnWidth(table, 1, P.inches(4));
      P.setTableRowHeight(table, 0, P.inches(3));
      const files = unzipSync(await P.savePresentation(p)),
        name = P.getSlidePartName(s).slice(1);
      files[name] = strToU8(
        strFromU8(files[name]).replace(
          /<a:tcPr\b[^>]*\/>/g,
          `<a:tcPr>${xmlGradient(scaled ? "1" : "0")}</a:tcPr>`,
        ),
      );
      const loaded = await parseDeck(zipSync(files));
      const axes = [...svg(loaded).matchAll(/<linearGradient\b[^>]*>/g)].map(
        (m) => axis(m[0]),
      );
      expect(axes).toHaveLength(2);
      for (const [i, w] of [1, 4].entries())
        expect(axes[i]).toEqual(axis(svg(fixture(45, scaled, w, 3).p)));
    },
  );
});

describe("gradient stop colors", () => {
  const transformed = `<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"><a:tint val="50000"/><a:satMod val="300000"/><a:alpha val="50000"/></a:srgbClr></a:gs><a:gs pos="50%"><a:sysClr val="windowText" lastClr="008000"><a:inv/><a:alpha val="0"/></a:sysClr></a:gs><a:gs pos="100000"><a:schemeClr val="accent1"/></a:gs></a:gsLst><a:lin ang="2700000" scaled="0"/></a:gradFill>`;
  it.each(["shape", "slide", "layout", "master"])(
    "resolves transforms and alpha for %s without mutating XML",
    async (level) => {
      const { p, s } = fixture();
      const files = unzipSync(await P.savePresentation(p));
      if (level !== "shape")
        for (const part of [
          P.getSlidePartName(s),
          P.getSlideLayoutPartName(P.getSlideLayout(s)),
          P.getSlideMasterPartName(s),
        ]) {
          files[part.slice(1)] = strToU8(
            strFromU8(files[part.slice(1)]).replace(
              /<p:bg\b[\s\S]*?<\/p:bg>/g,
              "",
            ),
          );
        }
      const name = (
        level === "layout"
          ? P.getSlideLayoutPartName(P.getSlideLayout(s))
          : level === "master"
            ? P.getSlideMasterPartName(s)
            : P.getSlidePartName(s)
      ).slice(1);
      let text = strFromU8(files[name]);
      text =
        level === "shape"
          ? text.replace(
              /<a:gradFill\b[^>]*>[\s\S]*?<\/a:gradFill>/,
              transformed,
            )
          : text
              .replace(/<p:bg\b[\s\S]*?<\/p:bg>/g, "")
              .replace(
                /(<p:cSld\b[^>]*>)/,
                `$1<p:bg><p:bgPr>${transformed}</p:bgPr></p:bg>`,
              );
      files[name] = strToU8(text);
      const loaded = await parseDeck(zipSync(files)),
        slide = P.getSlides(loaded)[0],
        layout = P.getSlideLayout(slide),
        theme = P.getPresentationTheme(loaded),
        clrMap = { accent1: "accent2" },
        context = { theme, clrMap };
      const before = unzipSync(await P.savePresentation(loaded));
      const grad =
        level === "shape"
          ? P.getShapeGradientFillEffective(
              loaded,
              P.getSlideShapes(slide)[0],
              clrMap,
            )
          : level === "slide"
            ? P.getSlideBackgroundGradientFill(slide, context)
            : level === "layout"
              ? P.getSlideLayoutBackgroundGradientFill(layout, context)
              : P.getSlideMasterBackgroundGradientFill(loaded, layout, context);
      expect(grad.stops[0]).toEqual({
        offset: 0,
        color: "#FF7878",
        opacity: 0.5,
      });
      expect(grad.stops[1]).toEqual({
        offset: 0.5,
        color: "#FFE5FF",
        opacity: 0,
      });
      expect(grad.stops[2].color).toBe(theme.accent2);
      const rendered = svg(loaded);
      expect(rendered).toContain('stop-color="#FF7878" stop-opacity="0.5"');
      expect(rendered).toContain('stop-opacity="0"');
      expect(unzipSync(await P.savePresentation(loaded))).toEqual(before);
      if (level === "shape")
        expect(
          P.getShapeGradientFill(P.getSlideShapes(slide)[0]).stops[0].color,
        ).toBe("#FF0000");
    },
  );
  it.each([0, 0.25, 1])(
    "authors and round-trips opacity %s",
    async (opacity) => {
      const { p, s, shape } = fixture();
      P.setShapeGradientFill(shape, {
        angleDeg: 30,
        scaled: true,
        stops: stops.map((stop) => ({ ...stop, opacity })),
      });
      const copy = P.copyShape(s, shape),
        gradient = P.getShapeGradientFill(copy);
      expect(
        gradient.stops.every((stop) => (stop.opacity ?? 1) === opacity),
      ).toBe(true);
      P.setShapeGradientFill(copy, gradient);
      const reopened = await parseDeck(await P.savePresentation(p));
      expect(
        P.getShapeGradientFill(P.getSlideShapes(P.getSlides(reopened)[0])[1]),
      ).toEqual(gradient);
    },
  );
});

it("paints unsorted stops in positional order while preserving their authored order", async () => {
  const { p, s, shape } = fixture();
  const authored = [stops[2], stops[0], stops[1]];
  P.setShapeGradientFill(shape, { stops: authored, angleDeg: 45 });
  const before = unzipSync(await P.savePresentation(p));
  expect(P.getShapeGradientFill(shape).stops).toEqual(authored);
  const painted = [
    ...svg(p).matchAll(/<stop offset="([^"]+)" stop-color="([^"]+)"/g),
  ].map((m) => ({ offset: Number(m[1]), color: m[2] }));
  expect(painted).toEqual(stops);
  expect(unzipSync(await P.savePresentation(p))).toEqual(before);
});

it.each([-0.1, 1.1, NaN, Infinity])(
  "rejects opacity %s without replacing the existing fill",
  async (opacity) => {
    const { p, shape } = fixture();
    const before = unzipSync(await P.savePresentation(p));
    expect(() =>
      P.setShapeGradientFill(shape, {
        stops: [{ ...stops[0], opacity }, stops[2]],
      }),
    ).toThrow(/opacity/);
    expect(unzipSync(await P.savePresentation(p))).toEqual(before);
  },
);

it("bounds exact alpha composition to two layers for dense stop lists", () => {
  const { p, shape } = fixture();
  P.setShapeGradientFill(shape, {
    stops: Array.from({ length: 501 }, (_, i) => ({
      offset: i / 500,
      color: i % 2 ? "#20A080" : "#D01070",
      opacity: i % 3 ? 0.2 : 0.9,
    })),
  });
  const output = svg(p);
  expect((output.match(/<linearGradient\b/g) || []).length).toBe(2);
  expect(output).toContain('operator="arithmetic" k2="1" k3="1"');
  expect((output.match(/<feOffset\b/g) || []).length).toBe(1);
  expect(output).not.toContain("mix-blend-mode");
  expect((output.match(/<stop\b/g) || []).length).toBeLessThanOrEqual(2004);
});
