import { it, expect } from "vitest";
import { selectionHandleLayout } from "../src/selection-handles.js";

const sizes = [
  [0, 0],
  [0, 7],
  [9, 0],
  [5, 5],
  [37.5, 72.5],
  [72.5, 37.5],
  [31, 240],
  [240, 31],
  [180, 140],
];
const cases = [12, 18, 44, 64].flatMap((target) =>
  sizes.map(([w, h]) => [w, h, target]),
);
it.each(cases)(
  "%s × %s rectangular selections retain a free center and distinct %s-pixel targets",
  (w, h, target) => {
    const interior = 12,
      layout = selectionHandleLayout(w, h, target, interior);
    const x = w / 2 + layout.offsetX,
      y = h / 2 + layout.offsetY;
    const centers = [
      [-x, -y],
      [x, -y],
      [x, y],
      [-x, y],
    ];
    if (layout.topBottom) centers.push([0, -y], [0, y]);
    if (layout.leftRight) centers.push([-x, 0], [x, 0]);
    for (let i = 0; i < centers.length; i++) {
      // A full interior square is free from every control target.
      expect(Math.max(...centers[i].map(Math.abs))).toBeGreaterThanOrEqual(
        (target + interior) / 2,
      );
      for (let j = 0; j < i; j++)
        expect(
          Math.max(
            Math.abs(centers[i][0] - centers[j][0]),
            Math.abs(centers[i][1] - centers[j][1]),
          ),
        ).toBeGreaterThanOrEqual(target);
    }
  },
);
it.each(cases)(
  "%s × %s connector endpoints retain their direction and a free center with %s-pixel targets",
  (w, h, target) => {
    const interior = 12,
      layout = selectionHandleLayout(w, h, target, interior, true);
    const x = w / 2 + layout.offsetX,
      y = h / 2 + layout.offsetY;
    expect(layout.topBottom || layout.leftRight).toBe(false);
    expect(Math.max(x, y)).toBeGreaterThanOrEqual(
      (target + interior) / 2 - 1e-12,
    );
    expect(x * h - y * w).toBeCloseTo(0, 10);
    if (w > 0 || h > 0) {
      expect(w === 0 ? x : y / x).toBeCloseTo(w === 0 ? 0 : h / w, 10);
    }
  },
);
it("leaves ordinary selection corners on their exact object bounds", () => {
  expect(selectionHandleLayout(240, 180, 44, 12)).toEqual({
    offsetX: 0,
    offsetY: 0,
    topBottom: true,
    leftRight: true,
  });
});
