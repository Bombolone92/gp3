import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: 'window.puter={};' }),
  );
  await page.goto('/');
  await expect(page.locator('#engine-status')).toHaveText(/WebGPU|WebGL2/);
});

test('native high-depth sources feed float GPU textures and alpha picking without bitmap conversion', async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const { Assets } = await import('/src/model/assets.ts');
    const { floatRaster } = await import('/src/model/raster.ts');
    const { serialize, deserialize } = await import('/src/model/serialization.ts');
    const { hitLayer } = await import('/src/ui/hit-test.ts');
    const { layer, newDocument } = await import('/src/model/document.ts');
    const { WebGLBackend } = await import('/src/renderer/webgl.ts');
    const { WebGPUBackend } = await import('/src/renderer/webgpu.ts');
    const backends: import('../../src/renderer/backend').Backend[] = [
      new WebGLBackend(document.createElement('canvas')),
    ];
    if (navigator.gpu) backends.push(await WebGPUBackend.create(document.createElement('canvas')));
    const results = [];
    try {
      for (const depth of [16, 32]) {
        const doc = newDocument(3, 2),
          assets = new Assets();
        const background = layer('solid', 'Underneath', 3, 2);
        const image = layer('image', 'High depth', 3, 2);
        const values = [0, 0.009, 0.011, 0.5, 0, 1];
        const data = depth === 16 ? new Uint16Array(24) : new Float32Array(24);
        for (let i = 0; i < 6; i++) {
          if (depth === 16) data.set([1, 32768, 65534, Math.round(values[i] * 65535)], i * 4);
          else data.set([-1.000123, 4.125, 0.1234567, values[i]], i * 4);
        }
        const id = await assets.addRaster({ width: 3, height: 2, data });
        image.asset = id;
        doc.layers = [background, image];
        const restored = await deserialize(await serialize(doc, assets));
        try {
          const pixels = restored.assets.raster(id)!;
          const expected = Array.from(floatRaster(pixels));
          const hits = [];
          for (let y = 0; y < 2; y++)
            for (let x = 0; x < 3; x++)
              hits.push(hitLayer(restored.document, restored.assets, x + 0.5, y + 0.5)?.id);
          for (const backend of backends) {
            const texture = backend.floatTexture(3, 2, floatRaster(pixels));
            try {
              results.push({
                depth,
                backend: backend.name,
                expected,
                uploaded: Array.from(await backend.readFloat(texture)),
                hits,
                expectedHits: values.map((a) => (a >= 0.01 ? image.id : background.id)),
              });
            } finally {
              backend.destroy(texture);
            }
          }
        } finally {
          restored.assets.clear();
          assets.clear();
        }
      }
    } finally {
      backends.forEach((b) => b.dispose());
    }
    return results;
  });
  for (const result of results) {
    expect(result.uploaded, `${result.backend} ${result.depth}-bit`).toEqual(result.expected);
    expect(result.hits).toEqual(result.expectedHits);
  }
});

