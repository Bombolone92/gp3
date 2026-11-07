import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://js.puter.com/**', (r) =>
    r.fulfill({ contentType: 'application/javascript', body: 'window.puter={};' }),
  );
  await page.goto('/');
  await expect(page.locator('#engine-status')).toHaveText(/WebGPU|WebGL2/);
});

test('tagged documents blend in document space, convert new sRGB colors, and preserve raw PSD sources on export', async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const { Renderer } = await import('/src/renderer/renderer.ts');
    const { ImageEngine } = await import('/src/engine/engine.ts');
    const { openPsd, savePsd } = await import('/src/model/psd.ts');
    const { writePsd, readPsd } = await import('/tests/browser/psd-codec.ts');
    const { makeRgbProfile } = await import('/tests/color-fixtures.ts');
    const { layer } = await import('/src/model/document.ts');
    const { colorTransform, convertRgb, readRgbProfile, srgbProfile, linearSrgbProfile } =
      await import('/src/color/profile.ts');
    const { readPsdImageResource, replacePsdImageResource } =
      await import('/src/model/psd-resources.ts');
    const { serialize, deserialize } = await import('/src/model/serialization.ts');
    const results = [];
    const originalGpu = navigator.gpu;
    const engine = new ImageEngine();
    try {
      for (const forceGl of [false, true]) {
        Object.defineProperty(navigator, 'gpu', {
          value: forceGl ? undefined : originalGpu,
          configurable: true,
        });
        const renderer = await Renderer.create(document.createElement('canvas'), engine);
        for (const [width, height] of [
          [3, 2],
          [7, 5],
        ]) {
          const profileBytes = makeRgbProfile({
            matrix: linearSrgbProfile.matrix,
            curves: linearSrgbProfile.curves,
          });
          const profile = readRgbProfile(profileBytes),
            toSrgb = colorTransform(profile, srgbProfile),
            fromSrgb = colorTransform(srgbProfile, profile);
          const data = new Uint8ClampedArray(width * height * 4);
          for (let i = 0; i < data.length; i += 4) data.set([64, 128, 192, 255], i);
          const encoded = writePsd(
            {
              width,
              height,
              imageData: { width, height, data },
              children: [{ name: 'Source', imageData: { width, height, data } }],
            },
            { noBackground: true },
          );
          const loaded = await openPsd(
            new Blob([replacePsdImageResource(new Uint8Array(encoded), 1039, profileBytes)]),
            'Linear.psd',
            engine,
          );
          let reopened: Awaited<ReturnType<typeof openPsd>> | undefined;
          const project = await deserialize(await serialize(loaded.document, loaded.assets));
          try {
            await renderer.render(project.document, project.assets);
            const rawBefore = Array.from(await renderer.pixels()),
              displayBefore = Array.from(await renderer.displayPixels());
            const rawSource = Array.from(
              (await renderer.sourcePixels(project.document.layers[0], project.assets)).data,
            );
            const expectedDisplay = data.map((_, i) =>
              i % 4 === 3
                ? 255
                : Math.round(convertRgb(toSrgb, [64 / 255, 128 / 255, 192 / 255])[i % 4] * 255),
            );
            // Editable UI colors start in sRGB. Convert once before a non-normal
            // blend with the document-space background.
            const edited = layer('solid', 'Edited fill', width, height);
            edited.color = '#804020';
            edited.opacity = 128 / 255;
            edited.blend = 'multiply';
            project.document.layers.push(edited);
            await renderer.render(project.document, project.assets);
            const rawEdited = Array.from(await renderer.pixels()),
              displayEdited = Array.from(await renderer.displayPixels());
            const source = convertRgb(fromSrgb, [128 / 255, 64 / 255, 32 / 255]).map(
              (n) => Math.round(Math.max(0, Math.min(1, n)) * 255) / 255,
            );
            const expectedRaw = [64, 128, 192].map((b, c) =>
              Math.round(b * (1 - edited.opacity + edited.opacity * source[c])),
            );
            const output = await savePsd(
              project.document,
              async (d) => {
                await renderer.render(d, project.assets);
                return renderer.pixels();
              },
              (l) => renderer.sourcePixels(l, project.assets),
              (id) => project.assets.blob(id),
            );
            const decoded = readPsd(await output.arrayBuffer(), { useImageData: true });
            reopened = await openPsd(output, 'Reopened.psd', engine);
            await renderer.render(reopened.document, reopened.assets);
            const displayReopened = Array.from(await renderer.displayPixels());
            // Profile changes at the same document dimensions invalidate both
            // source conversions and the display transform.
            const changed = { ...project.document, iccProfile: undefined };
            await renderer.render(changed, project.assets);
            results.push({
              backend: renderer.name,
              width,
              height,
              rawBefore,
              rawSource,
              expectedRawBefore: Array.from(data),
              displayBefore,
              expectedDisplay: Array.from(expectedDisplay),
              rawEdited,
              expectedRaw,
              displayEdited,
              displayReopened,
              exportedSource: Array.from(decoded.children![0].imageData!.data),
              profilePreserved: Array.from(
                readPsdImageResource(new Uint8Array(await output.arrayBuffer()), 1039)!,
              ),
              expectedProfile: Array.from(profileBytes),
              untaggedPixels: Array.from(await renderer.displayPixels()),
            });
          } finally {
            reopened?.assets.clear();
            project.assets.clear();
            loaded.assets.clear();
          }
        }
        renderer.dispose();
      }
    } finally {
      Object.defineProperty(navigator, 'gpu', { value: originalGpu, configurable: true });
      engine.dispose();
    }
    return results;
  });
  for (const result of results) {
    expect(result.rawBefore).toEqual(result.expectedRawBefore);
    expect(result.rawSource).toEqual(result.expectedRawBefore);
    expect(result.exportedSource).toEqual(result.expectedRawBefore);
    expect(result.profilePreserved).toEqual(result.expectedProfile);
    for (let i = 0; i < result.displayBefore.length; i++) {
      expect(
        Math.abs(result.displayBefore[i] - result.expectedDisplay[i]),
        result.backend,
      ).toBeLessThanOrEqual(1);
      if (i % 4 < 3)
        expect(
          Math.abs(result.rawEdited[i] - result.expectedRaw[i % 4]),
          result.backend,
        ).toBeLessThanOrEqual(1);
      expect(result.displayReopened[i], result.backend).toBe(result.displayEdited[i]);
    }
    expect(result.untaggedPixels).not.toEqual(result.displayEdited);
  }
});

