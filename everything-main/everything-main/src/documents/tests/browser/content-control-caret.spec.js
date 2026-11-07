import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

for (const mode of ['typing', 'fallback', 'composition', 'repeated-fallback']) for (const side of ['before', 'inside', 'after']) test(`${mode} preserves the selected ${side} boundary`, async ({ page }, info) => {
  const source = readFileSync('tests/fixtures/empty-inline-controls/control.docx'), parts = unzipSync(source);
  await page.goto('/playground.html');
  await page.evaluate(async ({ bytes, side }) => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { contentControlRanges } = await import('/src/engine/content-controls.js');
    const p = await DocxPackage.open(new Uint8Array(bytes));
    const host = document.createElement('div'); host.id = 'boundary-probe'; document.body.append(host);
    window.boundaryErrors = [];
    const e = new CanvasEditor(host, { ...p, onError: error => window.boundaryErrors.push(error.message) });
    window.boundaryEditor = e; window.boundaryPackage = p;
    const r = contentControlRanges(e.model.paragraphs).at(-2);
    e.model.select(r.start, r.start, { id: r.control.id, side }); e.syncInput(); e.paint(); e.focus();
  }, { bytes: [...source], side });
  const input = page.locator('#boundary-probe textarea'), original = await input.inputValue();
  await input.focus(); await expect(input).toBeFocused();
  expect(await page.evaluate(() => window.boundaryErrors)).toEqual([]);
  if (mode === 'typing') {
    await page.keyboard.insertText('X'); await page.keyboard.insertText('Y');
  } else await input.evaluate((el, mode) => {
    if (mode === 'composition') el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const texts = mode === 'repeated-fallback' ? [el.value[el.selectionStart], el.value[el.selectionStart]] : ['X', 'Y'];
    for (const text of texts) {
      el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: mode === 'composition' ? 'insertCompositionText' : 'insertText', data: text, isComposing: mode === 'composition' }));
    }
    if (mode === 'composition') el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'XY' }));
  }, mode);
  const inserted = mode === 'repeated-fallback' ? original[original.indexOf('Adjacent ') + 'Adjacent '.length].repeat(2) : 'XY';
  const expected = original.replace('Adjacent ', 'Adjacent ' + inserted);
  await expect(input).toHaveValue(expected);
  const exportBytes = () => page.evaluate(async () => {
    const p = window.boundaryPackage, d = window.boundaryEditor.model;
    return [...new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer())];
  });
  const edited = new Uint8Array(await exportBytes()); writeFileSync(info.outputPath('edited.docx'), edited);
  for (const [name, data] of Object.entries(parts)) if (name !== 'word/document.xml') expect(unzipSync(edited)[name]).toEqual(data);
  const ownership = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { contentControlRanges } = await import('/src/engine/content-controls.js');
    const p = await DocxPackage.open(new Uint8Array(bytes));
    return contentControlRanges(p.paragraphs).map(r => r.runs.map(run => run.text).join(''));
  }, [...edited]);
  expect(ownership).toEqual(['', '', '', '', side === 'inside' ? inserted : '', '']);
  await input.press('ControlOrMeta+z');
  if (mode !== 'composition') await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue(original);
  const undone = new Uint8Array(await exportBytes()); writeFileSync(info.outputPath('undo.docx'), undone);
  expect(unzipSync(undone)).toEqual(parts);
  expect(await page.evaluate(() => window.boundaryErrors)).toEqual([]);
});

for (const side of ['before', 'inside-start', 'inside-end', 'after']) test(`composition respects placeholder ${side}`, async ({ page }, info) => {
  const source = readFileSync('tests/fixtures/empty-inline-controls/native/clear-after-entry.docx');
  await page.goto('/playground.html');
  const initial = await page.evaluate(async ({ bytes, side }) => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { contentControlRanges } = await import('/src/engine/content-controls.js');
    const p = await DocxPackage.open(new Uint8Array(bytes));
    const host = document.createElement('div'); host.id = 'boundary-probe'; document.body.append(host);
    window.boundaryErrors = [];
    const e = new CanvasEditor(host, { ...p, onError: error => window.boundaryErrors.push(error.message) });
    window.boundaryEditor = e; window.boundaryPackage = p;
    const r = contentControlRanges(e.model.paragraphs).find(r => r.control.placeholder);
    if (!r) throw new Error('Missing native placeholder');
    const at = side === 'after' || side === 'inside-end' ? r.end : r.start;
    e.model.select(at, at, { id: r.control.id, side: side.startsWith('inside') ? 'inside' : side });
    e.syncInput(); e.paint(); e.focus();
    return { text: e.model.text, start: r.start, end: r.end, at, id: r.control.id };
  }, { bytes: [...source], side });
  const input = page.locator('#boundary-probe textarea'); await input.focus();
  await input.evaluate(el => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const start = el.selectionStart, end = el.selectionEnd, original = el.value;
    for (const text of ['ㅎ', '한']) {
      el.value = original.slice(0, start) + text + original.slice(end);
      el.setSelectionRange(start + text.length, start + text.length);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: text, isComposing: true }));
    }
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '한' }));
  });
  const inside = side.startsWith('inside');
  await expect(input).toHaveValue(initial.text.slice(0, inside ? initial.start : initial.at) + '한' + initial.text.slice(inside ? initial.end : initial.at));
  const result = await page.evaluate(async id => {
    const p = window.boundaryPackage, d = window.boundaryEditor.model;
    const bytes = [...new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer())];
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { contentControlRanges } = await import('/src/engine/content-controls.js');
    const reopened = await DocxPackage.open(new Uint8Array(bytes));
    const r = contentControlRanges(reopened.paragraphs).find(r => r.control.id === id);
    return { bytes, text: r.runs.map(r => r.text).join(''), placeholder: !!r.control.placeholder };
  }, initial.id);
  expect(result.text).toBe(inside ? '한' : initial.text.slice(initial.start, initial.end));
  expect(result.placeholder).toBe(!inside);
  writeFileSync(info.outputPath('edited.docx'), new Uint8Array(result.bytes));
  for (const [name, data] of Object.entries(unzipSync(source))) if (name !== 'word/document.xml') expect(unzipSync(new Uint8Array(result.bytes))[name]).toEqual(data);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(initial.text);
  const restored = await page.evaluate(async () => {
    const p = window.boundaryPackage, d = window.boundaryEditor.model;
    return [...new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer())];
  });
  expect(unzipSync(new Uint8Array(restored))).toEqual(unzipSync(source));
  expect(await page.evaluate(() => window.boundaryErrors)).toEqual([]);
});
