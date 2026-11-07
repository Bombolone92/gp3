import { describe, expect, it } from 'vitest';
import {
  parseEquation, sourceRow, equationText, equationMathML, equationOmml, ommlToTree, ommlToSource, BUILTIN_EQUATIONS, builtinEquation, estimateEquationSize,
} from '../src/core/equation.js';

/** A namespace-independent XML tree, as the XLSX drawing reader builds one. */
function tree(xml) {
  const root = { children: [] }, stack = [root];
  for (const m of xml.matchAll(/<[^>]*>|[^<]+/g)) {
    const token = m[0], parent = stack[stack.length - 1];
    if (token.startsWith('</')) { stack.pop(); continue; }
    if (token[0] !== '<') { parent.text = (parent.text || '') + token.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); continue; }
    const name = token.match(/^<([\w:.-]+)/)[1];
    const node = { name: name.split(':').pop(), attrs: {}, children: [] };
    for (const a of token.matchAll(/([\w:.-]+)="([^"]*)"/g)) node.attrs[a[1]] = a[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    parent.children.push(node);
    if (!token.endsWith('/>')) stack.push(node);
  }
  return root;
}

describe('the linear format', () => {
  it('builds fractions from the operands either side of a slash, removing their brackets', () => {
    expect(parseEquation('ab/c+d')).toEqual([
      { t: 'frac', num: [{ t: 'i', s: 'a' }, { t: 'i', s: 'b' }], den: [{ t: 'i', s: 'c' }] }, { t: 'o', s: '+' }, { t: 'i', s: 'd' }]);
    const [, , frac] = parseEquation('x=(-b±√(b^2-4ac))/2a');
    expect(frac.t).toBe('frac');
    expect(frac.num[0]).toEqual({ t: 'o', s: '−' });
    expect(frac.num[3]).toMatchObject({ t: 'rad', deg: null });
    expect(frac.den).toEqual([{ t: 'n', s: '2' }, { t: 'i', s: 'a' }]);
  });

  it('reads scripts, radicals, large operators with limits, functions, accents and matrices', () => {
    expect(parseEquation('x_i^2')).toEqual([{ t: 'scr', base: [{ t: 'i', s: 'x' }], sub: [{ t: 'i', s: 'i' }], sup: [{ t: 'n', s: '2' }] }]);
    expect(parseEquation('\\sqrt[3]{x}')).toEqual([{ t: 'rad', deg: [{ t: 'n', s: '3' }], body: [{ t: 'i', s: 'x' }] }]);
    expect(parseEquation('√(3&x)')).toEqual(parseEquation('\\sqrt[3]{x}'));
    const [sum] = parseEquation('\\sum_{k=0}^{n} a_k + 1');
    expect(sum).toMatchObject({ t: 'nary', chr: '∑', sub: [{ s: 'k' }, { s: '=' }, { s: '0' }], sup: [{ s: 'n' }] });
    expect(sum.body).toEqual([{ t: 'scr', base: [{ t: 'i', s: 'a' }], sub: [{ t: 'i', s: 'k' }], sup: null }]);
    expect(parseEquation('∑_(k=0)^n▒a_k')[0]).toEqual(sum);
    expect(parseEquation('\\int_0^\\infty e^{-x}dx')[0]).toMatchObject({ t: 'nary', chr: '∫', sub: [{ s: '0' }], sup: [{ s: '∞' }] });
    expect(parseEquation('\\sin\\alpha\\pm\\sin\\beta')).toMatchObject([{ t: 'func', name: [{ t: 'fn', s: 'sin' }], arg: [{ s: 'α' }] }, { s: '±' }, { t: 'func' }]);
    expect(parseEquation('sin x')).toMatchObject([{ t: 'func', arg: [{ s: 'x' }] }]);
    expect(parseEquation('\\lim_{n\\to\\infty} a_n')[0]).toMatchObject({ t: 'func', name: [{ t: 'lim', base: [{ t: 'fn', s: 'lim' }], lim: [{ s: 'n' }, { s: '→' }, { s: '∞' }] }] });
    expect(parseEquation('\\hat{x}\\vec v\\overline{AB}')).toMatchObject([{ t: 'acc', chr: '̂' }, { t: 'acc', chr: '⃗' }, { t: 'bar' }]);
    expect(parseEquation('\\pmatrix{1 & 0 \\\\ 0 & 1}')).toEqual([{ t: 'delim', open: '(', close: ')', body: [{ t: 'mat', rows: [[[{ t: 'n', s: '1' }], [{ t: 'n', s: '0' }]], [[{ t: 'n', s: '0' }], [{ t: 'n', s: '1' }]]] }] }]);
    expect(parseEquation('■(a&b@c&d)')[0]).toMatchObject({ t: 'mat', rows: [[[{ s: 'a' }], [{ s: 'b' }]], [[{ s: 'c' }], [{ s: 'd' }]]] });
    expect(parseEquation('\\binom{n}{k}')).toEqual([{ t: 'delim', open: '(', close: ')', body: [{ t: 'frac', num: [{ t: 'i', s: 'n' }], den: [{ t: 'i', s: 'k' }], noBar: true }] }]);
    expect(parseEquation('|x|')).toEqual([{ t: 'delim', open: '|', close: '|', body: [{ t: 'i', s: 'x' }] }]);
    expect(parseEquation('\\left[ x \\right.')).toEqual([{ t: 'delim', open: '[', close: '', body: [{ t: 'i', s: 'x' }] }]);
  });

  it('never throws on unbalanced or unknown input', () => {
    for (const s of ['(', ')', '{', '}', '\\frac{', '^', '_', 'x^', '|a', '\\unknown{x}', '\\', '/', '//', '■(', '\\left(', '"text']) expect(() => parseEquation(s)).not.toThrow();
  });

  it('writes linear text with the Unicode operators Office uses', () => {
    expect(equationText('x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}')).toBe('x=(−b±√(b^2−4ac))/(2a)');
    expect(equationText('\\sum_{k=0}^{n} a_k')).toBe('∑_(k=0)^n▒(a_k)');
    expect(equationText('\\pmatrix{1&0\\\\0&1}')).toBe('(■(1&0@0&1))');
  });

  it('writes a source that reads back to the same equation', () => {
    const samples = [...BUILTIN_EQUATIONS.map(b => b.source), 'x=(-b±√(b^2-4ac))/2a', 'ab/c+d', '|x|+\\lim_{n\\to\\infty}(1+1/n)^n', '\\sin^2\\theta+\\cos^2\\theta=1',
      '\\log_2 8=3', '\\hat{x}+\\overline{AB}+\\vec v', '\\sqrt[3]{x}', '\\left[ x \\right.', '\\text{area}=w h', '\\langle a\\rangle', '\\underset{x}{\\rightarrow}'];
    for (const s of samples) {
      const tree = parseEquation(s);
      expect(parseEquation(sourceRow(tree)), s).toEqual(tree);
    }
  });
});

