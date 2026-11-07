import { test, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { newDocument, layer } from "../../src/model/document";
import { Assets } from "../../src/model/assets";
import { serialize } from "../../src/model/serialization";
import { boot, type Backend, openFiles, panel, undo } from "./helpers";
import {
  encodePsdMetadata,
  psdMetadataMimeType,
} from "../../src/model/psd-metadata";

for (const backend of ["default", "WebGL"]) {
  test(`pattern paint combines transparency with stroke, masks and separate material assets (${backend})`, async ({
    page,
  }) => {
    await boot(page, backend as Backend, "window.puter={};");
    const fixture = Array.from(
      await readFile(
        new URL("../fixtures/psd-patterns/rgb-8-3.bin", import.meta.url),
      ),
    );
    const secondaryFixture = Array.from(
      await readFile(
        new URL("../fixtures/psd-patterns/gray.bin", import.meta.url),
      ),
    );
    const result = await page.evaluate(
      async ({ fixture, secondaryFixture }) => {
        const { Assets } = await import("/src/model/assets.ts");
        const { newDocument, layer } = await import("/src/model/document.ts");
        const { encodePsdMetadata, psdMetadataMimeType } =
          await import("/src/model/psd-metadata.ts");
        const { readPsdWithPatternResources } =
          await import("/src/model/psd-patterns.ts");
        const { Renderer } = await import("/src/renderer/renderer.ts");
        const { ImageEngine } = await import("/src/engine/engine.ts");
        const { savePsd, openPsd } = await import("/src/model/psd.ts");
        const assets = new Assets(),
          engine = new ImageEngine(),
          renderer = await Renderer.create(
            document.createElement("canvas"),
            engine,
          );
        try {
          const doc = newDocument(19, 13);
          doc.bitsPerChannel = 32;
          const asset = await assets.add(
            new Blob(
              [
                encodePsdMetadata({
                  globalMask: new Uint8Array(),
                  tags: [{ key: "Patt", data: new Uint8Array(fixture) }],
                }),
              ],
              { type: psdMetadataMimeType },
            ),
          );
          const l = layer("vector", "Independent copied material", 19, 13),
            x = 3.25,
            y = 2.125,
            w = 7.5,
            h = 5.75;
          l.vector = {
            reference: { x, y, width: w, height: h },
            fill: {
              type: "pattern",
              asset,
              id: "rgb-8-3",
              name: "Independent",
              phase: { x: 0.125, y: -0.375 },
            },
            mask: {
              fillStartsWithAllPixels: false,
              paths: [
                {
                  open: false,
                  operation: "combine",
                  fillRule: "non-zero",
                  knots: [
                    [x, y],
                    [x + w, y],
                    [x + w, y + h],
                    [x, y + h],
                  ].map(([a, b]) => ({
                    linked: false,
                    points: [a, b, a, b, a, b],
                  })),
                },
              ],
            },
            stroke: {
              enabled: true,
              fillEnabled: true,
              alignment: "inside",
              cap: "butt",
              join: "miter",
              miterLimit: 4,
              lineDashSet: [],
              lineDashOffset: { units: "None", value: 0 },
              resolution: 72,
              lineWidth: { units: "Pixels", value: 2 },
              opacity: 0.375,
              color: { rgb: [0.21, 0.73, 1.61], space: "document" },
            },
          };
          l.transform = { ...l.vector.reference, rotation: 0 };
          doc.layers = [l];
          let calls = 0;
          const stroke = engine.vectorStroke.bind(engine);
          engine.vectorStroke = (...args) => {
            calls++;
            return stroke(...args);
          };
          await renderer.render(doc, assets);
          const first = await renderer.rawPixels(),
            firstCalls = calls;
          l.vector.fill.phase.x += 1.125;
          await renderer.render(doc, assets);
          const shifted = await renderer.rawPixels(),
            phaseReusesGeometry = calls === firstCalls;
          l.vector.fill.align = false;
          await renderer.render(doc, assets);
          const linkReusesGeometry = calls === firstCalls;
          // PSD layer opacity and mask density are byte-valued fields.
          l.opacity = 160 / 255;
          l.pixelMask = {
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            defaultColor: 255,
            userMaskDensity: 192 / 255,
            matrix: [1, 0, 0, 1, 0, 0],
            positionRelativeToLayer: false,
            fromVectorData: false,
            reference: { ...l.transform },
          };
          l.maskInverted = true;
          await renderer.render(doc, assets);
          const masked = await renderer.rawPixels();
          // An inverted all-white mask retains one minus its density.
          let maskError = 0;
          for (let i = 0; i < 19 * 13; i++)
            maskError = Math.max(
              maskError,
              Math.abs(
                masked[i * 4 + 3] -
                  shifted[i * 4 + 3] *
                    l.opacity *
                    (1 - l.pixelMask.userMaskDensity),
              ),
            );
          const before = await renderer.rawPixels();
          const exported = await savePsd(
            doc,
            async (d) => {
              await renderer.render(d, assets);
              return renderer.rawPixels();
            },
            undefined,
            (id) => assets.blob(id),
          );
          const decoded = readPsdWithPatternResources(
            new Uint8Array(await exported.arrayBuffer()),
            { useRawData: true, skipCompositeImageData: true },
          );
          const reopened = await openPsd(exported, "Copied.psd", engine);
          try {
            await renderer.render(reopened.document, reopened.assets);
            const after = await renderer.rawPixels();
            let difference = 0;
            for (let i = 0; i < before.length; i++)
              difference = Math.max(difference, Math.abs(before[i] - after[i]));
            const other = await assets.add(
              new Blob(
                [
                  encodePsdMetadata({
                    globalMask: new Uint8Array(),
                    tags: [
                      { key: "Pat2", data: new Uint8Array(secondaryFixture) },
                    ],
                  }),
                ],
                { type: psdMetadataMimeType },
              ),
            );
            const copy = structuredClone(l);
            copy.id = crypto.randomUUID();
            copy.vector.fill = {
              ...copy.vector.fill,
              asset: other,
              id: "gray",
            };
            doc.layers.push(copy);
            doc.psdMetadataAsset = await assets.add(
              new Blob(
                [
                  encodePsdMetadata({
                    globalMask: new Uint8Array(),
                    tags: [{ key: "Pat3", data: new Uint8Array(fixture) }],
                  }),
                ],
                { type: psdMetadataMimeType },
              ),
            );
            const combined = await savePsd(
              doc,
              async (d) => {
                await renderer.render(d, assets);
                return renderer.rawPixels();
              },
              undefined,
              (id) => assets.blob(id),
            );
            const combinedDecoded = readPsdWithPatternResources(
              new Uint8Array(await combined.arrayBuffer()),
              { useRawData: true, skipCompositeImageData: true },
            );
            return {
              phaseReusesGeometry,
              linkReusesGeometry,
              maskError,
              difference,
              changed: first.some((v, i) => v !== shifted[i]),
              resourceExact: decoded.patternResources[0].raw.every(
                (v, i) => v === fixture[i],
              ),
              kind: reopened.document.layers[0].kind,
              combinedIds: combinedDecoded.patternResources.map((p) => p.id),
              combinedBytes: Array.from(
                new Uint8Array(await combined.arrayBuffer()),
              ),
            };
          } finally {
            reopened.assets.clear();
          }
        } finally {
          renderer.dispose();
          engine.dispose();
          assets.clear();
        }
      },
      { fixture, secondaryFixture },
    );
    const { combinedBytes, ...checks } = result;
    expect(checks).toEqual({
      phaseReusesGeometry: true,
      linkReusesGeometry: true,
      maskError: expect.any(Number),
      difference: expect.any(Number),
      changed: true,
      resourceExact: true,
      kind: "vector",
      combinedIds: ["rgb-8-3", "gray"],
    });
    expect(result.maskError).toBeLessThan(1e-7);
    expect(result.difference).toBeLessThan(1e-6);
    const directory = "/tmp/photo-editor-native-pattern-copy-exports";
    await mkdir(directory, { recursive: true });
    await writeFile(
      `${directory}/${backend}.psd`,
      new Uint8Array(combinedBytes),
    );
  });
  test(`native-grid pattern fills reconstruct editable paint and round trip (${backend})`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await boot(page, backend as Backend, "window.puter={};");
    const fixtures = await Promise.all(
      [8, 16, 32].map(async (depth) =>
        Array.from(
          await readFile(
            new URL(
              `../fixtures/psd-patterns/rgb-${depth}-3.bin`,
              import.meta.url,
            ),
          ),
        ),
      ),
    );
    const result = await page.evaluate(async (fixtures) => {
      const { writePsdWithPreciseStrokes } =
        await import("/src/model/psd-stroke-writer.ts");
      const { writeHighDepthPsd } =
        await import("/src/model/psd-high-depth.ts");
      const { restorePsdMetadata } = await import("/src/model/psd-metadata.ts");
      const {
        readPsdWithPatternResources,
        indexPsdPatterns,
        decodePsdPattern,
      } = await import("/src/model/psd-patterns.ts");
      const { openPsd, savePsd } = await import("/src/model/psd.ts");
      const { serialize, deserialize } =
        await import("/src/model/serialization.ts");
      const { Renderer } = await import("/src/renderer/renderer.ts");
      const { ImageEngine } = await import("/src/engine/engine.ts");
      const { History } = await import("/src/history/history.ts");
      const engine = new ImageEngine(),
        renderer = await Renderer.create(
          document.createElement("canvas"),
          engine,
        );
      const checks = [],
        exports = [];
      const exact = (a, b) =>
        a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
      const same = (a, b) =>
        typeof a !== "object" || a === null
          ? Object.is(a, b)
          : !!b &&
            Object.keys(a).length === Object.keys(b).length &&
            Object.keys(a).every((key) => same(a[key], b[key]));
      const raw = async (doc, assets) => {
        await renderer.render(doc, assets);
        return renderer.rawPixels();
      };
      try {
        for (let d = 0; d < 3; d++)
          for (const psb of [false, true])
            for (const align of [undefined, true, false]) {
              const depth = [8, 16, 32][d],
                width = 17 + d * 4,
                height = 11 + d * 2;
              const stale =
                depth === 8
                  ? new Uint8ClampedArray(width * height * 4)
                  : depth === 16
                    ? new Uint16Array(width * height * 4)
                    : new Float32Array(width * height * 4);
              for (let i = 0; i < width * height; i++)
                stale.set(
                  depth === 8
                    ? [255, 0, 255, 255]
                    : depth === 16
                      ? [65535, 0, 65535, 65535]
                      : [1, 0, 1, 1],
                  i * 4,
                );
              const phase = { x: -2.5000001 + d / 8, y: 1.375 - d / 4 },
                referencePoint = { x: 2.75, y: -1.125 };
              const fill = {
                type: "pattern",
                id: `rgb-${depth}-3`,
                name: `Independent rgb-${depth}-3 Ω`,
                phase,
                ...(align === undefined ? {} : { align }),
              };
              const psd = {
                width,
                height,
                bitsPerChannel: depth,
                imageData: { width, height, data: stale },
                children: [
                  {
                    name: "Editable pattern",
                    imageData: { width, height, data: stale },
                    vectorFill: fill,
                    referencePoint,
                    vectorMask: { paths: [], fillStartsWithAllPixels: true },
                  },
                ],
              };
              const encoded =
                depth === 8
                  ? writePsdWithPreciseStrokes(psd, { psb, noBackground: true })
                  : writeHighDepthPsd(psd, psb);
              const source = new Uint8Array(fixtures[d]);
              const input = restorePsdMetadata(new Uint8Array(encoded), {
                globalMask: new Uint8Array(),
                tags: [{ key: "Patt", data: source }],
              });
              const loaded = await openPsd(
                new Blob([input]),
                "Independent.psd",
                engine,
              );
              try {
                const l = loaded.document.layers[0],
                  tile = decodePsdPattern(indexPsdPatterns(source)[0]),
                  max = depth === 8 ? 255 : depth === 16 ? 65535 : 1;
                const initial = await raw(loaded.document, loaded.assets),
                  paint = await renderer.rawSourcePixels(l, loaded.assets);
                let paintError = 0;
                const anchor = {
                  x: phase.x + (align === false ? 0 : referencePoint.x),
                  y: phase.y + (align === false ? 0 : referencePoint.y),
                };
                for (let y = 0; y < height; y++)
                  for (let x = 0; x < width; x++) {
                    const tx =
                        ((Math.floor(x + 0.5 - anchor.x) % tile.width) +
                          tile.width) %
                        tile.width,
                      ty =
                        ((Math.floor(y + 0.5 - anchor.y) % tile.height) +
                          tile.height) %
                        tile.height;
                    for (let c = 0; c < 4; c++) {
                      const expected =
                        tile.data[(ty * tile.width + tx) * 4 + c] / max;
                      paintError = Math.max(
                        paintError,
                        Math.abs(
                          paint.data[(y * width + x) * 4 + c] -
                            (depth === 8
                              ? Math.round(expected * 255)
                              : expected),
                        ),
                      );
                    }
                  }
                const transparent = await renderer.pickCoverage(
                  loaded.document,
                  loaded.assets,
                  l,
                  [],
                  0.25,
                  0.25,
                );
                const index =
                  ((((Math.floor(0.5 - anchor.y) % tile.height) + tile.height) %
                    tile.height) *
                    tile.width +
                    (((Math.floor(0.5 - anchor.x) % tile.width) + tile.width) %
                      tile.width)) *
                    4 +
                  3;
                const pickExpected = tile.data[index] / max;
                const history = new History(loaded.document),
                  before = JSON.stringify(l.vector);
                history.execute("Offset", (doc) => {
                  doc.layers[0].vector.fill.phase.x += 1;
                });
                history.undo();
                const undoExact =
                  JSON.stringify(history.document.layers[0].vector) === before;
                l.vector.fill.phase.x += 1.25;
                l.vector.fill.phase.y -= 0.875;
                l.transform.x += 3;
                l.transform.y -= 2;
                const edited = await raw(loaded.document, loaded.assets);
                const saved = await deserialize(
                  await serialize(loaded.document, loaded.assets),
                );
                try {
                  const native = await raw(saved.document, saved.assets);
                  const exported = await savePsd(
                    saved.document,
                    (doc) => raw(doc, saved.assets),
                    undefined,
                    (id) => saved.assets.blob(id),
                  );
                  const bytes = new Uint8Array(await exported.arrayBuffer());
                  const decoded = readPsdWithPatternResources(bytes, {
                    useRawData: true,
                    skipCompositeImageData: true,
                    skipThumbnail: true,
                  });
                  const reopened = await openPsd(
                    exported,
                    "Reopened.psd",
                    engine,
                  );
                  try {
                    const after = await raw(reopened.document, reopened.assets);
                    checks.push({
                      depth,
                      psb,
                      align: align ?? "absent",
                      kind: l.kind,
                      noRaster: !l.asset,
                      noPreview: !loaded.document.psdOriginal,
                      notice: loaded.notice,
                      paintError,
                      pickError: Math.abs(transparent - pickExpected),
                      undoExact,
                      edited: !exact(initial, edited),
                      nativeExact: exact(edited, native),
                      roundTripExact: exact(edited, after),
                      resourceExact: exact(
                        decoded.patternResources[0].raw,
                        source,
                      ),
                      descriptorExact: same(decoded.children[0].vectorFill, {
                        ...fill,
                        phase: { x: phase.x + 1.25, y: phase.y - 0.875 },
                      }),
                      point: decoded.children[0].referencePoint,
                      reopenedKind: reopened.document.layers[0].kind,
                    });
                    if (align === undefined)
                      exports.push({
                        name: `${depth}-${psb ? "psb" : "psd"}.psd`,
                        bytes: Array.from(bytes),
                      });
                  } finally {
                    reopened.assets.clear();
                  }
                } finally {
                  saved.assets.clear();
                }
              } finally {
                loaded.assets.clear();
              }
            }
        return { checks, exports };
      } finally {
        renderer.dispose();
        engine.dispose();
      }
    }, fixtures);
    expect(result.checks).toHaveLength(18);
    for (const c of result.checks) {
      expect(c.kind).toBe("vector");
      expect(c.reopenedKind).toBe("vector");
      expect(c.notice).toBe("");
      expect(
        c.noRaster &&
          c.noPreview &&
          c.undoExact &&
          c.edited &&
          c.nativeExact &&
          c.roundTripExact &&
          c.resourceExact &&
          c.descriptorExact,
        JSON.stringify(c),
      ).toBe(true);
      expect(c.paintError).toBeLessThan(1e-7);
      expect(c.pickError).toBeLessThan(1 / 255 + 1e-7);
      expect(c.point).toEqual({ x: 5.75, y: -3.125 });
    }
    const directory = `/tmp/photo-editor-native-pattern-exports/${backend}`;
    await mkdir(directory, { recursive: true });
    for (const file of result.exports)
      await writeFile(`${directory}/${file.name}`, new Uint8Array(file.bytes));
  });
}

