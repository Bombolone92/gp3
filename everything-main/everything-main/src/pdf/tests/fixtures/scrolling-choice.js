import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';

export async function scrollingChoicePdf() {
  const doc = await PDFDocument.create();
  const field = doc.getForm().createOptionList('Destination');
  field.addOptions(
    Array.from({ length: 12 }, (_, i) => `Choice ${String(i + 1).padStart(2, '0')}`),
  );
  field.select('Choice 01');
  field.addToPage(doc.addPage([400, 400]), { x: 40, y: 200, width: 240, height: 60 });
  field.setFontSize(12);
  field.acroField.dict.set(PDFName.of('TI'), PDFNumber.of(0));
  return { doc, field };
}

export async function selectedPixels(bytes) {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
      .pathname,
  });
  try {
    const page = await (await task.promise).getPage(1);
    const canvas = createCanvas(400, 400);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: 1 }) }).promise;
    const pixels = ctx.getImageData(40, 140, 240, 60).data;
    let selected = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (
        Math.abs(pixels[i] - 153) < 3 &&
        Math.abs(pixels[i + 1] - 193) < 3 &&
        Math.abs(pixels[i + 2] - 218) < 3
      )
        selected++;
    return selected;
  } finally {
    await task.destroy();
  }
}
