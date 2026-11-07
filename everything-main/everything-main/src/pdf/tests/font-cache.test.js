import { expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { embedFont } from '../src/core/document.js';
import { loadScriptFont } from '../src/core/signature.js';
import { loadStampFont } from '../src/core/stamp.js';

it('retries a corrupt font response instead of keeping the unusable bytes cached', async () => {
  const bytes = await readFile(new URL('../public/fonts/NotoSans-Bold.ttf', import.meta.url));
  // A complete SFNT directory with an unusable table reaches the actual font parser.
  const malformed = new ArrayBuffer(28);
  const header = new DataView(malformed);
  header.setUint32(0, 0x00010000);
  header.setUint16(4, 1);
  header.setUint32(12, 0x6e616d65);
  header.setUint32(20, 28);
  const request = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response('<html>Temporarily unavailable</html>'))
    .mockResolvedValueOnce(new Response(bytes.subarray(0, 64)))
    .mockResolvedValueOnce(new Response(malformed))
    .mockImplementation(async () => new Response(bytes));
  try {
    const doc = await PDFDocument.create();
    await expect(embedFont(doc, 'bold')).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
    await expect(embedFont(doc, 'bold')).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
    await expect(embedFont(doc, 'bold')).rejects.toThrow('Could not load the text font');
    expect(request).toHaveBeenCalledTimes(3);
    const font = await embedFont(doc, 'bold');
    expect(font.name).toBe('NotoSans-Bold');
    expect(request).toHaveBeenCalledTimes(4);
    doc.addPage().drawText('Working', { font });
    expect((await doc.save()).length).toBeGreaterThan(0);
    await embedFont(await PDFDocument.create(), 'bold');
    expect(request).toHaveBeenCalledTimes(4);
  } finally {
    request.mockRestore();
  }
});

it.each([
  ['signature', loadScriptFont, 'GreatVibes-Regular.ttf'],
  ['stamp', loadStampFont, 'NotoSans-Regular.ttf'],
])('retries an invalid %s font response', async (_name, load, file) => {
  const bytes = await readFile(new URL(`../public/fonts/${file}`, import.meta.url));
  const request = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response('<html>Temporarily unavailable</html>'))
    .mockImplementation(async () => new Response(bytes));
  try {
    await expect(load()).rejects.toThrow('font');
    expect(new Uint8Array(await load())).toEqual(new Uint8Array(bytes));
    expect(request).toHaveBeenCalledTimes(2);
    await load();
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    request.mockRestore();
  }
});
