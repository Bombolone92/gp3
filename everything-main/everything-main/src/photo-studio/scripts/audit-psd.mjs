// Manual, local audit against the real importer, compositor, and exporter.
// Saved composites are evidence only: this report does not assert that they are
// an authoritative reconstruction of the editable layer tree.
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const directory = process.argv[2];
if (!directory)
  throw new Error(
    "Usage: npm run psd:audit -- <directory> [limit] [output-directory]",
  );
const limit =
  process.argv[3] === undefined ? Infinity : Number(process.argv[3]);
if (!(limit > 0)) throw new Error("The file limit must be positive.");
const output = path.resolve(process.argv[4] ?? "test-results/psd-audit");
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--use-angle=swiftshader",
  ],
});
const reports = [];
try {
  const page = await browser.newPage();
  if (process.env.PHOTO_EDITOR_AUDIT_BACKEND === "webgl")
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "gpu", { value: undefined }),
    );
  await page.route("https://js.puter.com/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "window.puter={};",
    }),
  );
  await page.goto(server.resolvedUrls.local[0]);
  const files = (await readdir(directory))
    .filter((name) => /\.ps[db]$/i.test(name))
    .sort()
    .slice(0, limit);
  for (const name of files) {
    const input = await readFile(path.join(directory, name));
    const report = await page.evaluate(
      async ({ name, bytes }) => {
        const { openPsd, savePsd } = await import("/src/model/psd.ts");
        const { readPsdWithPatternResources, decodePsdPattern, supportedPsdPattern } =
          await import("/src/model/psd-patterns.ts");
        const { nativePatternPlacement } = await import('/src/model/vector-pattern.ts');
        const readPsd = (buffer, options) =>
          readPsdWithPatternResources(new Uint8Array(buffer), options);
        const { writePsdWithPreciseStrokes: writePsd } =
          await import("/src/model/psd-stroke-writer.ts");
        const { supportedPsdPixelMask } =
          await import("/src/model/psd-pixel-mask.ts");
        const { getLayerImageData, getCompositeImageData } =
          await import("/tests/browser/psd-codec.ts");
        const { Renderer } = await import("/src/renderer/renderer.ts");
        const { ImageEngine } = await import("/src/engine/engine.ts");
        const { serialize, deserialize } =
          await import("/src/model/serialization.ts");
        const { readPsdImageResource } =
          await import("/src/model/psd-resources.ts");
        const { replacePsdImageResource } =
          await import("/src/model/psd-resources.ts");
        const { importVectorStroke, solidRgb } =
          await import("/src/model/vector-stroke.ts");
        const { readPsdMetadata, restorePsdMetadata } = await import("/src/model/psd-metadata.ts");
        const blob = new Blob([new Uint8Array(bytes)]);
        let loaded, project, renderer;
        const vectorDiagnostics = [];
        const patternDiagnostics = [];
        const engine = new ImageEngine();
        try {
          const highDepth =
            new DataView(new Uint8Array(bytes).buffer).getUint16(22) > 8;
          const decoded = readPsd(await blob.arrayBuffer(), {
            useRawData: highDepth,
            useImageData: true,
            skipThumbnail: true,
          });
          for (const resource of decoded.patternResources ?? []) {
            const diagnostic = {
              id: resource.id,
              colorMode: resource.colorMode,
              size: resource.size,
              bounds: resource.bounds,
              recordBytes: resource.raw.length,
              channelDepths: resource.channels
                .filter((c) => c.data)
                .map((c) => c.depth),
            };
            try {
              const pixels = decodePsdPattern(resource);
              const native = new Uint8Array(
                pixels.data.buffer,
                pixels.data.byteOffset,
                pixels.data.byteLength,
              );
              const digest = new Uint8Array(
                await crypto.subtle.digest("SHA-256", native),
              );
              diagnostic.sampleType = pixels.data.constructor.name;
              diagnostic.nativeSampleSha256 = Array.from(digest, (v) =>
                v.toString(16).padStart(2, "0"),
              ).join("");
              diagnostic.decodedBytes = native.length;
            } catch (error) {
              diagnostic.error = error.message;
            }
            patternDiagnostics.push(diagnostic);
          }
          if (highDepth) {
            decoded.imageData = getCompositeImageData(decoded);
            const decodeSources = (layers) => {
              for (const l of layers) {
                if (l.children) decodeSources(l.children);
                else if (!l.vectorFill) l.imageData = getLayerImageData(l);
              }
            };
            decodeSources(decoded.children ?? []);
          }
          // Inspect vector geometry independently even when the full importer
          // is gated by another missing feature (such as high-depth export).
          // This is evidence about the mask renderer, not a passing PSD import.
          const inspectVectors = async (layers) => {
            for (const layer of layers) {
              if (layer.vectorMask) {
                const diagnostic = {
                  name: layer.name,
                  ...(layer.vectorFill?.type === "pattern"
                    ? { patternFill: layer.vectorFill }
                    : {}),
                  flags: {
                    invert: layer.vectorMask.invert,
                    disable: layer.vectorMask.disable,
                    notLink: layer.vectorMask.notLink,
                    initialFill: layer.vectorMask.fillStartsWithAllPixels,
                  },
                  paths: layer.vectorMask.paths.map((p) => ({
                    open: p.open,
                    operation: p.operation,
                    fillRule: p.fillRule,
                    knots: p.knots.length,
                  })),
                };
                try {
                  const raster = await engine.vectorMask(layer.vectorMask, {
                    x: 0,
                    y: 0,
                    width: decoded.width,
                    height: decoded.height,
                  });
                  let coveredPixels = 0,
                    fractionalPixels = 0,
                    area = 0;
                  for (const alpha of raster.coverage) {
                    coveredPixels += alpha > 0 ? 1 : 0;
                    fractionalPixels += alpha > 0 && alpha < 255 ? 1 : 0;
                    area += alpha / 255;
                  }
                  Object.assign(diagnostic, {
                    coveredPixels,
                    fractionalPixels,
                    area,
                  });
                  const editableMask =
                    layer.mask &&
                    supportedPsdPixelMask(layer) &&
                    solidRgb(layer.vectorFill);
                  const patternResource = layer.vectorFill?.type === 'pattern'
                    ? decoded.patternResources?.find(p => p.id === layer.vectorFill.id) : undefined;
                  const editablePattern = patternResource && nativePatternPlacement(layer.vectorFill) && supportedPsdPattern(patternResource);
                  if (layer.vectorStroke || editableMask || editablePattern) {
                    const roundTrip = {
                      supported: layer.vectorStroke
                        ? !!importVectorStroke(layer)
                        : !!(editableMask || editablePattern),
                      reduction: solidRgb(layer.vectorFill) || editablePattern
                        ? "original fill and stroke"
                        : "stroke only; unsupported fill disabled",
                      descriptor: layer.vectorStroke,
                    };
                    if (layer.vectorStroke) diagnostic.stroke = roundTrip;
                    else if (editablePattern) diagnostic.pattern = roundTrip;
                    else diagnostic.pixelMask = roundTrip;
                    if (roundTrip.supported && !highDepth) {
                      // Retain original path and stroke parameters. When the
                      // fill is unsupported, disable it explicitly for a stroke-
                      // only diagnostic; this does not certify its fill or full PSD.
                      const reduced = solidRgb(layer.vectorFill) || editablePattern
                        ? layer
                        : {
                            ...layer,
                            vectorFill: {
                              type: "color",
                              color: { r: 0, g: 0, b: 0 },
                            },
                            vectorStroke: {
                              ...layer.vectorStroke,
                              fillEnabled: false,
                            },
                          };
                      let bytes = writePsd(
                        {
                          width: decoded.width,
                          height: decoded.height,
                          children: [reduced],
                          imageResources: {
                            resolutionInfo:
                              decoded.imageResources?.resolutionInfo,
                            iccUntaggedProfile:
                              decoded.imageResources?.iccUntaggedProfile,
                          },
                        },
                        { noBackground: true },
                      );
                      const profile = readPsdImageResource(
                        new Uint8Array(await blob.arrayBuffer()),
                        1039,
                      );
                      if (profile)
                        bytes = replacePsdImageResource(
                          new Uint8Array(bytes),
                          1039,
                          profile,
                        );
                      if (editablePattern)
                        bytes = restorePsdMetadata(new Uint8Array(bytes), {
                          globalMask: new Uint8Array(),
                          tags: [{key:'Pat3', data:patternResource.raw}],
                        });
                      const isolated = await openPsd(
                        new Blob([bytes]),
                        "Isolated vector.psd",
                        engine,
                      );
                      let native, reopened;
                      try {
                        await renderer.render(
                          isolated.document,
                          isolated.assets,
                        );
                        const before = await renderer.rawPixels();
                        native = await deserialize(
                          await serialize(isolated.document, isolated.assets),
                        );
                        await renderer.render(native.document, native.assets);
                        const projectPixels = await renderer.rawPixels();
                        const output = await savePsd(
                          native.document,
                          async (d) => {
                            await renderer.render(d, native.assets);
                            return renderer.rawPixels();
                          },
                          undefined,
                          (id) => native.assets.blob(id),
                        );
                        reopened = await openPsd(
                          output,
                          "Isolated reopen.psd",
                          engine,
                        );
                        await renderer.render(
                          reopened.document,
                          reopened.assets,
                        );
                        const after = await renderer.rawPixels();
                        Object.assign(roundTrip, {
                          kind: isolated.document.layers[0].kind,
                          notice: isolated.notice,
                          nativeDifference: before.reduce(
                            (sum, v, i) => sum + Math.abs(v - projectPixels[i]),
                            0,
                          ),
                          exportDifference: before.reduce(
                            (sum, v, i) => sum + Math.abs(v - after[i]),
                            0,
                          ),
                          exportedStyle: readPsd(await output.arrayBuffer(), {
                            skipLayerImageData: true,
                            skipCompositeImageData: true,
                          }).children[0].vectorStroke,
                          ...(editablePattern ? {
                            exportedFill: readPsd(await output.arrayBuffer(), {skipLayerImageData:true,skipCompositeImageData:true}).children[0].vectorFill,
                            resourceExact: (await native.assets.patternResource(native.document.layers[0].vector.fill.asset, patternResource.id)).raw.every((v,i)=>v===patternResource.raw[i]),
                          } : {}),
                          exported: Array.from(
                            new Uint8Array(await output.arrayBuffer()),
                          ),
                        });
                      } finally {
                        isolated.assets.clear();
                        native?.assets.clear();
                        reopened?.assets.clear();
                      }
                    }
                  }
                } catch (error) {
                  diagnostic.error = error.message;
                }
                vectorDiagnostics.push(diagnostic);
              }
              if (layer.children) await inspectVectors(layer.children);
            }
          };
          loaded = await openPsd(blob, name);
          for (let i = 0; i < patternDiagnostics.length; i++) {
            const diagnostic = patternDiagnostics[i];
            try {
              const asset = loaded.document.psdMetadataAsset,
                resource = await loaded.assets.patternResource(
                  asset,
                  diagnostic.id,
                ),
                original = decoded.patternResources[i].raw;
              diagnostic.assetRecordExact =
                resource.raw.length === original.length &&
                resource.raw.every((v, j) => v === original[j]);
              const pixels = await loaded.assets.pattern(asset, diagnostic.id),
                native = new Uint8Array(
                  pixels.data.buffer,
                  pixels.data.byteOffset,
                  pixels.data.byteLength,
                ),
                digest = new Uint8Array(
                  await crypto.subtle.digest("SHA-256", native),
                );
              diagnostic.assetSampleSha256 = Array.from(digest, (v) =>
                v.toString(16).padStart(2, "0"),
              ).join("");
            } catch (error) {
              diagnostic.assetError = error.message;
            }
          }
          renderer = await Renderer.create(
            document.createElement("canvas"),
            engine,
          );
          await inspectVectors(decoded.children ?? []);
          await renderer.render(loaded.document, loaded.assets);
          const pixels = await renderer.rawPixels();
          const displayPixels = await renderer.displayPixels();
          const sourceDifferences = [];
          const inspectSources = async (originals, layers) => {
            for (let j = 0; j < originals.length; j++) {
              const original = originals[j],
                layer = layers[j];
              if (!layer) break;
              if (original.children)
                await inspectSources(original.children, layer.children);
              else if (original.imageData && layer.asset) {
                const source = await renderer.rawSourcePixels(
                  layer,
                  loaded.assets,
                );
                const actual = source.data;
                let maximum = 0,
                  total = 0,
                  changed = 0;
                for (let i = 0; i < actual.length; i++) {
                  const expected =
                    original.imageData.data instanceof Uint16Array
                      ? Math.fround(original.imageData.data[i] / 65535)
                      : original.imageData.data[i];
                  const delta = Math.abs(actual[i] - expected);
                  maximum = Math.max(maximum, delta);
                  total += delta;
                  changed += delta !== 0 ? 1 : 0;
                }
                sourceDifferences.push({
                  name: layer.name,
                  maximum,
                  total,
                  changed,
                });
              }
            }
          };
          await inspectSources(decoded.children ?? [], loaded.document.layers);
          let maximum = 0,
            total = 0,
            changed = 0;
          const composite = decoded.imageData?.data;
          if (composite) {
            for (let i = 0; i < pixels.length; i++) {
              if (
                i % 4 !== 3 &&
                !pixels[i - (i % 4) + 3] &&
                !composite[i - (i % 4) + 3]
              )
                continue;
              const expected =
                composite instanceof Uint16Array
                  ? Math.fround(composite[i] / 65535)
                  : composite[i];
              const delta = Math.abs(pixels[i] - expected);
              maximum = Math.max(maximum, delta);
              total += delta;
              changed += delta !== 0 ? 1 : 0;
            }
          }
          project = await deserialize(
            await serialize(loaded.document, loaded.assets),
          );
          await renderer.render(project.document, project.assets);
          const projectPixels = await renderer.rawPixels();
          const projectDisplay = await renderer.displayPixels();
          const exported = await savePsd(
            project.document,
            async (snapshot) => {
              await renderer.render(snapshot, project.assets);
              return renderer.rawPixels();
            },
            (l) => renderer.rawSourcePixels(l, project.assets),
            (id) => project.assets.blob(id),
          );
          const reopened = await openPsd(exported, name);
          const originalProfile = readPsdImageResource(
            new Uint8Array(bytes),
            1039,
          );
          const exportedBytes = new Uint8Array(await exported.arrayBuffer());
          const exportedProfile = readPsdImageResource(exportedBytes, 1039);
          const originalMetadata = readPsdMetadata(new Uint8Array(bytes));
          const exportedMetadata = readPsdMetadata(exportedBytes);
          const equalBytes = (a, b) =>
            a.length === b.length && a.every((v, i) => v === b[i]);
          try {
            await renderer.render(reopened.document, reopened.assets);
            const reopenedPixels = await renderer.rawPixels();
            const reopenedDisplay = await renderer.displayPixels();
            const walk = (layers) =>
              layers.map((l) => ({
                psdId: l.psdId,
                name: l.name,
                kind: l.kind,
                visible: l.visible,
                locked: l.locked,
                protection: l.protection,
                transparencyProtected: l.transparencyProtected,
                opacity: l.opacity,
                blend: l.blend,
                transform: l.transform,
                children: walk(l.children),
              }));
            return {
              name,
              width: decoded.width,
              height: decoded.height,
              depth: decoded.bitsPerChannel,
              colorMode: decoded.colorMode,
              backend: renderer.name,
              notice: loaded.notice,
              originalFileRetained: !!loaded.document.psdOriginal,
              originalFileExportExact: loaded.document.psdOriginal
                ? equalBytes(new Uint8Array(bytes), exportedBytes)
                : undefined,
              originalResolution: decoded.imageResources?.resolutionInfo,
              resolution: loaded.document.resolution,
              exportedResolution: reopened.document.resolution,
              originalProfileBytes: originalProfile?.length ?? 0,
              exportedProfileBytes: exportedProfile?.length ?? 0,
              profilePreserved:
                originalProfile?.length === exportedProfile?.length &&
                (originalProfile?.every((v, i) => exportedProfile[i] === v) ??
                  true),
              metadataPreserved:
                equalBytes(
                  originalMetadata.globalMask,
                  exportedMetadata.globalMask,
                ) &&
                originalMetadata.tags.length === exportedMetadata.tags.length &&
                originalMetadata.tags.every(
                  (t, i) =>
                    t.key === exportedMetadata.tags[i].key &&
                    !!t.wideLength === !!exportedMetadata.tags[i].wideLength &&
                    equalBytes(t.data, exportedMetadata.tags[i].data),
                ),
              layers: walk(loaded.document.layers),
              exportedLayers: walk(reopened.document.layers),
              compositeDifference: { maximum, total, changed },
              sourceDifferences,
              vectorDiagnostics,
              patternDiagnostics,
              projectPixelDifference: pixels.reduce(
                (n, v, i) => n + Math.abs(v - projectPixels[i]),
                0,
              ),
              exportPixelDifference: pixels.reduce(
                (n, v, i) => n + Math.abs(v - reopenedPixels[i]),
                0,
              ),
              projectDisplayDifference: displayPixels.reduce(
                (n, v, i) => n + Math.abs(v - projectDisplay[i]),
                0,
              ),
              exportDisplayDifference: displayPixels.reduce(
                (n, v, i) => n + Math.abs(v - reopenedDisplay[i]),
                0,
              ),
              png: Array.from(
                new Uint8Array(
                  await (
                    await engine.png(
                      displayPixels.slice(),
                      decoded.width,
                      decoded.height,
                    )
                  ).arrayBuffer(),
                ),
              ),
              exported: Array.from(
                new Uint8Array(await exported.arrayBuffer()),
              ),
            };
          } finally {
            reopened.assets.clear();
          }
        } catch (error) {
          return {
            name,
            error: error.message,
            vectorDiagnostics,
            patternDiagnostics,
          };
        } finally {
          renderer?.dispose();
          engine.dispose();
          loaded?.assets.clear();
          project?.assets.clear();
        }
      },
      { name, bytes: Array.from(input) },
    );
    if (report.png)
      await writeFile(
        path.join(output, `${name}.png`),
        Buffer.from(report.png),
      );
    if (report.exported)
      await writeFile(
        path.join(output, `${name}.export.psd`),
        Buffer.from(report.exported),
      );
    delete report.png;
    delete report.exported;
    for (const [index, diagnostic] of (
      report.vectorDiagnostics ?? []
    ).entries()) {
      for (const kind of ["stroke", "pixelMask", "pattern"])
        if (diagnostic[kind]?.exported) {
          await writeFile(
            path.join(output, `${name}.vector-${index}.export.psd`),
            Buffer.from(diagnostic[kind].exported),
          );
          delete diagnostic[kind].exported;
        }
    }
    reports.push(report);
    console.log(JSON.stringify(report));
    await writeFile(
      path.join(output, "report.json"),
      JSON.stringify(reports, null, 2),
    );
  }
} finally {
  await browser.close();
  await server.close();
}
