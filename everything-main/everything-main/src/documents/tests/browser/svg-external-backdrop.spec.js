import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

test('transparent SVG compositing over external opaque backgrounds matches native metafile', async ({ page }, info) => {
  const folder = 'tests/fixtures/svg-external-backdrop/';
  const reference = JSON.parse(readFileSync(folder + 'native-colors.json', 'utf8').replace(/^\uFEFF/, ''));
  const svg = unzipSync(readFileSync(folder + 'control.docx'))['word/media/vector.svg'];
  await page.goto('/playground.html');
  const actual = await page.evaluate(async ({ bytes, samples }) => {
    const { decodeSvg } = await import('/src/engine/svg-images.js');
    const image = await decodeSvg(new Uint8Array(bytes));
    try {
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 900;
      const context = canvas.getContext('2d');
      return samples.map(({ background }) => {
        context.fillStyle = '#' + background; context.fillRect(0, 0, 1200, 900);
        context.drawImage(image, 0, 0, 1200, 900);
        return { background, colors: Array.from({ length: 9 }, (_, row) => [...context.getImageData(600, row * 100 + 50, 1, 1).data].slice(0, 3)) };
      });
    } finally { image.close(); }
  }, { bytes: [...svg], samples: reference.samples });
  const differences = actual.flatMap((sample, i) => sample.colors.flatMap((color, row) =>
    color.some((v, channel) => v !== reference.samples[i].colors[row][channel]) ?
      [{ background: sample.background, row, actual: color, native: reference.samples[i].colors[row] }] : []));
  writeFileSync(info.outputPath('differences.json'), JSON.stringify(differences, null, 2));
  test.fail(true, 'Transparent SVG flattening and external source-over still differ from the native metafile.');
  expect(actual).toEqual(reference.samples);
});
