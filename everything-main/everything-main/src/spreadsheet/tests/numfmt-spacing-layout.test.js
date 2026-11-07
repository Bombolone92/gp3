import { expect, it } from 'vitest';
import { formatCodeParts, formatWithCode } from '../src/core/numfmt.js';
import { numberFormatParts, measureFormatParts, layoutFormatParts, wrappedFormatLineCount } from '../src/core/format-layout.js';

const measure = text => [...text].reduce((sum, char) => sum + ({ W: 12, i: 3, ')': 5, ' ': 4, '.': 3, '\u200b': 0 }[char] ?? 8), 0);
const parts = (value, code) => numberFormatParts(value, { fmt: 'custom', code });
it('preserves glyph padding and fill as operations while retaining widthless string output', () => {
  const code = '_W"USD"*.0.00_)';
  expect(formatCodeParts(12, code)).toEqual([{ type: 'pad', char: 'W' }, { type: 'text', text: 'USD' }, { type: 'fill', char: '.' }, { type: 'text', text: '12.00' }, { type: 'pad', char: ')' }]);
  expect(formatWithCode(12, code)).toBe(' USD12.00 ');
  expect(measureFormatParts(parts(12, code), measure)).toBe(76);
  const narrow = layoutFormatParts(parts(12, code), 82, measure), wide = layoutFormatParts(parts(12, code), 106, measure);
  expect(narrow.runs.find(r => r.type === 'fill').text).toBe('..');
  expect(wide.runs.find(r => r.type === 'fill').text).toBe('..........');
  expect(narrow.runs.filter(r => r.type === 'pad').map(r => r.width)).toEqual([12, 5]);
  expect(formatWithCode(12, code)).toBe(' USD12.00 '); // cached tokens were not mutated
});
it.each([
  [125, '_($* 0.00_);_($* (0.00);_($* "-"??_);_(@_)', ['pad', 'text', 'fill', 'text', 'pad']],
  [-125, '_($* 0.00_);_($* (0.00);_($* "-"??_);_(@_)', ['pad', 'text', 'fill', 'text']],
  ['hello', '0;0;0;_W@*.', ['pad', 'text', 'fill']],
  [45300, 'yyyy*-mm-dd', ['text', 'fill', 'text']],
  [1.25, '[h]*.mm', ['text', 'fill', 'text']],
  [2.25, '# ?/?*-', ['text', 'fill']],
  [2, '# ?/?*-', ['text', 'fill']],
  [12345, '0.00E+00*.', ['text', 'fill']],
])('retains selected operations across section families: %s %s', (value, code, types) => {
  expect(parts(value, code).map(p => p.type)).toEqual(types);
});
it('does not turn quoted or escaped operators into instructions', () => {
  expect(formatCodeParts(12, '"_*"0')).toBeNull();
  expect(formatCodeParts(12, '\\_\\*0')).toBeNull();
  expect(formatCodeParts(12, '[>100]0*.;0')).toBeNull();
  expect(formatCodeParts('text', '0*.')).toBeNull();
});
it('does not confuse private-use text with internal layout operations', () => {
  const value = '\ue000\ue001\ue002';
  expect(formatCodeParts(value, '0;0;0;_W@*.')).toEqual([{ type: 'pad', char: 'W' }, { type: 'text', text: value }, { type: 'fill', char: '.' }]);
  const all = Array.from({ length: 0x1900 }, (_, i) => String.fromCharCode(0xe000 + i)).join('');
  expect(formatCodeParts(all, '0;0;0;_W@*.')).toEqual([{ type: 'pad', char: 'W' }, { type: 'text', text: all }, { type: 'fill', char: '.' }]);
});
it('never fills when intrinsic content is already too wide or the glyph has no advance', () => {
  const source = parts(12, '_W0*.');
  expect(layoutFormatParts(source, 10, measure)).toMatchObject({ naturalWidth: 28, width: 28 });
  expect(layoutFormatParts(parts(12, '0*.'), 80, () => 0).runs.at(-1).text).toBe('');
});
it('handles selected conditions and does not leak parts into TEXT results', () => {
  const code = '[>100]"big"*-0;[Red]_W0;@';
  expect(parts(200, code).some(p => p.type === 'fill')).toBe(true);
  expect(parts(20, code).some(p => p.type === 'pad')).toBe(true);
  expect(formatWithCode(200, code, { textFunction: true })).toBe('big200');
});
it('lays out explicit wrapped lines independently and ignores inactive newlines', () => {
  const style = { fmt: 'custom', code: '0"\n"_W"line"', wrap: true };
  const source = numberFormatParts(12, style);
  expect(source.some(p => p.type === 'break')).toBe(true);
  expect(measureFormatParts(source, measure)).toBe(39);
  expect(layoutFormatParts(source, 100, measure).naturalWidth).toBe(39);
  expect(numberFormatParts(12, { ...style, wrap: false }).some(p => p.type === 'break')).toBe(false);
});
it('uses only the last fill, including imported sections with different fill characters', () => {
  expect(layoutFormatParts(parts(12, '*x0*y'), 48, measure).runs.filter(r => r.type === 'fill').map(r => r.text)).toEqual(['', 'yyyy']);
  expect(layoutFormatParts(parts(2, '#*x?/?'), 80, measure).runs.find(r => r.type === 'fill').text).not.toBe('');
});
it('measures the whole repeated run even when shaping reduces its advance', () => {
  const shaped = t => t.length < 2 ? t.length * 10 : t.length * 4;
  expect(layoutFormatParts(parts(12, '*.'), 80, shaped).runs[0].text).toHaveLength(20);
});
it('keeps Unicode fill characters whole', () => {
  expect(layoutFormatParts(parts(12, '0*😀'), 48, measure).runs.at(-1).text).toBe('😀😀😀😀');
});
it('includes physical pads in wrapped row measurement without expanding fill', () => {
  const source = parts('abc def', '0;0;0;_W@*.');
  expect(wrappedFormatLineCount(source, 60, measure)).toBe(2);
  expect(wrappedFormatLineCount(source, 100, measure)).toBe(1);
});