test('GPU ICC matrix/TRC conversion preserves alpha, HDR and exact table interpolation in both directions', async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const { WebGLBackend } = await import('/src/renderer/webgl.ts');
    const { WebGPUBackend } = await import('/src/renderer/webgpu.ts');
    const {
      colorTransform,
      convertRgb,
      readRgbProfile,
      packColorTransform,
      srgbProfile,
      linearSrgbProfile,
    } = await import('/src/color/profile.ts');
    const { makeRgbProfile } = await import('/tests/color-fixtures.ts');
    const backends: import('../../src/renderer/backend').Backend[] = [
      new WebGLBackend(document.createElement('canvas')),
    ];
    if (navigator.gpu) backends.push(await WebGPUBackend.create(document.createElement('canvas')));
    const curves: import('../../src/color/profile').Curve[] = [
      { kind: 'parametric', type: 0, parameters: [1] },
      { kind: 'parametric', type: 0, parameters: [2] },
      { kind: 'parametric', type: 1, parameters: [2, 1, -0.25] },
      { kind: 'parametric', type: 2, parameters: [2, 1, -0.25, 0.125] },
      { kind: 'parametric', type: 3, parameters: [2, 1, 0, 0.25, 0.25] },
      { kind: 'parametric', type: 4, parameters: [2, 1, 0, 0.25, 0.25, 0.0625, 0.03125] },
      { kind: 'table', values: [0, 0.1, 0.3, 0.65, 1] },
      { kind: 'table', values: Array.from({ length: 8193 }, (_, i) => (i / 8192) ** 2) },
    ];
    const results = [];
    try {
      for (const backend of backends)
        for (const [index, curve] of curves.entries()) {
          const matrix =
            index % 2
              ? srgbProfile.matrix.map((v, i) => v * [1, 0.9, 1.1][i % 3])
              : srgbProfile.matrix;
          const profile = readRgbProfile(makeRgbProfile({ matrix, curves: [curve, curve, curve] }));
          for (const inverse of [false, true])
            for (const [width, height] of [
              [1, 1],
              [7, 3],
            ]) {
              const transform = colorTransform(
                inverse ? srgbProfile : profile,
                inverse ? profile : srgbProfile,
              );
              const packed = packColorTransform(transform, 128);
              const parameters = backend.floatTexture(packed.width, packed.height, packed.data);
              const pixels = new Float32Array(width * height * 4);
              for (let i = 0; i < width * height; i++)
                pixels.set(
                  [0.003 + i / 30, 0.17 + i / 40, 0.73 - i / 50, [0, 0.125, 1][i % 3]],
                  i * 4,
                );
              const source = backend.floatTexture(width, height, pixels),
                target = backend.floatTexture(width, height);
              try {
                backend.colorPass(source, parameters, target);
                const expected = Array.from(pixels);
                for (let i = 0; i < pixels.length; i += 4)
                  expected.splice(
                    i,
                    3,
                    ...convertRgb(transform, Array.from(pixels.subarray(i, i + 3))),
                  );
                results.push({
                  backend: backend.name,
                  index,
                  inverse,
                  width,
                  height,
                  expected,
                  actual: Array.from(await backend.readFloat(target)),
                });
              } finally {
                [parameters, source, target].forEach((t) => backend.destroy(t));
              }
            }
        }
      for (const backend of backends) {
        const packed = packColorTransform(colorTransform(linearSrgbProfile, srgbProfile), 128);
        const parameters = backend.floatTexture(packed.width, packed.height, packed.data);
        const values = new Float32Array([-0.125, 0.18, 4.5, 1e-9, 0.25, 0.5, 0.75, 0]);
        const source = backend.floatTexture(2, 1, values),
          target = backend.floatTexture(2, 1),
          byte = backend.texture(2, 1);
        try {
          backend.colorPass(source, parameters, target);
          backend.colorPass(source, parameters, byte);
          const expected = Array.from(values).map((x, i) =>
            i % 4 === 3
              ? x
              : Math.sign(x) *
                (Math.abs(x) <= 0.0031308
                  ? Math.abs(x) * 12.92
                  : 1.055 * Math.abs(x) ** (1 / 2.4) - 0.055),
          );
          results.push({
            backend: backend.name,
            index: 'HDR',
            expected,
            actual: Array.from(await backend.readFloat(target)),
          });
          results.push({
            backend: backend.name,
            index: 'byte',
            expected: expected.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255)),
            actual: Array.from(await backend.read(byte)),
          });
        } finally {
          [parameters, source, target, byte].forEach((t) => backend.destroy(t));
        }
      }
    } finally {
      backends.forEach((b) => b.dispose());
    }
    return results;
  });
  for (const result of results)
    for (let i = 0; i < result.expected.length; i++) {
      if (result.index === 'byte' || i % 4 === 3)
        expect(result.actual[i], `${result.backend} ${result.index} alpha/value ${i}`).toBe(
          result.expected[i],
        );
      else
        expect(result.actual[i], `${result.backend} curve ${result.index} ${i}`).toBeCloseTo(
          result.expected[i],
          5,
        );
    }
});
