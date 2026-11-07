import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

for (const backend of ["default", "WebGL"] as const) {
  test(`RGB/32 small colors survive editing, isolated groups and PSD interchange (${backend})`, async ({
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
    const results = await page.evaluate(async () => {
      const { writeHighDepthPsd } =
        await import("/src/model/psd-high-depth.ts");
      const { openPsd, savePsd } = await import("/src/model/psd.ts");
      const { Renderer } = await import("/src/renderer/renderer.ts");
      const { ImageEngine } = await import("/src/engine/engine.ts");
      const { serialize, deserialize } =
        await import("/src/model/serialization.ts");
      const engine = new ImageEngine(),
        renderer = await Renderer.create(
          document.createElement("canvas"),
          engine,
        );
      const front = new Float32Array([
        1e-30, -4e-30, 2e-20, 1e-20, -2e-25, 3e-25, 1e-30, 5e-30,
      ]);
      const back = new Float32Array([
        3e-30, 2e-30, -1e-20, 2e-20, 3e-25, -4e-25, 2e-30, 2e-30,
      ]);
      const results = [];
      try {
        for (const [width, height] of [
          [3, 2],
          [5, 1],
        ])
          for (const psb of [false, true]) {
            const input = writeHighDepthPsd(
              {
                width,
                height,
                bitsPerChannel: 32,
                imageData: {
                  width,
                  height,
                  data: new Float32Array(width * height * 4),
                },
                children: [
                  {
                    name: "Isolation",
                    blendMode: "normal",
                    opacity: 0.75,
                    children: [
                      {
                        name: "Background",
                        id: 21,
                        left: 0,
                        top: 0,
                        imageData: { width: 2, height: 1, data: back },
                      },
                      {
                        name: "Foreground",
                        id: 22,
                        left: 0,
                        top: 0,
                        imageData: { width: 2, height: 1, data: front },
                      },
                    ],
                  },
                ],
              },
              psb,
            );
            const loaded = await openPsd(
              new Blob([input]),
              "Small colors.psd",
              engine,
            );
            let project, reopened;
            try {
              const group = loaded.document.layers[0],
                foreground = group.children[1];
              // Opacity is an 8-bit PSD field. Choose an exactly representable
              // stored code so the edit is unchanged by export quantization.
              foreground.opacity = Math.round(0.5 * 255) / 255;
              const source = Array.from(
                loaded.assets.raster(foreground.asset!)!.data,
              );
              await renderer.render(loaded.document, loaded.assets);
              const pixels = Array.from(await renderer.rawPixels());
              project = await deserialize(
                await serialize(loaded.document, loaded.assets),
              );
              await renderer.render(project.document, project.assets);
              const nativePixels = Array.from(await renderer.rawPixels());
              const output = await savePsd(
                project.document,
                async (snapshot) => {
                  await renderer.render(snapshot, project.assets);
                  return renderer.rawPixels();
                },
                (l) => renderer.rawSourcePixels(l, project.assets),
                (id) => project.assets.blob(id),
              );
              reopened = await openPsd(output, "Reopened.psd", engine);
              await renderer.render(reopened.document, reopened.assets);
              const reopenedGroup = reopened.document.layers[0],
                reopenedFront = reopenedGroup.children[1];
              results.push({
                width,
                height,
                psb,
                front: Array.from(front),
                back: Array.from(back),
                opacity: foreground.opacity,
                groupOpacity: group.opacity,
                pixels,
                nativePixels,
                reopenedPixels: Array.from(await renderer.rawPixels()),
                source,
                nativeSource: Array.from(
                  project.assets.raster(
                    project.document.layers[0].children[1].asset!,
                  )!.data,
                ),
                reopenedSource: Array.from(
                  reopened.assets.raster(reopenedFront.asset!)!.data,
                ),
                names: [
                  reopenedGroup.name,
                  ...reopenedGroup.children.map((l) => l.name),
                ],
                ids: reopenedGroup.children.map((l) => l.psdId),
                reopenedOpacity: reopenedFront.opacity,
                reopenedGroupOpacity: reopenedGroup.opacity,
                bytes: Array.from(new Uint8Array(await output.arrayBuffer())),
              });
            } finally {
              loaded.assets.clear();
              project?.assets.clear();
              reopened?.assets.clear();
            }
          }
      } finally {
        renderer.dispose();
        engine.dispose();
      }
      return results;
    });
    for (const r of results) {
      expect(r.source).toEqual(r.front);
      expect(r.nativeSource).toEqual(r.front);
      expect(r.reopenedSource).toEqual(r.front);
      expect(r.names).toEqual(["Isolation", "Background", "Foreground"]);
      expect(r.ids).toEqual([21, 22]);
      expect(r.reopenedOpacity).toBe(r.opacity);
      expect(r.reopenedGroupOpacity).toBe(r.groupOpacity);
      expect(r.nativePixels).toEqual(r.pixels);
      expect(r.reopenedPixels).toEqual(r.pixels);
      for (let p = 0; p < r.width * r.height; p++)
        for (let c = 0; c < 4; c++) {
          let expected = 0;
          if (p < 2) {
            const sa = r.front[p * 4 + 3] * r.opacity,
              ba = r.back[p * 4 + 3],
              alpha = sa + ba * (1 - sa);
            expected =
              c === 3
                ? alpha * r.groupOpacity
                : (r.front[p * 4 + c] * sa +
                    r.back[p * 4 + c] * ba * (1 - sa)) /
                  alpha;
          }
          expect(
            Math.abs(r.pixels[p * 4 + c] - expected),
            `${backend}/${r.width}/${r.psb} pixel ${p} channel ${c}`,
          ).toBeLessThanOrEqual(Math.max(1e-44, Math.abs(expected) * 0.000002));
        }
      if (process.env.PHOTO_EDITOR_SOURCE_OVER_EXPORTS) {
        const dir = path.resolve(process.env.PHOTO_EDITOR_SOURCE_OVER_EXPORTS);
        await mkdir(dir, { recursive: true });
        const name = `${backend}-${r.width}-${r.height}-${r.psb ? "psb" : "psd"}`;
        await writeFile(path.join(dir, `${name}.psd`), new Uint8Array(r.bytes));
        const { bytes, ...manifest } = r;
        await writeFile(
          path.join(dir, `${name}.json`),
          JSON.stringify(manifest, null, 2) + "\n",
        );
      }
    }
  });
}
