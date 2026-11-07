import { test, expect } from "@playwright/test";
import { boot } from "./helpers";

test.beforeEach(async ({ page }) => {
  await boot(page, "default", "window.puter={};");
});

test("compound operations resolve geometry before antialiasing, including identical cubic edges", async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const { ImageEngine } = await import("/src/engine/engine.ts");
    const engine = new ImageEngine();
    const path = {
      open: false,
      operation: "combine" as const,
      fillRule: "even-odd" as const,
      knots: [
        { linked: false, points: [2.125, 7.5, 2.125, 4.25, 5.5, -3] },
        { linked: false, points: [14.75, -3, 18.625, 4.25, 18.625, 10.75] },
        { linked: false, points: [14, 19, 8.375, 16.5, 2.125, 7.5] },
      ],
    };
    const viewport = { x: 0, y: 0, width: 23, height: 21 };
    try {
      const single = await engine.vectorMask({ paths: [path] }, viewport);
      const results = [];
      for (const operation of [
        "combine",
        "subtract",
        "intersect",
        "exclude",
      ] as const) {
        const mask = { paths: [path, { ...path, operation }] };
        const before = JSON.stringify(mask);
        const raster = await engine.vectorMask(mask, viewport);
        results.push({
          operation,
          data: Array.from(raster.coverage),
          sourceUnchanged: before === JSON.stringify(mask),
        });
      }
      const canvas = document.createElement("canvas");
      const scale = 64;
      canvas.width = viewport.width * scale;
      canvas.height = viewport.height * scale;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.scale(scale, scale);
      // Independent explicit cubics detect swapped incoming/outgoing handles,
      // missing closing segments, and accidental polygonal interpretation.
      context.beginPath();
      context.moveTo(2.125, 4.25);
      context.bezierCurveTo(5.5, -3, 14.75, -3, 18.625, 4.25);
      context.bezierCurveTo(18.625, 10.75, 14, 19, 8.375, 16.5);
      context.bezierCurveTo(2.125, 7.5, 2.125, 7.5, 2.125, 4.25);
      context.closePath();
      context.fill();
      // Integrate an independent high-resolution cubic drawing. Native-size
      // Canvas AA depends on segment splitting and is not a pixel-area oracle.
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const reference = [];
      for (let y = 0; y < viewport.height; y++)
        for (let x = 0; x < viewport.width; x++) {
          let sum = 0;
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++)
              sum +=
                data[
                  ((y * scale + dy) * canvas.width + x * scale + dx) * 4 + 3
                ];
          reference.push(Math.round(sum / (scale * scale)));
        }
      return { single: Array.from(single.coverage), reference, results };
    } finally {
      engine.dispose();
    }
  });
  expect(results.single.some((a) => a > 0 && a < 255)).toBe(true);
  expect(results.single.some((a) => a === 255)).toBe(true);
  for (let i = 0; i < results.reference.length; i++)
    expect(
      Math.abs(results.single[i] - results.reference[i]),
    ).toBeLessThanOrEqual(2);
  for (const result of results.results) {
    expect(result.sourceUnchanged).toBe(true);
    if (result.operation === "exclude" || result.operation === "subtract")
      expect(
        result.data.every((a) => a === 0),
        result.operation,
      ).toBe(true);
    else expect(result.data, result.operation).toEqual(results.single);
  }
});

