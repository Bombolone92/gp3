// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { Blob } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { createCanvasRulers, rulerSnap } from '../src/ui/canvas-rulers.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { DocxPackage } from '../src/engine/docx.js';
import { pageGeometry, readingPageGeometry } from '../src/engine/page-settings.js';

const source = new Uint8Array(readFileSync('public/fixtures/ruler.docx'));
const resources = [];
beforeEach(() => vi.stubGlobal('Blob', Blob));
afterEach(() => { for (const r of resources.splice(0)) r.destroy(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
function setup(model, pageIndex) {
  const geometry = () => pageIndex === undefined ? pageGeometry(model.pageSettings) : readingPageGeometry(pageGeometry(model.pageSettings), pageIndex);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  localStorage.setItem('documents:unit', 'in');
  const surface = document.createElement('div'), host = document.createElement('div'), canvas = document.createElement('canvas');
  surface.append(host); host.append(canvas); document.body.append(surface);
  canvas.getBoundingClientRect = () => ({ left: 40, top: 54, bottom: 1110, width: 816, height: 1056 });
  const engine = { model, canvases: [canvas], zoom: 1, readOnly: false, finishComposition() {},
    setPageSettings: patch => { model.setPageSettings(patch); engine.layout.pages = [geometry()]; },
    setParagraphGeometry: patch => model.setParagraphGeometry(patch),
    layout: { pages: [geometry()] } };
  const rulers = createCanvasRulers({ host, surface, editor: () => engine, openParagraph() {} }); resources.push(rulers); rulers.update();
  const key = (kind, key, altKey = false) => surface.querySelector(`[data-kind="${kind}"]`).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key, altKey }));
  return { surface, engine, rulers, key };
}
async function fixture() {
  const pkg = await DocxPackage.open(source);
  return { pkg, model: new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets) };
}

describe('canvas rulers', () => {
  it.each([0,1])('edits the saved booklet margin under the visible ruler on page %i', async index => {
    const pkg=await DocxPackage.open(new Uint8Array(readFileSync('tests/fixtures/book-fold/small-gutter.docx')));
    const model=new TextDocument(pkg.paragraphs,pkg.pageSettings), {key,surface}=setup(model,index);
    expect(surface.querySelector('[data-kind="left"]').getAttribute('aria-valuenow')).toBe(String(index?1440:1080));
    key('left','ArrowRight');
    expect(model.pageSettings).toMatchObject(index?{left:1530,right:1080,gutter:180}:{left:1440,right:1170,gutter:180});
    key('right','ArrowLeft');
    expect(model.pageSettings).toMatchObject({left:1530,right:1170,gutter:180});
    model.undo();model.undo();
    expect(unzipSync(new Uint8Array(await pkg.export(model.paragraphs,model.pageSettings).arrayBuffer()))).toEqual(pkg.parts);
  });
  it('moves hanging and left markers independently, preserves leaders and round-trips untouched parts', async () => {
    const { pkg, model } = await fixture(), { key } = setup(model);
    key('hanging', 'ArrowRight');
    expect(model.paragraphFormatting).toMatchObject({ indentLeft: 810, firstLine: -450 });
    key('indentLeft', 'ArrowRight');
    expect(model.paragraphFormatting).toMatchObject({ indentLeft: 900, firstLine: -450 });
    key('firstLine', 'ArrowRight');
    expect(model.paragraphFormatting.firstLine).toBe(-360);
    key('tab', 'ArrowRight');
    expect(model.paragraphFormatting.tabs[0]).toMatchObject({ position: 1530, leader: 'dot' });
    key('left', 'ArrowRight');
    expect(model.pageSettings).toMatchObject({ left: 1170, gutter: 360, header: 720, footer: 720 });
    expect(model.history).toHaveLength(5);
    const bytes = new Uint8Array(await pkg.export(model.paragraphs, model.pageSettings, model.numbering, model.styles).arrayBuffer());
    const again = await DocxPackage.open(bytes);
    expect(again.pageSettings.left).toBe(1170);
    expect(again.paragraphs[0].format).toMatchObject({ indentLeft: 900, firstLine: -360 });
    expect(unzipSync(bytes)['customXml/ruler-provenance.xml']).toEqual(unzipSync(source)['customXml/ruler-provenance.xml']);
    for (let i = 0; i < 5; i++) model.undo();
    expect(unzipSync(new Uint8Array(await pkg.export(model.paragraphs, model.pageSettings, model.numbering, model.styles).arrayBuffer()))).toEqual(unzipSync(source));
  });
  it('keeps distinct first-line offsets when a shared left indent is moved', () => {
    const model = new TextDocument([paragraph('First'), paragraph('Second')]);
    model.select(0); model.setParagraphGeometry({ indentLeft: 720, firstLine: -360 });
    model.select(6); model.setParagraphGeometry({ indentLeft: 720, firstLine: 180 });
    model.select(0, model.text.length);
    const { key, surface } = setup(model);
    expect(surface.querySelector('[data-kind="firstLine"]')).toBeNull();
    key('indentLeft', 'ArrowRight');
    expect(model.paragraphs.map(p => p.format.firstLine)).toEqual([-360, 180]);
    expect(model.paragraphs.map(p => p.format.indentLeft)).toEqual([810, 810]);
  });
  it('preserves fixed negative vertical margins and top gutter', () => {
    const model = new TextDocument([paragraph('Text')], { top: -1440, gutter: 360, gutterAtTop: true });
    const { key } = setup(model); key('top', 'ArrowDown');
    expect(model.pageSettings).toMatchObject({ top: -1530, gutter: 360, gutterAtTop: true });
  });
  it('shows read-only and multiple-section margin controls as disabled', async () => {
    const { model } = await fixture(), { surface, engine, rulers } = setup(model);
    engine.readOnly = true; rulers.update();
    expect([...surface.querySelectorAll('button')].every(b => b.disabled)).toBe(true);
    engine.readOnly = false; model.paragraphs[0].sectionEnd = { ...model.pageSettings };
    rulers.update();
    expect(surface.querySelector('[data-kind="left"]').disabled).toBe(true);
  });
  it('uses twips for metric snapping and Alt precision', () => {
    expect(rulerSnap(101, 'in')).toBe(90);
    expect(rulerSnap(101, 'cm')).toBe(113);
    expect(rulerSnap(101, 'cm', true)).toBe(101);
  });
});
