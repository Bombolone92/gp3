import { describe, expect, it } from "vitest";
import { P, createDeck, preview } from "../src/model.js";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { readPatternFixture } from "./pattern-opacity-fixture.js";
import { binaryPatternCases } from "./pattern-motif-fixture.js";

const attr = (e, n) => getAttrValue(e, qname("", n, ""));
function check(pres, slide, [preset, count, foreground, background]) {
  const svg = decodeURIComponent(
      preview(pres, slide).split(",").slice(1).join(","),
    ),
    patterns = [];
  walkElements(parseXml(svg).root, (e) => {
    if (e.name.localName === "pattern") patterns.push(e);
  });
  expect(patterns.length).toBeGreaterThan(0);
  for (const pattern of patterns) {
    expect(Number(attr(pattern, "width"))).toBe(32);
    expect(Number(attr(pattern, "height"))).toBe(32);
    const paths = [];
    walkElements(pattern, (e) => {
      if (e.name.localName === "path") paths.push(e);
    });
    expect(paths).toHaveLength(9);
    const cells = Array.from({ length: 8 }, () => Array(8).fill(false));
    const runs = [
      ...attr(paths[0], "d").matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)Z/g),
    ];
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) {
      const [x, y, w, reverse] = r.slice(1).map(Number);
      expect(w).toBe(reverse);
      expect(x + w).toBeLessThanOrEqual(8);
      expect(y).toBeLessThan(8);
      for (let i = x; i < x + w; i++) {
        expect(cells[y][i]).toBe(false);
        cells[y][i] = true;
      }
    }
    expect(cells.flat().filter(Boolean), preset).toHaveLength(count);
    for (const [x, y] of foreground)
      expect(cells[y][x], `${preset} foreground ${x},${y}`).toBe(true);
    for (const [x, y] of background)
      expect(cells[y][x], `${preset} background ${x},${y}`).toBe(false);
    for (const [i, path] of paths.entries()) {
      expect(attr(path, "d")).toBe(attr(paths[0], "d"));
      expect(attr(path, "transform")).toBe(
        `scale(${96 / 72}) translate(${(i % 3) * 8} ${Math.floor(i / 3) * 8})`,
      );
    }
  }
}
describe("native binary pattern geometry", () => {
  for (const row of binaryPatternCases) {
    const [preset] = row;
    for (const kind of ["shape", "background", "table"])
      it(`keeps ${preset} coverage, phase and pitch in ${kind}`, async () => {
        const f = await readPatternFixture({ kind, level: "slide", preset });
        check(f.pres, f.slide, row);
      });
    it(`keeps ${preset} independently editable through copy, reload and return`, async () => {
      const f = await readPatternFixture({
          kind: "shape",
          level: "slide",
          preset,
        }),
        before = preview(f.pres, f.slide),
        target = createDeck("blank"),
        copy = P.importSlide(target, f.slide, P.getSlideLayouts(target)[0]);
      P.setShapePatternFill(P.getSlideShapes(copy)[0], {
        preset,
        foreground: "#9147BC/alpha=33333",
        background: "#23A87D/alpha=70001",
      });
      expect(preview(f.pres, f.slide)).toBe(before);
      const p = await P.loadPresentation(await P.savePresentation(target)),
        s = P.getSlides(p).at(-1);
      expect(P.getShapePatternFill(p, P.getSlideShapes(s)[0])).toEqual({
        preset,
        foreground: "#9147BC",
        background: "#23A87D",
        foregroundOpacity: 0.33333,
        backgroundOpacity: 0.70001,
      });
      check(p, s, row);
      const returned = P.importSlide(f.pres, s, P.getSlideLayout(f.slide));
      expect(preview(f.pres, returned)).toBe(preview(p, s));
      expect(P.validatePresentation(p)).toEqual([]);
    });
  }
});
