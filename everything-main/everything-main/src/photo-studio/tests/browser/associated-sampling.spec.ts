import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Backend } from "../../src/renderer/backend";

test.beforeEach(async ({ page }) => {
  await page.route("https://js.puter.com/**", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "window.puter={};",
    }),
  );
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveText(/WebGPU|WebGL2/);
});

test("resampling excludes hidden RGB and weights partially transparent colors by coverage", async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const { WebGLBackend } = await import("/src/renderer/webgl.ts");
    const { WebGPUBackend } = await import("/src/renderer/webgpu.ts");
    const { layer } = await import("/src/model/document.ts");
    const { uniforms } = await import("/src/renderer/renderer.ts");
    const backends: Backend[] = [
      new WebGLBackend(document.createElement("canvas")),
    ];
    if (navigator.gpu)
      backends.push(
        await WebGPUBackend.create(document.createElement("canvas")),
      );
    const results = [];
    try {
      for (const backend of backends)
        for (const floating of [false, true]) {
          for (const samples of [
            [1, 0, 0, 1, 0, 1, 1, 0],
            [0.8, 0.2, 0.4, 1, 0.2, 0.8, 0.6, 0.2],
            [0.3, 0.7, 0.9, 0, 0.9, 0.1, 0.5, 0],
            ...(floating
              ? [
                  [-2, 4, 0.125, 0.25, 6, -1, 3, 0.75],
                  [1e30, -1e30, 0.5, 1e-30, 6e30, 1e30, 3, 5e-30],
                ]
              : []),
          ]) {
            const input = floating
              ? new Float32Array(samples)
              : new Uint8Array(samples.map((v) => Math.round(v * 255)));
            const source = floating
              ? backend.floatTexture(2, 1, input as Float32Array)
              : backend.texture(2, 1, input as Uint8Array);
            const target = floating
              ? backend.floatTexture(1, 1)
              : backend.texture(1, 1);
            const empty = floating
              ? backend.floatTexture(1, 1)
              : backend.texture(1, 1);
            const white = backend.texture(
              1,
              1,
              new Uint8Array([255, 255, 255, 255]),
            );
            const l = layer("image", "Scaled", 2, 1);
            l.transform.width = 1;
            backend.clear(empty);
            try {
              const read = async () =>
                Array.from(
                  floating
                    ? await backend.readFloat(target)
                    : await backend.read(target),
                );
              const u = uniforms(l, 1, 1, 2, 1);
              backend.pass(empty, source, white, u, target);
              const composed = await read();
              u[31] = 1; // The screen/offscreen copy path also resamples RGBA.
              backend.pass(empty, source, white, u, target);
              results.push({
                backend: backend.name,
                floating,
                input: Array.from(input),
                composed,
                copied: await read(),
              });
            } finally {
              [source, target, empty, white].forEach((t) => backend.destroy(t));
            }
          }
        }
    } finally {
      backends.forEach((b) => b.dispose());
    }
    return results;
  });
  for (const r of results) {
    const alpha = (r.input[3] + r.input[7]) / 2;
    const close = (actual: number, expected: number, label = "") => {
      if (r.floating)
        expect(Math.abs(actual - expected), label).toBeLessThanOrEqual(
          Math.max(0.000001, Math.abs(expected) * 0.000002),
        );
      // UNORM targets round at half a code value; ties can go either way.
      else
        expect(Math.abs(actual - expected), label).toBeLessThanOrEqual(0.5001);
    };
    // Independent area average of premultiplied pixel contributions; alpha is
    // an average of coverage, not a second color interpolation weight.
    for (let c = 0; c < 3; c++) {
      const expected =
        alpha > 0
          ? (r.input[c] * r.input[3] + r.input[c + 4] * r.input[7]) /
            (2 * alpha)
          : (r.input[c] + r.input[c + 4]) / 2;
      close(r.copied[c], expected, `${r.backend} copy component ${c}`);
      if (alpha > 0)
        close(r.composed[c], expected, `${r.backend} source component ${c}`);
    }
    if (r.floating) {
      for (const actual of [r.copied[3], r.composed[3]])
        expect(Math.abs(actual - alpha)).toBeLessThanOrEqual(
          Math.max(1e-37, alpha * 0.000001),
        );
    } else {
      close(r.copied[3], alpha);
      close(r.composed[3], alpha);
    }
  }
});

