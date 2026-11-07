import { describe, expect, it } from "vitest";
import type { Texture } from "../src/renderer/backend";
import { needsRgbaResampling } from "../src/renderer/sampling";

const texture = (width: number, height: number): Texture => ({
  width,
  height,
  format: "rgba8unorm",
  handle: {} as Texture["handle"],
});
function parameters() {
  const u = new Float32Array(48);
  u.set([7, 5, 0, 0, -2, 3, 3, 2, 1, 0, 1, 0]);
  return u;
}
const back = texture(7, 5),
  source = texture(3, 2);
describe("RGBA sampling pipeline selection", () => {
  it("keeps native grids and integer blur taps on the copy pipeline", () => {
    const u = parameters();
    for (const [x, y, blur] of [
      [0, 0, 0],
      [-17, 9, 3],
      [12, -4, 1],
    ]) {
      u[4] = x;
      u[5] = y;
      u[15] = blur;
      expect(needsRgbaResampling(u, back, source, 7, 5)).toBe(false);
    }
    for (const [at, value] of [
      [4, 0.25],
      [5, -0.125],
      [6, 3.5],
      [7, 4],
      [8, 0],
      [9, 1],
      [15, 0.5],
    ]) {
      const changed = parameters();
      changed[at] = value;
      expect(needsRgbaResampling(changed, back, source, 7, 5)).toBe(true);
    }
    expect(needsRgbaResampling(parameters(), back, source, 14, 10)).toBe(true);
    expect(
      needsRgbaResampling(parameters(), texture(14, 10), source, 7, 5),
    ).toBe(true);
  });
  it("recognizes exact viewport projections, but resamples fractional or scaled picks", () => {
    const u = parameters();
    u.set([-3, 2, 1, 1], 32);
    expect(needsRgbaResampling(u, texture(1, 1), source, 1, 1)).toBe(false);
    for (const [at, value] of [
      [32, -3.25],
      [33, 2.5],
      [34, 2],
      [35, 3],
    ]) {
      const changed = u.slice();
      changed[at] = value;
      expect(needsRgbaResampling(changed, texture(1, 1), source, 1, 1)).toBe(
        true,
      );
    }
  });
  it("avoids color filtering for constants and scalar vector coverage, while checking the backdrop", () => {
    const u = parameters();
    u[4] = 1.25;
    u[8] = 0.75;
    u[9] = 0.25;
    expect(needsRgbaResampling(u, back, texture(1, 1), 7, 5)).toBe(false);
    u[29] = 1;
    expect(needsRgbaResampling(u, back, source, 7, 5)).toBe(false);
    expect(needsRgbaResampling(u, texture(14, 10), source, 7, 5)).toBe(true);
  });
  it("bases copy passes on actual source and destination sizes, including short uniform buffers", () => {
    const u = new Float32Array(32);
    u[31] = 1;
    expect(needsRgbaResampling(u, back, source, 3, 2)).toBe(false);
    expect(needsRgbaResampling(u, back, source, 2, 2)).toBe(true);
    expect(needsRgbaResampling(u, back, source, 3, 4)).toBe(true);
  });
});
