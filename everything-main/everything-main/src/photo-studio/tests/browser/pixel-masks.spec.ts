import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { boot, canvasClick, downloadFrom, historyLabels, idle, openProject, panel, redo, run, tool, undo } from "./helpers";
import { layer, newDocument } from "../../src/model/document";

test.beforeEach(async ({ page }) => {
  await page.route("https://js.puter.com/**", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.puter={};",
    }),
  );
});
for (const fallback of [false, true]) {
  test(`native masks match scalar coverage, preserve precision and compose brush edits (${fallback ? "WebGL" : "WebGPU"})`, async ({
    page,
  }) => {
    if (fallback)
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "gpu", { value: undefined }),
      );
    await page.goto("/");
    await expect(page.locator("#engine-status")).toHaveText(
      fallback ? "WebGL2" : /WebGPU|WebGL2/,
    );
    const result = await page.evaluate(async () => {
      const { Assets } = await import("/src/model/assets.ts");
      const { layer, newDocument } = await import("/src/model/document.ts");
      const { identityMaskMatrix, sourceMatrix, setPixelMaskLinked } =
        await import("/src/model/pixel-mask.ts");
      const { Renderer } = await import("/src/renderer/renderer.ts");
      const { ImageEngine } = await import("/src/engine/engine.ts");
      const { savePsd, openPsd } = await import("/src/model/psd.ts");
      const { serialize, deserialize } =
        await import("/src/model/serialization.ts");
      const { readPsdWithPixelMasks } =
        await import("/src/model/psd-mask-codec.ts");
      const { getLayerMaskImageData } =
        await import("/tests/browser/psd-codec.ts");
      const assets = new Assets(),
        engine = new ImageEngine(),
        renderer = await Renderer.create(
          document.createElement("canvas"),
          engine,
        );
      const reports = [];
      try {
        for (const depth of [8, 16, 32] as const) {
          const doc = newDocument(8, 6),
            l = layer("vector", "Masked pixels", 8, 6);
          l.vector = {
            mask: { paths: [], fillStartsWithAllPixels: true },
            reference: { x: 0, y: 0, width: 8, height: 6 },
            fill: { rgb: [18 / 255, 52 / 255, 86 / 255], space: "document" },
          };
          if (depth !== 8) doc.bitsPerChannel = depth;
          l.color = "#123456";
          doc.layers = [l];
          const codes =
            depth === 8
              ? new Uint8Array([0, 1, 127, 255, 201, 77])
              : depth === 16
                ? new Uint16Array([0, 1, 32769, 65535, 52341, 19789])
                : new Float32Array([
                    0, 1e-14, 0.12345679, 1, 0.799321, 0.304567,
                  ]);
          const asset = await assets.addCoverage({
            width: 2,
            height: 3,
            data: codes,
          });
          l.pixelMask = {
            asset,
            bounds: { x: 2, y: 1, width: 2, height: 3 },
            reference: { ...l.transform },
            matrix: identityMaskMatrix(),
            defaultColor: 255,
            positionRelativeToLayer: false,
            fromVectorData: false,
          };
          const max = depth === 8 ? 255 : depth === 16 ? 65535 : 1;
          let error = 0,
            pickError = 0;
          for (const matrix of [
            [1, 0, 0, 1, 0, 0],
            [1, 0, 0, 1, 0.25, 0.5],
            [0, 1, -1, 0, 6, 0],
            [1, 0.2, 0.3, 1, -1, 0],
          ] as [number, number, number, number, number, number][]) {
            l.pixelMask.matrix = matrix;
            for (const [background, density, inverted, disabled] of [
              [0, 1, false, false],
              [255, 0.4, false, false],
              [255, 1, true, false],
              [0, 0, false, false],
              [0, 1, false, true],
            ] as const) {
              l.pixelMask.defaultColor = background;
              l.pixelMask.userMaskDensity = density;
              l.maskInverted = inverted;
              l.maskDisabled = disabled;
              await renderer.render(doc, assets);
              const data = await renderer.rawPixels();
              for (let y = 0; y < 6; y++)
                for (let x = 0; x < 8; x++) {
                  // Independent scalar oracle; do not call production mask sampling.
                  const d = matrix[0] * matrix[3] - matrix[1] * matrix[2],
                    wx = x + 0.5 - matrix[4],
                    wy = y + 0.5 - matrix[5];
                  const sx = (matrix[3] * wx - matrix[2] * wy) / d - 2 - 0.5,
                    sy = (-matrix[1] * wx + matrix[0] * wy) / d - 1 - 0.5;
                  const bx = Math.floor(sx),
                    by = Math.floor(sy),
                    fx = sx - bx,
                    fy = sy - by;
                  const tap = (xx: number, yy: number) =>
                    xx >= 0 && xx < 2 && yy >= 0 && yy < 3
                      ? codes[yy * 2 + xx] / max
                      : background / 255;
                  let value =
                    (tap(bx, by) * (1 - fx) + tap(bx + 1, by) * fx) * (1 - fy) +
                    (tap(bx, by + 1) * (1 - fx) + tap(bx + 1, by + 1) * fx) *
                      fy;
                  if (inverted) value = 1 - value;
                  const expected = disabled ? 1 : 1 - density + density * value;
                  error = Math.max(
                    error,
                    Math.abs(
                      data[(y * 8 + x) * 4 + 3] /
                        (data instanceof Float32Array ? 1 : 255) -
                        expected,
                    ),
                  );
                }
              const picked = await renderer.pickCoverage(
                doc,
                assets,
                l,
                [],
                2.5,
                1.5,
              );
              const current = await renderer.rawPixels();
              pickError = Math.max(
                pickError,
                Math.abs(
                  picked -
                    current[(1 * 8 + 2) * 4 + 3] /
                      (current instanceof Float32Array ? 1 : 255),
                ),
              );
            }
          }
          l.pixelMask.matrix = identityMaskMatrix();
          l.pixelMask.defaultColor = 255;
          l.pixelMask.userMaskDensity = 1;
          l.maskInverted = false;
          l.maskDisabled = false;
          await renderer.render(doc, assets);
          const precise = (await renderer.rawPixels())[(1 * 8 + 3) * 4 + 3];
          // Paint is applied to raw coverage before inversion and density.
          l.maskStrokes = [
            {
              matrix: sourceMatrix(l.transform, 8, 6),
              points: [[2.5, 1.5]],
              size: 2,
              softness: 0,
              opacity: 0.5,
              restore: true,
            },
          ];
          l.pixelMask.userMaskDensity = 0.4;
          await renderer.render(doc, assets);
          const painted = Array.from(await renderer.rawPixels());
          const native = await deserialize(await serialize(doc, assets));
          await renderer.render(native.document, native.assets);
          const nativePixels = Array.from(await renderer.rawPixels());
          native.assets.clear();
          const output = await savePsd(
            doc,
            async (d) => {
              await renderer.render(d, assets);
              return renderer.rawPixels();
            },
            (l) => renderer.rawSourcePixels(l, assets),
            (id) => assets.blob(id),
          );
          const decoded = readPsdWithPixelMasks(
            new Uint8Array(await output.arrayBuffer()),
            { useImageData: true, useRawData: depth > 8 },
          );
          const exportedMask = (decoded.children![0].mask?.imageData ??
            getLayerMaskImageData(decoded.children![0]))!;
          const reopened = await openPsd(output, "Painted.psd", engine);
          await renderer.render(reopened.document, reopened.assets);
          const reopenedPixels = Array.from(await renderer.rawPixels());
          let roundtripError = 0;
          painted.forEach((v, i) => {
            roundtripError = Math.max(
              roundtripError,
              Math.abs(v - reopenedPixels[i]),
            );
          });
          reports.push({
            depth,
            error,
            pickError,
            precise,
            expectedPrecise: Math.fround(codes[1] / max),
            paintedAlpha:
              painted[(1 * 8 + 2) * 4 + 3] / (depth === 8 ? 255 : 1),
            nativePixels,
            painted,
            roundtripError,
            kind: reopened.document.layers[0].kind,
            notice: reopened.notice,
            mask: !!reopened.document.layers[0].pixelMask,
            maskDimensions: [exportedMask.width, exportedMask.height],
          });
          reopened.assets.clear();
          const group = layer("group", "Masked group", 8, 6);
          group.children = [l];
          group.opacity = 0.8;
          group.pixelMask = {
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            reference: { ...group.transform },
            matrix: identityMaskMatrix(),
            defaultColor: 0,
            positionRelativeToLayer: false,
            fromVectorData: false,
            userMaskDensity: 0.4,
          };
          doc.layers = [group];
          await renderer.render(doc, assets);
          const grouped = await renderer.rawPixels();
          const expectedGroup =
            (painted[(1 * 8 + 2) * 4 + 3] / (depth === 8 ? 255 : 1)) *
            0.8 *
            0.6;
          const groupAlpha =
            grouped[(1 * 8 + 2) * 4 + 3] / (depth === 8 ? 255 : 1);
          const groupPick = await renderer.pickCoverage(
            doc,
            assets,
            l,
            [group],
            2.5,
            1.5,
          );
          reports[reports.length - 1].groupError = Math.max(
            Math.abs(groupAlpha - expectedGroup),
            Math.abs(groupAlpha - groupPick),
          );
          const groupedOutput = await savePsd(
            doc,
            async (d) => {
              await renderer.render(d, assets);
              return renderer.rawPixels();
            },
            (l) => renderer.rawSourcePixels(l, assets),
            (id) => assets.blob(id),
          );
          const groupedReopen = await openPsd(
            groupedOutput,
            "Group mask.psd",
            engine,
          );
          await renderer.render(groupedReopen.document, groupedReopen.assets);
          reports[reports.length - 1].groupKind =
            groupedReopen.document.layers[0].kind;
          const groupedAfter = await renderer.rawPixels();
          let groupRoundtripError = 0;
          grouped.forEach((v, i) => {
            groupRoundtripError = Math.max(
              groupRoundtripError,
              Math.abs(v - groupedAfter[i]),
            );
          });
          reports[reports.length - 1].groupRoundtripError = groupRoundtripError;
          groupedReopen.assets.clear();
          doc.layers = [l];
          await renderer.render(doc, assets);
          const cache = (
            renderer as unknown as {
              sources: Map<string, { texture: { handle: unknown } }>;
            }
          ).sources;
          const planeBefore = cache.get(`pixel-mask:${l.id}`)!.texture.handle;
          l.pixelMask.userMaskDensity = 0.2;
          await renderer.render(doc, assets);
          const planeAfter = cache.get(`pixel-mask:${l.id}`)!.texture.handle;
          const brushBefore = cache.get(`mask:${l.id}`)!.texture.handle;
          l.pixelMask.matrix[4] += 0.25;
          await renderer.render(doc, assets);
          const brushAfter = cache.get(`mask:${l.id}`)!.texture.handle;
          setPixelMaskLinked(l, false);
          const unlinked = Array.from(await renderer.rawPixels());
          l.transform.x += 1;
          await renderer.render(doc, assets);
          reports[reports.length - 1].planeReused = planeBefore === planeAfter;
          reports[reports.length - 1].brushUpdated = brushBefore !== brushAfter;
          reports[reports.length - 1].unlinkedPixels = Array.from(
            await renderer.rawPixels(),
          );
          reports[reports.length - 1].unlinked = unlinked;
          l.maskStrokes = undefined;
          l.pixelMask.userMaskDensity = 0.4;
          l.pixelMask.matrix = [1, 0.2, 0.3, 1, -1, 0];
          await renderer.render(doc, assets);
          const transformedBefore = await renderer.rawPixels();
          reports[reports.length-1].brushReleased=!cache.has(`mask:${l.id}`);
          const transformedOutput = await savePsd(
            doc,
            async (d) => {
              await renderer.render(d, assets);
              return renderer.rawPixels();
            },
            (l) => renderer.rawSourcePixels(l, assets),
            (id) => assets.blob(id),
          );
          const transformedReopen = await openPsd(
            transformedOutput,
            "Transformed mask.psd",
            engine,
          );
          await renderer.render(
            transformedReopen.document,
            transformedReopen.assets,
          );
          const transformedAfter = await renderer.rawPixels();
          let transformedError = 0;
          transformedBefore.forEach((v, i) => {
            transformedError = Math.max(
              transformedError,
              Math.abs(v - transformedAfter[i]),
            );
          });
          reports[reports.length - 1].transformedError = transformedError;
          transformedReopen.assets.clear();
        }
      } finally {
        renderer.dispose();
        engine.dispose();
        assets.clear();
      }
      return reports;
    });
    for (const r of result) {
      expect(r.error).toBeLessThan(r.depth === 8 ? 1 / 255 : 2e-6);
      expect(r.pickError).toBeLessThan(r.depth === 8 ? 1 / 255 : 2e-6);
      expect(r.precise / (r.depth === 8 ? 255 : 1)).toBeCloseTo(
        r.expectedPrecise,
        r.depth === 8 ? 3 : 16,
      );
      expect(r.paintedAlpha).toBeCloseTo(
        0.6 + 0.4 * (128 / 255),
        r.depth === 8 ? 2 : 5,
      );
      expect(r.nativePixels).toEqual(r.painted);
      expect(r.roundtripError).toBeLessThanOrEqual(
        r.depth === 8 ? 1 : r.depth === 16 ? 2e-5 : 2e-6,
      );
      expect(r.kind).toBe("vector");
      expect(r.groupError).toBeLessThanOrEqual(r.depth === 8 ? 2 / 255 : 2e-6);
      expect(r.groupKind).toBe("group");
      expect(r.groupRoundtripError).toBeLessThanOrEqual(
        r.depth === 8 ? 1 : r.depth === 16 ? 2e-5 : 2e-6,
      );
      expect(r.transformedError).toBeLessThanOrEqual(
        r.depth === 8 ? 1 : r.depth === 16 ? 2e-5 : 2e-6,
      );
      expect(r.planeReused).toBe(true);
      expect(r.brushUpdated).toBe(true);
      expect(r.brushReleased).toBe(true);
      expect(r.unlinkedPixels).toEqual(r.unlinked);
      expect(r.mask).toBe(true);
      expect(r.notice).toBe("");
    }
  });
  test(`independent PSD/PSB masks retain editable hierarchy, native planes and state (${fallback ? "WebGL" : "WebGPU"})`, async ({
    page,
  }) => {
    if (fallback)
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "gpu", { value: undefined }),
      );
    await page.goto("/");
    await expect(page.locator("#engine-status")).toHaveText(/WebGPU|WebGL2/);
    const fixtures = await Promise.all(
      ["primary-8.psd", "primary-16.psb", "primary-32.psd"].map(
        async (name) => ({
          name,
          bytes: Array.from(
            await readFile(
              new URL(`../fixtures/psd-masks/${name}`, import.meta.url),
            ),
          ),
        }),
      ),
    );
    const results = await page.evaluate(async (fixtures) => {
      const { openPsd, savePsd } = await import("/src/model/psd.ts");
      const { Renderer } = await import("/src/renderer/renderer.ts");
      const { ImageEngine } = await import("/src/engine/engine.ts");
      const { serialize, deserialize } =
        await import("/src/model/serialization.ts");
      const { readPsdWithPixelMasks } =
        await import("/src/model/psd-mask-codec.ts");
      const { getLayerMaskImageData } =
        await import("/tests/browser/psd-codec.ts");
      const engine = new ImageEngine(),
        renderer = await Renderer.create(
          document.createElement("canvas"),
          engine,
        ),
        results = [];
      try {
        for (const f of fixtures) {
          const loaded = await openPsd(
              new Blob([new Uint8Array(f.bytes)]),
              f.name,
              engine,
            ),
            l = loaded.document.layers[0].children[0];
          try {
            const mask = l.pixelMask!,
              samples = loaded.assets.coverage(mask.asset!),
              beforeBytes = Array.from(new Uint8Array(samples.data.buffer));
            await renderer.render(loaded.document, loaded.assets);
            const before = Array.from(await renderer.rawPixels());
            const native = await deserialize(
              await serialize(loaded.document, loaded.assets),
            );
            const nativeBytes = Array.from(
              new Uint8Array(
                native.assets.coverage(
                  native.document.layers[0].children[0].pixelMask!.asset!,
                ).data.buffer,
              ),
            );
            native.assets.clear();
            const output = await savePsd(
              loaded.document,
              async (d) => {
                await renderer.render(d, loaded.assets);
                return renderer.rawPixels();
              },
              (l) => renderer.rawSourcePixels(l, loaded.assets),
              (id) => loaded.assets.blob(id),
            );
            const decoded = readPsdWithPixelMasks(
                new Uint8Array(await output.arrayBuffer()),
                {
                  useImageData: true,
                  useRawData: (loaded.document.bitsPerChannel ?? 8) > 8,
                },
              ),
              saved = decoded.children![0].children![0];
            const pd = (saved.mask?.imageData ?? getLayerMaskImageData(saved))!,
              red = pd.data.filter((_, i) => i % 4 === 0);
            const afterBytes = Array.from(new Uint8Array(red.buffer));
            const reopened = await openPsd(output, "Reopened.psd", engine);
            await renderer.render(reopened.document, reopened.assets);
            const after = Array.from(await renderer.rawPixels());
            const edited = reopened.document.layers[0].children[0];
            edited.transform.x += 2;
            await renderer.render(reopened.document, reopened.assets);
            const maskAfterMove = edited.pixelMask!.bounds;
            results.push({
              name: f.name,
              notice: loaded.notice,
              kind: l.kind,
              group: loaded.document.layers[0].kind,
              beforeBytes,
              nativeBytes,
              afterBytes,
              before,
              after,
              mask: { ...mask, asset: undefined },
              saved: { ...saved.mask, imageData: undefined },
              maskAfterMove,
            });
            reopened.assets.clear();
          } finally {
            loaded.assets.clear();
          }
        }
      } finally {
        renderer.dispose();
        engine.dispose();
      }
      return results;
    }, fixtures);
    for (const r of results) {
      expect(r.notice).toBe("");
      expect(r.kind).toBe("image");
      expect(r.group).toBe("group");
      expect(r.nativeBytes).toEqual(r.beforeBytes);
      expect(r.afterBytes).toEqual(r.beforeBytes);
      expect(r.after).toEqual(r.before);
      expect(r.saved).toMatchObject({
        left: 2,
        top: 0,
        right: 4,
        bottom: 3,
        defaultColor: 255,
        positionRelativeToLayer: true,
        inverted: true,
        flags: 0x95,
        userMaskDensity: 102 / 255,
        userMaskFeather: 0,
        vectorMaskDensity: 1,
        vectorMaskFeather: 0,
      });
      expect(r.maskAfterMove).toEqual({ x: 2, y: 0, width: 2, height: 3 });
      expect(r.before.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
    }
  });
  test(`pixel mask density, linking, painting and undo controls (${fallback ? "WebGL" : "WebGPU"})`, async ({
    page,
  }) => {
    await boot(page, fallback ? "WebGL" : "WebGPU", "window.puter={};");
    const doc = newDocument(160, 120, "Mask controls"),
      l = layer("solid", "Mask target", 160, 120);
    l.color = "#ff0000";
    l.pixelMask = {
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      reference: { ...l.transform },
      matrix: [1, 0, 0, 1, 0, 0],
      defaultColor: 0,
      positionRelativeToLayer: false,
      fromVectorData: false,
    };
    doc.layers = [l];
    await openProject(page, doc, [], "Mask.photo");
    await expect(page.locator("#layer-count")).toHaveText("1");
    const properties = await panel(page, "Properties");
    const alpha = async () => {
      const { bytes } = await downloadFrom(page, () => run(page, "file.quick-export-png"));
      return page.evaluate(async (bytes) => {
        const b = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        const c = new OffscreenCanvas(b.width, b.height).getContext("2d")!;
        c.drawImage(b, 0, 0);
        b.close();
        return c.getImageData(80, 60, 1, 1).data[3];
      }, Array.from(bytes));
    };
    const density = properties.getByRole("spinbutton", { name: "Mask density (%)" });
    expect(await alpha()).toBe(0);
    await density.fill("50");
    await density.press("Tab");
    await idle(page);
    expect(await alpha()).toBe(128);
    await undo(page);
    expect(await alpha()).toBe(0);
    await redo(page);
    expect(await alpha()).toBe(128);
    await properties.getByLabel("Link mask to layer").uncheck();
    await idle(page);
    expect(await alpha()).toBe(128);
    await page
      .getByRole("button", { name: "Edit mask for Mask target" })
      .click();
    // Painting a native PSD mask first converts it to an editable mask grid
    // (its own undo step), then the ordinary brush paints white to reveal.
    await tool(page, "Brush Tool");
    await page.evaluate(() => window.photoStudio.setForeground("#ffffff"));
    await canvasClick(page, 80, 60);
    await expect.poll(() => historyLabels(page)).toEqual(expect.arrayContaining(["Convert layer mask", "Brush Tool"]));
    await idle(page);
    expect(await alpha()).toBe(255);
    await undo(page);
    await undo(page);
    expect(await page.evaluate(() => !!window.photoStudio.layer?.pixelMask)).toBe(true);
    expect(await alpha()).toBe(128);
    await panel(page, "Properties");
    await properties.getByRole("button", { name: "Invert", exact: true }).click();
    await idle(page);
    expect(await alpha()).toBe(255);
    await properties
      .getByRole("button", { name: "Remove mask", exact: true })
      .click();
    await idle(page);
    expect(await alpha()).toBe(255);
    await expect(density).toHaveCount(0);
  });
}
