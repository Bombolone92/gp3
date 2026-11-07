/**
 * Equations in XLSX drawings, as Excel writes them: the anchor twice in an mc:AlternateContent. The
 * a14 choice holds a text box whose paragraph is Office Math (a14:m ▸ m:oMathPara); the fallback holds the
 * same text box with the equation's linear text, for readers without Office Math. Reading takes the
 * choice and makes it an editable equation again.
 */
import { equationOmml, equationText, ommlToSource, EQUATION_DEFAULT_SIZE } from './equation.js';
import { xmlText } from './xlsx-export-styles.js';

const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const A14 = 'http://schemas.microsoft.com/office/drawing/2010/main';
const ALIGN = { left: 'l', center: 'ctr', right: 'r' };

/** The math paragraph and the fallback paragraph of equation text box `obj`. */
export function equationParagraphs(obj) {
  const s = obj.style || {};
  const pt = Math.round((s.size || EQUATION_DEFAULT_SIZE) * 0.75 * 2) / 2;
  const sz = Math.round(pt * 100);
  const color = /^#[0-9a-f]{6}$/i.test(s.color || '') ? `<a:solidFill><a:srgbClr val="${s.color.slice(1).toUpperCase()}"/></a:solidFill>` : '';
  const pPr = `<a:pPr algn="${ALIGN[s.align] || 'ctr'}"/>`;
  const math = `<a:p>${pPr}<a14:m>${equationOmml(obj.equation, { size: pt })}</a14:m><a:endParaRPr lang="en-US" sz="${sz}"/></a:p>`;
  const fallback = `<a:p>${pPr}<a:r><a:rPr lang="en-US" sz="${sz}" b="0" i="0">${color}<a:latin typeface="Cambria Math" panose="02040503050406030204" pitchFamily="18" charset="0"/></a:rPr>`
    + `<a:t>${xmlText(equationText(obj.equation))}</a:t></a:r><a:endParaRPr lang="en-US" sz="${sz}"/></a:p>`;
  return { math, fallback };
}

/** An anchor holding an equation, wrapped as Excel wraps it: the math as the a14 choice, linear text as the fallback. */
export function equationAnchorXml(anchor, equation) {
  if (!equation) return anchor;
  return `<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:a14="${A14}" Requires="a14">${anchor}</mc:Choice>`
    + `<mc:Fallback>${anchor.split(equation.math).join(equation.fallback)}</mc:Fallback></mc:AlternateContent>`;
}

const find = (node, names, depth = 0) => {
  if (!node || depth > 64) return null;
  if (names.includes(node.name)) return node;
  for (const c of node.children || []) { const hit = find(c, names, depth + 1); if (hit) return hit; }
  return null;
};

/**
 * A drawing's top-level node, with an equation's mc:AlternateContent resolved to the anchor of its a14
 * choice. Every other node, other AlternateContent included, is returned as it is.
 */
export function equationAnchor(node) {
  if (node?.name !== 'AlternateContent') return node;
  const choice = (node.children || []).find(c => c.name === 'Choice' && /\ba14\b/.test(c.attrs?.Requires || ''));
  const anchor = choice?.children?.find(c => /Anchor$/.test(c.name));
  return anchor && find(anchor, ['oMathPara', 'oMath']) ? anchor : node;
}

/** An equation text box read from shape `sp` (an XML tree node), or null when the shape holds no Office Math. */
export function readEquationShape(sp) {
  const body = (sp?.children || []).find(c => c.name === 'txBody');
  const math = find(body, ['oMathPara', 'oMath']);
  if (!math) return null;
  const source = ommlToSource(math);
  if (!source.trim()) return null;
  const findSize = (n, depth = 0) => {
    if (!n || depth > 64) return null;
    if (['rPr', 'endParaRPr', 'defRPr'].includes(n.name) && Number(n.attrs?.sz) > 0) return Number(n.attrs.sz) / 100;
    for (const c of n.children || []) { const v = findSize(c, depth + 1); if (v) return v; }
    return null;
  };
  const pt = findSize(body) || 11;
  const algn = find(body, ['pPr'])?.attrs?.algn;
  const anchor = (body.children || []).find(c => c.name === 'bodyPr')?.attrs?.anchor;
  return {
    equation: source, text: equationText(source),
    style: { size: Math.round(pt * 4 / 3 * 100) / 100, align: { l: 'left', r: 'right' }[algn] || 'center', valign: { ctr: 'middle', b: 'bottom' }[anchor] || 'top', border: false, bg: null },
  };
}
