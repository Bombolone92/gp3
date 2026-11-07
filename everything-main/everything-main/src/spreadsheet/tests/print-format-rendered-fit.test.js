// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintRoot, preparePrintRoot } from '../src/ui/print.js';

let room;
beforeEach(() => {
  room = 72;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ font: '', measureText(text) {
    const size = Number(/([\d.]+)px/.exec(this.font)?.[1] || 13);
    return { width: [...text].reduce((sum, char) => sum + (char === 'W' ? 20 : 7), 0) * size / 13 };
  } });
  // jsdom cannot lay out a collapsed table. A percentage box resolves to
  // the renderer's content width, which is independent of the model width.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.classList.contains('number-format-layout') && this.style.inlineSize === '100%') {
      const scale = Number(this.closest('.print-sheet').style.zoom) || 1;
      return new DOMRect(0, 0, (typeof room === 'function' ? room(scale) : room) * scale, 15 * scale);
    }
    return new DOMRect();
  });
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function setup(scale = 100, style = {}, colWidth = 100) {
  const wb = new Workbook({ sheets: [{ colWidths: { 0: colWidth }, cells: {
    '0,0': { v: 12, s: { fmt: 'custom', code: '_W0*-', size: 13, font: 'arial', ...style } },
  } }] });
  const root = buildPrintRoot(wb, wb.activeSheetId, 'Measured format', { fit: 'scale', scale, title: false });
  document.body.append(root);
  return { wb, root, sheet: root.querySelector('.print-sheet'), table: root.querySelector('table') };
}

it.each([29, 53, 100, 140])('uses the rendered content box for padding and fill at %s%%', scale => {
  const { wb, root } = setup(scale), before = wb.toJSON();
  expect(root.querySelector('td').textContent).toBe('12--------');
  preparePrintRoot(root);
  const formatted = root.querySelector('.number-format-layout');
  expect(formatted.textContent).toBe('12-----');
  expect(parseFloat(formatted.style.inlineSize)).toBeCloseTo(72, 10);
  expect(parseFloat(formatted.querySelector('[aria-hidden]').style.inlineSize)).toBeCloseTo(20, 10);
  expect(wb.toJSON()).toEqual(before);
});

it('uses hashes at the actual numeric boundary and can recover after a wider layout', () => {
  const { root } = setup(53);
  room = 33; preparePrintRoot(root);
  expect(root.querySelector('td').textContent).toBe('###');
  room = 72; preparePrintRoot(root);
  expect(root.querySelector('td').textContent).toBe('12-----');
});

it('does not alter format boxes when no layout measurement is available', () => {
  const { root } = setup(), before = root.innerHTML;
  room = 0; preparePrintRoot(root);
  expect(root.innerHTML).toBe(before);
});

it('remeasures format spacing after fitting snapped borders to the page', () => {
  // Two columns fit as a unit; the formatted column has its own content box.
  const wb = new Workbook({ sheets: [{ colWidths: { 0: 100, 1: 800 }, cells: {
    '0,0': { v: 12, s: { fmt: 'custom', code: '_W0*-', size: 13, font: 'arial', indent: 1 } },
    '0,1': { v: 'Other column' },
  } }] });
  const fitted = buildPrintRoot(wb, wb.activeSheetId, 'Fit', { fit: 'pages', fitWidth: 1, fitHeight: 0, title: false,
    paper: 'letter', margins: 'custom', customMargins: { left: .5, right: .5, top: .5, bottom: .5 } });
  document.body.append(fitted);
  const target = fitted.querySelector('.print-sheet');
  for (const node of [target, fitted.querySelector('table'), fitted.querySelector('.print-section')]) {
    Object.defineProperty(node, 'getBoundingClientRect', { value: () => new DOMRect(0, 0, 900 * Number(target.style.zoom) + 2, 40) });
  }
  room = scale => 84 - 2 / scale;
  preparePrintRoot(fitted);
  expect(Number(target.style.zoom)).toBe(.79);
  expect(parseFloat(fitted.querySelector('.number-format-layout').style.inlineSize)).toBeCloseTo(room(.79), 3);
  expect(fitted.querySelector('td').textContent).toBe('12------');
});

it('remeasures filled text overflow against the physical cell without replacing its hard breaks', () => {
  const wb = new Workbook({sheets:[{colWidths:{0:150},cells:{'0,0':{v:'abc\ndef',s:{fmt:'custom',code:'0;0;0;@*.',wrap:true,font:'arial',size:13}}}}]});
  const root=buildPrintRoot(wb,wb.activeSheetId,'Text fill',{fit:'scale',scale:75,title:false});document.body.append(root);
  room=40;preparePrintRoot(root);expect(root.querySelector('td').textContent).toBe('###');
  room=70;preparePrintRoot(root);expect(root.querySelector('td').textContent).toBe('abcdef...');
  expect(root.querySelector('.number-format-layout br')).not.toBeNull();
  expect(wb.getValue(wb.activeSheetId,0,0)).toBe('abc\ndef');
});