test("pattern properties retain fractional offsets and linking through undo", async ({
  page,
}) => {
  await boot(page, "default", "window.puter={};");
  const doc = newDocument(37, 29, "Pattern controls"),
    assets = new Assets();
  try {
    const resource = new Uint8Array(
      await readFile(
        new URL("../fixtures/psd-patterns/rgb-8-3.bin", import.meta.url),
      ),
    );
    const asset = await assets.add(
      new Blob(
        [
          encodePsdMetadata({
            globalMask: new Uint8Array(),
            tags: [{ key: "Patt", data: resource }],
          }),
        ],
        { type: psdMetadataMimeType },
      ),
    );
    const l = layer("vector", "Pattern", 37, 29);
    l.vector = {
      reference: { x: 0, y: 0, width: 37, height: 29 },
      fill: {
        type: "pattern",
        asset,
        id: "rgb-8-3",
        name: "Independent",
        phase: { x: -2.123456789012345, y: 1.137 },
      },
      mask: { paths: [], fillStartsWithAllPixels: true },
    };
    doc.layers = [l];
    const bundle = await serialize(doc, assets);
    await openFiles(page, {
      name: "Pattern.photo",
      mimeType: bundle.type,
      buffer: Buffer.from(await bundle.arrayBuffer()),
    });
    // Layer controls live in the docked Properties panel.
    const props = await panel(page, "Properties");
    await expect(page.locator("#layer-count")).toHaveText("1");
    const x = props.getByLabel("Pattern offset X (px)", { exact: true });
    await expect(x).toHaveValue("-2.123456789012345");
    await x.fill("3.987654321012345");
    // Commit by leaving the field (change on blur): committing with Enter keeps the
    // field focused and the vector Properties editor then shows stale values after
    // Undo (see the fixme in vector-patterns).
    await x.blur();
    await expect(x).toHaveValue("3.987654321012345");
    await undo(page);
    await expect(x).toHaveValue("-2.123456789012345");
    const linked = props.getByLabel("Link pattern to layer", { exact: true });
    await expect(linked).toBeChecked();
    await linked.uncheck();
    await expect(linked).not.toBeChecked();
    await undo(page);
    await expect(linked).toBeChecked();
    await props.getByLabel("Lock layer", { exact: true }).check();
    await expect(x).toBeDisabled();
    await expect(linked).toBeDisabled();
  } finally {
    assets.clear();
  }
});

