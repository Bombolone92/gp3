import { test, expect } from "@playwright/test";
import { boot } from "./helpers";
import { mkdir, writeFile } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  await boot(page, "default", "window.puter={};");
});

test("dash intervals, phase, units, zero gaps and affine paths match analytic pixel areas", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { ImageEngine } = await import("/src/engine/engine.ts");
    const engine = new ImageEngine();
    const viewport = { x: 0, y: 0, width: 52, height: 19 };
    const mask = {
      paths: [
        {
          open: true,
          operation: "combine",
          fillRule: "non-zero",
          knots: [
            [3.25, 10.375],
            [25.625, 10.375],
          ].map(([x, y]) => ({ linked: false, points: [x, y, x, y, x, y] })),
        },
      ],
    };
    const matrix = [2, 0, 0, 0.5, -3.5, 2.25];
    const x0 = 3,
      x1 = 47.75,
      y0 = 7.4375,
      width = 2.25;
    const errors = [];
    try {
      for (const intervals of [
        [4.5, 2.125, 3.25, 5],
        [3, 1.5, 2.5],
        [4, 0, 2, 3],
        [4, 3, 2, 0],
        [4, 0],
      ])
        for (const phase of [0, -3.25, 123.375, -1000000001.375]) {
          const style = {
            enabled: true,
            fillEnabled: false,
            lineWidth: { value: 1.125, units: "Points" },
            resolution: 144,
            lineDashSet: intervals.map((value) => ({ value, units: "Pixels" })),
            lineDashOffset: { value: phase / 2, units: "Points" },
            cap: "butt",
            join: "miter",
            alignment: "center",
            miterLimit: 4,
            opacity: 0.375,
            color: { rgb: [1, 0, 0], space: "document" },
          };
          const r = await engine.vectorStroke(
            mask as any,
            viewport,
            matrix as any,
            style as any,
          );
          const sequence =
            intervals.length % 2 ? [...intervals, ...intervals] : intervals;
          const period = sequence.reduce((s, v) => s + v, 0),
            p = ((phase % period) + period) % period;
          const boxes: number[][] = [];
          let x = x0 - p,
            i = 0;
          while (x < x1) {
            const length = sequence[i % sequence.length];
            if (i % 2 === 0 && x + length > x0)
              boxes.push([
                Math.max(x, x0),
                y0 - width / 2,
                Math.min(x + length, x1),
                y0 + width / 2,
              ]);
            x += length;
            i++;
          }
          let error = 0;
          for (let y = 0; y < viewport.height; y++)
            for (let x = 0; x < viewport.width; x++) {
              const area = boxes.reduce(
                (s, b) =>
                  s +
                  Math.max(0, Math.min(x + 1, b[2]) - Math.max(x, b[0])) *
                    Math.max(0, Math.min(y + 1, b[3]) - Math.max(y, b[1])),
                0,
              );
              error = Math.max(
                error,
                Math.abs(r.strokeCoverage[y * viewport.width + x] - area),
              );
            }
          errors.push({ intervals, phase, error });
          // Cropping the viewport must not restart the dash phase.
          const cropped = await engine.vectorStroke(
            mask as any,
            { x: 11, y: 4, width: 17, height: 10 },
            matrix as any,
            style as any,
          );
          for (let y = 0; y < 10; y++)
            for (let x = 0; x < 17; x++)
              error = Math.max(
                error,
                Math.abs(
                  cropped.strokeCoverage[y * 17 + x] -
                    r.strokeCoverage[(y + 4) * 52 + x + 11],
                ),
              );
          errors.at(-1)!.error = error;
        }
      const s = {
        enabled: true,
        fillEnabled: false,
        lineWidth: { value: 2.25, units: "Pixels" },
        resolution: 72,
        lineDashSet: [
          { value: 2, units: "None" },
          { value: 1, units: "None" },
        ],
        lineDashOffset: { value: 0, units: "None" },
        cap: "butt",
        join: "miter",
        alignment: "center",
        miterLimit: 4,
        opacity: 1,
        color: { rgb: [1, 0, 0], space: "document" },
      };
      const a = await engine.vectorStroke(
        mask as any,
        viewport,
        matrix as any,
        s as any,
      );
      const b = await engine.vectorStroke(
        mask as any,
        viewport,
        matrix as any,
        {
          ...s,
          lineDashSet: [
            { value: 4.5, units: "Pixels" },
            { value: 2.25, units: "Pixels" },
          ],
        } as any,
      );
      let relativeError = 0;
      a.strokeCoverage.forEach(
        (v, i) =>
          (relativeError = Math.max(
            relativeError,
            Math.abs(v - b.strokeCoverage[i]),
          )),
      );
      let budget = "";
      try {
        await engine.vectorStroke(
          mask as any,
          viewport,
          matrix as any,
          {
            ...s,
            lineDashSet: [
              { value: 1e-7, units: "Pixels" },
              { value: 1e-7, units: "Pixels" },
            ],
          } as any,
        );
      } catch (e) {
        budget = (e as Error).message;
      }
      return { errors, relativeError, budget };
    } finally {
      engine.dispose();
    }
  });
  for (const row of result.errors)
    expect(row.error, JSON.stringify(row)).toBeLessThan(1e-5);
  expect(result.relativeError).toBe(0);
  expect(result.budget).toContain("segment budget");
});

