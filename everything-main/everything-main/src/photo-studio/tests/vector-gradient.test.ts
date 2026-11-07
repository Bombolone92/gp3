import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  gradientRamp,
  gradientPosition,
  gradientSpan,
  gradientMidpoint,
  gradientSampler,
  exportGradientDefinition,
  validateVectorGradient,
  supportedGradientDefinition,
  type VectorGradient,
} from "../src/model/vector-gradient";
import type { PsdSolidGradientFill } from "../src/model/psd-gradient-fill";

function fill(overrides: Partial<VectorGradient> = {}): VectorGradient {
  return {
    type: "solid",
    name: "Independent gradient",
    style: "linear",
    frame: { x: -7.25, y: 3.125, width: 23.5, height: 13.25 },
    colorStops: [
      { location: 0, midpoint: 0.5, color: { r: 0, g: 0, b: 0 } },
      { location: 1, midpoint: 0.5, color: { r: 255, g: 255, b: 255 } },
    ],
    opacityStops: [],
    ...overrides,
  };
}
describe("native Classic gradient material", () => {
  it("matches interpolation observations independently of reference coordinate quantization", () => {
    const report = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/psd-gradient-render/compatible-editor-report.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const linear = report.observations.find(
      (o: any) => o.interpolationSamples === 0,
    ).grayRow;
    for (const observation of report.observations) {
      const input = fill({
        interpolationSamples: observation.interpolationSamples,
      });
      input.colorStops.forEach(
        (stop, i) => (stop.midpoint = observation.colorMidpoints[i] / 100),
      );
      const sample = gradientRamp(input);
      observation.grayRow.forEach((value: number, x: number) => {
        // Derive the reference position interval from its linear byte capture.
        // This isolates interpolation from the editor's position quantization:
        // one byte code bounds each quantization, rather than assuming x/width.
        const low = Math.max(0, (linear[x] - 1) / 255),
          high = Math.min(1, (linear[x] + 1) / 255);
        expect(value).toBeGreaterThanOrEqual(
          Math.floor(sample(low)[0] * 255) - 1,
        );
        expect(value).toBeLessThanOrEqual(Math.ceil(sample(high)[0] * 255) + 1);
      });
    }
  });
  it("applies endpoint-duplicated cubic easing to RGB and opacity with original double smoothness", () => {
    for (const smoothness of [0, 137.375, 1024, 2048, 4096]) {
      const input = fill({
          interpolationSamples: smoothness,
          opacityStops: [
            { location: 0, midpoint: 0.1, opacityPercent: 0 },
            { location: 1, midpoint: 0.5, opacityPercent: 100 },
          ],
        }),
        sample = gradientRamp(input);
      for (const t of [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1]) {
        const cubic = 0.5 * t + 1.5 * t * t - t * t * t,
          expected = t + (cubic - t) * (smoothness / 4096);
        for (const channel of sample(t))
          expect(channel).toBeCloseTo(expected, 14);
      }
    }
  });
  it("preserves nonuniform stops, source ordering, hard edges, end colors and HDR values", () => {
    const input = fill({
        interpolationSamples: 0,
        colorStops: [
          { location: 0.75, midpoint: 0.5, color: { r: 510, g: 0, b: -255 } },
          { location: 0.125, midpoint: 0.5, color: { r: -255, g: 255, b: 0 } },
          { location: 0.125, midpoint: 0.5, color: { r: 0, g: 255, b: 0 } },
          { location: 1, midpoint: 0.5, color: { r: 255, g: 0, b: 510 } },
        ],
      }),
      snapshot = JSON.stringify(input),
      sample = gradientRamp(input);
    expect(sample(0)).toEqual([-1, 1, 0, 1]);
    expect(sample(0.125)).toEqual([0, 1, 0, 1]);
    expect(sample((0.125 + 0.75) / 2)).toEqual([1, 0.5, -0.5, 1]);
    expect(sample(1)).toEqual([1, 0, 2, 1]);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
  it("handles endpoint midpoints as exact limits and bounds cubic opacity overshoot", () => {
    expect(gradientMidpoint(0, 0)).toBe(0);
    expect(gradientMidpoint(0.25, 0)).toBe(0.625);
    expect(gradientMidpoint(0.75, 1)).toBe(0.375);
    expect(gradientMidpoint(1, 1)).toBe(1);
    const input = fill({
        opacityStops: [
          { location: 0, midpoint: 0.5, opacityPercent: 100 },
          { location: 0.25, midpoint: 0.5, opacityPercent: 0 },
          { location: 0.75, midpoint: 0.5, opacityPercent: 0 },
          { location: 1, midpoint: 0.5, opacityPercent: 100 },
        ],
      }),
      sample = gradientRamp(input);
    expect(sample(0.5)[3]).toBe(0);
    expect(sample(0)[3]).toBe(1);
    expect(sample(1)[3]).toBe(1);
  });
  it("uses center-chord placement, independent offsets, scale and reverse at every orientation", () => {
    for (const angle of [0, 37, 90, 180, 270, -720 + 37])
      for (const scalePercent of [17.375, 100, 213.25])
        for (const reverse of [false, true]) {
          const input = fill({
              angle,
              scalePercent,
              reverse,
              offsetPercent: { x: -12.375, y: 17.125 },
            }),
            f = input.frame,
            span = (gradientSpan(f, angle) * scalePercent) / 100,
            a = (angle * Math.PI) / 180,
            cx = f.x + f.width * (0.5 - 0.12375),
            cy = f.y + f.height * (0.5 + 0.17125);
          for (const fraction of [-2, -0.5, 0, 0.375, 0.5, 2]) {
            const point = [
                cx + Math.cos(a) * span * fraction,
                cy - Math.sin(a) * span * fraction,
              ],
              t = Math.max(0, Math.min(1, 0.5 + fraction));
            expect(
              gradientPosition(input, f, ...(point as [number, number])),
            ).toBeCloseTo(reverse ? 1 - t : t, 12);
          }
        }
  });
  it("maps radial, reflected, diamond and angle fields onto their natural anchors", () => {
    const frame = { x: 0, y: 0, width: 20, height: 12 },
      center = [10, 6];
    for (const style of ["radial", "reflected", "diamond"] as const) {
      const input = fill({ frame, style, angle: 0 });
      expect(
        gradientPosition(input, frame, ...(center as [number, number])),
      ).toBe(0);
      expect(gradientPosition(input, frame, 15, 6)).toBe(0.5);
      expect(gradientPosition(input, frame, 5, 6)).toBe(0.5);
    }
    expect(gradientPosition(fill({ style: "radial" }), frame, 13, 10)).toBe(
      0.5,
    );
    expect(gradientPosition(fill({ style: "diamond" }), frame, 12, 9)).toBe(
      0.5,
    );
    const angle = fill({ style: "angle", scalePercent: 13 });
    expect(gradientPosition(angle, frame, 15, 6)).toBe(0);
    expect(gradientPosition(angle, frame, 10, 11)).toBe(0.25);
    expect(gradientPosition(angle, frame, 5, 6)).toBe(0.5);
    expect(gradientPosition(angle, frame, 10, 1)).toBe(0.75);
    expect(gradientPosition(angle, frame, 10, 6)).toBe(0.25);
  });
  it("keeps global pixel centers and affine linked paint independent of raster tiles", () => {
    const input = fill({ interpolationSamples: 0 }),
      sample = gradientSampler(input, [1, 0, 0, 1, 0, 0]),
      moved = gradientSampler(input, [1, 0, 0, 1, 13, -7]);
    for (const [x, y] of [
      [0, 0],
      [9, 8],
      [-7, 3],
      [21, 11],
    ])
      expect(moved(x + 13, y - 7)).toEqual(sample(x, y));
    const out: [number, number, number, number] = [9, 9, 9, 9];
    expect(sample(4, 8, out)).toBe(out);
    const direct = gradientRamp(input)(
      gradientPosition(input, input.frame, 4.5, 8.5),
    );
    expect(out).toEqual(direct);
    input.align = false;
    expect(gradientSampler(input, [2, 0, 0, 3, 13, -7])(4, 8)).toEqual(
      gradientSampler(input, [1, 0, 0, 1, 0, 0])(4, 8),
    );
  });
  it("rejects unsupported or malformed definitions before painting and handles subnormal positive scales", () => {
    for (const change of [
      { dither: true },
      { interpolationMethod: "perceptual" },
      { scalePercent: 0 },
      { angle: Infinity },
      { offsetPercent: { x: 0, y: NaN } },
      { interpolationSamples: 4097 },
      { colorStops: [] },
      { colorStops: Array.from({ length: 257 }, () => fill().colorStops[0]) },
      { opacityStops: [{ location: 0, midpoint: 0.5, opacityPercent: 101 }] },
      {
        colorStops: [
          { location: 0, colorType: "Clry.FrgC", color: { r: 0, g: 0, b: 0 } },
        ],
      },
      { colorStops: [{ location: 0, color: { c: 0, m: 0, y: 0, k: 0 } }] },
    ]) {
      const input = fill(change as Partial<VectorGradient>);
      expect(
        supportedGradientDefinition(input as PsdSolidGradientFill),
      ).toBeFalsy();
      expect(() => validateVectorGradient(input)).toThrow(/gradient/);
    }
    for (const frame of [
      { x: 0, y: 0, width: 0, height: 1 },
      { x: Infinity, y: 0, width: 1, height: 1 },
    ])
      expect(() => validateVectorGradient(fill({ frame }))).toThrow(/frame/);
    const input = fill({
      scalePercent: Number.MIN_VALUE,
      frame: { x: 0, y: 0, width: 2, height: 2 },
    });
    expect(gradientPosition(input, input.frame, 1, 1)).toBe(0.5);
    expect(gradientPosition(input, input.frame, 2, 1)).toBe(1);
  });
  it("exports affine linear/reflected fields and similarity-mapped fields without baking paint", () => {
    const matrices = [
      [1, 0, 0, 1, 13, -7],
      [0, 2, -2, 0, 9, 3],
      [1.5, 0, 0, 0.625, -4, 7],
    ] as const;
    for (const style of [
      "linear",
      "reflected",
      "radial",
      "diamond",
      "angle",
    ] as const)
      for (const matrix of matrices) {
        const input = fill({
            style,
            angle: 37,
            scalePercent: 137.375,
            offsetPercent: { x: 12.375, y: -7.25 },
          }),
          targetFrame = { x: -31, y: -17, width: 83, height: 71 };
        if (!["linear", "reflected"].includes(style) && matrix[0] === 1.5) {
          expect(() =>
            exportGradientDefinition(input, [...matrix], targetFrame),
          ).toThrow(/nonuniform/);
          continue;
        }
        const exported = exportGradientDefinition(
            input,
            [...matrix],
            targetFrame,
          ),
          source = gradientSampler(input, [...matrix]),
          destination = gradientSampler(
            { ...exported, frame: targetFrame },
            [1, 0, 0, 1, 0, 0],
          );
        for (const [x, y] of [
          [0, 0],
          [7, 13],
          [29, -11],
          [-8, 3],
        ])
          source(x, y).forEach((v, c) =>
            expect(destination(x, y)[c]).toBeCloseTo(v, 12),
          );
      }
    const input = fill({ offsetPercent: { x: 12.375, y: -7.25 } }),
      targetFrame = {
        ...input.frame,
        x: input.frame.x + 13,
        y: input.frame.y - 7,
      },
      exported = exportGradientDefinition(
        input,
        [1, 0, 0, 1, 13, -7],
        targetFrame,
      );
    const { frame: _frame, ...original } = input;
    expect(exported).toEqual(original);
  });
});