test("keyboard Undo refreshes a focused pattern offset field", async ({ page }) => {
  await boot(page, "default", "window.puter={};");
  const doc = newDocument(37, 29, "Pattern focus"),
    assets = new Assets();
  try {
    const resource = new Uint8Array(await readFile(new URL("../fixtures/psd-patterns/rgb-8-3.bin", import.meta.url)));
    const asset = await assets.add(new Blob([encodePsdMetadata({ globalMask: new Uint8Array(), tags: [{ key: "Patt", data: resource }] })], { type: psdMetadataMimeType }));
    const l = layer("vector", "Pattern", 37, 29);
    l.vector = {
      reference: { x: 0, y: 0, width: 37, height: 29 },
      fill: { type: "pattern", asset, id: "rgb-8-3", name: "Independent", phase: { x: -2.5, y: 1 } },
      mask: { paths: [], fillStartsWithAllPixels: true },
    };
    doc.layers = [l];
    const bundle = await serialize(doc, assets);
    await openFiles(page, { name: "Pattern.photo", mimeType: bundle.type, buffer: Buffer.from(await bundle.arrayBuffer()) });
    const props = await panel(page, "Properties");
    const x = props.getByLabel("Pattern offset X (px)", { exact: true });
    await x.fill("4");
    await x.press("Enter");
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => page.evaluate(() => (window.photoStudio.layer?.vector?.fill as { phase?: { x: number } }).phase?.x)).toBe(-2.5);
    await expect(x).toHaveValue("-2.5");
  } finally {
    assets.clear();
  }
});
