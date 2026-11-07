import { expect, it } from "vitest";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { P } from "../src/model.js";
import { chartLegendLayoutDeck } from "./chart-copy-fixture.js";
import {
  getAttrValue,
  parseXml,
  qname,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";

const F = "#ECF5E9",
  O = "#23916F",
  G = "#167E9B",
  S = "#E85239";
const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const bounds = (e) => ["x", "y", "width", "height"].map((n) => +attr(e, n));
function paint(options = {}, width = 7, height = 4) {
  const f = chartLegendLayoutDeck({
    kind: "column",
    legend: undefined,
    sizePt: 14,
    valueAxis: { min: 0, max: 8, majorUnit: 2 },
    series: [
      { name: "Units", values: [2, 4, 3, 5], color: S, markerSymbol: "none" },
    ],
    valueAxisMajorGridlines: true,
    valueAxisMajorGridlineColor: G,
    valueAxisMajorGridlineWidthEmu: 127000,
    plotAreaFill: F,
    plotAreaStrokeColor: O,
    plotAreaStrokeWidthEmu: 38100,
    ...options,
  });
  P.setShapeSize(f.shape, P.inches(width), P.inches(height));
  const nodes = [];
  walkElements(parseXml(renderSlideToSvg(f.p, f.slide)).root, (e) =>
    nodes.push(e),
  );
  return {
    nodes,
    fill: nodes.filter(
      (e) => e.name.localName === "rect" && attr(e, "fill") === F,
    ),
    outline: nodes.filter(
      (e) => e.name.localName === "rect" && attr(e, "stroke") === O,
    ),
    grid: nodes.filter((e) => attr(e, "stroke") === G),
    series: nodes.filter(
      (e) => attr(e, "fill") === S || attr(e, "stroke") === S,
    ),
  };
}
function expectLayers(r) {
  expect(r.fill).toHaveLength(1);
  expect(r.outline).toHaveLength(1);
  expect(r.grid.length).toBeGreaterThan(1);
  expect(r.series.length).toBeGreaterThan(0);
  const index = (e) => r.nodes.indexOf(e);
  expect(index(r.fill[0])).toBeLessThan(Math.min(...r.grid.map(index)));
  expect(Math.max(...r.grid.map(index))).toBeLessThan(index(r.outline[0]));
  expect(index(r.outline[0])).toBeLessThan(Math.min(...r.series.map(index)));
  expect(attr(r.fill[0], "stroke")).toBe("none");
  expect(attr(r.outline[0], "fill")).toBe("none");
  expect(bounds(r.outline[0])).toEqual(bounds(r.fill[0]));
}
// Gridlines reach the plot boundary. The outline is painted over their
// endpoints, after the background and before any series geometry.
for (const kind of ["column", "bar", "line", "area"])
  for (const direction of ["minMax", "maxMin"])
    it(`${kind} ${direction} keeps grid endpoints under the plot outline`, () => {
      const r = paint({
        kind,
        categoryAxisOrientation: direction,
        valueAxisOrientation: direction,
      });
      expectLayers(r);
      const [x, y, w, h] = bounds(r.outline[0]);
      for (const e of r.grid) {
        const actual = ["x1", "y1", "x2", "y2"].map((n) => +attr(e, n));
        const endpoints =
            kind === "bar" ? [actual[1], actual[3]] : [actual[0], actual[2]],
          expected = kind === "bar" ? [y, y + h] : [x, x + w];
        // Each SVG coordinate rounds to 0.01px; adding the rectangle's
        // rounded origin and span can accumulate three half-unit errors.
        endpoints.forEach((v, i) =>
          expect(Math.abs(v - expected[i])).toBeLessThan(0.015),
        );
      }
    });
for (const fill of [F, null, undefined])
  for (const outline of [O, null, undefined])
    it(`keeps plot fill ${fill} and outline ${outline} independent`, () => {
      const r = paint({ plotAreaFill: fill, plotAreaStrokeColor: outline });
      expect(r.fill).toHaveLength(fill ? 1 : 0);
      expect(r.outline).toHaveLength(outline ? 1 : 0);
      if (fill) expect(attr(r.fill[0], "stroke")).toBe("none");
      if (outline) {
        expect(attr(r.outline[0], "fill")).toBe("none");
        expect(r.nodes.indexOf(r.outline[0])).toBeGreaterThan(
          Math.max(...r.grid.map((e) => r.nodes.indexOf(e))),
        );
      }
    });
for (const [width, height, stroke] of [
  [2.5, 6, 0],
  [8.5, 2.25, 9525],
  [5, 3.75, 31750],
])
  it(`retains coincident plot bounds and ${stroke} EMU stroke at ${width} × ${height}`, () => {
    const r = paint({ plotAreaStrokeWidthEmu: stroke }, width, height);
    expectLayers(r);
    expect(+attr(r.outline[0], "stroke-width")).toBeCloseTo(stroke / 9525, 8);
  });
for (const values of [[], [null, null, null, null]])
  it(`keeps an empty plot's background, grid and outline independent: ${JSON.stringify(values)}`, () => {
    const r = paint({ series: [{ name: "Empty", values, color: S }] });
    expect(r.fill).toHaveLength(1);
    expect(r.outline).toHaveLength(1);
    expect(r.nodes.indexOf(r.fill[0])).toBeLessThan(
      Math.min(...r.grid.map((e) => r.nodes.indexOf(e))),
    );
    expect(r.nodes.indexOf(r.outline[0])).toBeGreaterThan(
      Math.max(...r.grid.map((e) => r.nodes.indexOf(e))),
    );
    expect(attr(r.outline[0], "fill")).toBe("none");
    expect(bounds(r.outline[0])).toEqual(bounds(r.fill[0]));
  });
