import { it, expect, vi, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

afterEach(() => vi.unstubAllGlobals());
async function setup() {
  vi.resetModules(); const dom = new JSDOM();
  vi.stubGlobal('DOMParser', dom.window.DOMParser); vi.stubGlobal('XMLSerializer', dom.window.XMLSerializer);
  vi.stubGlobal('document', { fonts: { add() {} } });
  const calls = [];
  vi.stubGlobal('FontFace', class { constructor(family, source) { this.source = source; calls.push(source); } async load() { if (this.source.startsWith('local(')) throw Error('Absent'); return this; } });
  const registry = await import('../src/engine/file-fonts.js');
  const load = async form => { const data = readFileSync(`tests/fixtures/font-files/${form}.ttf`); await registry.loadFontFile({ size: data.length, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.length) }); };
  return { dom, registry, load, calls, ...await import('../src/engine/metafile-file-fonts.js'), ...await import('../src/engine/metafile-fonts.js') };
}
it('leaves pictures byte-identical when none of their fonts were supplied', async () => {
  const s = await setup(); try {
    await s.load('Regular'); const svg = '<svg><text font-family="Other">Hi</text></svg>';
    expect(s.metafileFileFonts(svg, [['Other']])).toBe(svg);
    expect(s.metafileFileFonts(svg, [])).toBe(svg);
  } finally { s.dom.window.close(); }
});
it('embeds all supplied styles once and preserves text, positions and source data', async () => {
  const s = await setup(); try {
    for (const form of ['Regular', 'Bold', 'Italic', 'BoldItalic']) await s.load(form);
    const { emfInfo } = await import('../src/engine/emf-images.js');
    const parts = unzipSync(readFileSync('tests/fixtures/metafile-file-fonts/control.docx'));
    const { svg, textFonts } = emfInfo(parts['word/media/control0.emf']);
    const result = s.metafileFileFonts(svg, [...textFonts, ...textFonts]);
    const before = new s.dom.window.DOMParser().parseFromString(svg, 'application/xml');
    const after = new s.dom.window.DOMParser().parseFromString(result, 'application/xml');
    expect(after.querySelector('parsererror')).toBeNull();
    expect(after.querySelector('style').textContent.match(/@font-face/g)).toHaveLength(4);
    expect(after.querySelector('style').textContent).toContain('font-weight:700;font-style:italic');
    expect(after.querySelector('text').getAttribute('font-family')).toContain('canvas file font');
    expect([...after.querySelectorAll('tspan')].map(n => n.outerHTML)).toEqual([...before.querySelectorAll('tspan')].map(n => n.outerHTML));
    for (const attr of before.querySelector('text').attributes) if (attr.name !== 'font-family') expect(after.querySelector('text').getAttribute(attr.name)).toBe(attr.value);
    expect(s.metafileFileFonts(svg, textFonts)).toBe(result);
    const calls = s.calls.length;
    expect(await s.missingMetafileFonts([['Corpus File Font'], ['Unknown']])).toEqual(['Unknown']);
    expect(s.calls.slice(calls)).toEqual(['local("Unknown")']);
    expect(emfInfo(parts['word/media/control0.emf']).svg).toBe(svg);
  } finally { s.dom.window.close(); }
});
