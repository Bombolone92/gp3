import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";

for (const backend of ["default", "WebGL"]) {
  test(`first pattern asset lookup retains the live editor asset store (${backend})`, async ({
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
    let navigations = 0;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });
    const bytes = Array.from(
      await readFile(
        new URL("../fixtures/psd-patterns/rgb-32-3.bin", import.meta.url),
      ),
    );
    const result = await page.evaluate(async (bytes) => {
      const { Assets } = await import("/src/model/assets.ts"),
        { encodePsdMetadata, psdMetadataMimeType } =
          await import("/src/model/psd-metadata.ts"),
        assets = new Assets(),
        blob = new Blob(
          [
            encodePsdMetadata({
              globalMask: new Uint8Array(),
              tags: [{ key: "Pat3", data: new Uint8Array(bytes) }],
            }),
          ],
          { type: psdMetadataMimeType },
        ),
        id = await assets.add(blob);
      try {
        const [record, pixels] = await Promise.all([
          assets.patternResource(id, "rgb-32-3"),
          assets.pattern(id, "rgb-32-3"),
        ]);
        return {
          sameClass: (await import("/src/model/assets.ts")).Assets === Assets,
          sameBlob: assets.blob(id) === blob,
          recordExact:
            record.raw.length === bytes.length &&
            record.raw.every((v, i) => v === bytes[i]),
          native: pixels.data instanceof Float32Array,
          signedZero: Object.is(pixels.data[0], -0),
          subnormal: pixels.data[4] === 2 ** -149,
          hdr: pixels.data[20] === 2.75,
        };
      } finally {
        assets.clear();
      }
    }, bytes);
    expect(Object.values(result).every(Boolean)).toBe(true);
    expect(navigations).toBe(0);
  });
}

