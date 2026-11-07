import { describe, it, expect } from "vitest";
import { vectorCoverage } from "../src/engine/vector-coverage";
const rectangle = (x: number, y: number, w: number, h: number): number[][] => [
  [0, x, y],
  [1, x + w, y],
  [1, x + w, y + h],
  [1, x, y + h],
  [5],
];
describe("pixel-area vector scan conversion", () => {
  it("integrates rational circle arcs without replacing them with polynomial curves", () => {
    for (const radius of [1, 0.75, 1e-4]) {
      const commands = [
        [0, 0, 0],
        [1, radius, 0],
        [3, radius, radius, 0, radius, Math.SQRT1_2],
        [5],
      ];
      expect(
        vectorCoverage(commands, 1, 1, "nonzero")[0] / (radius * radius),
      ).toBeCloseTo(Math.PI / 4, 3);
    }
    const rational = [[0, 0, 0], [3, 0.5, 1, 1, 0, 1], [5]];
    const polynomial = [[0, 0, 0], [2, 0.5, 1, 1, 0], [5]];
    expect(vectorCoverage(rational, 1, 1, "evenodd")[0]).toBeCloseTo(1 / 3, 5);
    expect(vectorCoverage(polynomial, 1, 1, "evenodd")[0]).toBeCloseTo(
      1 / 3,
      5,
    );
    for (const weight of [-1, 0, NaN, Infinity])
      expect(() =>
        vectorCoverage(
          [[0, 0, 0], [3, 1, 1, 0, 1, weight], [5]],
          1,
          1,
          "nonzero",
        ),
      ).toThrow("weight");
  });
  it("integrates rectangles exactly across fractional edges, viewport translations and negative bounds", () => {
    for (const [x, y, w, h] of [
      [2.25, 3.125, 17.5, 12.75],
      [-0.75, -0.375, 4.25, 3.5],
      [0.125 - 1e-6, 0.125 + 1e-6, 0.75, 0.5],
      [0.333, 0.777, 0.0001, 0.0002],
    ]) {
      const result = vectorCoverage(rectangle(x, y, w, h), 23, 19, "evenodd");
      for (let row = 0; row < 19; row++)
        for (let col = 0; col < 23; col++) {
          const dx = Math.max(0, Math.min(col + 1, x + w) - Math.max(col, x)),
            dy = Math.max(0, Math.min(row + 1, y + h) - Math.max(row, y));
          expect(result[row * 23 + col]).toBeCloseTo(dx * dy, 7);
        }
    }
  });
  it("integrates nested holes and overlapping contours within a single pixel under both fill rules", () => {
    const nested = [
      ...rectangle(0.2, 0.2, 0.6, 0.6),
      ...rectangle(0.35, 0.35, 0.3, 0.3),
    ];
    expect(vectorCoverage(nested, 1, 1, "evenodd")[0]).toBeCloseTo(0.27, 7);
    expect(vectorCoverage(nested, 1, 1, "nonzero")[0]).toBeCloseTo(0.36, 7);
    const overlap = [
      ...rectangle(0.2, 0.2, 0.7, 0.6),
      ...rectangle(0.4, 0.2, 0.7, 0.6),
    ];
    expect(Array.from(vectorCoverage(overlap, 2, 1, "evenodd"))).toEqual([
      Math.fround(0.18),
      Math.fround(0.06),
    ]);
    expect(Array.from(vectorCoverage(overlap, 2, 1, "nonzero"))).toEqual([
      Math.fround(0.48),
      Math.fround(0.06),
    ]);
  });
  it("splits crossings instead of averaging opposing winding numbers", () => {
    const bowtie = [[0, 0, 0], [1, 1, 1], [1, 0, 1], [1, 1, 0], [5]];
    expect(vectorCoverage(bowtie, 1, 1, "evenodd")[0]).toBe(0.5);
    expect(vectorCoverage(bowtie, 1, 1, "nonzero")[0]).toBe(0.5);
  });
  it("agrees with independent polygon clipping for rotated, reversed and off-canvas contours", () => {
    type Point = [number, number];
    const clip = (
      input: Point[],
      axis: 0 | 1,
      limit: number,
      lower: boolean,
    ) => {
      const output: Point[] = [];
      for (let i = 0; i < input.length; i++) {
        const a = input[i],
          b = input[(i + 1) % input.length];
        const inside = (p: Point) =>
          lower ? p[axis] >= limit : p[axis] <= limit;
        if (inside(a)) output.push(a);
        if (inside(a) !== inside(b)) {
          const t = (limit - a[axis]) / (b[axis] - a[axis]);
          output.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
        }
      }
      return output;
    };
    for (let trial = 0; trial < 20; trial++) {
      const vertices: Point[] = Array.from(
        { length: 3 + (trial % 7) },
        (_, i) => {
          const angle = (i * 2 * Math.PI) / (3 + (trial % 7)) + trial * 0.137;
          return [
            Math.cos(angle) * (1 + trial * 0.19) + trial * 0.1,
            Math.sin(angle) * (2 + trial * 0.13) + trial * 0.17,
          ];
        },
      );
      if (trial % 2) vertices.reverse();
      const commands = [
        [0, ...vertices[0]],
        ...vertices.slice(1).map((p) => [1, ...p]),
        [5],
      ];
      for (const rule of ["evenodd", "nonzero"] as const) {
        const result = vectorCoverage(commands, 7, 6, rule);
        for (let y = 0; y < 6; y++)
          for (let x = 0; x < 7; x++) {
            let clipped = clip(vertices, 0, x, true);
            clipped = clip(clipped, 0, x + 1, false);
            clipped = clip(clipped, 1, y, true);
            clipped = clip(clipped, 1, y + 1, false);
            let area = 0;
            for (let i = 0; i < clipped.length; i++) {
              const a = clipped[i],
                b = clipped[(i + 1) % clipped.length];
              area += a[0] * b[1] - b[0] * a[1];
            }
            expect(result[y * 7 + x]).toBeCloseTo(Math.abs(area) / 2, 7);
          }
      }
    }
  });
  it("retains curved subpixel features and preserves integrated cubic area", () => {
    // The enclosed area of this two-segment arch is exactly 60 square units.
    const arch = [[0, 0, 0], [4, 0, 10, 10, 10, 10, 0], [1, 0, 0], [5]];
    const area = vectorCoverage(arch, 11, 11, "evenodd").reduce(
      (s, a) => s + a,
      0,
    );
    expect(area).toBeCloseTo(60, 2);
    const tiny = arch.map((c) => [c[0], ...c.slice(1).map((v) => v * 1e-5)]);
    const coverage = vectorCoverage(tiny, 1, 1, "evenodd")[0];
    expect(coverage).toBeGreaterThan(0);
    expect(coverage / 60e-10).toBeCloseTo(1, 4);
  });
});
