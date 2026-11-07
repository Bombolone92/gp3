import { describe, expect, it } from "vitest";
import { P, parseDeck, createDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import native from "./data/geometry-arc-native.json" with { type: "json" };
import { geometryArcFixture } from "./geometry-arc-fixture.js";
import { resolveGeometryArc } from "../lib/pptx/src/internal/drawingml/geometry-arc.ts";
import { createGeometryDeck } from "./geometry-fixture.js";
import { unzipSync } from "fflate";

function paths(p, slide = P.getSlides(p)[0]) {
  const out = [],
    attr = (el, key) => getAttrValue(el, qname("", key, ""));
  walkElements(
    parseXml(renderSlideToSvg(p, slide, { textLayout: "svg" })).root,
    (el) => {
      if (el.name.localName === "path" && attr(el, "stroke") === "#1267B2")
        out.push(attr(el, "d"));
    },
  );
  return out;
}
function arcEnd(path, trailingLine) {
  const commands = path.match(/[A-Z][^A-Z]*/g);
  const numbers = commands
    .at(trailingLine ? -2 : -1)
    .slice(1)
    .match(/-?\d+(?:\.\d+)?/g)
    .map(Number);
  return numbers.slice(-2);
}

describe("native DrawingML ellipse arcs", () => {
  it.each(
    Object.entries(native.sets).flatMap(([set, rows]) =>
      rows.map((row, index) => [set, index, row]),
    ),
  )(
    "matches the native %s arc endpoint %i",
    async (set, index, observation) => {
      const p = await parseDeck(await geometryArcFixture(set)),
        slide = P.getSlides(p)[0],
        shape = P.getSlideShapes(slide)[index],
        bounds = P.getShapeBoundsResolved(p, shape),
        end = arcEnd(paths(p)[index], set !== "ordinary");
      for (let axis = 0; axis < 2; axis++) {
        const offset = axis ? bounds.y : bounds.x;
        expect(
          Math.abs(
            end[axis] - (offset + observation.nativeEndEmu[axis]) / 9525,
          ),
        ).toBeLessThan(0.006);
      }
    },
  );
});

describe("exact geometry arc behavior", () => {
  it.each(Array.from({ length: 8 }, (_, i) => [i]))(
    "renders ordinary control %i as exact SVG ellipse arcs with the native direction",
    async (index) => {
      const p = await parseDeck(await geometryArcFixture()),
        d = paths(p)[index];
      expect(d).not.toContain("C");
      const arcs = d.match(/A[^A-Z]*/g);
      expect(arcs).toHaveLength(index % 4 === 3 ? 2 : 1);
      for (const arc of arcs) {
        const numbers = arc
          .slice(1)
          .match(/-?\d+(?:\.\d+)?/g)
          .map(Number);
        expect(numbers.slice(0, 2)).toEqual(
          index < 4 ? [64.8, 33.6] : [36, 60],
        );
        expect(numbers.slice(2, 5)).toEqual([0, 0, index % 4 === 2 ? 0 : 1]);
      }
    },
  );
  it.each(
    [
      [-137, 391],
      [137, -391],
      [-137, -391],
      [137, 391],
      [59, 59],
    ].flatMap(([rx, ry]) =>
      [-785, 38.25, 412, 270].flatMap((start) =>
        [-258.5, 123.75].map((sweep) => [rx, ry, start, sweep]),
      ),
    ),
  )(
    "keeps arbitrary %s/%s ellipses on their radial rays from %s through %s degrees",
    (rx, ry, start, sweep) => {
      // Independent ray/ellipse intersection, not parametric angle conversion.
      const ray = (angle) => {
        const a = (angle * Math.PI) / 180,
          distance = (rx * ry) / Math.hypot(ry * Math.cos(a), rx * Math.sin(a));
        return { x: distance * Math.cos(a), y: distance * Math.sin(a) };
      };
      const a = ray(start),
        b = ray(start + sweep),
        result = resolveGeometryArc(
          37.5,
          -82.25,
          rx,
          ry,
          start * 60000,
          sweep * 60000,
        );
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(2);
      expect(result.at(-1).end.x).toBeCloseTo(37.5 + b.x - a.x, 10);
      expect(result.at(-1).end.y).toBeCloseTo(-82.25 + b.y - a.y, 10);
      for (const segment of result) {
        expect(segment.kind).toBe("arc");
        expect(segment.clockwise).toBe(Math.sign(sweep) === Math.sign(rx * ry));
        const cx = 37.5 - a.x,
          cy = -82.25 - a.y;
        expect(
          ((segment.end.x - cx) / rx) ** 2 + ((segment.end.y - cy) / ry) ** 2,
        ).toBeCloseTo(1, 12);
      }
    },
  );
  it.each([-450, 450, -720, 720, -1e100, 1e100])(
    "clamps %s-degree sweeps to one complete native ellipse",
    (sweep) => {
      const result = resolveGeometryArc(
        13,
        41,
        237,
        83,
        37 * 60000,
        sweep * 60000,
      );
      expect(result).toHaveLength(2);
      expect(result.at(-1).end).toEqual({ x: 13, y: 41 });
      expect(
        result.every((s) => s.kind === "arc" && s.clockwise === sweep > 0),
      ).toBe(true);
    },
  );
  it.each([-360, 360])(
    "preserves the extrema of collapsed ellipses in a %s-degree sweep",
    (sweep) => {
      const vertical = resolveGeometryArc(13, 41, 0, 19, 0, sweep * 60000);
      expect(vertical.map((s) => s.kind)).toEqual(["line", "line", "line"]);
      expect(vertical.map((s) => s.end.y)).toEqual(
        sweep > 0 ? [60, 22, 41] : [22, 60, 41],
      );
      expect(vertical.every((s) => s.end.x === 13)).toBe(true);
      const horizontal = resolveGeometryArc(
        13,
        41,
        19,
        0,
        90 * 60000,
        sweep * 60000,
      );
      const expected = sweep > 0 ? [-6, 32, 13] : [32, -6, 13];
      horizontal.forEach((s, i) =>
        expect(s.end.x).toBeCloseTo(expected[i], 12),
      );
      expect(horizontal.every((s) => s.end.y === 41)).toBe(true);
    },
  );
  it("zero sweep and a zero-size ellipse leave the pen untouched", () => {
    expect(resolveGeometryArc(17, 23, 137, 82, 300, 0)).toEqual([]);
    expect(resolveGeometryArc(17, 23, 0, 0, 300, 21600000)).toEqual([]);
  });
  it.each(Array.from({ length: 6 }, (_, index) => [index]))(
    "rejects nonfinite arc argument %i",
    (index) => {
      const args = [17, 23, 137, 82, 300, 5400000];
      for (const value of [NaN, Infinity, -Infinity]) {
        args[index] = value;
        expect(() => resolveGeometryArc(...args)).toThrow(RangeError);
      }
    },
  );
  it.each(["sqrt -1", `val ${"9".repeat(310)}`])(
    "reports malformed consumed guide %s as a labelled custom-geometry fallback",
    async (formula) => {
      const p = await parseDeck(
        await createGeometryDeck({
          shapeKind: "shape",
          geometry: `<a:custGeom><a:gdLst><a:gd name="bad" fmla="${formula}"/></a:gdLst><a:pathLst><a:path><a:moveTo><a:pt x="hc" y="vc"/></a:moveTo><a:arcTo wR="bad" hR="hd4" stAng="2700000" swAng="5400000"/></a:path></a:pathLst></a:custGeom>`,
        }),
      );
      const sh = P.getSlideShapes(P.getSlides(p)[0])[0];
      expect(P.getShapeGeometryEffective(p, sh)).toEqual({
        kind: "custom",
        geometry: null,
      });
      const svg = renderSlideToSvg(p, P.getSlides(p)[0]);
      expect(svg).toContain('data-pptx-fallback="custGeom"');
      expect(svg).not.toMatch(/NaN|Infinity/);
    },
  );
  it.each(
    ["picture", "shape"].flatMap((kind) =>
      ["local", "layout", "master"].map((level) => [kind, level]),
    ),
  )(
    "shares exact inherited arc geometry between %s clipping and outline from %s",
    async (shapeKind, level) => {
      const geometry =
          '<a:custGeom><a:pathLst><a:path><a:moveTo><a:pt x="hc" y="vc"/></a:moveTo><a:arcTo wR="wd4" hR="hd4" stAng="2700000" swAng="16200000"/><a:close/></a:path></a:pathLst></a:custGeom>',
        p = await parseDeck(
          await createGeometryDeck({
            shapeKind,
            level,
            geometry,
            extraProperties:
              '<a:ln w="38100"><a:solidFill><a:srgbClr val="1267B2"/></a:solidFill></a:ln>',
          }),
        );
      const svg = renderSlideToSvg(p, P.getSlides(p)[0], { textLayout: "svg" }),
        root = parseXml(svg).root,
        ds = [];
      walkElements(root, (el) => {
        if (el.name.localName === "path")
          ds.push(getAttrValue(el, qname("", "d", "")));
      });
      expect(ds).toHaveLength(2);
      expect(ds[0]).toBe(ds[1]);
      expect(ds[0]).toContain("A");
      expect(ds[0]).not.toContain("C");
      const saved = await parseDeck(await P.savePresentation(p));
      const savedPaths = [];
      walkElements(
        parseXml(
          renderSlideToSvg(saved, P.getSlides(saved)[0], { textLayout: "svg" }),
        ).root,
        (el) => {
          if (el.name.localName === "path")
            savedPaths.push(getAttrValue(el, qname("", "d", "")));
        },
      );
      expect(savedPaths).toEqual(ds);
      expect(
        P.getShapeGeometryEffective(
          saved,
          P.getSlideShapes(P.getSlides(saved)[0])[0],
        ),
      ).toEqual(
        P.getShapeGeometryEffective(p, P.getSlideShapes(P.getSlides(p)[0])[0]),
      );
    },
  );
  it("scales authored path coordinates anisotropically after resolving radial angles", async () => {
    const geometry =
        '<a:custGeom><a:pathLst><a:path w="1000" h="1000"><a:moveTo><a:pt x="500" y="500"/></a:moveTo><a:arcTo wR="200" hR="80" stAng="2700000" swAng="5400000"/></a:path></a:pathLst></a:custGeom>',
      p = await parseDeck(
        await createGeometryDeck({
          shapeKind: "shape",
          level: "local",
          geometry,
          bounds: {
            x: P.inches(1),
            y: P.inches(0.5),
            w: P.inches(4),
            h: P.inches(1),
          },
          extraProperties:
            '<a:ln w="38100"><a:solidFill><a:srgbClr val="1267B2"/></a:solidFill></a:ln>',
        }),
      ),
      d = paths(p)[0];
    expect(d).toContain("A76.80,7.68 0 0 1");
    const intersection = (200 * 80) / Math.hypot(80, 200),
      end = arcEnd(d, false);
    expect(end[0]).toBeCloseTo(96 + ((500 - 2 * intersection) * 384) / 1000, 2);
    expect(end[1]).toBe(96);
  });
  it("updates the pen through chained arcs and resets it after close and move", async () => {
    const geometry =
        '<a:custGeom><a:pathLst><a:path w="1000" h="1000"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="50"/></a:lnTo><a:arcTo wR="200" hR="80" stAng="2700000" swAng="5400000"/><a:arcTo wR="100" hR="40" stAng="8100000" swAng="-5400000"/><a:close/><a:arcTo wR="50" hR="50" stAng="0" swAng="5400000"/><a:moveTo><a:pt x="300" y="400"/></a:moveTo><a:arcTo wR="50" hR="50" stAng="10800000" swAng="5400000"/></a:path></a:pathLst></a:custGeom>',
      p = await parseDeck(
        await createGeometryDeck({
          shapeKind: "shape",
          level: "local",
          geometry,
          extraProperties:
            '<a:ln w="38100"><a:solidFill><a:srgbClr val="1267B2"/></a:solidFill></a:ln>',
        }),
      ),
      d = paths(p)[0],
      commands = d.match(/[A-Z][^A-Z]*/g),
      endpoints = commands
        .filter((c) => c.startsWith("A"))
        .map((c) =>
          c
            .slice(1)
            .match(/-?\d+(?:\.\d+)?/g)
            .map(Number)
            .slice(-2),
        );
    const distance = (200 * 80) / Math.hypot(200, 80);
    expect(endpoints[0][0]).toBeCloseTo(
      96 + ((100 - 2 * distance) * 384) / 1000,
      2,
    );
    expect(endpoints[1][0]).toBeCloseTo(
      96 + ((100 - distance) * 384) / 1000,
      2,
    );
    expect(endpoints[2]).toEqual([76.8, 105.6]);
    expect(endpoints[3]).toEqual([230.4, 163.2]);
  });
  it.each(Object.keys(native.sets))(
    "preserves %s source geometry through reads, grouping, save and bidirectional transfer",
    async (set) => {
      const p = await parseDeck(await geometryArcFixture(set)),
        s = P.getSlides(p)[0],
        parts = unzipSync(await P.savePresentation(p)),
        before = paths(p);
      expect(unzipSync(await P.savePresentation(p))).toEqual(parts);
      P.groupShapes(P.getSlideShapes(s).slice(0, 2));
      expect(paths(p)).toEqual(before);
      const target = createDeck("blank");
      P.importSlide(target, s, P.getSlideLayouts(target)[0], {
        preservePaintFormatting: true,
        preserveTextFormatting: true,
      });
      expect(paths(target, P.getSlides(target).at(-1))).toEqual(before);
      const saved = await parseDeck(await P.savePresentation(target)),
        returned = createDeck("blank");
      P.importSlide(
        returned,
        P.getSlides(saved).at(-1),
        P.getSlideLayouts(returned)[0],
        { preservePaintFormatting: true, preserveTextFormatting: true },
      );
      expect(paths(returned, P.getSlides(returned).at(-1))).toEqual(before);
    },
  );
});