test("merged contours implement holes, winding rules, open fills and sequential operations", async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const { ImageEngine } = await import("/src/engine/engine.ts");
    const engine = new ImageEngine();
    type Contour = import("../../src/model/vector").VectorMask["paths"][number];
    const rectangle = (
      x: number,
      y: number,
      width: number,
      height: number,
      operation?: Contour["operation"],
      fillRule: Contour["fillRule"] = "even-odd",
    ): Contour => ({
      open: false,
      operation,
      fillRule,
      knots: [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
      ].map(([a, b]) => ({ linked: false, points: [a, b, a, b, a, b] })),
    });
    const viewport = { x: 0, y: 0, width: 20, height: 17 };
    try {
      const cases: { name: string; paths: Contour[] }[] = [
        {
          name: "merged hole",
          paths: [rectangle(2, 2, 14, 12, "combine"), rectangle(5, 5, 6, 6)],
        },
        {
          name: "merged first unspecified",
          paths: [rectangle(2, 2, 14, 12), rectangle(5, 5, 6, 6)],
        },
        {
          name: "non-zero same winding",
          paths: [
            rectangle(2, 2, 14, 12, "combine", "non-zero"),
            rectangle(5, 5, 6, 6, undefined, "non-zero"),
          ],
        },
        {
          name: "independent union",
          paths: [
            rectangle(2, 2, 14, 12, "combine"),
            rectangle(5, 5, 6, 6, "combine"),
          ],
        },
        {
          name: "subtraction",
          paths: [
            rectangle(2, 2, 14, 12, "combine"),
            rectangle(5, 5, 6, 6, "subtract"),
          ],
        },
        {
          name: "intersection",
          paths: [
            rectangle(2, 2, 14, 12, "combine"),
            rectangle(5, 5, 6, 6, "intersect"),
          ],
        },
        {
          name: "exclusion",
          paths: [
            rectangle(2, 2, 14, 12, "combine"),
            rectangle(5, 5, 6, 6, "exclude"),
          ],
        },
        {
          name: "open filled rectangle",
          paths: [{ ...rectangle(2, 2, 14, 12, "combine"), open: true }],
        },
        { name: "first subtract", paths: [rectangle(5, 5, 6, 6, "subtract")] },
        {
          name: "first intersect",
          paths: [rectangle(5, 5, 6, 6, "intersect")],
        },
        {
          name: "non-zero opposite winding",
          paths: [
            rectangle(2, 2, 14, 12, "combine", "non-zero"),
            {
              ...rectangle(5, 5, 6, 6, undefined, "non-zero"),
              knots: rectangle(5, 5, 6, 6).knots.reverse(),
            },
          ],
        },
      ];
      const results = [];
      for (const item of cases) {
        const raster = await engine.vectorMask({ paths: item.paths }, viewport);
        results.push({ name: item.name, data: Array.from(raster.coverage) });
      }
      return results;
    } finally {
      engine.dispose();
    }
  });
  for (const result of results) {
    for (let y = 0; y < 17; y++)
      for (let x = 0; x < 20; x++) {
        const outer = x >= 2 && x < 16 && y >= 2 && y < 14;
        const inner = x >= 5 && x < 11 && y >= 5 && y < 11;
        const expected =
          result.name === "first subtract"
            ? !inner
            : ["intersection", "first intersect"].includes(result.name)
              ? inner
              : [
                    "non-zero same winding",
                    "independent union",
                    "open filled rectangle",
                  ].includes(result.name)
                ? outer
                : outer && !inner;
        expect(result.data[y * 20 + x], `${result.name} (${x},${y})`).toBe(
          expected ? 255 : 0,
        );
      }
  }
});

