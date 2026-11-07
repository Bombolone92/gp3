import { fontStack } from './format.js';

const child = (node, name) => node?.children.find(n => n.name === name);
const children = (node, name) => node?.children.filter(n => n.name === name) || [];
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const emu = (value, fallback = 0) => value != null && Number.isFinite(+value) ? Math.max(-1e7, Math.min(1e7, +value / 9525)) : fallback;
const bool = value => ['1', 'true'].includes(value);
const colorRef = (ref, fill) => ref && fill({ children: [{ name: 'solidFill', children: ref.children }] });

/** Sanitized HTML in a self-contained SVG text viewport; the browser lays out rich runs and wraps words. */
export function drawingText(node, rect, fill, font, defaultSize = 11 * 4 / 3) {
  const body = child(node, 'txBody');
  if (!body) return '';
  const paragraphs = children(body, 'p');
  if (paragraphs.length > 1000) return null;
  let count = 0;
  const props = child(body, 'bodyPr')?.attrs || {};
  const ref = child(child(node, 'style'), 'fontRef');
  const baseFont = font?.(ref?.attrs.idx === 'major' ? '+mj-lt' : '+mn-lt', 'arial') || 'arial';
  const refColor = colorRef(ref, fill);
  const baseColor = refColor === 'none' ? 'transparent' : refColor || '#000000';
  const runStyle = (sources) => {
    const st = { font: baseFont, color: baseColor, size: defaultSize, spacing: 0 };
    for (const source of sources.filter(Boolean)) {
      const a = source.attrs;
      if (+a.sz > 0 && +a.sz <= 400000) st.size = +a.sz / 75;
      // ST_TextPoint is signed hundredths of a point, including an explicit
      // zero that cancels inherited character spacing (ISO 29500 §20.1.10.75).
      if (a.spc != null && String(a.spc).trim() !== '' && Number.isInteger(+a.spc) && Math.abs(+a.spc) <= 400000) st.spacing = +a.spc / 75;
      const face = child(source, 'latin')?.attrs.typeface;
      if (face) st.font = font?.(face, st.font) || st.font;
      const color = fill(source);
      if (color) st.color = color === 'none' ? 'transparent' : color;
      for (const key of ['b', 'i']) if (a[key] != null) st[key] = bool(a[key]);
      if (a.u != null) st.underline = a.u !== 'none';
      if (a.strike != null) st.strike = a.strike !== 'noStrike';
      if (a.cap != null) st.cap = a.cap;
    }
    return `font-family:${fontStack(st.font) || 'Arial, sans-serif'};font-size:${st.size}px;letter-spacing:${st.spacing}px;color:${st.color};font-weight:${st.b ? 700 : 400};font-style:${st.i ? 'italic' : 'normal'};text-decoration:${[st.underline && 'underline', st.strike && 'line-through'].filter(Boolean).join(' ') || 'none'};text-transform:${st.cap === 'all' ? 'uppercase' : 'none'};font-variant:${st.cap === 'small' ? 'small-caps' : 'normal'}`;
  };
  const html = [];
  for (const p of paragraphs) {
    const pp = child(p, 'pPr'), a = pp?.attrs || {};
    const level = Math.max(0, Math.min(8, Number(a.lvl) || 0));
    const list = child(child(body, 'lstStyle'), `lvl${level + 1}pPr`);
    const defaults = [child(list, 'defRPr'), child(pp, 'defRPr')];
    const runs = [];
    for (const run of p.children) {
      if (++count > 10000) return null;
      if (run.name === 'br') { runs.push('<br/>'); continue; }
      if (!['r', 'fld'].includes(run.name)) continue;
      const text = child(run, 't')?.text || '';
      count += text.length / 16;
      if (count > 10000) return null;
      runs.push(`<span style="${esc(runStyle([...defaults, child(run, 'rPr')]))}">${esc(text)}</span>`);
    }
    const align = ({ ctr: 'center', r: 'right', just: 'justify', dist: 'justify' })[a.algn || list?.attrs.algn] || 'left';
    const spacing = name => {
      const spacing = child(pp, name) || child(list, name), points = child(spacing, 'spcPts');
      return points ? Math.max(0, Math.min(1000, Number(points.attrs.val) / 75 || 0)) : 0;
    };
    const line = child(pp, 'lnSpc') || child(list, 'lnSpc');
    const linePoints = child(line, 'spcPts'), linePercent = child(line, 'spcPct');
    const lineHeight = linePoints ? `${Math.max(0, Number(linePoints.attrs.val) / 75 || 0)}px`
      : linePercent ? Math.max(0, Math.min(10, Number(linePercent.attrs.val) / 100000 * 1.2 || 0)) : '1.2';
    // The paragraph's line box must follow its text size. A missing endParaRPr
    // size used to give an 11pt caption an 18pt line box and clip its baseline.
    const firstRun = p.children.find(n => ['r', 'fld'].includes(n.name));
    const css = `${runStyle([...defaults, child(p, 'endParaRPr'), child(firstRun, 'rPr')])};margin:${spacing('spcBef')}px ${emu(a.marR)}px ${spacing('spcAft')}px ${emu(a.marL)}px;text-indent:${emu(a.indent)}px;text-align:${align};line-height:${lineHeight};direction:${bool(a.rtl) ? 'rtl' : 'ltr'}`;
    html.push(`<div style="${esc(css)}">${runs.join('') || '<br/>'}</div>`);
  }
  if (!html.length) return '';
  const [l, t, r, b] = rect;
  const w = Math.max(0, (r - l) / 9525), h = Math.max(0, (b - t) / 9525);
  if (!(w > 0 && h > 0)) return '';
  const align = ({ ctr: 'center', b: 'flex-end', just: 'space-between', dist: 'space-around' })[props.anchor] || 'flex-start';
  const padding = `${Math.max(0, emu(props.tIns, 4.8))}px ${Math.max(0, emu(props.rIns, 9.6))}px ${Math.max(0, emu(props.bIns, 4.8))}px ${Math.max(0, emu(props.lIns, 9.6))}px`;
  const writing = ({ vert: 'vertical-rl', vert270: 'vertical-lr', eaVert: 'vertical-rl' })[props.vert] || 'horizontal-tb';
  // ISO 29500 bodyPr defaults both axes to overflow. CSS "hidden" on one
  // axis makes "visible" on the other compute to auto; "clip" is independent.
  const overflow = `overflow-x:${props.horzOverflow === 'clip' ? 'clip' : 'visible'};overflow-y:${['clip', 'ellipsis'].includes(props.vertOverflow) ? 'clip' : 'visible'}`;
  // Use pixel-sized CSS inside a scaled viewport: browser font-size caps are
  // far below DrawingML's EMU coordinates (one CSS pixel is 9525 EMUs).
  return `<g transform="translate(${l} ${t}) scale(9525)"><foreignObject width="${w}" height="${h}" overflow="visible"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;box-sizing:border-box;display:flex;flex-direction:column;justify-content:${align};${overflow};padding:${padding};white-space:${props.wrap === 'none' ? 'pre' : 'pre-wrap'};overflow-wrap:break-word;writing-mode:${writing}"><div style="flex:none;width:100%">${html.join('')}</div></div></foreignObject></g>`;
}
