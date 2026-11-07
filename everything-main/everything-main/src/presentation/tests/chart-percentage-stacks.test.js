import { expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { chartRoot, workbook } from "./chart-copy-fixture.js";
import {
  chartPercentageStacksDeck,
  chartPercentageComboDeck,
  percentageColors as colors,
} from "./chart-percentage-stacks-fixture.js";
import {
  getAttrValue,
  parseXml,
  qname,
  walkElements,
} from "../lib/pptx/src/internal/xml/index.ts";

const attr = (e, n) => getAttrValue(e, qname("", n, ""));
const num = (e, n) => Number(attr(e, n));
const text = (e) =>
  e.children
    .filter((c) => c.kind === "text")
    .map((c) => c.data)
    .join("");
function paint(f) {
  const svg = renderSlideToSvg(f.p, f.slide),
    nodes = [];
  walkElements(parseXml(svg).root, (e) => nodes.push(e));
  return {
    svg,
    plot: nodes.find(
      (e) => e.name.localName === "rect" && attr(e, "fill") === "#ECF5E9",
    ),
    labels: nodes.filter(
      (e) => e.name.localName === "text" && attr(e, "fill") === "#17589B",
    ),
    grids: nodes.filter(
      (e) => e.name.localName === "line" && attr(e, "stroke") === "#9152BD",
    ),
    bars: nodes.filter(
      (e) => e.name.localName === "rect" && colors.includes(attr(e, "fill")),
    ),
    paths: nodes.filter(
      (e) => e.name.localName === "path" && colors.includes(attr(e, "stroke")),
    ),
    markers: nodes.filter(
      (e) => e.name.localName === "circle" && colors.includes(attr(e, "fill")),
    ),
  };
}
const positive = [
    [1, 2, 3],
    [3, 2, 1],
  ],
  negative = positive.map((row) => row.map((v) => -v)),
  mixed = [
    [1, -2, 3],
    [-3, 2, -1],
  ],
  zero = [
    [0, 0, 0],
    [0, 0, 0],
  ];
// Independent native reference controls. Authored units make these limits
// independent of the unresolved automatic tick-density/layout fitting.
const cases = [
  [positive, { min: 0.2, max: 0.8, majorUnit: 0.3 }, [0.2, 0.8]],
  [positive, { min: 0.1, majorUnit: 0.3 }, [0.1, 1]],
  [positive, { max: 0.8, majorUnit: 0.3 }, [-0.1, 0.8]],
  [positive, { majorUnit: 0.3 }, [0, 1.2]],
  [positive, { min: -0.4, max: 1.4, majorUnit: 0.3 }, [-0.4, 1.4]],
  [positive, { min: 1.2, majorUnit: 0.3 }, [1.2, 1.5]],
  [positive, { max: -0.2, majorUnit: 0.3 }, [-0.5, -0.2]],
  [positive, { min: 1, majorUnit: 0.3 }, [1, 1.3]],
  [positive, { max: 0, majorUnit: 0.3 }, [-0.3, 0]],
  [negative, { majorUnit: 0.3 }, [-1.2, 0]],
  [negative, { min: -0.8, majorUnit: 0.3 }, [-0.8, 0.1]],
  [mixed, { min: -0.4, max: 0.4, majorUnit: 0.2 }, [-0.4, 0.4]],
  [positive, { min: 0.93, majorUnit: 0.02 }, [0.93, 1.01]],
  [zero, { max: 0, majorUnit: 0.3 }, [-0.3, 0]],
  [positive, {}, [0, 1]],
  [negative, {}, [-1, 0]],
  [zero, {}, [0, 1]],
];
for (const kind of ["bar", "column", "line", "area"])
  for (const direction of ["minMax", "maxMin"])
    for (const [values, axis, [min, max]] of cases)
      it(`${kind} ${direction} honors percentage limits ${JSON.stringify(axis)} for ${JSON.stringify(values)}`, () => {
        const r = paint(
            chartPercentageStacksDeck({ kind, direction, values, axis }),
          ),
          unit = axis.majorUnit ?? 0.2,
          expected = Array.from(
            { length: Math.round((max - min) / unit) + 1 },
            (_, i) => min + i * unit,
          );
        expect(r.labels.map(text)).toEqual(
          expected.map((v) => `${Math.round(v * 100)}%`),
        );
        expect(r.grids).toHaveLength(expected.length);
        const horizontal = kind === "bar",
          start = num(r.plot, horizontal ? "x" : "y"),
          span = num(r.plot, horizontal ? "width" : "height");
        r.grids.forEach((e, i) => {
          let t = (expected[i] - min) / (max - min);
          if (!horizontal) t = 1 - t;
          if (direction === "maxMin") t = 1 - t;
          expect((num(e, horizontal ? "x1" : "y1") - start) / span).toBeCloseTo(
            t,
            4,
          );
        });
        expect(r.svg).not.toMatch(/NaN|Infinity/);
      });

for (const kind of ["bar", "column", "line", "area"])
  for (const direction of ["minMax", "maxMin"])
    it(`${kind} ${direction} automatic signed percentage range follows the plotted stack`, () => {
      const r = paint(
        chartPercentageStacksDeck({
          kind,
          direction,
          values: mixed,
          axis: { majorUnit: 0.2 },
        }),
      );
      expect(r.labels.map(text)).toEqual(
        (kind === "bar" || kind === "column"
          ? [-80, -60, -40, -20, 0, 20, 40, 60, 80]
          : [-60, -40, -20, 0, 20, 40, 60, 80]
        ).map((v) => `${v}%`),
      );
    });

// Vary magnitudes over hundreds of orders, including a finite-input sum
// that overflows. Normalization must preserve the same signed geometry.
for (const kind of ["bar", "column", "line", "area"])
  for (const direction of ["minMax", "maxMin"])
    for (const factor of [1, 1e-250, 1e250, Number.MAX_VALUE / 3.5])
      it(`${kind} ${direction} normalizes signed shares with magnitude ${factor}`, () => {
        const f = chartPercentageStacksDeck({
            kind,
            direction,
            values: mixed.map((row) => row.map((v) => v * factor)),
          }),
          r = paint(f),
          horizontal = kind === "bar",
          start = num(r.plot, horizontal ? "x" : "y"),
          span = num(r.plot, horizontal ? "width" : "height"),
          coordinate = (v) => {
            let t = (v + 1) / 2;
            if (!horizontal) t = 1 - t;
            if (direction === "maxMin") t = 1 - t;
            return start + t * span;
          };
        if (kind === "bar" || kind === "column") {
          expect(r.bars).toHaveLength(6);
          const shares = [
            [0.25, -0.75],
            [-0.5, 0.5],
            [0.75, -0.25],
          ];
          r.bars.forEach((bar, i) => {
            const tip = coordinate(shares[Math.floor(i / 2)][i % 2]),
              base = coordinate(0);
            expect(
              Math.abs(num(bar, horizontal ? "x" : "y") - Math.min(tip, base)),
            ).toBeLessThan(0.02);
            expect(
              Math.abs(
                num(bar, horizontal ? "width" : "height") -
                  Math.abs(tip - base),
              ),
            ).toBeLessThan(0.02);
          });
        } else {
          expect(r.paths).toHaveLength(2);
          const tops = [
            [0.25, -0.5, 0.75],
            [-0.5, 0, 0.5],
          ];
          r.paths.forEach((path, s) => {
            const pts = [
              ...attr(path, "d").matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g),
            ].map((m) => [+m[1], +m[2]]);
            expect(pts.length).toBe(kind === "area" ? 6 : 3);
            pts
              .slice(0, 3)
              .forEach(([, y], c) =>
                expect(Math.abs(y - coordinate(tops[s][c]))).toBeLessThan(0.02),
              );
          });
          if (kind === "line") expect(r.markers).toHaveLength(6);
        }
        expect(r.svg).not.toMatch(/NaN|Infinity/);
      });

