import { it, expect, vi, afterEach } from 'vitest';
import { missingMetafileFonts } from '../src/engine/metafile-fonts.js';
import { emfFontFamilies } from '../src/engine/emf-text.js';

afterEach(() => vi.unstubAllGlobals());
it('checks each installed face once and accepts the GDI style-family alternative', async () => {
  const calls = [];
  vi.stubGlobal('FontFace', class {
    constructor(name, source) { this.source = source; calls.push(source); }
    async load() { if (this.source !== 'local("Arial")') throw Error('Absent'); return this; }
  });
  const groups = [emfFontFamilies({ family: 'Arial Bold Italic', italic: true, weight: 700 }), ['Absent'], ['Absent']];
  expect(await missingMetafileFonts(groups)).toEqual(['Absent']);
  expect(calls).toHaveLength(3);
});
it('does not infer missing fonts when the environment cannot probe them', async () => {
  vi.stubGlobal('FontFace', undefined);
  expect(await missingMetafileFonts([['Unknown']])).toEqual([]);
});
