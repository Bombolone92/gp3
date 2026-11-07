import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Text actually drawn by PDF.js, including form appearances that text extraction omits. */
export async function paintedText(bytes) {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
      .pathname,
  });
  try {
    const pdf = await task.promise;
    const text = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const operators = await (await pdf.getPage(i)).getOperatorList();
      text.push(
        operators.fnArray
          .flatMap((fn, j) =>
            fn === pdfjs.OPS.showText
              ? operators.argsArray[j][0].map((glyph) => glyph.unicode || '')
              : [],
          )
          .join(''),
      );
    }
    return text.join('\n');
  } finally {
    await task.destroy();
  }
}
