import { describe, expect, it } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readPatternFixture } from "./pattern-opacity-fixture.js";

const densities = [
  [5, 2],
  [10, 4],
  [20, 8],
  [25, 16],
  [30, 24],
  [40, 30],
  [50, 32],
  [60, 40],
  [70, 48],
  [75, 56],
  [80, 60],
  [90, 62],
];
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
function patterns(svg) {
  const result = [];
  walkElements(parseXml(svg).root, (e) => {
    if (e.name.localName === "pattern") result.push(e);
  });
  return result;
}
function check(svg, count) {
  const ps = patterns(svg).filter((p) => {
    let hasPath = false;
    walkElements(p, (e) => {
      if (e.name.localName === "path") hasPath = true;
    });
    return hasPath;
  });
  expect(ps.length).toBeGreaterThan(0);
  for (const p of ps) {
    expect(Number(attr(p, "width"))).toBeCloseTo((24 * 96) / 72, 12);
    expect(Number(attr(p, "height"))).toBeCloseTo((24 * 96) / 72, 12);
    // The percentage mask is a union of unit cells, independent of object bounds.
    const paths = [];
    walkElements(p, (e) => {
      if (e.name.localName === "path") paths.push(e);
    });
    // The integral-pixel SVG tile contains three native periods per axis.
    expect(paths).toHaveLength(9);
    for (const [i, path] of paths.entries()) {
      expect(attr(path, "d")).toBe(attr(paths[0], "d"));
      expect(attr(path, "transform")).toBe(
        `scale(${96 / 72}) translate(${(i % 3) * 8} ${Math.floor(i / 3) * 8})`,
      );
    }
    const runs = [
      ...attr(paths[0], "d").matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)Z/g),
    ];
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.reduce((n, r) => n + Number(r[3]), 0)).toBe(count);
    for (const run of runs) {
      expect(run[3]).toBe(run[4]);
      expect(Number(run[1]) + Number(run[3])).toBeLessThanOrEqual(8);
      expect(Number(run[2])).toBeLessThan(8);
    }
  }
}
describe("native percentage pattern coverage", () => {
  for (const [pct, count] of densities)
    for (const kind of ["shape", "background", "table"])
      it(`retains pct${pct} cell coverage and physical pitch in ${kind}`, async () => {
        const f = await readPatternFixture({
          kind,
          level: "slide",
          preset: `pct${pct}`,
        });
        check(
          decodeURIComponent(
            preview(f.pres, f.slide).split(",").slice(1).join(","),
          ),
          count,
        );
      });
  for (const [kind, levels] of [
    [
      "shape",
      ["slide", "layout", "master", "layoutDecoration", "masterDecoration"],
    ],
    ["reference", ["slide", "layout", "master"]],
    ["background", ["slide", "layout", "master"]],
    ["table", ["slide"]],
  ])
    for (const level of levels)
      it(`uses the pct5 default for an omitted preset in ${kind} at ${level}`, async () => {
        const f = await readPatternFixture({ kind, level, preset: null });
        expect(f.fill.preset).toBe("pct5");
        check(
          decodeURIComponent(
            preview(f.pres, f.slide).split(",").slice(1).join(","),
          ),
          2,
        );
      });
  for (const [pct, count] of densities)
    it(`keeps pct${pct} editable through copy, independent edits, reload and return`, async () => {
      const f = await readPatternFixture({
          kind: "shape",
          level: "slide",
          preset: `pct${pct}`,
        }),
        before = preview(f.pres, f.slide),
        target = createDeck("blank"),
        copy = P.importSlide(target, f.slide, P.getSlideLayouts(target)[0]),
        shape = P.getSlideShapes(copy)[0];
      P.setShapePatternFill(shape, {
        preset: `pct${pct}`,
        foreground: "#9147BC/alpha=33333",
        background: "#23A87D/alpha=70001",
      });
      expect(preview(f.pres, f.slide)).toBe(before);
      const loaded = await P.loadPresentation(await P.savePresentation(target)),
        slide = P.getSlides(loaded).at(-1);
      expect(P.getShapePatternFill(loaded, P.getSlideShapes(slide)[0])).toEqual(
        {
          preset: `pct${pct}`,
          foreground: "#9147BC",
          background: "#23A87D",
          foregroundOpacity: 0.33333,
          backgroundOpacity: 0.70001,
        },
      );
      check(
        decodeURIComponent(
          preview(loaded, slide).split(",").slice(1).join(","),
        ),
        count,
      );
      const returned = P.importSlide(f.pres, slide, P.getSlideLayout(f.slide));
      expect(preview(f.pres, returned)).toBe(preview(loaded, slide));
      expect(P.validatePresentation(loaded)).toEqual([]);
    });
});
