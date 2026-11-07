import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { xlsxAttr, xlsxElements } from '../src/core/xlsx-styles.js';

const source = () => new Workbook({ sheets: [{ name: 'Colors',
  colStyles: { 0: { bg: '#112233', font: 'arial' }, 3: { bg: '#445566', font: 'courier' } },
  rowStyles: { 4: { bg: '#ffcc88', bold: true } },
  cells: { '0,0': { v: 'Own', s: { bg: '#008844' } }, '1,0': { v: 2 },
    '2,0': { v: 'No fill', s: { bg: null } }, '3,0': { s: { bg: '#008844', font: 'georgia' } }, '4,1': { v: 'Row' } },
}] });
const bytes = async wb => new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
const read = data => workbookFromFile(data, 'edited.xlsx');
const bg = (wb, r, c) => wb.styleAt(wb.activeSheetId, r, c)?.bg || null;
function zipEditor(data) {
  const zip = X.CFB.read(data, { type: 'array' });
  const get = p => new TextDecoder().decode(X.CFB.find(zip, p).content);
  const set = (p, text) => X.CFB.utils.cfb_add(zip, p, new TextEncoder().encode(text));
  return { get, set, finish: () => X.CFB.write(zip, { type: 'array', fileType: 'zip' }) };
}
function editFill(data, match, pattern) {
  const z = zipEditor(data), path = '/xl/styles.xml';
  let styles = z.get(path);
  const fills = xlsxElements(xlsxElements(styles, 'fills')[0], 'fill');
  const xfs = xlsxElements(xlsxElements(styles, 'cellXfs')[0], 'xf'), changed = new Map();
  const fillId = fills.length; fills.push(`<fill>${pattern}</fill>`);
  const sheet = z.get('/xl/worksheets/sheet1.xml').replace(/<(?:c|row|col)\b[^>]*>/g, head => {
    if (!match(head)) return head;
    const key = /^<col\b/.test(head) ? 'style' : 's', old = Number(xlsxAttr(head, key) || 0);
    if (!changed.has(old)) { changed.set(old, xfs.length); xfs.push(xfs[old].replace(/fillId="\d+"/, `fillId="${fillId}"`)); }
    return head.replace(new RegExp(`\\s${key}="[^"]*"`), '').replace(/(\/?>)$/, ` ${key}="${changed.get(old)}"$1`);
  });
  styles = styles.replace(/<fills\b[^>]*>[\s\S]*?<\/fills>/, `<fills count="${fills.length}">${fills.join('')}</fills>`)
    .replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/, `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`);
  z.set(path, styles); z.set('/xl/worksheets/sheet1.xml', sheet); return z.finish();
}
const cellAt = address => h => /^<c\b/.test(h) && xlsxAttr(h, 'r') === address;
const solid = color => `<patternFill patternType="solid"><fgColor rgb="FF${color.slice(1)}"/></patternFill>`;
const withoutMeta = data => {
  const z = zipEditor(data);
  z.set('/xl/workbook.xml', z.get('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return z.finish();
};

it('retains unchanged private fill inheritance, explicit no-fill resets and empty styled cells', async () => {
  const wb = source(), back = await read(await bytes(wb));
  expect(back.activeSheet.colStyles).toEqual(wb.activeSheet.colStyles);
  expect(back.activeSheet.rowStyles).toEqual(wb.activeSheet.rowStyles);
  for (const key of wb.activeSheet.cells.keys()) expect(back.activeSheet.cells.get(key)?.s?.bg).toBe(wb.activeSheet.cells.get(key)?.s?.bg);
  expect(bg(back, 2, 0)).toBeNull(); expect(bg(back, 3, 0)).toBe('#008844');
});

it.each(['cell', 'column', 'row'])('accepts replaced %s fills through app/native saves and internal copy/paste', async target => {
  const wb = source(), color = '#cCdDeE';
  const match = target === 'cell' ? cellAt('A1') : target === 'column'
    ? h => /^<col\b/.test(h) && xlsxAttr(h, 'min') === '1' || /^<c\b/.test(h) && /^A\d+$/.test(xlsxAttr(h, 'r'))
    : h => /^<row\b/.test(h) && xlsxAttr(h, 'r') === '5' || /^<c\b/.test(h) && /\D5$/.test(xlsxAttr(h, 'r'));
  const back = await read(editFill(await bytes(wb), match, solid(color)));
  const points = target === 'cell' ? [[0, 0]] : target === 'column' ? [[0, 0], [1, 0], [2, 0], [3, 0], [80, 0]] : [[4, 1], [4, 20]];
  for (const [r, c] of points) expect(bg(back, r, c)).toBe(color.toLowerCase());
  const saved = await bytes(back);
  for (const data of [saved, withoutMeta(saved)]) {
    const again = await read(data);
    for (const [r, c] of points) expect(bg(again, r, c)).toBe(color.toLowerCase());
  }
  const [r, c] = points[0], range = { r1: r, c1: c, r2: r, c2: c };
  back.pasteCells(back.activeSheetId, back.copyRange(back.activeSheetId, range), 20, 3, { r, c });
  expect(bg(back, 20, 3)).toBe(color.toLowerCase());
});

it('keeps stored fills and native row fills when only a column default changes, without freezing row fonts', async () => {
  const wb = source();
  const back = await read(editFill(await bytes(wb), h => /^<col\b/.test(h) && xlsxAttr(h, 'min') === '1', solid('#abcdef')));
  expect(bg(back, 80, 0)).toBe('#abcdef');
  expect(bg(back, 0, 0)).toBe('#008844'); expect(bg(back, 1, 0)).toBe('#112233');
  expect(bg(back, 4, 0)).toBe('#ffcc88');
  expect(back.activeSheet.rowStyles.get(4)).toEqual({ ...wb.activeSheet.rowStyles.get(4), nativeFill: null });
  back.setInput(back.activeSheetId, 80, 0, 'New'); expect(bg(back, 80, 0)).toBe('#abcdef');
});

it.each([solid('#ffffff'), '<patternFill patternType="none"><fgColor rgb="FFFF0000"/></patternFill>'])('distinguishes explicit white from no fill and clears a stale private fill (%s)', async pattern => {
  const back = await read(editFill(await bytes(source()), cellAt('A1'), pattern));
  const expected = pattern.includes('solid') ? '#ffffff' : null;
  expect(bg(back, 0, 0)).toBe(expected);
  expect(bg(await read(await bytes(back)), 0, 0)).toBe(expected);
});

it('keeps a blank cell’s explicit XF-zero clears over column defaults', async () => {
  const z = zipEditor(await bytes(source()));
  z.set('/xl/worksheets/sheet1.xml', z.get('/xl/worksheets/sheet1.xml').replace(/<c\b[^>]*r="A4"[^>]*>/, h => h.replace(/ s="\d+"/, '')));
  const back = await read(z.finish());
  expect(bg(back, 3, 0)).toBeNull();
  expect(back.styleAt(back.activeSheetId, 3, 0).font).toBe('calibri');
  const again = await read(await bytes(back)); expect(bg(again, 3, 0)).toBeNull();
});

it.each(['<fgColor theme="4" tint="0.4"/>', '<fgColor indexed="3"/>'])('reconciles resolved theme/indexed colors consistently with native-only import (%s)', async color => {
  const edited = editFill(await bytes(source()), cellAt('A1'), `<patternFill patternType="solid">${color}</patternFill>`);
  const back = await read(edited), native = await read(withoutMeta(edited));
  expect(bg(back, 0, 0)).toEqual(bg(native, 0, 0));
  expect(bg(back, 0, 0)).not.toBe('#008844');
  expect(bg(await read(await bytes(back)), 0, 0)).toEqual(bg(native, 0, 0));
});

it('lets a native cell fill override a private clear-format region while retaining the remaining reset', async () => {
  const json = source().toJSON();
  json.sheets[0].styleResets = [{ range: { r1: 1, c1: 0, r2: 2, c2: 0 }, keys: ['bg'] }];
  const wb = new Workbook(json);
  expect(bg(wb, 1, 0)).toBeNull();
  const back = await read(editFill(await bytes(wb), cellAt('A2'), solid('#aabbcc')));
  expect(bg(back, 1, 0)).toBe('#aabbcc'); expect(bg(back, 2, 0)).toBeNull();
  expect(back.activeSheet.styleResets).toEqual(wb.activeSheet.styleResets);
});
