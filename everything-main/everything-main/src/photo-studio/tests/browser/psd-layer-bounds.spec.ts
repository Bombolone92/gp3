import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

for (const backend of ["default", "WebGL"]) {
  test(`cacheless fill rectangles survive native PSD/PSB encoding (${backend})`, async ({
    page,
  }) => {
    if (backend === "WebGL")
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "gpu", { value: undefined }),
      );
    await page.route("https://js.puter.com/**", (r) =>
      r.fulfill({
        contentType: "application/javascript",
        body: "window.puter={};",
      }),
    );
    await page.goto("/");
    await expect(page.locator("#engine-status")).toHaveText(/WebGPU|WebGL2/);
    const result = await page.evaluate(async () => {
      const { writePsdWithPreciseStrokes } =
        await import("/src/model/psd-stroke-writer.ts");
      const { writeHighDepthPsd } =
        await import("/src/model/psd-high-depth.ts");
      const { readPsdWithPatternResources } =
        await import("/src/model/psd-patterns.ts");
      const checks = [],
        outputs = [];
      for (const depth of [8, 16, 32])
        for (const psb of [false, true])
          for (const extent of [0, 1]) {
            const width = 37 + extent * 20,
              height = 29 + extent * 12;
            const leaf = {
              name: "Aligned gradient",
              left: -7 + extent * 5,
              top: 4 + extent * 3,
              right: 13 + extent * 15,
              bottom: 19 + extent * 10,
              vectorFill: {
                type: "solid",
                name: "Independent Classic",
                style: "linear",
                angle: 37,
                align: true,
                dither: false,
                interpolationSamples: 137.375,
                scalePercent: 137.12345678901235,
                offsetPercent: { x: -12.345678901234567, y: 3.987654321012345 },
                colorStops: [
                  {
                    location: 0,
                    midpoint: 0.5,
                    color: { r: 23.125, g: 71.25, b: 163.5 },
                    colorType: "Clry.UsrS",
                  },
                  {
                    location: 1,
                    midpoint: 0.5,
                    color: { r: 241.5, g: 31.25, b: 43.125 },
                    colorType: "Clry.UsrS",
                  },
                ],
                opacityStops: [
                  { location: 0, midpoint: 0.5, opacityPercent: 100 },
                  { location: 1, midpoint: 0.5, opacityPercent: 100 },
                ],
              },
              vectorMask: { paths: [], fillStartsWithAllPixels: true },
              mask: {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
                defaultColor: 255,
                userMaskDensity: 192 / 255,
                disabled: false,
              },
            };
            const psd = {
              width,
              height,
              bitsPerChannel: depth,
              imageData: {
                width,
                height,
                data:
                  depth === 8
                    ? new Uint8ClampedArray(width * height * 4)
                    : depth === 16
                      ? new Uint16Array(width * height * 4)
                      : new Float32Array(width * height * 4),
              },
              children: [
                {
                  name: "Bounds group",
                  left: -13,
                  top: -17,
                  right: 31,
                  bottom: 43,
                  children: [leaf],
                },
              ],
            };
            const buffer =
              depth === 8
                ? writePsdWithPreciseStrokes(psd, { psb, noBackground: true })
                : writeHighDepthPsd(psd, psb);
            const decoded = readPsdWithPatternResources(
              new Uint8Array(buffer),
              {
                useRawData: true,
                skipCompositeImageData: true,
                skipLayerImageData: true,
              },
            );
            const group = decoded.children[0],
              l = group.children[0];
            checks.push({
              depth,
              psb,
              extent,
              group: [group.left, group.top, group.right, group.bottom],
              bounds: [l.left, l.top, l.right, l.bottom],
              expected: [leaf.left, leaf.top, leaf.right, leaf.bottom],
              fill: l.vectorFill,
              sourceFill: leaf.vectorFill,
              density: l.mask.userMaskDensity,
              noCache: !l.imageData,
            });
            outputs.push({
              name: `${depth}-${psb ? "psb" : "psd"}-${extent}.${psb ? "psb" : "psd"}`,
              bytes: Array.from(new Uint8Array(buffer)),
            });
          }
      return { checks, outputs };
    });
    for (const c of result.checks) {
      expect(c.group).toEqual([-13, -17, 31, 43]);
      expect(c.bounds).toEqual(c.expected);
      expect(c.fill).toEqual(c.sourceFill);
      expect(c.density).toBe(192 / 255);
      expect(c.noCache).toBe(true);
    }
    const directory = `/tmp/photo-editor-cacheless-bounds-exports/${backend}`;
    await mkdir(directory, { recursive: true });
    for (const file of result.outputs)
      await writeFile(`${directory}/${file.name}`, new Uint8Array(file.bytes));
  });
}

