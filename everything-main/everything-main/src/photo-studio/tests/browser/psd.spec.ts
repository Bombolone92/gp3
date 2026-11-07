import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'window.puter={};',
    }),
  );
  await page.goto('/');
  await expect(page.locator('#engine-status')).toHaveText(/WebGPU|WebGL2/);
});

for (const backend of ['default', 'WebGL'] as const) {
  test(`long pixel-mask parameters open with an explicit compatibility notice (${backend})`, async ({
    page,
  }) => {
    const fixtures = await Promise.all(
      ['8.psd', '16.psb', '32.psd'].map(async (name) => ({
        name,
        bytes: Array.from(
          await readFile(
            new URL(`../fixtures/psd-masks/${name}`, import.meta.url),
          ),
        ),
      })),
    );
    const results = await page.evaluate(
      async ({ backend, fixtures }) => {
        if (backend === 'WebGL')
          Object.defineProperty(navigator, 'gpu', {
            value: undefined,
            configurable: true,
          });
        const { openPsd } = await import('/src/model/psd.ts');
        const { Renderer } = await import('/src/renderer/renderer.ts');
        const { ImageEngine } = await import('/src/engine/engine.ts');
        const engine = new ImageEngine();
        const renderer = await Renderer.create(
          document.createElement('canvas'),
          engine,
        );
        try {
          const results = [];
          for (const fixture of fixtures) {
            const loaded = await openPsd(
              new Blob([new Uint8Array(fixture.bytes)]),
              fixture.name,
              engine,
            );
            try {
              await renderer.render(loaded.document, loaded.assets);
              const pixels = await renderer.displayPixels();
              results.push({
                notice: loaded.notice,
                depth: loaded.document.bitsPerChannel ?? 8,
                layers: loaded.document.layers.length,
                pixels: Array.from(pixels),
              });
            } finally {
              loaded.assets.clear();
            }
          }
          return results;
        } finally {
          renderer.dispose();
          engine.dispose();
        }
      },
      { backend, fixtures },
    );
    results.forEach((result, i) => {
      expect(result.notice).toContain('unsupported masks');
      expect(result.layers).toBe(1);
      expect(result.depth).toBe([8, 16, 32][i]);
      for (let at = 0; at < result.pixels.length; at += 4) {
        expect(result.pixels.slice(at, at + 3)).toEqual([0, 0, 0]);
        expect(result.pixels[at + 3]).toBe(255);
      }
    });
  });
  test(`PSD retains raster bounds, off-canvas content and hidden RGB on export (${backend})`, async ({
    page,
  }) => {
    const results = await page.evaluate(async (backend) => {
      if (backend === 'WebGL')
        Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
      const { openPsd, savePsd } = await import('/src/model/psd.ts');
      const { writePsd, readPsd } = await import('/tests/browser/psd-codec.ts');
      const { Renderer } = await import('/src/renderer/renderer.ts');
      const { ImageEngine } = await import('/src/engine/engine.ts');
      const results = [];
      const engine = new ImageEngine();
      const renderer = await Renderer.create(document.createElement('canvas'), engine);
      try {
        for (const [width, height, left, top, visible] of [
          [13, 4, -9, -2, true],
          [3, 7, 20, -12, false],
          [2, 4, 1, 1, true],
        ] as const) {
          const expected = [];
          for (let i = 0; i < width * height; i++)
            expected.push((i * 17) % 256, (i * 31) % 256, (i * 43) % 256, [255, 0, 1, 127][i % 4]);
          const imageData = { width, height, data: new Uint8ClampedArray(expected) };
          const group = {
            name: 'Group',
            blendMode: 'normal' as const,
            children: [
              {
                name: 'Pixels',
                imageData,
                left,
                top,
                hidden: !visible,
                opacity: 0.6,
                blendMode: 'screen' as const,
              },
            ],
          };
          const loaded = await openPsd(
            new Blob([
              writePsd({
                width: 8,
                height: 6,
                imageData: { width: 8, height: 6, data: new Uint8ClampedArray(8 * 6 * 4) },
                children: [group],
              }),
            ]),
            'Bounds.psd',
            engine,
          );
          try {
            await renderer.render(loaded.document, loaded.assets);
            const before = Array.from(await renderer.pixels());
            const output = await savePsd(
              loaded.document,
              async (doc) => {
                await renderer.render(doc, loaded.assets);
                return renderer.pixels();
              },
              (l) => renderer.sourcePixels(l, loaded.assets),
              (id) => loaded.assets.blob(id),
            );
            const decoded = readPsd(await output.arrayBuffer(), { useImageData: true });
            const saved = decoded.children![0].children![0];
            const reopened = await openPsd(output, 'Reopened.psd', engine);
            try {
              await renderer.render(reopened.document, reopened.assets);
              const after = Array.from(await renderer.pixels());
              // A move after reopening must reveal original pixels outside the canvas.
              const moved = reopened.document.layers[0].children[0];
              moved.visible = true;
              moved.opacity = 1;
              moved.blend = 'normal';
              moved.transform.x = 0;
              moved.transform.y = 0;
              await renderer.render({ ...reopened.document, layers: [moved] }, reopened.assets);
              const revealed = Array.from(await renderer.pixels());
              results.push({
                width,
                height,
                left,
                top,
                expected,
                pixels: Array.from(saved.imageData!.data),
                bounds: [saved.left, saved.top, saved.right, saved.bottom],
                before,
                after,
                revealed,
                hidden: saved.hidden,
                visible,
                opacity: saved.opacity,
                blend: saved.blendMode,
              });
            } finally {
              reopened.assets.clear();
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
    }, backend);
    for (const result of results) {
      expect(result.bounds).toEqual([
        result.left,
        result.top,
        result.left + result.width,
        result.top + result.height,
      ]);
      expect(result.pixels).toEqual(result.expected);
      expect(result.after).toEqual(result.before);
      expect(result.hidden).toBe(!result.visible);
      expect(result.opacity).toBeCloseTo(0.6, 2);
      expect(result.blend).toBe('screen');
      expect(result.revealed.some((v) => v !== 0)).toBe(true);
    }
  });
}

test('opaque ICC resources and intentional untagged state survive project and PSD round trips', async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const { openPsd, savePsd } = await import('/src/model/psd.ts');
    const { writePsd, readPsd } = await import('/tests/browser/psd-codec.ts');
    const { readPsdImageResource, replacePsdImageResource, decodeIccProfile } =
      await import('/src/model/psd-resources.ts');
    const { serialize, deserialize } = await import('/src/model/serialization.ts');
    const results = [];
    for (const [width, profileSize, untagged] of [
      [1, 129, false],
      [2, 258, true],
      [5, 4097, false],
    ] as const) {
      const imageData = { width, height: 2, data: new Uint8ClampedArray(width * 2 * 4).fill(255) };
      // Synthetic opaque bytes test preservation, not ICC color-transform support.
      const profile = Uint8Array.from({ length: profileSize }, (_, i) => i % 256);
      const encoded = writePsd({
        width,
        height: 2,
        imageData,
        children: [{ imageData }],
        imageResources: { iccUntaggedProfile: untagged },
      });
      const input = new Blob([replacePsdImageResource(new Uint8Array(encoded), 1039, profile)]);
      const loaded = await openPsd(input, 'Profile.psd');
      const project = await deserialize(await serialize(loaded.document, loaded.assets));
      try {
        const output = await savePsd(project.document, async () => new Uint8Array(imageData.data), undefined, (id) => project.assets.blob(id));
        const decoded = readPsd(await output.arrayBuffer(), { useImageData: true });
        results.push({
          expected: Array.from(profile),
          imported: Array.from(decodeIccProfile(loaded.document.iccProfile!)),
          project: Array.from(decodeIccProfile(project.document.iccProfile!)),
          exported: Array.from(
            readPsdImageResource(new Uint8Array(await output.arrayBuffer()), 1039)!,
          ),
          untagged,
          exportedUntagged: decoded.imageResources?.iccUntaggedProfile,
        });
      } finally {
        loaded.assets.clear();
        project.assets.clear();
      }
    }
    return results;
  });
  for (const result of results) {
    expect(result.imported).toEqual(result.expected);
    expect(result.project).toEqual(result.expected);
    expect(result.exported).toEqual(result.expected);
    expect(result.exportedUntagged).toBe(result.untagged);
  }
});

test('PSD raster imports preserve straight RGB at low and partial alpha on both GPU backends', async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const { openPsd } = await import('/src/model/psd.ts');
    const { writePsd } = await import('/tests/browser/psd-codec.ts');
    const { WebGLBackend } = await import('/src/renderer/webgl.ts');
    const { WebGPUBackend } = await import('/src/renderer/webgpu.ts');
    const expected = [];
    for (const alpha of [1, 2, 7, 17, 63, 127, 128, 191, 254, 255])
      expected.push(47, 113, 201, alpha, 9, 198, 251, alpha === 7 ? 0 : alpha, 217, 33, 86, alpha);
    const imageData = { width: 3, height: 10, data: new Uint8ClampedArray(expected) };
    const loaded = await openPsd(
      new Blob([
        writePsd({
          width: 3,
          height: 10,
          imageData,
          children: [{ name: 'Alpha', imageData }],
        }),
      ]),
      'Alpha.psd',
    );
    const backends = [new WebGLBackend(document.createElement('canvas'))];
    if (navigator.gpu) backends.push(await WebGPUBackend.create(document.createElement('canvas')));
    try {
      const results = [];
      const bitmap = loaded.assets.get(loaded.document.layers[0].asset!);
      for (const backend of backends) {
        const texture = backend.texture(bitmap.width, bitmap.height, bitmap);
        try {
          results.push({
            backend: backend.name,
            pixels: Array.from(await backend.read(texture)),
            expected,
          });
        } finally {
          backend.destroy(texture);
        }
      }
      return results;
    } finally {
      backends.forEach((backend) => backend.dispose());
      loaded.assets.clear();
    }
  });
  for (const result of results) expect(result.pixels, result.backend).toEqual(result.expected);
});