test('float sources, intermediates and readbacks retain HDR values, small alpha and precision', async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const { WebGLBackend } = await import('/src/renderer/webgl.ts');
    const { WebGPUBackend } = await import('/src/renderer/webgpu.ts');
    const { uniforms } = await import('/src/renderer/renderer.ts');
    const { layer } = await import('/src/model/document.ts');
    const backends: import('../../src/renderer/backend').Backend[] = [
      new WebGLBackend(document.createElement('canvas')),
    ];
    if (navigator.gpu) backends.push(await WebGPUBackend.create(document.createElement('canvas')));
    const results = [];
    try {
      for (const backend of backends) {
        for (const [width, height] of [
          [1, 1],
          [3, 2],
          [17, 3],
        ]) {
          const sourceData = new Float32Array(width * height * 4);
          const backData = new Float32Array(width * height * 4);
          for (let i = 0; i < width * height; i++) {
            sourceData.set([1.000123, -0.375, 4.125, [1, 0.25, 1e-9][i % 3]], i * 4);
            backData.set([-0.125, 3.5, 0.1234567, i % 3 === 2 ? 0 : 0.375], i * 4);
          }
          const source = backend.floatTexture(width, height, sourceData);
          const back = backend.floatTexture(width, height, backData);
          const first = backend.floatTexture(width, height);
          const next = backend.floatTexture(width, height);
          const mask = backend.texture(1, 1, new Uint8Array([255, 255, 255, 255]));
          try {
            const uploaded = Array.from(await backend.readFloat(source));
            const l = layer('image', 'Float', width, height);
            l.opacity = 0.625;
            const u = uniforms(l, width, height, width, height);
            backend.pass(back, source, mask, u, first);
            const composed = Array.from(await backend.readFloat(first));
            // Another complete compositing pass must not quantize its backdrop.
            const transparent = backend.floatTexture(1, 1, new Float32Array([2, -3, 5, 0]));
            try {
              backend.pass(first, transparent, mask, uniforms(l, width, height, 1, 1), next);
              results.push({
                backend: backend.name,
                width,
                height,
                source: Array.from(sourceData),
                backdrop: Array.from(backData),
                uploaded,
                composed,
                repeated: Array.from(await backend.readFloat(next)),
                opacity: l.opacity,
              });
            } finally {
              backend.destroy(transparent);
            }
          } finally {
            [source, back, first, next, mask].forEach((t) => backend.destroy(t));
          }
        }
      }
    } finally {
      backends.forEach((backend) => backend.dispose());
    }
    return results;
  });
  for (const result of results) {
    expect(result.uploaded, result.backend).toEqual(result.source);
    for (let i = 0; i < result.source.length; i += 4) {
      const sa = result.source[i + 3] * result.opacity,
        ba = result.backdrop[i + 3];
      const alpha = sa + ba * (1 - sa);
      for (let c = 0; c < 3; c++) {
        const expected =
          (result.source[i + c] * sa + result.backdrop[i + c] * ba * (1 - sa)) / alpha;
        expect(
          result.composed[i + c],
          `${result.backend} ${result.width}x${result.height} component ${i + c}`,
        ).toBeCloseTo(expected, 5);
        expect(result.repeated[i + c]).toBeCloseTo(expected, 5);
      }
      // Preserve sub-byte and extremely small alpha rather than rounding it to zero.
      expect(Math.abs(result.composed[i + 3] - alpha)).toBeLessThan(Math.max(1e-16, alpha * 1e-6));
    }
  }
});