test("curved dashes and closed seam joins match independent high-resolution drawing", async ({
  page,
}) => {
  const rows = await page.evaluate(async () => {
    const { ImageEngine } = await import("/src/engine/engine.ts");
    const engine = new ImageEngine(),
      rows = [];
    const viewport = { x: 0, y: 0, width: 26, height: 23 };
    try {
      for (const closed of [false, true])
        for (const cap of ["butt", "round", "square"])
          for (const alignment of closed
            ? ["inside", "center", "outside"]
            : ["center"]) {
            const knots = closed
              ? [
                  [4.25, 4.375],
                  [21.125, 4.375],
                  [21.125, 18.25],
                  [4.25, 18.25],
                ].map(([x, y]) => ({
                  linked: false,
                  points: [x, y, x, y, x, y],
                }))
              : [
                  {
                    linked: false,
                    points: [3.375, 13.25, 3.375, 13.25, 5.5, -2.5],
                  },
                  {
                    linked: false,
                    points: [16.25, 1.5, 20.5, 10.375, 20.5, 10.375],
                  },
                  {
                    linked: false,
                    points: [14.5, 19.25, 14.5, 19.25, 14.5, 19.25],
                  },
                ];
            const style = {
              enabled: true,
              fillEnabled: false,
              lineWidth: { value: 1.75, units: "Pixels" },
              lineDashOffset: { value: -2.125, units: "Pixels" },
              lineDashSet: [3.25, 2.375, 1.5, 4].map((value) => ({
                value,
                units: "Pixels",
              })),
              resolution: 72,
              cap,
              join: "miter",
              alignment,
              miterLimit: 4,
              opacity: 1,
              color: { rgb: [1, 0, 0], space: "document" },
            };
            const r = await engine.vectorStroke(
              {
                paths: [
                  {
                    open: !closed,
                    operation: "combine",
                    fillRule: "non-zero",
                    knots,
                  },
                ],
              } as any,
              viewport,
              [1, 0, 0, 1, 0, 0],
              style as any,
            );
            const scale = 128,
              canvas = document.createElement("canvas");
            canvas.width = 26 * scale;
            canvas.height = 23 * scale;
            const c = canvas.getContext("2d", { willReadFrequently: true })!;
            c.scale(scale, scale);
            c.lineWidth = alignment === "center" ? 1.75 : 3.5;
            if (alignment !== "center") {
              const clip = new Path2D();
              if (alignment === "outside") clip.rect(0, 0, 26, 23);
              clip.rect(4.25, 4.375, 21.125 - 4.25, 18.25 - 4.375);
              c.clip(clip, "evenodd");
            }
            c.lineCap = (
              !closed && cap === "square" ? "butt" : cap
            ) as CanvasLineCap;
            c.lineJoin = "miter";
            c.miterLimit = 4;
            c.setLineDash([3.25, 2.375, 1.5, 4]);
            c.lineDashOffset = -2.125;
            c.beginPath();
            if (closed) {
              c.moveTo(4.25, 4.375);
              c.lineTo(21.125, 4.375);
              c.lineTo(21.125, 18.25);
              c.lineTo(4.25, 18.25);
              c.closePath();
            } else {
              c.moveTo(3.375, 13.25);
              c.bezierCurveTo(5.5, -2.5, 16.25, 1.5, 20.5, 10.375);
              c.lineTo(14.5, 19.25);
            }
            c.stroke();
            if (!closed && cap === "square") {
              // Independent arclength integration and analytic tangents avoid the
              // browser's square-cap mutation on a dash spanning curve and line.
              const point = (t: number) => {
                const u = 1 - t;
                return [
                  u * u * u * 3.375 +
                    3 * u * u * t * 5.5 +
                    3 * u * t * t * 16.25 +
                    t * t * t * 20.5,
                  u * u * u * 13.25 +
                    3 * u * u * t * -2.5 +
                    3 * u * t * t * 1.5 +
                    t * t * t * 10.375,
                ];
              };
              const count = 65536,
                lengths = new Float64Array(count + 1);
              let prev = point(0);
              for (let i = 1; i <= count; i++) {
                const p = point(i / count);
                lengths[i] =
                  lengths[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]);
                prev = p;
              }
              const curved = lengths[count],
                line = Math.hypot(14.5 - 20.5, 19.25 - 10.375),
                total = curved + line;
              const sample = (distance: number) => {
                if (distance >= curved) {
                  const f = (distance - curved) / line;
                  return [
                    20.5 + f * (14.5 - 20.5),
                    10.375 + f * (19.25 - 10.375),
                    14.5 - 20.5,
                    19.25 - 10.375,
                  ];
                }
                let lo = 0,
                  hi = count;
                while (lo + 1 < hi) {
                  const mid = (lo + hi) >> 1;
                  if (lengths[mid] < distance) lo = mid;
                  else hi = mid;
                }
                const t =
                    (lo +
                      (distance - lengths[lo]) / (lengths[hi] - lengths[lo])) /
                    count,
                  u = 1 - t,
                  p = point(t);
                return [
                  ...p,
                  3 *
                    (u * u * (5.5 - 3.375) +
                      2 * u * t * (16.25 - 5.5) +
                      t * t * (20.5 - 16.25)),
                  3 *
                    (u * u * (-2.5 - 13.25) +
                      2 * u * t * (1.5 + 2.5) +
                      t * t * (10.375 - 1.5)),
                ];
              };
              const capRect = (distance: number, sign: number) => {
                const [x, y, vx, vy] = sample(distance),
                  f = (sign * 0.875) / Math.hypot(vx, vy),
                  dx = vx * f,
                  dy = vy * f;
                c.beginPath();
                c.moveTo(x - dy, y + dx);
                c.lineTo(x + dy, y - dx);
                c.lineTo(x + dy + dx, y - dx + dy);
                c.lineTo(x - dy + dx, y + dx + dy);
                c.closePath();
                c.fill();
              };
              const pattern = [3.25, 2.375, 1.5, 4],
                period = pattern.reduce((s, v) => s + v, 0);
              let distance = -(((-2.125 % period) + period) % period),
                i = 0;
              while (distance < total) {
                const next = distance + pattern[i % 4];
                if (i % 2 === 0 && next > 0) {
                  capRect(Math.max(0, distance), -1);
                  capRect(Math.min(total, next), 1);
                }
                distance = next;
                i++;
              }
            }
            const pixels = c.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data;
            let error = 0,
              worst = { x: 0, y: 0, actual: 0, reference: 0 };
            for (let y = 0; y < 23; y++)
              for (let x = 0; x < 26; x++) {
                let sum = 0;
                for (let dy = 0; dy < scale; dy++)
                  for (let dx = 0; dx < scale; dx++)
                    sum +=
                      pixels[
                        ((y * scale + dy) * canvas.width + x * scale + dx) * 4 +
                          3
                      ];
                const reference = sum / (255 * scale * scale),
                  actual = r.strokeCoverage[y * 26 + x],
                  delta = Math.abs(actual - reference);
                if (delta > error) {
                  error = delta;
                  worst = { x, y, actual, reference };
                }
              }
            rows.push({ closed, cap, alignment, error, worst });
          }
      return rows;
    } finally {
      engine.dispose();
    }
  });
  for (const row of rows)
    expect(row.error, JSON.stringify(rows)).toBeLessThan(0.012);
});

