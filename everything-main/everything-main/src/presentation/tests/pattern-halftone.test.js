import { describe, expect, it } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readPatternFixture } from "./pattern-opacity-fixture.js";
import { halftonePatternCases } from "./pattern-halftone-fixture.js";
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const nodes = (e, name) => {
  const out = [];
  walkElements(e, (x) => {
    if (x.name.localName === name) out.push(x);
  });
  return out;
};
function check(
  p,
  s,
  [preset, fullCount, halfCount, fullProbes, halfProbes, backProbes],
  palette = ["#ED3719", 0.33333, "#29CD53", 0.70001, "#8B8236"],
) {
  const root = parseXml(
      decodeURIComponent(preview(p, s).split(",").slice(1).join(",")),
    ).root,
    patterns = nodes(root, "pattern");
  expect(patterns.length).toBeGreaterThan(0);
  expect(nodes(root, "feImage")).toHaveLength(0);
  const [fg, af, bg, ab, mid] = palette,
    opaque = af === 1 && ab === 1;
  for (const pattern of patterns) {
    expect(nodes(pattern, "image")).toHaveLength(0);
    expect(attr(pattern, "width")).toBe("32");
    expect(attr(pattern, "height")).toBe("32");
    const paths = nodes(pattern, "path");
    expect(paths).toHaveLength(18);
    const masks = [];
    for (let level = 0; level < 2; level++) {
      const pathsAt = paths.slice(level * 9, level * 9 + 9),
        cells = Array.from({ length: 8 }, () => Array(8).fill(false));
      const path = attr(pathsAt[0], "d"),
        runs = [...path.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)Z/g)];
      expect(runs.length).toBeGreaterThan(0);
      expect(runs.map((r) => r[0]).join("")).toBe(path);
      for (const run of runs) {
        const [x, y, w, back] = run.slice(1).map(Number);
        expect(w).toBe(back);
        expect(x + w).toBeLessThanOrEqual(8);
        expect(y).toBeLessThan(8);
        for (let xx = x; xx < x + w; xx++) {
          expect(cells[y][xx]).toBe(false);
          cells[y][xx] = true;
        }
      }
      expect(cells.flat().filter(Boolean), preset).toHaveLength(
        level ? halfCount : fullCount,
      );
      for (const [i, path] of pathsAt.entries()) {
        expect(attr(path, "d")).toBe(attr(pathsAt[0], "d"));
        expect(attr(path, "fill")).toBe(
          opaque ? (level ? mid : fg) : "#FFFFFF",
        );
        expect(attr(path, "transform")).toBe(
          `scale(${96 / 72}) translate(${(i % 3) * 8} ${Math.floor(i / 3) * 8})`,
        );
      }
      masks.push(cells);
    }
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        expect(masks[0][y][x] && masks[1][y][x]).toBe(false);
    for (const [x, y] of fullProbes)
      expect([masks[0][y][x], masks[1][y][x]]).toEqual([true, false]);
    for (const [x, y] of halfProbes)
      expect([masks[0][y][x], masks[1][y][x]]).toEqual([false, true]);
    for (const [x, y] of backProbes)
      expect([masks[0][y][x], masks[1][y][x]]).toEqual([false, false]);
  }
  if (opaque) {
    expect(nodes(root, "filter")).toHaveLength(0);
    return;
  }
  const filter = nodes(root, "filter")[0];
  expect(attr(filter, "width")).toBe("64");
  expect(attr(filter, "color-interpolation-filters")).toBe("sRGB");
  const offsets = nodes(filter, "feOffset");
  expect(
    offsets.map((e) => [
      attr(e, "in"),
      attr(e, "dx"),
      attr(e, "width"),
      attr(e, "height"),
    ]),
  ).toEqual([
    ["SourceAlpha", "0", "32", "32"],
    ["SourceAlpha", "-32", "32", "32"],
  ]);
  expect(
    nodes(filter, "feComposite").some(
      (e) =>
        attr(e, "in") === "fullCell" &&
        attr(e, "in2") === "half" &&
        attr(e, "operator") === "out" &&
        attr(e, "result") === "full",
    ),
  ).toBe(true);
  const floods = nodes(filter, "feFlood");
  expect(floods.map((e) => attr(e, "flood-color"))).toEqual([fg, mid, bg]);
  expect(floods.map((e) => Number(attr(e, "flood-opacity")))).toEqual([
    af,
    (af + ab) / 2,
    ab,
  ]);
  const output = nodes(filter, "feComposite").at(-1);
  expect(attr(output, "width")).toBe("32");
  expect(attr(output, "height")).toBe("32");
  expect(attr(output, "operator")).toBe("arithmetic");
}
describe("native half-tone pattern palettes", () => {
  for (const row of halftonePatternCases) {
    const [preset] = row;
    for (const [kind, level] of [
      ...[
        "slide",
        "layout",
        "master",
        "layoutDecoration",
        "masterDecoration",
      ].map((level) => ["shape", level]),
      ...["slide", "layout", "master"].flatMap((level) => [
        ["reference", level],
        ["background", level],
      ]),
      ["table", "slide"],
    ])
      it(`keeps ${preset} palette classes in ${kind} ${level}`, async () => {
        const f = await readPatternFixture({
          kind,
          level,
          preset,
          foreground:
            '<a:srgbClr val="ED3719"><a:alpha val="33333"/></a:srgbClr>',
        });
        check(f.pres, f.slide, row);
      });
    for (const [af, ab] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [0.33333, 0.70001],
      [0.99999, 0.00001],
    ])
      it(`keeps ${preset} midpoint RGB independent of ${af}/${ab} alpha`, async () => {
        const f = await readPatternFixture({
          preset,
          foreground: `<a:srgbClr val="9147BC"><a:alpha val="${Math.round(af * 100000)}"/></a:srgbClr>`,
          background: `<a:srgbClr val="23A87D"><a:alpha val="${Math.round(ab * 100000)}"/></a:srgbClr>`,
        });
        check(f.pres, f.slide, row, ["#9147BC", af, "#23A87D", ab, "#5A789D"]);
      });
    it(`keeps ${preset} editable through independent copy, reload and return`, async () => {
      const f = await readPatternFixture({ preset }),
        before = preview(f.pres, f.slide),
        p = createDeck("blank"),
        s = P.importSlide(p, f.slide, P.getSlideLayouts(p)[0]);
      P.setShapePatternFill(P.getSlideShapes(s)[0], {
        preset,
        foreground: "#9147BC/alpha=33333",
        background: "#23A87D/alpha=70001",
      });
      expect(preview(f.pres, f.slide)).toBe(before);
      const q = await P.loadPresentation(await P.savePresentation(p)),
        t = P.getSlides(q).at(-1);
      expect(P.getShapePatternFill(q, P.getSlideShapes(t)[0])).toEqual({
        preset,
        foreground: "#9147BC",
        background: "#23A87D",
        foregroundOpacity: 0.33333,
        backgroundOpacity: 0.70001,
      });
      check(q, t, row, ["#9147BC", 0.33333, "#23A87D", 0.70001, "#5A789D"]);
      const returned = P.importSlide(f.pres, t, P.getSlideLayout(f.slide));
      expect(preview(f.pres, returned)).toBe(preview(q, t));
      expect(P.validatePresentation(q)).toEqual([]);
    });
  }
});
