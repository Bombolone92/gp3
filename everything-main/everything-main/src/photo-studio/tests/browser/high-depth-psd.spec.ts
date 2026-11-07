import { test, expect } from '@playwright/test';
import { boot, downloadFrom, menu, openFiles } from './helpers';
for (const backend of ['default', 'WebGL']) {
  test(`high-depth PSD and PSB retain native samples and editable layers through import/edit/export (${backend})`, async ({
    page,
  }) => {
    if (backend === 'WebGL')
      await page.addInitScript(() =>
        Object.defineProperty(navigator, 'gpu', { value: undefined }),
      );
    await page.route('https://js.puter.com/**', (r) =>
      r.fulfill({
        contentType: 'application/javascript',
        body: 'window.puter={};',
      }),
    );
    await page.goto('/');
    await expect(page.locator('#engine-status')).toHaveText(/WebGPU|WebGL2/);
    const results = await page.evaluate(async () => {
      const { writeHighDepthPsd } =
        await import('/src/model/psd-high-depth.ts');
      const { openPsd, savePsd } = await import('/src/model/psd.ts');
      const { Renderer } = await import('/src/renderer/renderer.ts');
      const { ImageEngine } = await import('/src/engine/engine.ts');
      const { serialize, deserialize } =
        await import('/src/model/serialization.ts');
      const { setVectorColor } = await import('/src/color/vector.ts');
      const { makeRgbProfile } = await import('/tests/color-fixtures.ts');
      const { linearSrgbProfile, srgbProfile } =
        await import('/src/color/profile.ts');
      const { replacePsdImageResource } =
        await import('/src/model/psd-resources.ts');
      const engine = new ImageEngine(),
        renderer = await Renderer.create(
          document.createElement('canvas'),
          engine,
        ),
        results = [];
      try {
        for (const depth of [16, 32] as const)
          for (const psb of [false, true])
            for (const [width, height] of [
              [17, 13],
              [31, 19],
            ]) {
              const sw = width + 4,
                sh = height + 2,
                data =
                  depth === 16
                    ? new Uint16Array(sw * sh * 4)
                    : new Float32Array(sw * sh * 4);
              for (let i = 0; i < sw * sh; i++) {
                data.set(
                  depth === 16
                    ? [
                        (i * 997) % 65536,
                        (i * 313) % 65536,
                        (i * 127) % 65536,
                        [0, 1, 32768, 65535][i % 4],
                      ]
                    : [
                        (i % 5) - 0.1234567,
                        0.1371234,
                        -0.0625,
                        [0, 1e-10, 0.625, 1][i % 4],
                      ],
                  i * 4,
                );
              }
              const points = [
                [2.25, 3.125],
                [width - 2.75, 3.125],
                [width - 2.75, height - 2.625],
                [2.25, height - 2.625],
              ];
              const vectorMask = {
                paths: [
                  {
                    operation: 'combine' as const,
                    open: false,
                    fillRule: 'even-odd' as const,
                    knots: points.map(([x, y]) => ({
                      linked: false,
                      points: [x, y, x, y, x, y],
                    })),
                  },
                ],
              };
              // Deliberately stale composite: editable layer records are authoritative.
              const composite = {
                width,
                height,
                data:
                  depth === 16
                    ? new Uint16Array(width * height * 4)
                    : new Float32Array(width * height * 4),
              };
              const encoded = writeHighDepthPsd(
                {
                  width,
                  height,
                  bitsPerChannel: depth,
                  imageData: composite,
                  children: [
                    {
                      name: 'Group',
                      blendMode: 'normal',
                      children: [
                        {
                          name: 'Typed source ź形',
                          left: -2,
                          top: -1,
                          imageData: { width: sw, height: sh, data },
                        },
                        {
                          name: 'Editable fill',
                          opacity: 0.6,
                          vectorMask,
                          vectorFill: {
                            type: 'color',
                            color: { r: 31.25, g: 135.125, b: 244.875 },
                          },
                        },
                      ],
                    },
                  ],
                },
                psb,
              );
              const profile = makeRgbProfile(
                width === 17 ? linearSrgbProfile : srgbProfile,
              );
              const loaded = await openPsd(
                new Blob([
                  replacePsdImageResource(
                    new Uint8Array(encoded),
                    1039,
                    profile,
                  ),
                ]),
                psb ? 'Input.psb' : 'Input.psd',
                engine,
              );
              let project, reopen;
              try {
                const group = loaded.document.layers[0],
                  source = group.children[0],
                  vector = group.children[1];
                const native = loaded.assets.raster(source.asset!)!;
                const exactSource = Array.from(native.data).every((v, i) =>
                  Object.is(v, data[i]),
                );
                const originalFill = structuredClone(vector.vector!.fill);
                await renderer.render(loaded.document, loaded.assets);
                const before = await renderer.rawPixels();
                const hasVisibleContent = Array.from(before).some(
                  (v, i) => i % 4 === 3 && v > 0,
                );
                source.transform.x = -1;
                vector.transform.rotation = 17;
                vector.transform.width *= 1.25;
                setVectorColor(vector, '#4ca83d');
                project = await deserialize(
                  await serialize(loaded.document, loaded.assets),
                );
                await renderer.render(project.document, project.assets);
                const edited = await renderer.rawPixels();
                const display = await renderer.displayPixels();
                const exported = await savePsd(
                  project.document,
                  async (snapshot) => {
                    await renderer.render(snapshot, project.assets);
                    return renderer.rawPixels();
                  },
                  (l) => renderer.rawSourcePixels(l, project.assets),
                  (id) => project.assets.blob(id),
                );
                reopen = await openPsd(exported, 'Reopened.psd', engine);
                await renderer.render(reopen.document, reopen.assets);
                const after = await renderer.rawPixels();
                const reopenedDisplay = await renderer.displayPixels();
                const maxError = edited.reduce(
                  (max, v, i) => Math.max(max, Math.abs(v - after[i])),
                  0,
                );
                const raster = reopen.document.layers[0].children[0],
                  shape = reopen.document.layers[0].children[1];
                const preserved = Array.from(
                  reopen.assets.raster(raster.asset!)!.data,
                ).every((v, i) => Object.is(v, data[i]));
                results.push({
                  depth,
                  psb,
                  width,
                  height,
                  notice: loaded.notice,
                  exactSource,
                  preserved,
                  hasVisibleContent,
                  maxError,
                  displayError: display.reduce(
                    (max, v, i) =>
                      Math.max(max, Math.abs(v - reopenedDisplay[i])),
                    0,
                  ),
                  profilePreserved:
                    reopen.document.iccProfile === loaded.document.iccProfile,
                  rasterX: raster.transform.x,
                  rasterY: raster.transform.y,
                  kind: shape.kind,
                  originalFill,
                  children: reopen.document.layers[0].children.map(
                    (l) => l.name,
                  ),
                  outputDepth: reopen.document.bitsPerChannel,
                });
              } finally {
                loaded.assets.clear();
                project?.assets.clear();
                reopen?.assets.clear();
              }
            }
      } finally {
        renderer.dispose();
        engine.dispose();
      }
      return results;
    });
    for (const r of results) {
      expect(r.notice).toBe('');
      expect(r.exactSource).toBe(true);
      expect(r.preserved).toBe(true);
      expect(r.hasVisibleContent).toBe(true);
      expect(r.maxError).toBeLessThanOrEqual(2e-6);
      expect(r.displayError).toBeLessThanOrEqual(1);
      expect(r.profilePreserved).toBe(true);
      expect(r.rasterX).toBe(-1);
      expect(r.rasterY).toBe(-1);
      expect(r.kind).toBe('vector');
      expect(r.children).toEqual(['Typed source ź形', 'Editable fill']);
      expect(r.outputDepth).toBe(r.depth);
      expect(r.originalFill.rgb).toEqual([
        31.25 / 255,
        135.125 / 255,
        244.875 / 255,
      ]);
    }
  });
}

