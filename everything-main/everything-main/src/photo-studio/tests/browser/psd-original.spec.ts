import { test, expect } from "@playwright/test";
import { boot, downloadFrom, idle, menu, openFiles } from "./helpers";

for (const backend of ["default", "WebGL"]) {
  test(`unsupported layer records survive native previews and exact original exports (${backend})`, async ({
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
      const { openPsd, savePsd } = await import("/src/model/psd.ts");
      const { readOriginalPsd } = await import("/src/model/psd-original.ts");
      const { serialize, deserialize } =
        await import("/src/model/serialization.ts");
      const { restorePsdMetadata } = await import("/src/model/psd-metadata.ts");
      const { Renderer } = await import("/src/renderer/renderer.ts");
      const { ImageEngine } = await import("/src/engine/engine.ts");
      const engine = new ImageEngine(),
        renderer = await Renderer.create(
          document.createElement("canvas"),
          engine,
        ),
        cases = [];
      const equal = (a, b) =>
        a.length === b.length && a.every((v, i) => v === b[i]);
      try {
        for (const depth of [8, 16, 32] as const)
          for (const psb of [false, true]) {
            const width = 7 + depth / 8,
              height = psb ? 5 : 3;
            const pixels = (preview: boolean) => {
              const data =
                depth === 8
                  ? new Uint8ClampedArray(width * height * 4)
                  : depth === 16
                    ? new Uint16Array(width * height * 4)
                    : new Float32Array(width * height * 4);
              for (let i = 0; i < width * height; i++)
                data.set(
                  depth === 8
                    ? preview
                      ? [17, 53, 121, 255]
                      : [213, 41, 79, 255]
                    : depth === 16
                      ? preview
                        ? [1111, 32768, 65432, 65535]
                        : [55555, 12345, 23456, 65535]
                      : preview
                        ? [-0.125, 0.1371234, 1.75, 1]
                        : [2.125, 0.35, -0.25, 1],
                  i * 4,
                );
              return { width, height, data };
            };
            const imageData = pixels(false),
              composite = pixels(true);
            const features = {
              clipping: { clipping: true },
              // Supported adjustments open as editable layers; a noise
              // gradient map still has no native equivalent.
              adjustment: {
                adjustment: {
                  type: "gradient map",
                  gradientType: "noise",
                  roughness: 0.5,
                  randomSeed: 17,
                  colorModel: "rgb",
                  min: [0, 0, 0, 0],
                  max: [1, 1, 1, 1],
                  colorStops: [],
                  opacityStops: [],
                },
              },
              effects: {
                effects: {
                  solidFill: [
                    {
                      enabled: true,
                      color: { r: 51, g: 178, b: 213 },
                      blendMode: "multiply",
                      opacity: 0.7321,
                    },
                  ],
                },
              },
              gradient: {
                vectorFill: {
                  type: "solid",
                  name: "Independent ramp",
                  // Dithering remains unsupported by the native fill renderer.
                  dither: true,
                  smoothness: 0.75,
                  style: "linear",
                  angle: 17.5,
                  scale: 1.2,
                  colorStops: [
                    {
                      location: 0,
                      midpoint: 0.25,
                      color: { r: 31, g: 51, b: 213 },
                    },
                    {
                      location: 1,
                      midpoint: 0.75,
                      color: { r: 231, g: 178, b: 13 },
                    },
                  ],
                  opacityStops: [
                    { location: 0, midpoint: 0.5, opacity: 0.31 },
                    { location: 1, midpoint: 0.5, opacity: 1 },
                  ],
                },
              },
              text: {
                text: {
                  text: "Editable original text",
                  transform: [1, 0, 0, 1, 1.25, -2.5],
                  style: {
                    font: { name: "IndependentTestFont" },
                    fontSize: 13.5,
                  },
                },
              },
              smartObject: {
                placedLayer: {
                  id: crypto.randomUUID(),
                  type: "raster",
                  width,
                  height,
                  transform: [0, 0, width, 0, width, height, 0, height],
                },
              },
            };
            for (const [feature, fields] of Object.entries(features)) {
              const psd = {
                width,
                height,
                bitsPerChannel: depth,
                imageData: composite,
                children: [
                  {
                    name: "Nested original",
                    children: [{ name: "Source pixels", id: 71, imageData }],
                  },
                  { name: feature, id: 219, imageData, ...fields },
                ],
              };
              const encoded =
                depth === 8
                  ? writePsdWithPreciseStrokes(psd, { psb, noBackground: true })
                  : writeHighDepthPsd(psd, psb);
              const input = new Uint8Array(
                restorePsdMetadata(new Uint8Array(encoded), {
                  globalMask: new Uint8Array(),
                  tags: [
                    {
                      key: "zzzz",
                      data: new Uint8Array([17, 99, 128, 255, 31]),
                      wideLength: psb,
                    },
                  ],
                }),
              );
              let loaded, project, edited;
              try {
                loaded = await openPsd(
                  new Blob([input]),
                  `${feature}.${psb ? "psb" : "psd"}`,
                  engine,
                );
                if (!loaded.document.psdOriginal) {
                  // Clipping groups are now composited natively, so such files open
                  // as editable layers instead of a retained original.
                  cases.push({ depth, psb, feature, retained: false, clipped: loaded.document.layers.some((l) => l.clipped) });
                  continue;
                }
                await renderer.render(loaded.document, loaded.assets);
                const before = await renderer.rawPixels();
                project = await deserialize(
                  await serialize(loaded.document, loaded.assets),
                );
                await renderer.render(project.document, project.assets);
                const after = await renderer.rawPixels();
                let rendered = false;
                const output = await savePsd(
                  project.document,
                  async () => {
                    rendered = true;
                    throw new Error("Must retain original bytes");
                  },
                  undefined,
                  (id) => project.assets.blob(id),
                );
                project.document.layers[0].opacity = 0.375;
                edited = await deserialize(
                  await serialize(project.document, project.assets),
                );
                let error = "";
                try {
                  await savePsd(
                    edited.document,
                    async () => {
                      rendered = true;
                      return new Uint8Array();
                    },
                    undefined,
                    (id) => edited.assets.blob(id),
                  );
                } catch (e) {
                  error = String(e);
                }
                const original = await readOriginalPsd(edited.document, (id) =>
                  edited.assets.blob(id),
                );
                cases.push({
                  depth,
                  psb,
                  feature,
                  retained: !!loaded.document.psdOriginal,
                  exactExport: equal(
                    new Uint8Array(await output.arrayBuffer()),
                    input,
                  ),
                  exactRecovery: equal(
                    new Uint8Array(await original.blob.arrayBuffer()),
                    input,
                  ),
                  nativeExact: equal(before, after),
                  editsRetained: edited.document.layers[0].opacity === 0.375,
                  extension: original.extension,
                  rendered,
                  error,
                });
              } finally {
                loaded?.assets.clear();
                project?.assets.clear();
                edited?.assets.clear();
              }
            }
          }
        // Ordinary composite-only documents keep their existing editable export.
        const imageData = {
          width: 3,
          height: 2,
          data: new Uint8ClampedArray(24).fill(255),
        };
        const ordinary = await openPsd(
          new Blob([
            writePsdWithPreciseStrokes(
              { width: 3, height: 2, imageData },
              { noBackground: true },
            ),
          ]),
          "Composite.psd",
          engine,
        );
        const compositeOnlyPreserved = !ordinary.document.psdOriginal;
        ordinary.assets.clear();
        return { cases, compositeOnlyPreserved };
      } finally {
        renderer.dispose();
        engine.dispose();
      }
    });
    expect(result.cases).toHaveLength(36);
    expect(result.compositeOnlyPreserved).toBe(true);
    for (const c of result.cases) {
      if (c.feature === "clipping") {
        // Behavior change: clipping masks are supported by the new compositor.
        expect(c, `clipping RGB/${c.depth}`).toMatchObject({ retained: false, clipped: true });
        continue;
      }
      expect(
        c,
        `${c.feature} RGB/${c.depth} ${c.psb ? "PSB" : "PSD"}`,
      ).toMatchObject({
        retained: true,
        exactExport: true,
        exactRecovery: true,
        nativeExact: true,
        editsRetained: true,
        rendered: false,
        extension: c.psb ? "psb" : "psd",
      });
      expect(c.error).toContain("preview has been edited");
    }
  });
}