test('PSD resolution survives independent axes, units, native project saves and PSD export', async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const { openPsd, savePsd } = await import('/src/model/psd.ts');
    const { writePsd, readPsd } = await import('/tests/browser/psd-codec.ts');
    const { serialize, deserialize } = await import('/src/model/serialization.ts');
    const results = [];
    for (const [width, height, horizontalResolution, verticalResolution] of [
      [4, 3, 72, 72],
      [7, 2, 300, 144],
      [3, 8, 118.125, 236.0625],
    ]) {
      const resolutionInfo = {
        horizontalResolution,
        horizontalResolutionUnit: 'PPI' as const,
        widthUnit: 'Centimeters' as const,
        verticalResolution,
        verticalResolutionUnit: 'PPCM' as const,
        heightUnit: 'Points' as const,
      };
      const imageData = {
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4).fill(255),
      };
      const input = new Blob([
        writePsd({
          width,
          height,
          imageData,
          children: [{ name: 'Pixels', imageData }],
          imageResources: { resolutionInfo },
        }),
      ]);
      const loaded = await openPsd(input, 'Density.psd');
      const project = await deserialize(await serialize(loaded.document, loaded.assets));
      try {
        const output = await savePsd(project.document, async () => new Uint8Array(imageData.data), undefined, (id) => project.assets.blob(id));
        const decoded = readPsd(await output.arrayBuffer(), {
          useImageData: true,
        });
        results.push({
          expected: resolutionInfo,
          imported: loaded.document.resolution,
          project: project.document.resolution,
          exported: decoded.imageResources?.resolutionInfo,
        });
      } finally {
        loaded.assets.clear();
        project.assets.clear();
      }
    }
    return results;
  });
  for (const result of results) {
    expect(result.imported).toEqual(result.expected);
    expect(result.project).toEqual(result.expected);
    expect(result.exported).toEqual(result.expected);
  }
});