for (const kind of ["bar", "column", "line", "area"])
  it(`${kind} preserves signed raw data, authored limits and native workbook through transfer and save`, async () => {
    const f = chartPercentageStacksDeck({
        kind,
        axis: { min: -0.4, max: 0.4, majorUnit: 0.2 },
        dataLabels: { showValue: true },
      }),
      spec = P.getShapeChartSpec(f.shape),
      raw = P._internalPackageOf(f.p).getPart(chartRoot(f.shape)).data.slice(),
      book = workbook(f.p, f.shape).data.slice(),
      q = createDeck("blank"),
      slide = P.importSlide(q, f.slide, P.getSlideLayouts(q)[0]),
      saved = await P.loadPresentation(await P.savePresentation(q)),
      imported = P.getSlides(saved).at(-1),
      chart = P.getSlideCharts(imported)[0];
    expect(P.getShapeChartSpec(chart.shape)).toEqual(spec);
    expect(
      P._internalPackageOf(saved).getPart(chartRoot(chart.shape)).data,
    ).toEqual(raw);
    expect(workbook(saved, chart.shape).data).toEqual(book);
    expect(P.validatePresentation(saved)).toEqual([]);
    expect(paint({ p: saved, slide: imported }).labels.map(text)).toEqual([
      "-40%",
      "-20%",
      "0%",
      "20%",
      "40%",
    ]);
  });

