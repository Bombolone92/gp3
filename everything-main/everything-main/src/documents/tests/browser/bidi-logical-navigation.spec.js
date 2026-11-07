import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { requireNativeWordFonts } from './helpers/native-fonts.js';
const root = 'tests/fixtures/bidi-layout/';
const cases = JSON.parse(readFileSync(root+'cases.json', 'utf8'));
const reference = JSON.parse(readFileSync(root+'native-navigation.json', 'utf8').replace(/^\uFEFF/, ''));

test('matches native logical character commands across Hebrew and Arabic boundaries', async ({ page }, info) => {
  expect(createHash('sha256').update(readFileSync(root+'control.docx')).digest('hex')).toBe(reference.sourceSha256);
  await page.goto('/playground.html'); await requireNativeWordFonts(page, ['Arial']);
  const actual = await page.evaluate(async ({ cases, controls }) => {
    const { bidiControlParagraphs } = await import('/tests/helpers/bidi-controls.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { prepareCanvasFont } = await import('/src/engine/font-availability.js');
    const { caretRect } = await import('/src/engine/layout.js');
    await prepareCanvasFont('Arial');
    const host = document.createElement('div'); document.body.append(host);
    const paragraphs = bidiControlParagraphs(cases), editor = new CanvasEditor(host, { paragraphs });
    const result = [];
    try {
      for (const control of controls) {
        const line = editor.layout.lines.find(l => l.paragraphId === paragraphs[2*control.index+1].id);
        editor.model.select(line.start+8); editor.caretAffinity='forward'; editor.caretPage=line.page;
        const steps=[];
        for (let i=0; i<control.steps.length; i++) {
          const caret=caretRect(editor.layout,editor.model.selection.focus,editor.caretAffinity,editor.caretPage);
          steps.push({offset:editor.model.selection.focus-line.start,x:caret.x*.75});
          editor.move(control.command==='CharLeft'?'ArrowLeft':'ArrowRight',false,false,false);
        }
        result.push({index:control.index,command:control.command,steps});
      }
      return result;
    } finally {editor.destroy();host.remove();}
  }, {cases,controls:reference.cases.filter(c=>c.mode===0)});
  writeFileSync(info.outputPath('actual.json'),JSON.stringify(actual,null,2));
  for (const sample of actual) {
    const native=reference.cases.find(c=>c.mode===0&&c.index===sample.index&&c.command===sample.command);
    for (const [i,step] of sample.steps.entries()) {
      expect(step.offset,`case ${sample.index} ${sample.command} step ${i}`).toBe(native.steps[i].offset);
      expect(Math.abs(step.x-native.steps[i].x),`case ${sample.index} ${sample.command} step ${i} caret`).toBeLessThan(.5);
    }
  }
});