it.each([
  ['@*.', true], ['*.@', false], ['"A"*.@', true], ['" "*.@', true],
  ['""*.@', false], ['_W*.@', true], ['*.@_W', false], ['@_W', false],
  ['*.*-@', false], ['*.@*-', true], ['@*\u200b', false], ['*.@*\u200b', false],
])('requires a complete horizontal fit for the effective fill in %s: %s', (code, required) => {
  const source = parts('abc def ghi', `0;0;0;${code}`);
  const layout = layoutFormatParts(source, 20, measure);
  expect(layout.requiresFit).toBe(required);
  expect(layout.runs.filter(r => r.type === 'fill').every(r => r.text === '')).toBe(true);
  expect(layout.naturalWidth).toBeGreaterThan(20);
});
it.each(['*.@', '@*.'])('budgets fill once across hard line breaks in %s', code => {
  const source = numberFormatParts('ab\ncd', { fmt: 'custom', code: `0;0;0;${code}`, wrap: true });
  const layout = layoutFormatParts(source, 45, measure);
  expect(layout.naturalWidth).toBe(36); // the break has the horizontal width of a space
  expect(layout.runs.find(r => r.type === 'fill').text).toBe('...');
  expect(layout.runs.filter(r => r.type === 'break')).toHaveLength(1);
  expect(layout.width).toBe(25); // painting still has two lines
  // AutoFit continues to measure the underlying wrapped text, even if its
  // constrained display would be hashes. Native row/column controls confirm it.
  expect(measureFormatParts(source, measure)).toBe(16);
  expect(wrappedFormatLineCount(source, 12, measure)).toBe(4);
});
it('treats a hard break before fill as content and keeps last-fill selection across lines', () => {
  const source = numberFormatParts('ab', { fmt: 'custom', code: '0;0;0;"\n"*.@', wrap: true });
  expect(layoutFormatParts(source, 15, measure)).toMatchObject({ requiresFit: true, naturalWidth: 20 });
  const multiline = numberFormatParts('ab', { fmt: 'custom', code: '0;0;0;*x@"\n"*.', wrap: true });
  const layout = layoutFormatParts(multiline, 29, measure);
  expect(layout.runs.filter(r => r.type === 'fill').map(r => r.text)).toEqual(['', '...']);
});