for (const backend of ["default", "WebGL"]) {
  test(`production import, native persistence and edited vector exports retain cacheless bounds (${backend})`, async ({
    page,
  }) => {
    if (backend === "WebGL")
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "gpu", { value: undefined }),
      );
    await page.route("https://js.puter.com/**", (r) =>
      r.fulfill({
        contentType: "application/javascript",
        body: "window.puter={};",
      }),
    );
    await page.goto("/");
    await expect(page.locator("#engine-status")).toHaveText(/WebGPU|WebGL2/);
    const result = await page.evaluate(async () => {
      const { writePsdWithPreciseStrokes } =
          await import("/src/model/psd-stroke-writer.ts"),
        { writeHighDepthPsd } = await import("/src/model/psd-high-depth.ts"),
        { readPsdWithPatternResources } =
          await import("/src/model/psd-patterns.ts"),
        { savePsd, openPsd } = await import("/src/model/psd.ts"),
        { serialize, deserialize } =
          await import("/src/model/serialization.ts"),
        { Renderer } = await import("/src/renderer/renderer.ts"),
        { ImageEngine } = await import("/src/engine/engine.ts");
      const engine = new ImageEngine(),
        renderer = await Renderer.create(
          document.createElement("canvas"),
          engine,
        ),
        checks = [],
        outputs = [];
      const raw = async (doc, assets) => {
        await renderer.render(doc, assets);
        return renderer.rawPixels();
      };
      const difference = (a, b) =>
        a.reduce(
          (result, value, i) => Math.max(result, Math.abs(value - b[i])),
          0,
        );
      try {
        for (const depth of [8, 16, 32])
          for (const psb of [false, true]) {
            const width = psb ? 64 : 32,
              height = 32,
              bounds = { left: -17, top: 5, right: 47, bottom: 29 },
              leaf = {
                name: "Independent solid",
                ...bounds,
                vectorFill: {
                  type: "color",
                  color: { r: 31.125, g: 73.375, b: 137.5 },
                },
                vectorMask: {
                  fillStartsWithAllPixels: false,
                  paths: [
                    {
                      open: false,
                      operation: "combine",
                      fillRule: "non-zero",
                      knots: [
                        [8, 4],
                        [16, 4],
                        [16, 12],
                        [8, 12],
                      ].map(([x, y]) => ({
                        linked: false,
                        points: [x, y, x, y, x, y],
                      })),
                    },
                  ],
                },
                mask: {
                  left: 0,
                  top: 0,
                  right: 0,
                  bottom: 0,
                  defaultColor: 255,
                  userMaskDensity: 192 / 255,
                },
              },
              input = {
                width,
                height,
                bitsPerChannel: depth,
                children: [leaf],
                imageData: {
                  width,
                  height,
                  data:
                    depth === 8
                      ? new Uint8ClampedArray(width * height * 4)
                      : depth === 16
                        ? new Uint16Array(width * height * 4)
                        : new Float32Array(width * height * 4),
                },
              },
              bytes =
                depth === 8
                  ? writePsdWithPreciseStrokes(input, {
                      psb,
                      noBackground: true,
                    })
                  : writeHighDepthPsd(input, psb),
              loaded = await openPsd(new Blob([bytes]), "Input.psd", engine);
            let saved;
            try {
              const missingInput = {
                ...input,
                children: [
                  {
                    name: "Missing raster",
                    left: 2,
                    top: 3,
                    right: 7,
                    bottom: 9,
                  },
                ],
              };
              const missingBytes =
                depth === 8
                  ? writePsdWithPreciseStrokes(missingInput, {
                      psb,
                      noBackground: true,
                    })
                  : writeHighDepthPsd(missingInput, psb);
              let missingError = "";
              try {
                const missing = await openPsd(
                  new Blob([missingBytes]),
                  "Missing.psd",
                  engine,
                );
                missing.assets.clear();
              } catch (error) {
                missingError = String(error);
              }
              if (!missingError.includes("PSD layer pixels are missing"))
                throw new Error(
                  `Absent raster cache was not reported at depth ${depth}: ${missingError}`,
                );
              const before = await raw(loaded.document, loaded.assets);
              saved = await deserialize(
                await serialize(loaded.document, loaded.assets),
              );
              const native = await raw(saved.document, saved.assets),
                l = saved.document.layers[0];
              const unchanged = await savePsd(
                saved.document,
                (d) => raw(d, saved.assets),
                undefined,
                (id) => saved.assets.blob(id),
              );
              const initial = readPsdWithPatternResources(
                new Uint8Array(await unchanged.arrayBuffer()),
                { useRawData: true, skipCompositeImageData: true },
              ).children[0];
              l.transform.x += 4;
              l.transform.y -= 2;
              const edited = await raw(saved.document, saved.assets),
                output = await savePsd(
                  saved.document,
                  (d) => raw(d, saved.assets),
                  undefined,
                  (id) => saved.assets.blob(id),
                ),
                outputBytes = new Uint8Array(await output.arrayBuffer()),
                decoded = readPsdWithPatternResources(outputBytes, {
                  useRawData: true,
                  skipCompositeImageData: true,
                }).children[0],
                reopened = await openPsd(output, "Reopened.psd", engine);
              try {
                checks.push({
                  depth,
                  psb,
                  kind: l.kind,
                  originalBounds: loaded.document.layers[0].vector.psdBounds,
                  nativeBounds: l.vector.psdBounds,
                  initialBounds: [
                    initial.left,
                    initial.top,
                    initial.right,
                    initial.bottom,
                  ],
                  editedBounds: [
                    decoded.left,
                    decoded.top,
                    decoded.right,
                    decoded.bottom,
                  ],
                  reopenedBounds: reopened.document.layers[0].vector.psdBounds,
                  nativeDifference: difference(before, native),
                  editedDifference: difference(
                    edited,
                    await raw(reopened.document, reopened.assets),
                  ),
                  changed: difference(before, edited) > 0,
                  noCache: !decoded.rawData.channels.some(
                    (c) => c.data && c.id !== -2 && c.id !== -3,
                  ),
                });
                outputs.push({
                  name: `app-${depth}-${psb ? "psb" : "psd"}.psd`,
                  bytes: Array.from(outputBytes),
                });
              } finally {
                reopened.assets.clear();
              }
            } finally {
              loaded.assets.clear();
              saved?.assets.clear();
            }
          }
      } finally {
        renderer.dispose();
        engine.dispose();
      }
      return { checks, outputs };
    });
    for (const c of result.checks) {
      expect(c.kind).toBe("vector");
      expect(c.originalBounds).toEqual({
        left: -17,
        top: 5,
        right: 47,
        bottom: 29,
      });
      expect(c.nativeBounds).toEqual(c.originalBounds);
      expect(c.initialBounds).toEqual([-17, 5, 47, 29]);
      expect(c.editedBounds).toEqual([-13, 3, 51, 27]);
      expect(c.reopenedBounds).toEqual({
        left: -13,
        top: 3,
        right: 51,
        bottom: 27,
      });
      expect(c.nativeDifference).toBe(0);
      expect(c.editedDifference).toBe(0);
      expect(c.changed).toBe(true);
      expect(c.noCache).toBe(true);
    }
    const directory = `/tmp/photo-editor-cacheless-bounds-exports/${backend}`;
    await mkdir(directory, { recursive: true });
    for (const file of result.outputs)
      await writeFile(`${directory}/${file.name}`, new Uint8Array(file.bytes));
  });
}