test("queued float source-over retains small colors independently of coverage", async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const { WebGLBackend } = await import("/src/renderer/webgl.ts");
    const { WebGPUBackend } = await import("/src/renderer/webgpu.ts");
    const { layer, blends } = await import("/src/model/document.ts");
    const { uniforms } = await import("/src/renderer/renderer.ts");
    // The oracle below covers these separable modes; the shader takes the
    // mode's index in the (since extended) blend list.
    const oracleModes = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "difference"] as const;
    const backends: Backend[] = [
      new WebGLBackend(document.createElement("canvas")),
    ];
    if (navigator.gpu)
      backends.push(
        await WebGPUBackend.create(document.createElement("canvas")),
      );
    const results = [];
    try {
      for (const backend of backends) {
        const pending = [];
        const white = backend.texture(
          1,
          1,
          new Uint8Array([255, 255, 255, 255]),
        );
        try {
          for (const [front, back] of [
            [
              [1e-30, -4e-30, 2e-20, 1e-20],
              [0, 0, 0, 0],
            ],
            [
              [-1e-25, 2e-25, 3e-30, 1e-30],
              [3e-25, -4e-25, 2e-30, 2e-30],
            ],
            [
              [1e30, -1e30, 1e-30, 5e-30],
              [-1e20, 2e20, 3e-30, 3e-30],
            ],
          ])
            for (const resampled of [false, true])
              for (const mode of Math.abs(front[0]) > 1
                ? [0]
                : [0, 1, 2, 3, 4, 5, 6]) {
                const input = new Float32Array(front),
                  backdrop = new Float32Array(back);
                const source = resampled
                  ? backend.floatTexture(
                      2,
                      1,
                      new Float32Array([...input, 6, -7, 8, 0]),
                    )
                  : backend.floatTexture(1, 1, input);
                const background = backend.floatTexture(1, 1, backdrop);
                const target = backend.floatTexture(1, 1);
                const copy = backend.floatTexture(1, 1);
                const u = uniforms(
                  layer("image", "Small color", 1, 1),
                  1,
                  1,
                  resampled ? 2 : 1,
                  1,
                );
                u[11] = blends.indexOf(oracleModes[mode]);
                backend.pass(background, source, white, u, target);
                // Queue another draw using the same CPU uniform array, then a
                // short copy pass, without waiting for the first GPU draw.
                u[10] = 0.25;
                const faded = backend.floatTexture(1, 1);
                backend.pass(background, source, white, u, faded);
                const short = new Float32Array(32);
                short[31] = 1;
                backend.pass(background, target, white, short, copy);
                // A full-length masked draw followed by a short ordinary draw must
                // not carry mask parameters over to the later draw.
                u[44] = 1;
                u[45] = 1;
                const masked = backend.floatTexture(1, 1),
                  unmasked = backend.floatTexture(1, 1);
                backend.pass(background, source, white, u, masked);
                backend.pass(
                  background,
                  source,
                  white,
                  u.slice(0, 32),
                  unmasked,
                );
                if (resampled) input[3] *= 0.5;
                pending.push({
                  input,
                  backdrop,
                  mode,
                  target,
                  faded,
                  copy,
                  unmasked,
                  textures: [
                    source,
                    background,
                    target,
                    faded,
                    copy,
                    masked,
                    unmasked,
                  ],
                });
              }
          for (const p of pending)
            results.push({
              backend: backend.name,
              mode: p.mode,
              input: Array.from(p.input),
              back: Array.from(p.backdrop),
              composed: Array.from(await backend.readFloat(p.target)),
              faded: Array.from(await backend.readFloat(p.faded)),
              copied: Array.from(await backend.readFloat(p.copy)),
              unmasked: Array.from(await backend.readFloat(p.unmasked)),
            });
        } finally {
          pending.forEach((p) => p.textures.forEach((t) => backend.destroy(t)));
          backend.destroy(white);
        }
      }
    } finally {
      backends.forEach((b) => b.dispose());
    }
    return results;
  });
  for (const r of results) {
    for (const [pixels, opacity] of [
      [r.composed, 1],
      [r.copied, 1],
      [r.faded, 0.25],
      [r.unmasked, 0.25],
    ] as const) {
      const sa = r.input[3] * opacity,
        ba = r.back[3];
      const alpha = sa + ba * (1 - sa);
      for (let c = 0; c < 4; c++) {
        // Double-precision premultiplied contributions provide an independent
        // oracle even where their products underflow in float GPU arithmetic.
        const s = r.input[c],
          b = r.back[c];
        const blend =
          r.mode === 1
            ? s * b
            : r.mode === 2
              ? 1 - (1 - s) * (1 - b)
              : r.mode === 3
                ? b < 0.5
                  ? 2 * b * s
                  : 1 - 2 * (1 - b) * (1 - s)
                : r.mode === 4
                  ? Math.min(s, b)
                  : r.mode === 5
                    ? Math.max(s, b)
                    : r.mode === 6
                      ? Math.abs(s - b)
                      : s;
        const expected =
          c === 3
            ? alpha
            : (s * sa * (1 - ba) + blend * sa * ba + b * ba * (1 - sa)) / alpha;
        expect(
          Math.abs(pixels[c] - expected),
          `${r.backend}/${r.mode}/${opacity} channel ${c}`,
        ).toBeLessThanOrEqual(Math.max(1e-44, Math.abs(expected) * 0.000002));
      }
    }
  }
});

