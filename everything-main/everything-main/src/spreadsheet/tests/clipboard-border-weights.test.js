// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';

const sides = ['bt', 'br', 'bb', 'bl'];
const office = '<html xmlns:x="urn:schemas-microsoft-com:office:excel">';
const table = css => `<table><tr><td style="${css}">Value</td></tr></table>`;
const read = (css, prefix = office) => parseHtmlClipboard(`${prefix}${table(css)}`).rows[0][0].style;

// Native Excel HTML point weights, including values on both sides of its
// thresholds. These are semantic weights, not the physical printed strokes.
it.each([
  ['.25pt', 'thin'], ['.5pt', 'thin'], ['.75pt', 'thin'], ['.99pt', 'thin'],
  ['1pt', 'medium'], ['1.25pt', 'medium'], ['1.49pt', 'medium'],
  ['1.5pt', 'thick'], ['2pt', 'thick'], ['3pt', 'thick'],
])('reads Excel point weight %s as %s', (width, bs) => {
  const style = read(`border:${width} solid #1368ac`);
  for (const side of sides) {
    expect(style[side]).toBe(true);
    expect(style[`${side}Border`]).toEqual({ bs, bc: '#1368ac' });
  }
});

it('recognizes the Excel ProgId declaration without requiring a namespace', () => {
  expect(read('border:1.5pt solid red', '<meta name="ProgId" content="Excel.Sheet">').btBorder.bs).toBe('thick');
  expect(read('border:1.5pt solid red', '<meta name="ProgId" content="Word.Document">').btBorder.bs).toBe('medium');
});

it.each([
  ['.5pt', 'thin'], ['1pt', 'thin'], ['1.5pt', 'medium'], ['3pt', 'thick'],
  ['1px', 'thin'], ['2px', 'medium'], ['3px', 'thick'],
])('preserves ordinary web CSS weight %s as %s', (width, bs) => {
  expect(read(`border:${width} solid red`, '').btBorder.bs).toBe(bs);
});

it('keeps non-point CSS lengths on their existing interpretation', () => {
  expect(read('border:2px solid red').btBorder.bs).toBe('medium');
  expect(read('border:0.02in solid red').btBorder.bs).toBe('medium');
});

it('settles stylesheet shorthands, longhands and cleared sides before assigning weights', () => {
  const html = `${office}<style>.edge {border:1pt solid #123456; border-bottom-width:1.5pt; border-top-width:.5pt}</style>
    <table><tr><td class="edge" style="border-right:0pt solid blue;border-left-color:transparent">Value</td></tr></table>`;
  const style = parseHtmlClipboard(html).rows[0][0].style;
  expect(style.btBorder).toEqual({ bs: 'thin', bc: '#123456' });
  expect(style.bbBorder).toEqual({ bs: 'thick', bc: '#123456' });
  for (const side of ['br', 'bl']) {
    expect(style[side]).toBe(false);
    expect(style[`${side}Border`]).toBeNull();
  }
});

it.each(['none', 'hidden', '0pt solid red', '1.5pt solid rgba(12,34,56,0)'])('keeps cleared borders cleared: %s', css => {
  const style = read(`border:${css}`);
  for (const side of sides) {
    expect(style[side]).toBe(false);
    expect(style[`${side}Border`]).toBeNull();
  }
});

const weights = [
  ['thin', '0.5pt', '1px', 'solid'], ['medium', '1pt', '2px', 'solid'],
  ['thick', '1.5pt', '3px', 'solid'], ['dashed', '0.5pt', '1px', 'dashed'],
  ['dotted', '0.5pt', '1px', 'dotted'], ['double', '1.5pt', '3px', 'double'],
];
it.each(weights)('exports and reimports %s through private and external clipboard representations', (bs, point, pixel, cssStyle) => {
  const s = { bt: true, br: true, bb: true, bl: true, bs, bc: '#ad3517' };
  const cells = [[{ v: 6, f: '2*3', s }]];
  const html = cellsToHtml([['6']], cells);
  expect(parseHtmlClipboard(html).cells).toEqual(cells);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const side of ['top', 'right', 'bottom', 'left']) {
    expect(doc.querySelector('td').style.getPropertyValue(`border-${side}-width`)).toBe(point);
    expect(doc.querySelector('td').style.getPropertyValue(`border-${side}-style`)).toBe(cssStyle);
  }
  // Simulate external software keeping the visible Office HTML without the
  // signed private snapshot. The border semantics must stand on their own.
  for (const attr of [...doc.querySelector('table').attributes]) doc.querySelector('table').removeAttribute(attr.name);
  const parsed = parseHtmlClipboard(doc.documentElement.outerHTML);
  expect(parsed.cells).toBeUndefined();
  for (const side of sides) expect(parsed.rows[0][0].style[`${side}Border`]).toEqual({ bs, bc: '#ad3517' });
  const page = new DOMParser().parseFromString(cellsToHtml([['6']], cells, null, null, null, { clipboard: false }), 'text/html');
  expect(page.querySelector('td').style.borderTopWidth).toBe(pixel);
});

it('exports each side descriptor independently and retains explicit removals', () => {
  const s = { bt: true, br: true, bb: true, bl: false, bs: 'double', bc: '#112233',
    btBorder: { bs: 'thin', bc: '#445566' }, brBorder: { bs: 'medium', bc: '#778899' } };
  const html = cellsToHtml([['Sides']], [[{ v: 'Sides', s }]]);
  const td = new DOMParser().parseFromString(html, 'text/html').querySelector('td');
  expect(td.style.borderTopWidth).toBe('0.5pt');
  expect(td.style.borderRightWidth).toBe('1pt');
  expect(td.style.borderBottomWidth).toBe('1.5pt');
  expect(td.style.borderLeftStyle).toBe('none');
  expect(td.style.borderTopColor).toBe('rgb(68, 85, 102)');
  expect(td.style.borderRightColor).toBe('rgb(119, 136, 153)');
});