test('float bilinear transforms, byte masks and blend modes follow scalar source-over math', async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const { WebGLBackend } = await import('/src/renderer/webgl.ts');
    const { WebGPUBackend } = await import('/src/renderer/webgpu.ts');
    const { uniforms } = await import('/src/renderer/renderer.ts');
    const { layer } = await import('/src/model/document.ts');
    // The scalar oracle below covers these separable modes; the full blend list
    // (non-separable, dissolve, dodge/burn...) has its own unit tests.
    const blends = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference'] as const;
    const backends: import('../../src/renderer/backend').Backend[] = [
      new WebGLBackend(document.createElement('canvas')),
    ];
    if (navigator.gpu) backends.push(await WebGPUBackend.create(document.createElement('canvas')));
    const width = 7,
      height = 5,
      sw = 3,
      sh = 2;
    const pixels = new Float32Array([
      2, -0.25, 0.125, 1, 0.01, 1.5, 0.25, 0.25, -0.1, 0.7, 4, 0.9, 0.375, -0.5, 2, 0.7, 1.125, 3,
      -0.3, 0, 0.8, 0.6, 0.4, 0.35,
    ]);
    const maskBytes = new Uint8Array([
      255, 255, 255, 255, 255, 255, 255, 0, 255, 255, 255, 31, 255, 255, 255, 127, 255, 255, 255,
      255, 255, 255, 255, 191,
    ]);
    const backdrop = new Float32Array(width * height * 4);
    for (let i = 0; i < width * height; i++)
      backdrop.set([(i % 5) / 4 - 0.2, 1.8, (i % 3) * 0.37, i % 2 ? 0.2 : 0.75], i * 4);
    const transform = { x: -0.375, y: 0.625, width: 5.5, height: 3.75, rotation: 0 };
    const results = [];
    try {
      for (const backend of backends) {
        const back = backend.floatTexture(width, height, backdrop),
          source = backend.floatTexture(sw, sh, pixels);
        const mask = backend.texture(sw, sh, maskBytes),
          target = backend.floatTexture(width, height);
        const l = layer('image', 'Transformed', sw, sh);
        l.transform = transform;
        l.opacity = 0.71;
        l.maskAsset = 'mask';
        try {
          for (const mode of blends) {
            l.blend = mode;
            backend.pass(back, source, mask, uniforms(l, width, height, sw, sh), target);
            results.push({
              backend: backend.name,
              mode,
              width,
              height,
              sw,
              sh,
              transform,
              opacity: l.opacity,
              pixels: Array.from(pixels),
              backdrop: Array.from(backdrop),
              mask: Array.from(maskBytes),
              actual: Array.from(await backend.readFloat(target)),
            });
          }
        } finally {
          [back, source, mask, target].forEach((t) => backend.destroy(t));
        }
        // Float input to a byte render target must use a compatible bind layout.
        const image = backend.floatTexture(1, 1, new Float32Array([0.25, 0.5, 0.75, 1]));
        const empty = backend.floatTexture(1, 1),
          white = backend.texture(1, 1, new Uint8Array([255, 255, 255, 255]));
        const byte = backend.texture(1, 1);
        backend.clear(empty);
        try {
          backend.pass(
            empty,
            image,
            white,
            uniforms(layer('image', 'Convert', 1, 1), 1, 1, 1, 1),
            byte,
          );
          results.push({ backend: backend.name, conversion: Array.from(await backend.read(byte)) });
        } finally {
          [image, empty, white, byte].forEach((t) => backend.destroy(t));
        }
      }
    } finally {
      backends.forEach((b) => b.dispose());
    }
    return results;
  });
  const bilinear = (
    data: number[],
    width: number,
    height: number,
    x: number,
    y: number,
    component: number,
    associated = false,
  ) => {
    const atX = x - 0.5,
      atY = y - 0.5,
      ix = Math.floor(atX),
      iy = Math.floor(atY);
    const fx = atX - ix,
      fy = atY - iy;
    const fetch = (x: number, y: number, c = component) =>
      data[
        (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4 +
          c
      ];
    if (associated && component !== 3) {
      const taps = [
        [ix, iy, (1 - fx) * (1 - fy)],
        [ix + 1, iy, fx * (1 - fy)],
        [ix, iy + 1, (1 - fx) * fy],
        [ix + 1, iy + 1, fx * fy],
      ];
      const alpha = taps.reduce((sum, [x, y, w]) => sum + fetch(x, y, 3) * w, 0);
      if (alpha > 0)
        return taps.reduce((sum, [x, y, w]) => sum + fetch(x, y) * fetch(x, y, 3) * w, 0) / alpha;
    }
    return (
      (fetch(ix, iy) * (1 - fx) + fetch(ix + 1, iy) * fx) * (1 - fy) +
      (fetch(ix, iy + 1) * (1 - fx) + fetch(ix + 1, iy + 1) * fx) * fy
    );
  };
  for (const result of results) {
    if ('conversion' in result) {
      expect(result.conversion, result.backend).toEqual([64, 128, 191, 255]);
      continue;
    }
    for (let y = 0; y < result.height; y++)
      for (let x = 0; x < result.width; x++) {
        const i = (y * result.width + x) * 4;
        const px = (x + 0.5 - result.transform.x) / result.transform.width;
        const py = (y + 0.5 - result.transform.y) / result.transform.height;
        const s = [0, 1, 2, 3].map((c) =>
          bilinear(result.pixels, result.sw, result.sh, px * result.sw, py * result.sh, c, true),
        );
        const inside = px >= 0 && px <= 1 && py >= 0 && py <= 1;
        const sa = inside
          ? (s[3] *
              result.opacity *
              bilinear(result.mask, result.sw, result.sh, px * result.sw, py * result.sh, 3)) /
            255
          : 0;
        const ba = result.backdrop[i + 3],
          alpha = sa + ba * (1 - sa);
        for (let c = 0; c < 3; c++) {
          const b = result.backdrop[i + c],
            f = s[c];
          const blend =
            result.mode === 'multiply'
              ? b * f
              : result.mode === 'screen'
                ? 1 - (1 - b) * (1 - f)
                : result.mode === 'overlay'
                  ? b < 0.5
                    ? 2 * b * f
                    : 1 - 2 * (1 - b) * (1 - f)
                  : result.mode === 'darken'
                    ? Math.min(b, f)
                    : result.mode === 'lighten'
                      ? Math.max(b, f)
                      : result.mode === 'difference'
                        ? Math.abs(b - f)
                        : f;
          const expected = (sa * (1 - ba) * f + sa * ba * blend + (1 - sa) * ba * b) / alpha;
          expect(
            result.actual[i + c],
            `${result.backend} ${result.mode} (${x},${y}) channel ${c}`,
          ).toBeCloseTo(expected, 5);
        }
        expect(result.actual[i + 3]).toBeCloseTo(alpha, 6);
      }
  }
});