test('HDR PSD file input and PSD download preserve depth and sample values', async ({
  page,
}) => {
  await boot(page, 'default', 'window.puter={};');
  const bytes = await page.evaluate(async () => {
    const { writeHighDepthPsd } = await import('/src/model/psd-high-depth.ts');
    const width = 9,
      height = 7,
      data = new Float32Array(width * height * 4);
    for (let i = 0; i < width * height; i++)
      data.set([-0.1234567, 3.125, 0.1371234, 1], i * 4);
    const imageData = { width, height, data };
    return Array.from(
      new Uint8Array(
        writeHighDepthPsd({
          width,
          height,
          bitsPerChannel: 32,
          imageData,
          children: [{ name: 'HDR source', imageData }],
        }),
      ),
    );
  });
  await openFiles(page, {
    name: 'HDR.psd',
    mimeType: 'image/vnd.adobe.photoshop',
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator('.document-mode')).toHaveText('(RGB/32)');
  await expect(page.locator('#layer-count')).toHaveText('1');
  const { bytes: output } = await downloadFrom(page, () => menu(page, 'File', 'Export', 'Export PSD'));
  const result = await page.evaluate(async (bytes) => {
    const { openPsd } = await import('/src/model/psd.ts');
    const loaded = await openPsd(
      new Blob([new Uint8Array(bytes)]),
      'Saved.psd',
    );
    try {
      const data = loaded.assets.raster(loaded.document.layers[0].asset!)!.data;
      return {
        depth: loaded.document.bitsPerChannel,
        sample: Array.from(data.slice(0, 4)),
      };
    } finally {
      loaded.assets.clear();
    }
  }, Array.from(output));
  expect(result.depth).toBe(32);
  expect(result.sample).toEqual([
    Math.fround(-0.1234567),
    3.125,
    Math.fround(0.1371234),
    1,
  ]);
});