for (const backend of ["default", "WebGL"])
  test(`dash editing, picking, cache reuse and native/PSD round trips (${backend})`, async ({
    page,
  }) => {
    if (backend === "WebGL") {
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "gpu", { value: undefined }),
      );
      await page.reload();
      await expect(page.locator("#engine-status")).toHaveText("WebGL2");
    }
    const rows = await page.evaluate(async () => {
      const { newDocument, layer } = await import("/src/model/document.ts");
      const { Assets } = await import("/src/model/assets.ts");
      const { serialize, deserialize } =
        await import("/src/model/serialization.ts");
      const { savePsd, openPsd } = await import("/src/model/psd.ts");
      const { readPsd } = await import("/tests/browser/psd-codec.ts");
      const { History } = await import("/src/history/history.ts");
      const { ImageEngine } = await import("/src/engine/engine.ts");
      const { Renderer } = await import("/src/renderer/renderer.ts");
      const engine = new ImageEngine(),
        renderer = await Renderer.create(
          document.createElement("canvas"),
          engine,
        ),
        rows = [];
      let calls = 0;
      const geometry = engine.vectorStroke.bind(engine);
      engine.vectorStroke = (...args) => {
        calls++;
        return geometry(...args);
      };
      try {
        for (const depth of [8, 16, 32] as const) {
          const doc = newDocument(49, 27),
            assets = new Assets(),
            l = layer("vector", "Dash path", 49, 27);
          doc.bitsPerChannel = depth;
          l.vector = {
            reference: { x: 3.25, y: 10.375, width: 40, height: 1 },
            fill: { rgb: [0.2, 0.5, 0.7], space: "document" },
            mask: {
              paths: [
                {
                  open: true,
                  operation: "combine",
                  fillRule: "non-zero",
                  knots: [
                    [3.25, 10.375],
                    [43.25, 10.375],
                  ].map(([x, y]) => ({
                    linked: false,
                    points: [x, y, x, y, x, y],
                  })),
                },
              ],
            },
            stroke: {
              enabled: true,
              fillEnabled: false,
              lineWidth: { value: 1.125, units: "Points" },
              lineDashOffset: { value: -0.625, units: "None" },
              lineDashSet: [
                { value: 2, units: "None" },
                { value: 1.125, units: "Points" },
                { value: 3.25, units: "Pixels" },
              ],
              resolution: 144,
              cap: "butt",
              join: "miter",
              alignment: "center",
              miterLimit: 4,
              opacity: 0.375,
              color: {
                rgb: depth === 32 ? [3, -0.2, 0.6] : [0.8, 0.2, 0.6],
                space: "document",
              },
            },
          };
          l.transform = {
            x: 3.25,
            y: 10.375,
            width: 40,
            height: 1,
            rotation: 0,
          };
          doc.layers = [l];
          let native: any, reopened: any;
          try {
            await renderer.render(doc, assets);
            const initialCalls = calls;
            const painted = await renderer.pickCoverage(
                doc,
                assets,
                l,
                [],
                5,
                10,
              ),
              gap = await renderer.pickCoverage(doc, assets, l, [], 9.5, 10);
            l.vector.stroke!.opacity = 0.123456789;
            await renderer.render(doc, assets);
            const reuse = calls === initialCalls;
            const history = new History(doc),
              old = JSON.stringify(l.vector.stroke);
            history.execute("Dash phase", (d) => {
              d.layers[0].vector!.stroke!.lineDashOffset.value = -1.125;
            });
            history.undo();
            const undo =
              JSON.stringify(history.document.layers[0].vector!.stroke) === old;
            // A phase edit changes geometry and therefore invalidates its cache.
            l.vector.stroke!.lineDashOffset.value = -1.125;
            await renderer.render(doc, assets);
            const phaseReraster = calls === initialCalls + 1;
            l.transform = {
              x: -2.375,
              y: 4.25,
              width: 46.75,
              height: 3.125,
              rotation: 12.5,
            };
            await renderer.render(doc, assets);
            const transformReraster = calls === initialCalls + 2;
            const pixels = await renderer.rawPixels();
            native = await deserialize(await serialize(doc, assets));
            await renderer.render(native.document, native.assets);
            const nativePixels = await renderer.rawPixels();
            const output = await savePsd(native.document, async (d) => {
              await renderer.render(d, native.assets);
              return renderer.rawPixels();
            });
            reopened = await openPsd(output, "Dashes.psd", engine);
            await renderer.render(reopened.document, reopened.assets);
            const after = await renderer.rawPixels();
            const difference = (a: ArrayLike<number>, b: ArrayLike<number>) =>
              Array.from(a).reduce(
                (m, v, i) => Math.max(m, Math.abs(v - b[i])),
                0,
              );
            const descriptor = readPsd(await output.arrayBuffer(), {
              skipLayerImageData: true,
              skipCompositeImageData: true,
            }).children![0].vectorStroke;
            rows.push({
              depth,
              notice: reopened.notice,
              kind: reopened.document.layers[0].kind,
              painted,
              gap,
              reuse,
              undo,
              phaseReraster,
              transformReraster,
              nativeDifference: difference(pixels, nativePixels),
              exportDifference: difference(pixels, after),
              nativeStroke:
                JSON.stringify(native.document.layers[0].vector.stroke) ===
                JSON.stringify(l.vector.stroke),
              descriptor,
              bytes: Array.from(new Uint8Array(await output.arrayBuffer())),
            });
          } finally {
            assets.clear();
            native?.assets.clear();
            reopened?.assets.clear();
          }
        }
        return rows;
      } finally {
        renderer.dispose();
        engine.dispose();
      }
    });
    await mkdir("/tmp/photo-editor-dash-roundtrips", { recursive: true });
    for (const r of rows) {
      expect(r.notice).toBe("");
      expect(r.kind).toBe("vector");
      expect(r.painted).toBeCloseTo(
        r.depth === 8 ? Math.round(0.375 * 255) / 255 : 0.375,
        6,
      );
      expect(r.gap).toBe(0);
      expect(
        r.reuse &&
          r.undo &&
          r.phaseReraster &&
          r.transformReraster &&
          r.nativeStroke,
      ).toBe(true);
      expect(r.nativeDifference).toBe(0);
      expect(r.exportDifference).toBeLessThanOrEqual(r.depth === 8 ? 1 : 1e-4);
      expect(r.descriptor!.lineDashSet).toEqual([
        { value: 2, units: "None" },
        { value: 1.125, units: "Points" },
        { value: 3.25, units: "Pixels" },
      ]);
      expect(r.descriptor!.lineDashOffset).toEqual({
        value: -1.125,
        units: "None",
      });
      expect(r.descriptor!.opacity).toBeCloseTo(0.123456789, 12);
      await writeFile(
        `/tmp/photo-editor-dash-roundtrips/${backend}-${r.depth}.psd`,
        Buffer.from(r.bytes),
      );
    }
  });
