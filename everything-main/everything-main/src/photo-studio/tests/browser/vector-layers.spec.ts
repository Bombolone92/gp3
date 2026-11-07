import { test, expect } from "@playwright/test";
import { boot, type Backend } from "./helpers";

for (const backend of ["default", "WebGL"] as const) {
  test(`editable PSD color shapes ignore stale composites and survive transformed export (${backend})`, async ({
    page,
  }) => {
    await boot(page, backend as Backend, "window.puter={};");
    const result = await page.evaluate(async () => {
      const { writePsd, readPsd } = await import("/tests/browser/psd-codec.ts");
      const { openPsd, savePsd } = await import("/src/model/psd.ts");
      const { serialize, deserialize } =
        await import("/src/model/serialization.ts");
      const { Renderer } = await import("/src/renderer/renderer.ts");
      const { ImageEngine } = await import("/src/engine/engine.ts");
      const { transformedVectorMask } = await import("/src/model/vector.ts");
      const { setVectorColor } = await import("/src/color/vector.ts");
      const { History } = await import("/src/history/history.ts");
      const { hitLayer } = await import("/src/ui/hit-test.ts");
      const { layer } = await import("/src/model/document.ts");
      const engine = new ImageEngine(),
        renderer = await Renderer.create(
          document.createElement("canvas"),
          engine,
        );
      const results = [];
      try {
        for (const [width, height] of [
          [37, 29],
          [61, 43],
        ]) {
          const rectangle = (
            x: number,
            y: number,
            w: number,
            h: number,
            operation?: "combine",
          ) => ({
            open: false,
            operation,
            fillRule: "even-odd" as const,
            knots: [
              [x, y],
              [x + w, y],
              [x + w, y + h],
              [x, y + h],
            ].map(([a, b]) => ({ linked: false, points: [a, b, a, b, a, b] })),
          });
          const mask = {
            paths: [
              rectangle(2.25, 3.125, 17.5, 12.75, "combine"),
              rectangle(7.25, 6.125, 6.5, 4.75),
            ],
            fillStartsWithAllPixels: false,
          };
          const color = { r: 35.125, g: 148.875, b: 237.03125 };
          const psd = {
            width,
            height,
            imageData: {
              width,
              height,
              data: new Uint8ClampedArray(width * height * 4),
            },
            children: [
              {
                name: "Editable cubic shape",
                opacity: 0.625,
                blendMode: "normal" as const,
                vectorFill: { type: "color" as const, color },
                vectorMask: mask,
              },
            ],
          };
          const loaded = await openPsd(
            new Blob([writePsd(psd, { noBackground: true })]),
            "Independent.psd",
            engine,
          );
          try {
            const l = loaded.document.layers[0],
              original = structuredClone(l.vector!);
            await renderer.render(loaded.document, loaded.assets);
            const pixels = await renderer.pixels(),
              coverage = await engine.vectorMask(mask, {
                x: 0,
                y: 0,
                width,
                height,
              });
            let maximum = 0;
            for (let i = 0; i < width * height; i++) {
              maximum = Math.max(
                maximum,
                Math.abs(
                  pixels[i * 4 + 3] - Math.round(coverage.coverage[i] * 0.625),
                ),
              );
              if (pixels[i * 4 + 3])
                for (let c = 0; c < 3; c++)
                  maximum = Math.max(
                    maximum,
                    Math.abs(
                      pixels[i * 4 + c] -
                        Math.round([color.r, color.g, color.b][c]),
                    ),
                  );
            }
            const lower = layer("solid", "Under", width, height);
            loaded.document.layers.unshift(lower);
            const holeHit = hitLayer(loaded.document, loaded.assets, 9, 8)?.id;
            const bodyHit = hitLayer(loaded.document, loaded.assets, 4, 8)?.id;
            const history = new History(loaded.document);
            history.execute("Color", (doc) =>
              setVectorColor(doc.layers[1], "#40ab7c"),
            );
            history.undo();
            const undoExact =
              JSON.stringify(history.document.layers[1].vector) ===
              JSON.stringify(original);
            l.transform = {
              x: -3.5,
              y: 8.25,
              width: l.transform.width * 1.35,
              height: l.transform.height * 0.8,
              rotation: 31,
            };
            const expected = transformedVectorMask(l);
            const project = await deserialize(
              await serialize(loaded.document, loaded.assets),
            );
            try {
              const exported = await savePsd(
                project.document,
                async (doc) => {
                  await renderer.render(doc, project.assets);
                  return renderer.pixels();
                },
                undefined,
                (id) => project.assets.blob(id),
              );
              const decoded = readPsd(await exported.arrayBuffer(), {
                useImageData: true,
              });
              const reopen = await openPsd(exported, "Reopened.psd", engine);
              try {
                const output = decoded.children![1],
                  shape = reopen.document.layers[1];
                let coordinateError = 0;
                for (let p = 0; p < expected.paths.length; p++)
                  for (let k = 0; k < expected.paths[p].knots.length; k++)
                    for (let c = 0; c < 6; c++)
                      coordinateError = Math.max(
                        coordinateError,
                        Math.abs(
                          expected.paths[p].knots[k].points[c] -
                            output.vectorMask!.paths[p].knots[k].points[c],
                        ),
                      );
                await renderer.render(project.document, project.assets);
                const before = await renderer.pixels();
                await renderer.render(reopen.document, reopen.assets);
                const after = await renderer.pixels();
                const renderError = before.reduce(
                  (max, v, i) => Math.max(max, Math.abs(v - after[i])),
                  0,
                );
                results.push({
                  width,
                  height,
                  kind: l.kind,
                  asset: l.asset,
                  notice: loaded.notice,
                  maximum,
                  holeHit: holeHit === lower.id,
                  bodyHit: bodyHit === l.id,
                  undoExact,
                  nativeExact:
                    JSON.stringify(project.document.layers[1].vector) ===
                    JSON.stringify(original),
                  coordinateError,
                  renderError,
                  exportedEditable: !!output.vectorFill && !!output.vectorMask,
                  reopenedKind: shape.kind,
                  sourceFill: original.fill.rgb,
                  outputFill: shape.vector!.fill.rgb,
                });
              } finally {
                reopen.assets.clear();
              }
            } finally {
              project.assets.clear();
            }
          } finally {
            loaded.assets.clear();
          }
        }
      } finally {
        renderer.dispose();
        engine.dispose();
      }
      return results;
    });
    for (const r of result) {
      expect(r.kind).toBe("vector");
      expect(r.asset).toBeUndefined();
      expect(r.notice).toBe("");
      expect(r.maximum).toBeLessThanOrEqual(1);
      expect(r.holeHit).toBe(true);
      expect(r.bodyHit).toBe(true);
      expect(r.undoExact).toBe(true);
      expect(r.nativeExact).toBe(true);
      expect(r.coordinateError).toBeLessThanOrEqual(
        Math.max(r.width, r.height) / 0x1000000,
      );
      expect(r.renderError).toBeLessThanOrEqual(1);
      expect(r.exportedEditable).toBe(true);
      expect(r.reopenedKind).toBe("vector");
      for (let c = 0; c < 3; c++)
        expect(r.outputFill[c]).toBeCloseTo(r.sourceFill[c], 12);
    }
  });

  test(`native HDR vectors keep constant fill precision, project masks and rerasterize transforms (${backend})`, async ({
    page,
  }) => {
    await boot(page, backend as Backend, "window.puter={};");
    const result = await page.evaluate(async () => {
      const { layer, newDocument } = await import("/src/model/document.ts");
      const { Assets } = await import("/src/model/assets.ts");
      const { Renderer } = await import("/src/renderer/renderer.ts");
      const { ImageEngine } = await import("/src/engine/engine.ts");
      const { hitLayer } = await import("/src/ui/hit-test.ts");
      const doc = newDocument(40, 30);
      doc.bitsPerChannel = 32;
      const l = layer("vector", "HDR shape", 40, 30);
      l.vector = {
        reference: { x: 0, y: 0, width: 10, height: 6 },
        fill: { space: "document", rgb: [-0.1234567, 3.125, 0.1371234] },
        mask: {
          paths: [
            {
              open: false,
              operation: "combine",
              fillRule: "even-odd",
              knots: [
                [0, 0],
                [10, 0],
                [10, 6],
                [0, 6],
              ].map(([x, y]) => ({
                linked: false,
                points: [x, y, x, y, x, y],
              })),
            },
          ],
        },
      };
      l.transform = { x: 5, y: 2, width: 20, height: 12, rotation: 90 };
      const lower = layer("solid", "Below", 40, 30);
      lower.color = "#000000";
      doc.layers = [l];
      const assets = new Assets(),
        engine = new ImageEngine(),
        renderer = await Renderer.create(
          document.createElement("canvas"),
          engine,
        );
      try {
        await renderer.render(doc, assets);
        const data = await renderer.rawPixels(),
          rgb = Array.from(
            data.slice((8 * 40 + 15) * 4, (8 * 40 + 15) * 4 + 4),
          );
        const entry = (renderer as any).sources.get(l.id),
          firstTexture = entry.texture;
        const format = firstTexture.format,
          dimensions = [firstTexture.width, firstTexture.height];
        l.vector.fill.rgb = [0.125, 0.5, 2.875];
        await renderer.render(doc, assets);
        const colorReusesCoverage =
          (renderer as any).sources.get(l.id).texture === firstTexture;
        l.maskStrokes = [
          {
            points: [[20, 15]],
            size: 8,
            softness: 0,
            opacity: 1,
            restore: false,
          },
        ];
        doc.layers = [lower, l];
        await renderer.render(doc, assets);
        const masked = await renderer.rawPixels();
        const hole = Array.from(
          masked.slice((8 * 40 + 15) * 4, (8 * 40 + 15) * 4 + 4),
        );
        const holeHit = hitLayer(doc, assets, 15.5, 8.5)?.id === lower.id;
        const bodyHit = hitLayer(doc, assets, 18.5, 8.5)?.id === l.id;
        l.maskInverted = true;
        await renderer.render(doc, assets);
        const inverse = await renderer.rawPixels();
        const inverseCenter = Array.from(
          inverse.slice((8 * 40 + 15) * 4, (8 * 40 + 15) * 4 + 4),
        );
        l.maskDisabled = true;
        await renderer.render(doc, assets);
        const disabled = await renderer.rawPixels();
        const disabledEdge = Array.from(
          disabled.slice((8 * 40 + 18) * 4, (8 * 40 + 18) * 4 + 4),
        );
        delete l.maskStrokes;
        delete l.maskInverted;
        delete l.maskDisabled;
        l.transform.width = 7.5;
        l.transform.height = 4.5;
        l.transform.rotation = 0;
        await renderer.render(doc, assets);
        const resized = (renderer as any).sources.get(l.id);
        const source = await renderer.rawSourcePixels(l, assets);
        l.transform = {
          x: 5.25,
          y: 3.375,
          width: 0.001,
          height: 0.002,
          rotation: 0,
        };
        doc.layers = [l];
        await renderer.render(doc, assets);
        const tiny = (await renderer.rawPixels())[(3 * 40 + 5) * 4 + 3];
        return {
          rgb,
          format,
          dimensions,
          colorReusesCoverage,
          hole,
          holeHit,
          bodyHit,
          inverseCenter,
          disabledEdge,
          tiny,
          rerasterized: resized.texture !== firstTexture,
          sourceFloat: source.data instanceof Float32Array,
          sourceViewport: source.viewport,
          sourceGeometry: l.vector.mask.paths[0].knots[1].points,
        };
      } finally {
        renderer.dispose();
        assets.clear();
        engine.dispose();
      }
    });
    expect(result.rgb[0]).toBeCloseTo(-0.1234567, 6);
    expect(result.rgb[1]).toBe(3.125);
    expect(result.rgb[2]).toBeCloseTo(0.1371234, 6);
    expect(result.rgb[3]).toBe(1);
    expect(result.format).toBe("r32float");
    expect(result.dimensions[0]).toBeLessThan(40);
    expect(result.dimensions[1]).toBeLessThan(30);
    expect(result.colorReusesCoverage).toBe(true);
    expect(result.hole).toEqual([0, 0, 0, 1]);
    expect(result.holeHit).toBe(true);
    expect(result.bodyHit).toBe(true);
    expect(result.inverseCenter).toEqual([0.125, 0.5, 2.875, 1]);
    expect(result.disabledEdge).toEqual([0.125, 0.5, 2.875, 1]);
    expect(result.rerasterized).toBe(true);
    expect(result.sourceFloat).toBe(true);
    expect(result.sourceViewport).toBeDefined();
    expect(result.sourceGeometry).toEqual([10, 0, 10, 0, 10, 0]);
    expect(result.tiny).toBeCloseTo(0.000002, 9);
  });
}
