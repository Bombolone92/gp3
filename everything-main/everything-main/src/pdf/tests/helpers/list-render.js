import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

export async function rendered(bytes, rotation = 0) {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
      .pathname,
  });
  try {
    const page = await (await task.promise).getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(viewport.width, viewport.height),
      context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport }).promise;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const counts = Array(rotation ? canvas.width : canvas.height).fill(0);
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (data[i] === 153 && data[i + 1] === 193 && data[i + 2] === 218)
          counts[rotation ? x : y]++;
      }
    const bands = [];
    for (let i = 0; i < counts.length; i++)
      if (counts[i] > 20) {
        if (i > 0 && counts[i - 1] > 20) bands.at(-1)[1] = i;
        else bands.push([i, i]);
      }
    const ops = await page.getOperatorList();
    const lines = ops.fnArray.flatMap((fn, i) =>
      fn === pdfjs.OPS.showText ? [ops.argsArray[i][0].map((g) => g.unicode || '').join('')] : [],
    );
    return { bands, lines, pixels: Buffer.from(data) };
  } finally {
    await task.destroy();
  }
}
