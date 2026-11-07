import { describe, expect, it } from "vitest";
import { gradientPowerTransfer } from "../lib/pptx-preview/src/gradient-power.ts";

const stop = (offset, color, opacity) => ({ offset, color, opacity });
const a = stop(0, "#204080", 0.25);
const b = stop(1, "#C09030", 0.75);

describe("two-stop gradient power interpolation", () => {
  it("preserves straight RGB, linear alpha and mixed channel directions", () => {
    const stops = Object.freeze([
      Object.freeze({ ...a }),
      Object.freeze({ ...b }),
    ]);
    const power = gradientPowerTransfer(stops);
    expect(power.exponent).toBe(1.875);
    const first = [32, 64, 128],
      last = [192, 144, 48];
    for (const t of [0, 0.13, 0.5, 0.89, 1]) {
      const progress = power.channels.map(
        (_, i) => power.matrix[i * 5 + 3] * t + power.matrix[i * 5 + 4],
      );
      const alpha = power.matrix[18] * t + power.matrix[19];
      expect(alpha).toBeCloseTo(0.25 + 0.5 * t, 12);
      for (let i = 0; i < 3; i++) {
        const expected =
          first[i] +
          (last[i] - first[i]) *
            (last[i] > first[i] ? 1 - (1 - t) ** 1.875 : t ** 1.875);
        expect(
          255 *
            (power.channels[i].amplitude * progress[i] ** power.exponent +
              power.channels[i].offset),
        ).toBeCloseTo(expected, 10);
      }
    }
    expect(stops).toEqual([a, b]);
  });
  it("retains the hue of a fully transparent endpoint", () => {
    expect(gradientPowerTransfer([{ ...a, opacity: 0 }, b])).toMatchObject({
      channels: [
        { offset: 192 / 255 },
        { offset: 144 / 255 },
        { offset: 128 / 255 },
      ],
    });
  });
  it.each([0.01, 0.37, 0.5, 0.93, 0.99999])(
    "supports matching outer RGBA at middle position %s",
    (offset) => {
      expect(
        gradientPowerTransfer([a, { ...b, offset }, { ...a, offset: 1 }]),
      ).toEqual(gradientPowerTransfer([a, b]));
    },
  );
  it("compares resolved colors case-insensitively and omitted opacity as one", () => {
    expect(
      gradientPowerTransfer([
        stop(0, "#abcdef"),
        stop(0.3, "#123456", 0.2),
        stop(1, "#ABCDEF", 1),
      ]),
    ).not.toBeNull();
  });
  it.each([
    [],
    [a],
    [{ ...a, offset: 0.01 }, b],
    [a, { ...b, offset: 0.99 }],
    [a, { ...b, offset: 0 }, { ...a, offset: 1 }],
    [a, b, { ...a, offset: 1 }],
    [a, { ...b, offset: 0.37 }, { ...a, offset: 1, opacity: 0.6 }],
    [a, { ...b, offset: 0.37 }, stop(1, "#00FF00", 0.25)],
    [a, { ...b, offset: 0.37 }, { ...b, offset: 0.7 }, { ...a, offset: 1 }],
    [{ ...a, color: "#bad" }, b],
    [{ ...a, opacity: NaN }, b],
    [{ ...a, opacity: -0.1 }, b],
    [{ ...a, opacity: 1.1 }, b],
  ])(
    "leaves ordinary or invalid stop configurations unchanged: %j",
    (...stops) => {
      expect(gradientPowerTransfer(stops)).toBeNull();
    },
  );
  it("avoids filters for constant RGB or fully transparent fills", () => {
    expect(gradientPowerTransfer([a, { ...b, color: a.color }])).toBeNull();
    expect(
      gradientPowerTransfer([
        { ...a, opacity: 0 },
        { ...b, opacity: 0 },
      ]),
    ).toBeNull();
  });
});