for (const backend of ["default", "WebGL"]) {
  test(`pattern-fill descriptors retain precise editable settings in the browser (${backend})`, async ({
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
    const fixtures = await Promise.all(
      ["PtFl", "vscg"].flatMap((key) =>
        [
          "default",
          "complete",
          "explicit-defaults",
          "invalid-units",
          "invalid-number",
        ].map(async (label) => ({
          label,
          key,
          bytes: Array.from(
            await readFile(
              new URL(
                `../fixtures/psd-pattern-fills/${label}-${key}.psd`,
                import.meta.url,
              ),
            ),
          ),
        })),
      ),
    );
    const result = await page.evaluate(async (fixtures) => {
      const { readPsdWithPatternResources } =
        await import("/src/model/psd-patterns.ts");
      const { writePsdWithPreciseStrokes } =
        await import("/src/model/psd-stroke-writer.ts");
      const { writeHighDepthPsd } =
        await import("/src/model/psd-high-depth.ts");
      const options = {
        useRawData: true,
        skipCompositeImageData: true,
        skipThumbnail: true,
      };
      const exports = [],
        checks = [],
        errors = [];
      const same = (a, b) => {
        const names = [
          "type",
          "name",
          "id",
          "scalePercent",
          "angle",
          "align",
          "linked",
        ];
        return (
          names.every((name) => Object.is(a[name], b[name])) &&
          Object.keys(a).length === Object.keys(b).length &&
          Object.is(a.phase?.x, b.phase?.x) &&
          Object.is(a.phase?.y, b.phase?.y)
        );
      };
      for (const fixture of fixtures) {
        const bytes = new Uint8Array(fixture.bytes);
        if (fixture.label.startsWith("invalid")) {
          try {
            readPsdWithPatternResources(bytes, options);
            errors.push("accepted malformed fill");
          } catch (error) {
            errors.push(error.message);
          }
          continue;
        }
        const original = readPsdWithPatternResources(bytes, options).children[0]
          .vectorFill;
        for (const depth of [8, 16, 32])
          for (const psb of [false, true]) {
            const psd = {
              width: 5,
              height: 3,
              bitsPerChannel: depth,
              imageData: {
                width: 5,
                height: 3,
                data:
                  depth === 8
                    ? new Uint8ClampedArray(60)
                    : depth === 16
                      ? new Uint16Array(60)
                      : new Float32Array(60),
              },
              children: [
                {
                  name: "Editable pattern",
                  vectorFill: original,
                  ...(fixture.key === "vscg"
                    ? {
                        vectorStroke: {
                          strokeEnabled: true,
                          fillEnabled: true,
                          opacity: 0.123456789,
                          lineWidth: { units: "Pixels", value: 1.25 },
                          content: {
                            type: "color",
                            color: { r: 21, g: 71, b: 161 },
                          },
                        },
                      }
                    : {}),
                },
              ],
            };
            const encode = () =>
              new Uint8Array(
                depth === 8
                  ? writePsdWithPreciseStrokes(psd, { psb, noBackground: true })
                  : writeHighDepthPsd(psd, psb),
              );
            const output = encode(),
              decoded = readPsdWithPatternResources(output, options);
            const edited = {
              ...original,
              scalePercent: 73.65432198765432,
              angle: 278.7654321987654,
              align: false,
              linked: true,
              phase: { x: 0.125, y: -987.25 },
            };
            psd.children[0].vectorFill = edited;
            const editedOutput = readPsdWithPatternResources(encode(), options);
            checks.push(
              same(decoded.children[0].vectorFill, original) &&
                same(editedOutput.children[0].vectorFill, edited) &&
                decoded.bitsPerChannel === depth &&
                (fixture.key !== "vscg" ||
                  decoded.children[0].vectorStroke.opacity === 0.123456789),
            );
            exports.push({
              name: `${fixture.label}-${fixture.key}-${depth}.${psb ? "psb" : "psd"}`,
              bytes: Array.from(output),
            });
          }
      }
      return { checks, errors, exports };
    }, fixtures);
    expect(result.checks).toHaveLength(36);
    expect(result.checks.every(Boolean)).toBe(true);
    expect(result.errors).toHaveLength(4);
    expect(
      result.errors.every((message) =>
        /Invalid PSD pattern-fill/.test(message),
      ),
    ).toBe(true);
    const output = `/tmp/photo-editor-pattern-fill-exports/${backend}`;
    await mkdir(output, { recursive: true });
    for (const record of result.exports)
      await writeFile(`${output}/${record.name}`, new Uint8Array(record.bytes));
  });
}

for (const backend of ["default", "WebGL"]) {
  test(`native pattern resources survive production import, native save and PSD export (${backend})`, async ({
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
    const fixtures = await Promise.all(
      ["rgb-8-1", "rgb-16-2", "rgb-32-3"].map(async (name) =>
        Array.from(
          await readFile(
            new URL(`../fixtures/psd-patterns/${name}.bin`, import.meta.url),
          ),
        ),
      ),
    );
    const results = await page.evaluate(async (fixtures) => {
      const { writePsd } = await import("/tests/browser/psd-codec.ts");
      const { writeHighDepthPsd } =
        await import("/src/model/psd-high-depth.ts");
      const { openPsd, savePsd } = await import("/src/model/psd.ts");
      const {
        readPsdWithPatternResources,
        decodePsdPattern,
        indexPsdPatterns,
      } = await import("/src/model/psd-patterns.ts");
      const { readPsdMetadata, decodePsdMetadata, restorePsdMetadata } =
        await import("/src/model/psd-metadata.ts");
      const { serialize, deserialize } =
        await import("/src/model/serialization.ts");
      const { Renderer } = await import("/src/renderer/renderer.ts");
      const { ImageEngine } = await import("/src/engine/engine.ts");
      const engine = new ImageEngine(),
        renderer = await Renderer.create(
          document.createElement("canvas"),
          engine,
        ),
        results = [];
      const tags = fixtures.map((data, i) => ({
        key: ["Patt", "Pat2", "Pat3"][i],
        data: new Uint8Array(data),
      }));
      const exact = (a, b) =>
        a.length === b.length && a.every((v, i) => v === b[i]);
      try {
        for (const depth of [8, 16, 32])
          for (const psb of [false, true]) {
            const width = 7,
              height = 5,
              data =
                depth === 8
                  ? new Uint8ClampedArray(width * height * 4)
                  : depth === 16
                    ? new Uint16Array(width * height * 4)
                    : new Float32Array(width * height * 4);
            for (let i = 0; i < width * height; i++)
              data.set(
                depth === 8
                  ? [21, 73, 161, 255]
                  : depth === 16
                    ? [21, 32768, 65432, 65535]
                    : [-0.25, 0.137, 1.75, 1],
                i * 4,
              );
            const imageData = { width, height, data },
              psd = {
                width,
                height,
                bitsPerChannel: depth,
                imageData,
                children: [{ name: "Editable source", imageData }],
              },
              encoded =
                depth === 8
                  ? writePsd(psd, { psb, noBackground: true })
                  : writeHighDepthPsd(psd, psb),
              input = new Uint8Array(
                restorePsdMetadata(new Uint8Array(encoded), {
                  globalMask: new Uint8Array(),
                  tags,
                }),
              );
            const loaded = await openPsd(
              new Blob([input]),
              "Patterns.psd",
              engine,
            );
            let project, reopened;
            try {
              loaded.document.layers[0].transform.x = -1;
              project = await deserialize(
                await serialize(loaded.document, loaded.assets),
              );
              const stored = decodePsdMetadata(
                new Uint8Array(
                  await project.assets
                    .blob(project.document.psdMetadataAsset!)
                    .arrayBuffer(),
                ),
              );
              const output = await savePsd(
                project.document,
                async (d) => {
                  await renderer.render(d, project.assets);
                  return renderer.rawPixels();
                },
                (l) => renderer.rawSourcePixels(l, project.assets),
                (id) => project.assets.blob(id),
              );
              const bytes = new Uint8Array(await output.arrayBuffer()),
                decoded = readPsdWithPatternResources(bytes, {
                  useRawData: true,
                  skipCompositeImageData: true,
                  skipThumbnail: true,
                }),
                finalTags = readPsdMetadata(bytes).tags;
              reopened = await openPsd(output, "Reopened.psd", engine);
              const assetResolution = [];
              for (const documentAssets of [loaded, project, reopened])
                for (const tag of tags) {
                  const [expected] = indexPsdPatterns(tag.data),
                    asset = documentAssets.document.psdMetadataAsset!,
                    record = await documentAssets.assets.patternResource(
                      asset,
                      expected.id,
                    ),
                    pixels = await documentAssets.assets.pattern(
                      asset,
                      expected.id,
                    ),
                    originalPixels = decodePsdPattern(expected),
                    nativeBytes = (data) =>
                      new Uint8Array(
                        data.buffer,
                        data.byteOffset,
                        data.byteLength,
                      );
                  assetResolution.push(
                    exact(record.raw, expected.raw) &&
                      pixels.width === originalPixels.width &&
                      pixels.height === originalPixels.height &&
                      pixels.data.constructor ===
                        originalPixels.data.constructor &&
                      exact(
                        nativeBytes(pixels.data),
                        nativeBytes(originalPixels.data),
                      ),
                  );
                }
              await renderer.render(project.document, project.assets);
              const before = await renderer.rawPixels();
              await renderer.render(reopened.document, reopened.assets);
              const after = await renderer.rawPixels();
              results.push({
                depth,
                psb,
                notice: loaded.notice,
                layerKind: reopened.document.layers[0].kind,
                x: reopened.document.layers[0].transform.x,
                metadataExact: tags.every((t) =>
                  exact(
                    stored.tags.find((s) => s.key === t.key)?.data ?? [],
                    t.data,
                  ),
                ),
                exportExact: tags.every((t) =>
                  exact(
                    finalTags.find((s) => s.key === t.key)?.data ?? [],
                    t.data,
                  ),
                ),
                types: decoded.patternResources!.map(
                  (p) => decodePsdPattern(p).data.constructor.name,
                ),
                planesExact: decoded.patternResources!.every((p, i) =>
                  exact(
                    decodePsdPattern(p).data,
                    decodePsdPattern(indexPsdPatterns(tags[i].data)[0]).data,
                  ),
                ),
                assetResolution,
                maxError: before.reduce(
                  (e, v, i) => Math.max(e, Math.abs(v - after[i])),
                  0,
                ),
                output: Array.from(bytes),
              });
            } finally {
              loaded.assets.clear();
              project?.assets.clear();
              reopened?.assets.clear();
            }
          }
        return results;
      } finally {
        renderer.dispose();
        engine.dispose();
      }
    }, fixtures);
    for (const result of results) {
      expect(result.notice).toBe("");
      expect(result.layerKind).toBe("image");
      expect(result.x).toBe(-1);
      expect(result.metadataExact).toBe(true);
      expect(result.exportExact).toBe(true);
      expect(result.types).toEqual([
        "Uint8Array",
        "Uint16Array",
        "Float32Array",
      ]);
      expect(result.planesExact).toBe(true);
      expect(result.assetResolution).toHaveLength(9);
      expect(result.assetResolution.every(Boolean)).toBe(true);
      expect(result.maxError).toBe(0);
      // Make production exports available for optional independent decoding.
      if (process.env.PSD_PATTERN_EXPORT_DIRECTORY) {
        const { mkdir, writeFile } = await import("node:fs/promises");
        await mkdir(process.env.PSD_PATTERN_EXPORT_DIRECTORY, {
          recursive: true,
        });
        await writeFile(
          `${process.env.PSD_PATTERN_EXPORT_DIRECTORY}/${backend}-${result.depth}-${result.psb ? "psb" : "psd"}.psd`,
          new Uint8Array(result.output),
        );
      }
    }
  });
}
