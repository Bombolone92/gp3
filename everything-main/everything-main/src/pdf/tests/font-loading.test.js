import { expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { embedFont } from '../src/core/document.js';

// Reproduce a failed font request while the separately downloaded parser is still loading.
vi.mock('@pdf-lib/fontkit', async (original) => {
  await new Promise((resolve) => setTimeout(resolve, 75));
  return original();
});

it('reports an early font download failure and retries successfully', async () => {
  const bytes = await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url));
  const request = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockImplementation(async () => new Response(bytes));
  try {
    const doc = await PDFDocument.create();
    await expect(embedFont(doc)).rejects.toThrow('Could not load the text font. Please retry.');
    const font = await embedFont(doc);
    expect(font.name).toBe('NotoSans-Regular');
    expect(request).toHaveBeenCalledTimes(2);
    expect(await embedFont(doc)).toBe(font);
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    request.mockRestore();
  }
});
