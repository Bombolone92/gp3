import { afterEach, expect, it, vi } from 'vitest';
import { createImageCodec, normalizeImageFiles } from '../src/image-codec.js';
import { MAX_IMAGE_SIZE } from '../src/core/document.js';
import { PDFDocument } from 'pdf-lib';
import { addImagePages } from '../src/core/image-pages.js';

it('rejects an oversized picture before reading or decoding any file in the batch', async () => {
  const read = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
  await expect(
    normalizeImageFiles([
      { size: 3, arrayBuffer: read },
      { size: MAX_IMAGE_SIZE + 1, arrayBuffer: read },
    ]),
  ).rejects.toThrow('Choose an image smaller than 20 MB.');
  expect(read).not.toHaveBeenCalled();
});

it('preserves picture bytes and order when the files fit the size limit', async () => {
  const first = new Uint8Array([137, 80, 78, 71]);
  const second = new Uint8Array([255, 216, 255, 217]);
  const read = vi.fn(async () => first.buffer);
  expect(
    await normalizeImageFiles([
      { size: MAX_IMAGE_SIZE, arrayBuffer: read },
      new File([second], 'picture.jpg', { type: 'image/jpeg' }),
    ]),
  ).toEqual([first, second]);
  expect(read).toHaveBeenCalledOnce();
});

for (const [count, maxPages] of [
  [1001, undefined],
  [2, 1],
  [1, 0],
])
  it(`rejects ${count} pictures beyond page capacity ${maxPages ?? 1000} before reading files`, async () => {
    const read = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
    const files = Array.from({ length: count }, () => ({ size: 3, arrayBuffer: read }));
    const error = await normalizeImageFiles(
      files,
      maxPages === undefined ? undefined : { maxPages },
    ).then(
      () => null,
      (error) => error,
    );
    expect(error?.message).toBe('Keep between 1 and 1,000 pages in the PDF.');
    expect(read).not.toHaveBeenCalled();
  });

it('reads a picture batch exactly matching the remaining page capacity', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const file = new File([bytes], 'picture.png', { type: 'image/png' });
  expect(await normalizeImageFiles([file, file], { maxPages: 2 })).toEqual([bytes, bytes]);
});

afterEach(() => vi.unstubAllGlobals());

it('reads lazy pictures only when requested, keeping their original bytes and order', async () => {
  const first = new Uint8Array([137, 80, 78, 71]);
  const second = new Uint8Array([255, 216, 255, 217]);
  const readFirst = vi.fn(async () => first.buffer);
  const readSecond = vi.fn(async () => second.buffer);
  const readers = await normalizeImageFiles(
    [
      { size: first.length, arrayBuffer: readFirst },
      { size: second.length, arrayBuffer: readSecond },
    ],
    { lazy: true },
  );
  expect(readFirst).not.toHaveBeenCalled();
  expect(readSecond).not.toHaveBeenCalled();
  expect(await readers[0]()).toEqual(first);
  expect(readFirst).toHaveBeenCalledOnce();
  expect(readSecond).not.toHaveBeenCalled();
  expect(await readers[1]()).toEqual(second);
});

for (const constraint of ['size', 'pages'])
  it(`preflights the whole lazy picture batch for ${constraint} before reading files`, async () => {
    const read = vi.fn();
    await expect(
      normalizeImageFiles(
        [
          { size: 3, arrayBuffer: read },
          { size: constraint === 'size' ? MAX_IMAGE_SIZE + 1 : 3, arrayBuffer: read },
        ],
        { lazy: true, maxPages: constraint === 'pages' ? 1 : 2 },
      ),
    ).rejects.toThrow(
      constraint === 'size'
        ? 'Choose an image smaller than 20 MB.'
        : 'Keep between 1 and 1,000 pages in the PDF.',
    );
    expect(read).not.toHaveBeenCalled();
  });