for (const secondary of [false, true])
  for (const direction of ["minMax", "maxMin"])
    it(`percentage plots normalize independently with ${secondary ? "separate" : "shared"} value axes ${direction}`, () => {
      const f = chartPercentageComboDeck({
          secondary,
          direction,
          secondaryValueAxisOrientation: direction,
        }),
        r = paint(f),
        nodes = [];
      walkElements(parseXml(r.svg).root, (e) => nodes.push(e));
      const paths = ["#882266", "#CC8800"].map((color) =>
          nodes.find(
            (e) => e.name.localName === "path" && attr(e, "stroke") === color,
          ),
        ),
        extent = secondary ? 0.6 : 1,
        top = num(r.plot, "y"),
        height = num(r.plot, "height"),
        expected = [
          [-5 / 6, 0.8, -0.25],
          [-2 / 3, 0.6, 0.5],
        ];
      paths.forEach((path, s) => {
        expect(path).toBeDefined();
        const pts = [...attr(path, "d").matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)];
        expect(pts).toHaveLength(3);
        pts.forEach((m, c) => {
          let t = (expected[s][c] + extent) / (2 * extent);
          if (direction !== "maxMin") t = 1 - t;
          expect(Math.abs(+m[2] - (top + t * height))).toBeLessThan(0.02);
        });
      });
      const bars = r.bars;
      expect(bars).toHaveLength(6);
      bars.forEach((bar, i) => {
        const share = [
          [0.25, -0.75],
          [-0.5, 0.5],
          [0.75, -0.25],
        ][Math.floor(i / 2)][i % 2];
        expect(
          Math.abs(num(bar, "height") - (Math.abs(share) * height) / 2),
        ).toBeLessThan(0.02);
      });
    });

for (const kind of ["bar", "column", "line", "area"])
  it(`${kind} ignores blank cells in the percentage denominator and retains all-zero categories`, () => {
    const f = chartPercentageStacksDeck({
        kind,
        values: [
          [1, null, 0],
          [null, -2, 0],
        ],
        axis: { min: -1, max: 1, majorUnit: 0.5 },
        dispBlanksAs: "zero",
      }),
      r = paint(f);
    expect(r.svg).not.toMatch(/NaN|Infinity/);
    if (kind === "bar" || kind === "column") {
      expect(r.bars).toHaveLength(2);
      const span = num(r.plot, kind === "bar" ? "width" : "height");
      for (const bar of r.bars)
        expect(
          Math.abs(num(bar, kind === "bar" ? "width" : "height") - span / 2),
        ).toBeLessThan(0.02);
    } else {
      expect(r.paths).toHaveLength(2);
      const top = num(r.plot, "y"),
        height = num(r.plot, "height");
      r.paths.forEach((path, s) => {
        const points = [
          ...attr(path, "d").matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g),
        ];
        [1, s === 0 ? 0 : -1, 0].forEach((v, c) =>
          expect(
            Math.abs(+points[c][2] - (top + ((1 - v) / 2) * height)),
          ).toBeLessThan(0.02),
        );
      });
    }
  });