test("vector coverage honors mask flags, fractional origins, negative coordinates and affine transforms", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { ImageEngine } = await import("/src/engine/engine.ts");
    const engine = new ImageEngine();
    const path = {
      open: false,
      operation: "combine" as const,
      fillRule: "even-odd" as const,
      knots: [
        [-2.25, -1.5],
        [7.5, -1.5],
        [7.5, 6.25],
        [-2.25, 6.25],
      ].map(([x, y]) => ({ linked: false, points: [x, y, x, y, x, y] })),
    };
    const viewport = { x: -6.375, y: 3.25, width: 29, height: 19 };
    const matrix: [number, number, number, number, number, number] = [
      1.3, 0.35, -0.6, 1.75, 2.25, 6.5,
    ];
    try {
      const masks = [
        { paths: [path] },
        { paths: [path], invert: true },
        { paths: [path], invert: true, disable: true },
        { paths: [], fillStartsWithAllPixels: true },
        { paths: [] },
        { paths: [], invert: true },
        { paths: [path], fillStartsWithAllPixels: true },
      ];
      const rasters = [];
      for (const mask of masks)
        rasters.push(await engine.vectorMask(mask, viewport, matrix));
      // Independent browser path construction uses Canvas's affine transform,
      // avoiding the renderer's coordinate mapping and operation implementation.
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      // Match CPU scan conversion; GPU Canvas uses a different edge sampling
      // algorithm, so it is not an independent coordinate-error oracle here.
      const c = canvas.getContext("2d", { willReadFrequently: true })!;
      c.setTransform(
        matrix[0],
        matrix[1],
        matrix[2],
        matrix[3],
        matrix[4] - viewport.x,
        matrix[5] - viewport.y,
      );
      c.fillStyle = "#fff";
      c.beginPath();
      c.moveTo(-2.25, -1.5);
      c.lineTo(7.5, -1.5);
      c.lineTo(7.5, 6.25);
      c.lineTo(-2.25, 6.25);
      c.closePath();
      c.resetTransform();
      const geometry = new Path2D(rasters[0].path);
      const mismatches = [];
      // Compare the actual transformed outlines independently of the Canvas
      // scan converter's edge rounding, which depends on contour segmentation.
      // A boolean operation may reorder/split equivalent line segments without
      // changing the shape. Point containment tests the coordinate semantics.
      for (let y = 0; y < viewport.height; y++)
        for (let x = 0; x < viewport.width; x++)
          for (const fraction of [0.25, 0.5, 0.75])
            if (
              c.isPointInPath(x + fraction, y + fraction) !==
              c.isPointInPath(
                geometry,
                x + fraction,
                y + fraction,
                rasters[0].fillRule,
              )
            )
              mismatches.push([x, y, fraction]);
      return {
        rasters: rasters.map((r) => Array.from(r.coverage)),
        mismatches,
        geometry: rasters[0].path,
      };
    } finally {
      engine.dispose();
    }
  });
  expect(result.geometry).not.toBe("");
  expect(result.mismatches).toEqual([]);
  for (let i = 0; i < result.rasters[0].length; i++) {
    expect(result.rasters[1][i] + result.rasters[0][i]).toBe(255);
  }
  for (const index of [2, 3, 5, 6])
    expect(result.rasters[index].every((a) => a === 255)).toBe(true);
  expect(result.rasters[4].every((a) => a === 0)).toBe(true);
});

test("invalid vector requests reject cleanly and a worker remains usable", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { ImageEngine } = await import("/src/engine/engine.ts");
    const engine = new ImageEngine();
    const errors = [];
    try {
      for (const [mask, viewport, matrix] of [
        [{ paths: null }, { x: 0, y: 0, width: 2, height: 2 }, undefined],
        [{ paths: [] }, { x: 0, y: 0, width: 8192, height: 8192 }, undefined],
        [
          { paths: [] },
          { x: 0, y: 0, width: 2, height: 2 },
          [1, 0, 0, NaN, 0, 0],
        ],
      ] as const) {
        try {
          await engine.vectorMask(mask as any, viewport, matrix as any);
        } catch (error) {
          errors.push(String(error));
        }
      }
      const valid = await engine.vectorMask(
        { paths: [], fillStartsWithAllPixels: true },
        { x: 0, y: 0, width: 3, height: 2 },
      );
      const ready = await engine.ready();
      return { errors, ready, data: Array.from(valid.coverage) };
    } finally {
      engine.dispose();
    }
  });
  expect(result.errors).toHaveLength(3);
  expect(result.ready).toBe(true);
  expect(result.data).toEqual([255, 255, 255, 255, 255, 255]);
});