for (const backend of ["default", "WebGL"] as const) {
  test(`transformed PSD sources retain correct coverage through native and PSD saves (${backend})`, async ({
    page,
  }) => {
    const results = await page.evaluate(
      async ({ backend, exportBytes }) => {
        if (backend === "WebGL")
          Object.defineProperty(navigator, "gpu", {
            value: undefined,
            configurable: true,
          });
        const { writePsdWithPreciseStrokes } =
          await import("/src/model/psd-stroke-writer.ts");
        const { writeHighDepthPsd } =
          await import("/src/model/psd-high-depth.ts");
        const { openPsd, savePsd } = await import("/src/model/psd.ts");
        const { Renderer } = await import("/src/renderer/renderer.ts");
        const { ImageEngine } = await import("/src/engine/engine.ts");
        const { serialize, deserialize } =
          await import("/src/model/serialization.ts");
        const engine = new ImageEngine();
        const renderer = await Renderer.create(
          document.createElement("canvas"),
          engine,
        );
        const results = [];
        try {
          for (const depth of [8, 16, 32] as const)
            for (const psb of [false, true]) {
              const normalized = [
                depth === 32 ? -2 : 1,
                depth === 32 ? 4 : 0,
                0.125,
                1,
                1,
                1,
                1,
                0,
                0.3,
                0.7,
                depth === 32 ? 3 : 0.9,
                0.2,
                0.9,
                0.1,
                0.5,
                0.7,
              ];
              const source =
                depth === 8
                  ? new Uint8ClampedArray(
                      normalized.map((v) => Math.round(v * 255)),
                    )
                  : depth === 16
                    ? new Uint16Array(
                        normalized.map((v) => Math.round(v * 65535)),
                      )
                    : new Float32Array(normalized);
              const composite =
                depth === 8
                  ? new Uint8ClampedArray(5 * 4 * 4)
                  : depth === 16
                    ? new Uint16Array(5 * 4 * 4)
                    : new Float32Array(5 * 4 * 4);
              const psd = {
                width: 5,
                height: 4,
                bitsPerChannel: depth,
                imageData: { width: 5, height: 4, data: composite },
                children: [
                  {
                    name: "Isolated group",
                    opacity: 0.75,
                    blendMode: "normal" as const,
                    children: [
                      {
                        name: "Editable source",
                        left: 0,
                        top: 0,
                        imageData: { width: 2, height: 2, data: source },
                      },
                    ],
                  },
                ],
              };
              const encoded =
                depth === 8
                  ? writePsdWithPreciseStrokes(psd, { psb, noBackground: true })
                  : writeHighDepthPsd(psd, psb);
              const loaded = await openPsd(
                new Blob([encoded]),
                "Independent source.psd",
                engine,
              );
              let project: Awaited<ReturnType<typeof deserialize>> | undefined;
              let reopened: Awaited<ReturnType<typeof openPsd>> | undefined;
              try {
                const l = loaded.document.layers[0].children[0];
                for (const rotation of [0, 27]) {
                  l.transform = {
                    x: -0.25,
                    y: 0.375,
                    width: 3.5,
                    height: 2.5,
                    rotation,
                  };
                  l.mask = { x: 0, y: 0, width: 2, height: 3 };
                  await renderer.render(loaded.document, loaded.assets);
                  const before = await renderer.rawPixels();
                  const rawSource = await renderer.rawSourcePixels(
                    l,
                    loaded.assets,
                  );
                  project = await deserialize(
                    await serialize(loaded.document, loaded.assets),
                  );
                  await renderer.render(project.document, project.assets);
                  const native = await renderer.rawPixels();
                  const nativeSource = await renderer.rawSourcePixels(
                    project.document.layers[0].children[0],
                    project.assets,
                  );
                  const output = await savePsd(
                    project.document,
                    async (snapshot) => {
                      await renderer.render(snapshot, project!.assets);
                      return renderer.rawPixels();
                    },
                    (layer) => renderer.rawSourcePixels(layer, project!.assets),
                    (id) => project!.assets.blob(id),
                  );
                  reopened = await openPsd(output, "Reopen.psd", engine);
                  await renderer.render(reopened.document, reopened.assets);
                  results.push({
                    encoded: exportBytes
                      ? Array.from(new Uint8Array(await output.arrayBuffer()))
                      : undefined,
                    backend: renderer.name,
                    depth,
                    psb,
                    rotation,
                    opacity: loaded.document.layers[0].opacity,
                    notice: loaded.notice,
                    source: Array.from(source),
                    uploaded: Array.from(rawSource.data),
                    nativeSource: Array.from(nativeSource.data),
                    transform: l.transform,
                    pixels: Array.from(before),
                    native: Array.from(native),
                    reopened: Array.from(await renderer.rawPixels()),
                    hierarchy: [
                      reopened.document.layers[0].kind,
                      reopened.document.layers[0].children[0].kind,
                    ],
                  });
                  project.assets.clear();
                  project = undefined;
                  reopened.assets.clear();
                  reopened = undefined;
                }
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
      },
      { backend, exportBytes: !!process.env.PHOTO_EDITOR_SAMPLING_EXPORTS },
    );
    if (process.env.PHOTO_EDITOR_SAMPLING_EXPORTS) {
      const directory = path.resolve(process.env.PHOTO_EDITOR_SAMPLING_EXPORTS);
      await mkdir(directory, { recursive: true });
      for (const r of results) {
        const name = `${backend}-${r.depth}-${r.psb ? "psb" : "psd"}-${r.rotation}`;
        await writeFile(
          path.join(directory, name + ".psd"),
          new Uint8Array(r.encoded!),
        );
        const { encoded: _, ...manifest } = r;
        await writeFile(
          path.join(directory, name + ".json"),
          JSON.stringify(manifest),
        );
      }
    }
    for (const r of results) {
      expect(r.notice).toBe("");
      expect(r.hierarchy).toEqual(["group", "image"]);
      expect(r.native).toEqual(r.pixels);
      expect(r.nativeSource).toEqual(r.uploaded);
      const sourceUnit = r.depth === 8 ? 255 : r.depth === 16 ? 65535 : 1;
      const outputUnit = r.depth === 8 ? 255 : 1;
      r.uploaded.forEach((v, i) =>
        expect(v).toBe(
          r.depth === 16 ? Math.fround(r.source[i] / sourceUnit) : r.source[i],
        ),
      );
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 5; x++) {
          const t = r.transform,
            a = (t.rotation * Math.PI) / 180;
          const dx = x + 0.5 - t.x - t.width / 2,
            dy = y + 0.5 - t.y - t.height / 2;
          const u = (dx * Math.cos(a) + dy * Math.sin(a)) / t.width + 0.5;
          const v = (-dx * Math.sin(a) + dy * Math.cos(a)) / t.height + 0.5;
          const sx = u * 2 - 0.5,
            sy = v * 2 - 0.5,
            ix = Math.floor(sx),
            iy = Math.floor(sy);
          const fx = sx - ix,
            fy = sy - iy;
          const taps = [
            [ix, iy, (1 - fx) * (1 - fy)],
            [ix + 1, iy, fx * (1 - fy)],
            [ix, iy + 1, (1 - fx) * fy],
            [ix + 1, iy + 1, fx * fy],
          ];
          const sums = [0, 0, 0, 0];
          for (const [tx, ty, w] of taps) {
            const at =
              (Math.max(0, Math.min(1, ty)) * 2 +
                Math.max(0, Math.min(1, tx))) *
              4;
            const alpha = r.source[at + 3] / sourceUnit;
            sums[3] += alpha * w;
            for (let c = 0; c < 3; c++)
              sums[c] += (r.source[at + c] / sourceUnit) * alpha * w;
          }
          const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1 && x < 2 && y < 3;
          const alpha = inside ? sums[3] * r.opacity : 0;
          const at = (y * 5 + x) * 4;
          expect(
            Math.abs(r.pixels[at + 3] / outputUnit - alpha),
            `${r.backend}/${r.depth}/${r.rotation} (${x},${y}) alpha`,
          ).toBeLessThan(r.depth === 8 ? 1 / 255 : 0.000001);
          if (alpha > 0)
            for (let c = 0; c < 3; c++) {
              expect(
                Math.abs(r.pixels[at + c] / outputUnit - sums[c] / sums[3]),
                `${r.backend}/${r.depth}/${r.rotation} (${x},${y}) RGB ${c}`,
              ).toBeLessThan(r.depth === 8 ? 1 / 255 : 0.000002);
            }
          for (let c = 0; c < 4; c++)
            expect(
              Math.abs(r.reopened[at + c] - r.pixels[at + c]),
            ).toBeLessThanOrEqual(
              r.depth === 8 ? 1 : r.depth === 16 ? 2 / 65535 : 0.000002,
            );
        }
    }
  });
}