test("File downloads preserve original PSB layers and explain edited preview exports", async ({
  page,
}) => {
  await boot(page, "default", "window.puter={};");
  // The original-PSD download is only enabled for documents that retain one.
  await page.getByRole("menubar").getByRole("menuitem", { name: "File", exact: true }).click();
  await expect(page.locator('.menu-item[data-command="file.export-original-psd"]')).toHaveAttribute("aria-disabled", "true");
  await page.locator("#status").click();
  const bytes = await page.evaluate(async () => {
    const { writePsdWithPreciseStrokes } =
      await import("/src/model/psd-stroke-writer.ts");
    const imageData = {
      width: 9,
      height: 7,
      data: new Uint8ClampedArray(9 * 7 * 4).fill(255),
    };
    return Array.from(
      new Uint8Array(
        writePsdWithPreciseStrokes(
          {
            width: 9,
            height: 7,
            imageData,
            children: [
              { name: "Original pixels", imageData },
              // A layer style is still composited from the saved composite.
              {
                name: "Styled pixels",
                imageData,
                effects: { solidFill: [{ enabled: true, color: { r: 51, g: 178, b: 213 }, blendMode: "multiply", opacity: 0.5 }] },
              },
            ],
          },
          { psb: true, noBackground: true },
        ),
      ),
    );
  });
  const input = Buffer.from(bytes);
  await openFiles(page, {
    name: "Archive.PSB",
    mimeType: "application/octet-stream",
    buffer: input,
  });
  await expect(page.getByRole("dialog")).toContainText(
    "complete original file is retained",
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const exportPsd = () => menu(page, "File", "Export", "Export PSD");
  const unchanged = await downloadFrom(page, exportPsd);
  expect(unchanged.name).toBe("Archive.psb");
  expect(unchanged.bytes).toEqual(input);
  await page.locator("#opacity").fill("50");
  await page.locator("#opacity").dispatchEvent("change");
  await idle(page);
  let count = 0;
  page.on("download", () => count++);
  await exportPsd();
  await expect(page.getByRole("dialog")).toContainText(
    "preview has been edited",
  );
  expect(count).toBe(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const native = await downloadFrom(page, () => menu(page, "File", "Download Project (.photo)"));
  expect(native.name).toMatch(/\.photo$/);
  await page.reload();
  await page.waitForFunction(() => !!window.photoStudio?.renderer);
  await openFiles(page, {
    name: native.name,
    mimeType: "application/x-photo-editor",
    buffer: native.bytes,
  });
  await expect(page.locator("#opacity")).toHaveValue("50");
  const recovered = await downloadFrom(page, () => menu(page, "File", "Export", "Download Original PSD"));
  expect(recovered.name).toBe("Archive-original.psb");
  expect(recovered.bytes).toEqual(input);
  await expect(page.locator("#toast")).toContainText(
    "Preview edits are not included",
  );
});
