import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const source = 'tests/fixtures/persistent-block-controls/control.docx';
const refs = JSON.parse(readFileSync('tests/fixtures/persistent-block-controls/boundary-matrix/reference.json', 'utf8')).cases;

for (const name of ['replace-join-start', 'replace-split-cross-end', 'two-paragraphs-cross-start', 'placeholder-join-end', 'replace-erase-cross-start']) {
  test(`edits, exports and undoes ${name}`, async ({ page }, info) => {
    test.setTimeout(120000);
    const ref = refs.find(r => r.name === name), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/playground.html');
    await page.getByLabel('Open DOCX file').setInputFiles(source);
    const input = page.getByRole('textbox', { name: 'Document text' });
    await expect(input).toHaveValue(/^Before insert/);
    const original = await input.inputValue(), parts = unzipSync(readFileSync(source));
    const start = original.indexOf(`Before ${ref.title}\n`) + `Before ${ref.title}\n`.length;
    const end = original.indexOf(`\nAfter ${ref.title}`, start);
    const range = ref.operation === 'join-start' ? [start,start] : ref.operation === 'join-end' ? [end,end]
      : ref.operation === 'erase-cross-start' ? [start-1,end] : ref.operation === 'cross-start' ? [start-1,start+2] : [end-2,end+1];
    await input.evaluate((el, [start,end]) => { el.focus(); el.setSelectionRange(start,end); el.dispatchEvent(new Event('select')); }, range);
    if (ref.operation === 'join-start') await input.press('Backspace');
    else if (ref.operation === 'join-end') await input.press('Delete');
    else if (!ref.replacement) await input.press('Backspace');
    else await page.keyboard.insertText(ref.replacement.replaceAll('\r','\n'));
    const expected = ref.bodyParagraphs.join('\n');
    await expect(input).toHaveValue(expected);
    const save = async label => {
      const event = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
      const path = info.outputPath(label + '.docx'); await (await event).saveAs(path); return path;
    };
    const exported = await save('edited'), out = unzipSync(readFileSync(exported));
    for (const [name,data] of Object.entries(parts)) if (name !== 'word/document.xml') expect(out[name]).toEqual(data);
    const control = await page.evaluate(({xml,title}) => {
      const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      const d = new DOMParser().parseFromString(xml,'application/xml');
      const c = [...d.getElementsByTagNameNS(w,'sdt')].find(c => c.getElementsByTagNameNS(w,'alias')[0]?.getAttributeNS(w,'val') === title);
      return { parent: c.parentNode.localName, tag: c.getElementsByTagNameNS(w,'tag')[0].getAttributeNS(w,'val') };
    }, {xml:strFromU8(out['word/document.xml']),title:ref.title});
    expect(control).toEqual({parent:ref.kind === 'inline' ? 'p' : 'body',tag:'original-'+ref.title});
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(input).toHaveValue(original);
    expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
    await reopenDocx(page,input,exported,expected);
    await expect(input).toHaveJSProperty('readOnly',false);
    if (ref.controlText === null) {
      const at = expected.indexOf('Before replace') + 'Before replace'.length;
      await input.evaluate((el,at)=>{el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select'));},at);
      await page.keyboard.insertText('Typed');
      const filled = expected.slice(0,at)+'Typed'+expected.slice(at);
      await expect(input).toHaveValue(filled);
      const filledPath = await save('filled-empty');
      await reopenDocx(page,input,filledPath,filled);
      await expect(input).toHaveJSProperty('readOnly',false);
    }
    expect(errors).toEqual([]);
  });
}