it('an already-aborted picture batch does not read any file', async () => {
  const controller = new AbortController();
  controller.abort();
  const read = vi.fn();
  await expect(
    normalizeImageFiles([{ size: 3, arrayBuffer: read }], {
      lazy: true,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(read).not.toHaveBeenCalled();
});

it('an aborted pending picture read stops the batch before parsing it or reading the next file', async () => {
  const controller = new AbortController();
  const doc = await PDFDocument.create();
  let release, enter;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  const read = vi.fn(() => {
    enter();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const readNext = vi.fn();
  const readers = await normalizeImageFiles(
    [
      { size: 3, arrayBuffer: read },
      { size: 3, arrayBuffer: readNext },
    ],
    { lazy: true, signal: controller.signal },
  );
  const result = addImagePages(doc, readers, { signal: controller.signal });
  await entered;
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  // The native file read has no cancellation API. Its late bytes must be consumed safely.
  release(new Uint8Array([1, 2, 3]).buffer);
  await new Promise((resolve) => setImmediate(resolve));
  expect(read).toHaveBeenCalledOnce();
  expect(readNext).not.toHaveBeenCalled();
  expect(doc.getPageCount()).toBe(0);
});

it('bounds retained source buffers when importing a large batch into a small PDF', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { fileURLToPath } = await import('node:url');
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['--expose-gc', fileURLToPath(new URL('./fixtures/picture-read-memory.mjs', import.meta.url))],
    { timeout: 15000 },
  );
  const result = JSON.parse(stdout);
  expect(result.pages).toBe(12);
  expect(result.pdfBytes).toBeLessThan(100 * 1024);
  expect(result.pixel).toEqual([208, 32, 32]);
  expect(result.peakRetainedBytes).toBeLessThan(6 * 1024 * 1024);
});

for (const surface of ['offscreen', 'dom'])
  for (const stopAt of ['document', 'page', 'render', null])
    it(`${surface} decoder ${stopAt ? `cancels after ${stopAt}` : 'returns rendered pixels'} and destroys its PDF task`, async () => {
      const controller = new AbortController();
      const pixels = { data: new Uint8ClampedArray(16), width: 2, height: 2 };
      const context = { getImageData: vi.fn(() => pixels) };
      const makeCanvas = vi.fn(() => ({ getContext: () => context }));
      vi.stubGlobal(
        'OffscreenCanvas',
        surface === 'offscreen'
          ? function () {
              return makeCanvas();
            }
          : undefined,
      );
      vi.stubGlobal('document', { createElement: makeCanvas });
      let release, entered;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const waiting = new Promise((resolve) => {
        entered = resolve;
      });
      const hold = async (value) => {
        entered();
        await gate;
        return value;
      };
      const checkpoint = stopAt || 'render';
      const render = vi.fn(() => ({
        promise: checkpoint === 'render' ? hold() : Promise.resolve(),
      }));
      const page = { render, getViewport: () => ({ width: 2, height: 2 }) };
      const getPage = vi.fn(async () => (checkpoint === 'page' ? hold(page) : page));
      const pdf = { getPage };
      const destroy = vi.fn(async () => {});
      const task = {
        promise: checkpoint === 'document' ? hold(pdf) : Promise.resolve(pdf),
        destroy,
      };
      const result = createImageCodec(() => task)
        .render(new Uint8Array([1]), 2, 2, { signal: controller.signal })
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      await waiting;
      if (stopAt) controller.abort();
      release();
      const settled = await result;
      if (stopAt) expect(settled.error).toMatchObject({ name: 'AbortError' });
      else expect(settled.value).toBe(pixels);
      expect(getPage).toHaveBeenCalledTimes(stopAt === 'document' ? 0 : 1);
      expect(render).toHaveBeenCalledTimes(['document', 'page'].includes(stopAt) ? 0 : 1);
      expect(context.getImageData).toHaveBeenCalledTimes(stopAt ? 0 : 1);
      expect(destroy).toHaveBeenCalledOnce();
    });

it('an already-cancelled decoder does not start loading a PDF', async () => {
  const controller = new AbortController();
  controller.abort();
  const loadPdf = vi.fn();
  await expect(
    createImageCodec(loadPdf).render(new Uint8Array(), 2, 2, { signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(loadPdf).not.toHaveBeenCalled();
});

for (const surface of ['offscreen', 'dom'])
  for (const stopAt of ['blob', 'buffer', null])
    it(`${surface} encoder ${stopAt ? `cancels after ${stopAt}` : 'returns JPEG bytes without a signal'}`, async () => {
      const controller = new AbortController();
      const pixels = { data: new Uint8ClampedArray(16), width: 2, height: 2 };
      const bytes = new Uint8Array([1, 2, 3]);
      let release, entered;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const waiting = new Promise((resolve) => {
        entered = resolve;
      });
      const hold = async (value) => {
        entered();
        await gate;
        return value;
      };
      const arrayBuffer = vi.fn(async () =>
        stopAt === 'buffer' ? hold(bytes.buffer) : bytes.buffer,
      );
      const blob = { arrayBuffer };
      const encode = vi.fn(async () => (stopAt === 'buffer' ? blob : hold(blob)));
      const putImageData = vi.fn();
      const canvas = {
        getContext: () => ({ putImageData }),
        ...(surface === 'offscreen'
          ? { convertToBlob: encode }
          : {
              toBlob: async (callback, type, quality) => callback(await encode({ type, quality })),
            }),
      };
      vi.stubGlobal(
        'OffscreenCanvas',
        surface === 'offscreen'
          ? function () {
              return canvas;
            }
          : undefined,
      );
      vi.stubGlobal('document', { createElement: () => canvas });
      vi.stubGlobal('ImageData', function (data, width, height) {
        return { data, width, height };
      });
      const result = createImageCodec(vi.fn())
        .encodeJpeg(pixels, 0.7, stopAt ? { signal: controller.signal } : undefined)
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      await waiting;
      if (stopAt) controller.abort();
      release();
      const settled = await result;
      if (stopAt) expect(settled.error).toMatchObject({ name: 'AbortError' });
      else expect(settled.value).toEqual(bytes);
      expect(arrayBuffer).toHaveBeenCalledTimes(stopAt === 'blob' ? 0 : 1);
      expect(putImageData).toHaveBeenCalledWith(pixels, 0, 0);
      expect(encode).toHaveBeenCalledExactlyOnceWith({ type: 'image/jpeg', quality: 0.7 });
    });

it('an already-cancelled encoder does not allocate a canvas', async () => {
  const controller = new AbortController();
  controller.abort();
  const allocate = vi.fn();
  vi.stubGlobal('OffscreenCanvas', allocate);
  vi.stubGlobal('document', { createElement: allocate });
  await expect(
    createImageCodec(vi.fn()).encodeJpeg(
      { data: new Uint8ClampedArray(16), width: 2, height: 2 },
      0.7,
      { signal: controller.signal },
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(allocate).not.toHaveBeenCalled();
});