describe('MathML', () => {
  it('draws the structures built up', () => {
    const ml = equationMathML('x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}');
    expect(ml).toMatch(/^<math xmlns="http:\/\/www.w3.org\/1998\/Math\/MathML" display="block">/);
    expect(ml).toContain('<mfrac><mrow><mo form="prefix">−</mo><mi>b</mi><mo>±</mo><msqrt><msup><mrow><mi>b</mi></mrow><mrow><mn>2</mn></mrow></msup>');
    expect(equationMathML('\\sum_{k=0}^{n}k')).toContain('<munderover><mo largeop="true" movablelimits="false">∑</mo>');
    expect(equationMathML('\\int_0^1 x dx')).toContain('<msubsup><mo largeop="true" movablelimits="false">∫</mo>');
    expect(equationMathML('\\pmatrix{1&0\\\\0&1}')).toContain('<mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>0</mn></mtd></mtr>');
    expect(equationMathML('a<b')).toContain('<mo>&lt;</mo>');
  });
});

describe('Office Math', () => {
  it('writes OMML and reads it back to the same equation', () => {
    for (const { source } of BUILTIN_EQUATIONS) {
      const xml = equationOmml(source, { size: 11 });
      expect(xml).toMatch(/^<m:oMathPara xmlns:m="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/math"><m:oMathParaPr><m:jc m:val="centerGroup"\/><\/m:oMathParaPr><m:oMath>/);
      expect(ommlToTree(tree(xml)), source).toEqual(parseEquation(source));
      expect(parseEquation(ommlToSource(tree(xml)))).toEqual(parseEquation(source));
    }
    const quadratic = equationOmml(builtinEquation('quadratic').source);
    expect(quadratic).toContain('<m:f><m:num>');
    expect(quadratic).toContain('<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>');
    expect(quadratic).toContain('<a:latin typeface="Cambria Math"');
    const sum = equationOmml('\\sum_{k=0}^{n}k');
    expect(sum).toContain('<m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub>');
    expect(equationOmml('\\sin x')).toContain('<m:func><m:fName><m:r><m:rPr><m:sty m:val="p"/></m:rPr>');
  });

  it('reads Office Math written by Word or Excel, with multi-letter runs and implicit properties', () => {
    const xml = '<m:oMathPara><m:oMath><m:r><m:t>E=m</m:t></m:r><m:sSup><m:e><m:r><m:t>c</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>'
      + '<m:r><m:t>+</m:t></m:r><m:nary><m:naryPr><m:limLoc m:val="subSup"/></m:naryPr><m:sub><m:r><m:t>0</m:t></m:r></m:sub><m:sup><m:r><m:t>1</m:t></m:r></m:sup><m:e><m:r><m:t>xdx</m:t></m:r></m:e></m:nary>'
      + '<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e><m:r><m:t>12</m:t></m:r></m:e></m:d></m:oMath></m:oMathPara>';
    expect(ommlToTree(tree(xml))).toEqual(parseEquation('E=mc^2+\\int_0^1{xdx}[12]'));
  });

  it('offers the built-in equations, each well formed', () => {
    expect(BUILTIN_EQUATIONS.map(b => b.label)).toEqual(['Area of Circle', 'Binomial Theorem', 'Expansion of a Sum', 'Fourier Series', 'Pythagorean Theorem',
      'Quadratic Formula', 'Taylor Expansion', 'Trig Identity 1', 'Trig Identity 2']);
    for (const b of BUILTIN_EQUATIONS) {
      expect(JSON.stringify(parseEquation(b.source))).not.toContain('"tx"');
      const size = estimateEquationSize(b.source);
      expect(size.w).toBeGreaterThan(60); expect(size.h).toBeGreaterThan(30);
    }
  });
});
