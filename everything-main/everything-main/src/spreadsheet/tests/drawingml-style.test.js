import { expect, it } from 'vitest';
import { resolveDrawingStyle } from '../src/core/drawingml-style.js';

const n = (name, attrs = {}, children = []) => ({ name, attrs, children });
const child = (node, name) => node.children.find(c => c.name === name);
const color = (value, transforms = []) => n('srgbClr', { val: value }, transforms);
const solid = value => n('solidFill', {}, [color(value)]);
const reference = (name, idx, clr = color('407080')) => n(name, { idx }, [clr]);
const shape = (props, refs) => n('sp', {}, [n('spPr', {}, props), n('style', {}, refs)]);
const matrix = () => n('fmtScheme', {}, [
  n('fillStyleLst', {}, [n('solidFill', {}, [n('schemeClr', { val: 'phClr' }, [n('shade', { val: 50000 })])]),
    n('gradFill', { rotWithShape: '0' }, [n('gsLst', {}, [n('gs', { pos: 0 }, [color('102030')]), n('gs', { pos: 100000 }, [color('ffffff')])]), n('lin', { ang: 5400000, scaled: '1' })])]),
  n('bgFillStyleLst', {}, [solid('abcdef')]),
  n('lnStyleLst', {}, [n('ln', { w: 25400, cap: 'rnd', cmpd: 'sng' }, [n('solidFill', {}, [n('schemeClr', { val: 'phClr' })]), n('prstDash', { val: 'dash' }), n('miter', { lim: 400000 }), n('headEnd', { type: 'none', w: 'lg', len: 'sm' })])]),
  n('effectStyleLst', {}, [n('effectStyle', {}, [n('effectLst', {}, [n('outerShdw', { dist: 12700 }, [color('000000')])])])]),
]);
const propsOf = shape => child(shape, 'spPr');

it('merges direct line attributes and child choices over the selected matrix style without mutation', () => {
  const source = shape([n('ln', { cap: 'flat' }, [n('noFill'), n('round'), n('headEnd', { type: 'triangle' })])], [reference('lnRef', 1)]);
  const before = JSON.stringify(source), theme = matrix(), themeBefore = JSON.stringify(theme);
  const props = propsOf(resolveDrawingStyle(source, theme)), line = child(props, 'ln');
  expect(line.attrs).toEqual({ w: 25400, cap: 'flat', cmpd: 'sng' });
  expect(line.children.map(c => c.name)).toEqual(['noFill', 'prstDash', 'round', 'headEnd']);
  expect(child(line, 'headEnd').attrs).toEqual({ type: 'triangle', w: 'lg', len: 'sm' });
  expect(JSON.stringify(source)).toBe(before); expect(JSON.stringify(theme)).toBe(themeBefore);
});

it('substitutes phClr and preserves the ordered reference/style color transforms', () => {
  const source = shape([], [reference('fillRef', 1, color('804020', [n('tint', { val: 80000 }), n('alpha', { val: 33333 })]))]);
  const resolved = child(propsOf(resolveDrawingStyle(source, matrix())), 'solidFill').children[0];
  expect(resolved.attrs.val).toBe('804020');
  expect(resolved.children.map(c => c.name)).toEqual(['tint', 'alpha', 'shade']);
});

it('does not apply a style color or its transforms over an explicit color', () => {
  const source = shape([solid('123456')], [reference('fillRef', 1)]);
  expect(child(propsOf(resolveDrawingStyle(source, matrix())), 'solidFill')).toEqual(solid('123456'));
});

it.each([0, 1000])('resolves the standard no-fill index %i', idx => {
  expect(propsOf(resolveDrawingStyle(shape([], [reference('fillRef', idx)]), matrix())).children).toEqual([n('noFill')]);
});

it('resolves background fill indices independently of foreground fill indices', () => {
  expect(propsOf(resolveDrawingStyle(shape([], [reference('fillRef', 1001)]), matrix())).children).toEqual([solid('abcdef')]);
});

it('inherits gradient properties while preserving a directly selected shading type and stop list', () => {
  const direct = n('gradFill', { flip: 'xy' }, [n('gsLst'), n('path', { path: 'circle' })]);
  const out = child(propsOf(resolveDrawingStyle(shape([direct], [reference('fillRef', 2)]), matrix())), 'gradFill');
  expect(out.attrs).toEqual({ rotWithShape: '0', flip: 'xy' });
  expect(child(out, 'gsLst').children).toEqual([]);
  expect(child(out, 'path').attrs.path).toBe('circle');
  expect(child(out, 'lin')).toBeUndefined();
});

it('lets an empty explicit effect list block inherited effects', () => {
  const source = shape([n('effectLst')], [reference('effectRef', 1)]);
  expect(child(propsOf(resolveDrawingStyle(source, matrix())), 'effectLst').children).toEqual([]);
  const inherited = propsOf(resolveDrawingStyle(shape([], [reference('effectRef', 1)]), matrix()));
  expect(child(child(inherited, 'effectLst'), 'outerShdw').attrs.dist).toBe(12700);
});

it('resolves child shapes inside groups and retains font references', () => {
  const source = n('grpSp', {}, [n('grpSpPr'), shape([], [reference('fillRef', 1001), reference('fontRef', 'major')])]);
  const back = resolveDrawingStyle(source, matrix()).children[1];
  expect(child(child(back, 'style'), 'fontRef').attrs.idx).toBe('major');
  expect(propsOf(back).children).toEqual([solid('abcdef')]);
});

it.each([-1, 0.5, 300, 'invalid'])('rejects unresolved matrix index %j without dropping its styling', idx => {
  expect(() => resolveDrawingStyle(shape([], [reference('fillRef', idx)]), matrix())).toThrow();
});
