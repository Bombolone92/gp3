// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintRoot, sheetPrintPrefs, printSettingsFromPrefs } from '../src/ui/print.js';

const margins = { left: 1.25, right: .5, top: .75, bottom: .75 };
const header = '&LLeft&CCenter&RRight';
const workbook = () => new Workbook({ sheets: [false, true].map((alignWithMargins, i) => ({ name: `Report ${i}`,
  cells: { '0,0': { v: 'Content' } }, printSettings: { alignWithMargins, header, footer: header, margins } })) });

it('keeps alignment per sheet and through print preference edits', () => {
  const wb = workbook();
  expect(sheetPrintPrefs(wb.sheets[0]).alignWithMargins).toBe(false);
  expect(sheetPrintPrefs(wb.sheets[1]).alignWithMargins).toBe(true);
  expect(sheetPrintPrefs({}).alignWithMargins).toBe(true);
  expect(printSettingsFromPrefs(wb.sheets[0], { ...sheetPrintPrefs(wb.sheets[0]), header: 'New' })).toMatchObject({ alignWithMargins: false, header: 'New' });
  const root = buildPrintRoot(wb, wb.activeSheetId, 'Report', { area: 'workbook', marginBoxes: true });
  const css = root.querySelector('style').textContent;
  const paper = css.slice(css.indexOf('@page sheet-1 { @top-left'), css.indexOf('@page sheet-2'));
  for (const edge of ['top', 'bottom']) {
    expect(paper).toMatch(new RegExp(`@${edge}-left \\{[^}]*margin-left: -120px;`));
    expect(paper).toMatch(new RegExp(`@${edge}-center \\{[^}]*margin-left: -120px;[^}]*margin-right: -48px;`));
    expect(paper).toMatch(new RegExp(`@${edge}-right \\{[^}]*margin-right: -48px;`));
  }
  expect(css.slice(css.indexOf('@page sheet-2'))).not.toContain('margin-left: -');
});

it('renders native headers without an app title in the flow fallback', () => {
  const wb = workbook();
  const root = buildPrintRoot(wb, wb.activeSheetId, 'Report', { area: 'workbook', marginBoxes: false });
  const sections = root.querySelectorAll('.print-section');
  expect(root.querySelector('.print-title')).toBeNull();
  expect(sections[0].style.marginLeft).toBe('120px');
  expect(sections[0].style.width).toBe('648px');
  expect(root.textContent).not.toMatch(/false|null|undefined/);
  expect(root.querySelector('style').textContent).toContain('margin: 0.75in 0in 0.75in 0in;');
  for (const node of sections[0].querySelectorAll('.print-page-header, .print-foot')) {
    expect(node.textContent).toBe('LeftCenterRight');
    expect(node.style.marginLeft).toBe('-120px');
    expect(node.style.marginRight).toBe('-48px');
    expect(node.style.width).toBe('calc(100% + 168px)');
    expect([...node.children].map(n => n.style.textAlign)).toEqual(['left', 'center', 'right']);
  }
  expect(sections[0].querySelectorAll('.print-page-header, .print-foot')).toHaveLength(2);
  expect(sections[1].querySelector('.print-page-header').style.marginLeft).toBe('');
});

it('centers a lone center section and keeps empty first-page text empty', () => {
  const wb = workbook();
  let root = buildPrintRoot(wb, wb.activeSheetId, 'Report', { marginBoxes: false, header: 'Center' });
  const node = root.querySelector('.print-page-header');
  expect(node.textContent).toBe('Center');
  expect(node.style.justifyContent).toBe('center');
  root = buildPrintRoot(wb, wb.activeSheetId, 'Report', { marginBoxes: false, differentFirst: true, firstHeader: '', firstFooter: '' });
  expect(root.querySelector('.print-page-header, .print-foot')).toBeNull();
  expect(root.textContent).not.toMatch(/false|null|undefined/);
});
