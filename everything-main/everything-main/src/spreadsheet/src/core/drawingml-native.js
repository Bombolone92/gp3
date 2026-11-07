/** Portable DrawingML shape records, independent of package IDs and source themes. */
import { fontName } from './format.js';
import { resolveDrawingStyle } from './drawingml-style.js';
import { drawingDecorative, decorativeXml, drawingDescription } from './drawingml-accessibility.js';
import { xmlTag, xmlText } from './xlsx-export-styles.js';

const child = (n, name) => n?.children.find(c => c.name === name);
const node = (name, attrs = {}, children = []) => ({ name, attrs, children });
export const validDrawingKey = key => typeof key === 'string' && /^[a-f0-9]{64}:\d+$/.test(key);
export function drawingNodeKey(n, scope) {
  const nv = n?.children.find(c => ['nvSpPr', 'nvCxnSpPr', 'nvGrpSpPr', 'nvPicPr', 'nvGraphicFramePr'].includes(c.name));
  const id = child(nv, 'cNvPr')?.attrs.id;
  return scope && /^\d+$/.test(id || '') ? `${scope}:${id}` : undefined;
}
// Only self-contained geometry/paint/text is stored. Package relationships,
// extension payloads and executable actions are never copied into another file.
const names = new Set(('sp cxnSp grpSp spPr grpSpPr xfrm off ext chOff chExt prstGeom custGeom avLst gdLst gd ahLst ahXY ahPolar pos cxnLst cxn rect pathLst path moveTo lnTo cubicBezTo quadBezTo arcTo close pt solidFill noFill srgbClr alpha ln prstDash custDash ds round bevel miter headEnd tailEnd txBody bodyPr lstStyle p pPr defRPr r rPr endParaRPr t br latin ea cs sym lnSpc spcAft spcBef spcPct spcPts buNone buChar buAutoNum buSzPct buSzPts buSzTx buFont buFontTx buClr buClrTx tabLst tab normAutofit noAutofit spAutoFit').split(' '));
for (let i = 1; i <= 9; i++) names.add(`lvl${i}pPr`);
names.add('alphaMod'); names.add('alphaOff'); names.add('effectLst');

export function normalizeNativeDrawing(raw) {
  if (!raw || !Array.isArray(raw.viewport) || raw.viewport.length !== 4
    || !raw.viewport.every(n => Number.isFinite(n) && Math.abs(n) <= 1e12)
    || raw.viewport[2] <= 0 || raw.viewport[3] <= 0) return null;
  let count = 0, bytes = 0;
  const copy = (n, depth = 0) => {
    if (!n || !names.has(n.name) || depth > 24 || ++count > 10000 || !Array.isArray(n.children)) throw 0;
    const attrs = {};
    for (const [k, v] of Object.entries(n.attrs || {})) {
      if ((!/^[A-Za-z][A-Za-z0-9]*$/.test(k) && !(k === 'xml:space' && ['default', 'preserve'].includes(v)))
        || !['string', 'number'].includes(typeof v) || String(v).length > 1000) throw 0;
      bytes += k.length + String(v).length;
      attrs[k] = v;
    }
    const text = n.text == null ? '' : String(n.text);
    if ((bytes += text.length) > 1000000) throw 0;
    const connections = ['start', 'end'].flatMap(end => {
      const c = n.name === 'cxnSp' && n.connections?.[end];
      return validDrawingKey(c?.target) && Number.isInteger(c.index) && c.index >= 0 && c.index <= 4294967295 ? [[end, { target: c.target, index: c.index }]] : [];
    });
    return { ...node(n.name, attrs, n.children.map(c => copy(c, depth + 1))), ...(text ? { text } : {}),
      ...(validDrawingKey(n.key) ? { key: n.key } : {}), ...(connections.length ? { connections: Object.fromEntries(connections) } : {}),
      ...(['sp', 'cxnSp', 'grpSp'].includes(n.name) && n.decorative === true ? { decorative: true } : {}) };
  };
  try {
    const root = copy(raw.node);
    if (!['sp', 'cxnSp', 'grpSp'].includes(root.name)) return null;
    return { node: root, viewport: [...raw.viewport] };
  } catch { return null; }
}

/** Capture supported native shapes while resolving workbook-local theme references. */
export function nativeDrawing(root, viewport, { fill, font, textSize, formatScheme, scope }) {
  const color = n => {
    const alpha = n.children.filter(c => ['alpha', 'alphaMod', 'alphaOff'].includes(c.name));
    const value = fill({ children: [node('solidFill', {}, [{ ...n, children: n.children.filter(c => !alpha.includes(c)) }])] });
    if (value === 'none') return node('srgbClr', { val: '000000' }, [node('alpha', { val: 0 })]);
    if (!/^#[\da-f]{6}([\da-f]{2})?$/i.test(value || '')) throw 0;
    return node('srgbClr', { val: value.slice(1, 7) }, alpha.map(c => node(c.name, { ...c.attrs })));
  };
  const copy = (n, depth = 0) => {
    if (depth > 24) throw 0;
    if (['srgbClr', 'schemeClr', 'sysClr', 'prstClr'].includes(n.name)) return color(n);
    if (!names.has(n.name)) throw 0;
    const attrs = Object.fromEntries(Object.entries(n.attrs).filter(([k]) => k !== 'xmlns' && !k.startsWith('xmlns:')));
    if (['latin', 'ea', 'cs'].includes(n.name) && attrs.typeface?.startsWith('+')) {
      attrs.typeface = fontName(font(attrs.typeface));
      if (!attrs.typeface || attrs.typeface.startsWith('+')) throw 0;
    }
    return { ...node(n.name, attrs, n.children.map(c => copy(c, depth + 1))), ...(n.text ? { text: n.text } : {}) };
  };
  const shape = n => {
    if (!['sp', 'cxnSp', 'grpSp'].includes(n.name) || n.attrs.macro || n.attrs.textlink) throw 0;
    const style = child(n, 'style');
    // Unresolved style references cannot move to a different workbook theme.
    if (style?.children.some(c => !['fontRef', 'fillRef', 'lnRef', 'effectRef'].includes(c.name))) throw 0;
    const children = n.children.filter(c => !['nvSpPr', 'nvCxnSpPr', 'nvGrpSpPr', 'style', 'extLst'].includes(c.name))
      .map(c => ['sp', 'cxnSp', 'grpSp'].includes(c.name) ? shape(c) : copy(c));
    const result = node(n.name, {}, children), body = child(result, 'txBody');
    const key = drawingNodeKey(n, scope);
    if (key) result.key = key;
    if (n.name === 'cxnSp' && scope) {
      const props = child(child(n, 'nvCxnSpPr'), 'cNvCxnSpPr');
      const connections = ['start', 'end'].flatMap(end => {
        const c = child(props, end === 'start' ? 'stCxn' : 'endCxn');
        return c ? [[end, { target: `${scope}:${c.attrs.id}`, index: Number(c.attrs.idx) }]] : [];
      });
      if (connections.length) result.connections = Object.fromEntries(connections);
    }
    if (drawingDecorative(n)) result.decorative = true;
    const ref = child(style, 'fontRef');
    if (body) {
      const defaultFont = fontName(font(ref?.attrs.idx === 'major' ? '+mj-lt' : '+mn-lt', 'arial'));
      const defaultColor = ref?.children[0] ? color(ref.children[0]) : node('srgbClr', { val: '000000' });
      // Lowest-priority paragraph defaults make the source theme portable while
      // retaining all explicit paragraph and run overrides.
      const list = child(body, 'lstStyle') || node('lstStyle');
      if (!child(body, 'lstStyle')) body.children.splice(1, 0, list);
      for (let i = 1; i <= 9; i++) {
        let level = child(list, `lvl${i}pPr`);
        if (!level) { level = node(`lvl${i}pPr`); list.children.push(level); }
        let defaults = child(level, 'defRPr');
        if (!defaults) { defaults = node('defRPr'); level.children.push(defaults); }
        defaults.attrs.sz ??= Math.round(textSize * 75);
        if (!child(defaults, 'solidFill') && !child(defaults, 'noFill')) defaults.children.push(node('solidFill', {}, [defaultColor]));
        if (!child(defaults, 'latin')) defaults.children.push(node('latin', { typeface: defaultFont }));
      }
    }
    return result;
  };
  try {
    const result = shape(resolveDrawingStyle(root, formatScheme)), xfrm = child(child(result, result.name === 'grpSp' ? 'grpSpPr' : 'spPr'), 'xfrm');
    // The sheet object owns the outer rotation/flips, just as for its SVG view.
    if (xfrm) for (const k of ['rot', 'flipH', 'flipV']) delete xfrm.attrs[k];
    return normalizeNativeDrawing({ node: result, viewport });
  } catch { return null; }
}

/** Export the same affine viewport as the SVG, retaining editable native paths/text. */
export function nativeDrawingXml(obj, id, allocateId, linkId, localIds = new Map(), drawingIds = new Map()) {
  const drawing = normalizeNativeDrawing(obj.nativeDrawing);
  if (!drawing) return null;
  const { node: root, viewport: [x, y, w, h] } = drawing;
  // The editable sheet object owns the outer accessibility flag; retain only
  // independently marked children when wrapping a shape for affine scaling.
  delete root.decorative;
  const transform = { rot: Math.round((obj.rotation || 0) * 60000), flipH: Number(!!obj.flipH), flipV: Number(!!obj.flipV) };
  const ext = node('ext', { cx: Math.round(obj.w * 9525), cy: Math.round(obj.h * 9525) });
  let group = root;
  const props = root.name === 'sp' ? child(root, 'spPr') : null, frame = child(props, 'xfrm');
  const geometry = child(props, 'custGeom') || child(props, 'prstGeom');
  const off = child(frame, 'off')?.attrs, size = child(frame, 'ext')?.attrs;
  // A freeform or plain rectangle/oval/line whose frame is its whole box (ink, and shapes made from ink) is written
  // as the shape itself, sized to the object: scaling its frame scales such geometry exactly as a group would.
  if (props && !child(root, 'txBody') && off && size && +off.x === x && +off.y === y && +size.cx === w && +size.cy === h
    && (geometry?.name === 'custGeom' ? !child(geometry, 'gdLst')?.children.length : ['rect', 'ellipse', 'line'].includes(geometry?.attrs.prst))) {
    frame.attrs = Object.fromEntries(Object.entries(transform).filter(([, v]) => v));
    frame.children = [node('off', { x: 0, y: 0 }), ext];
    group = root;
  } else if (root.name === 'grpSp') {
    const props = child(root, 'grpSpPr'), t = child(props, 'xfrm');
    const off = child(t, 'off')?.attrs, oldExt = child(t, 'ext')?.attrs;
    const co = child(t, 'chOff')?.attrs, ce = child(t, 'chExt')?.attrs;
    if (!off || !co || !(oldExt?.cx > 0 && oldExt?.cy > 0 && ce?.cx > 0 && ce?.cy > 0)) return null;
    const sx = Number(ce.cx) / oldExt.cx, sy = Number(ce.cy) / oldExt.cy;
    t.attrs = transform;
    t.children = [node('off', { x: 0, y: 0 }), ext,
      node('chOff', { x: Math.round(Number(co.x) + (x - off.x) * sx), y: Math.round(Number(co.y) + (y - off.y) * sy) }),
      node('chExt', { cx: Math.round(w * sx), cy: Math.round(h * sy) })];
  } else {
    // A group provides nonuniform scaling without changing preset adjustments,
    // line widths or rich-text sizes. Its child remains an editable shape.
    group = node('grpSp', {}, [node('grpSpPr', {}, [node('xfrm', transform, [node('off', { x: 0, y: 0 }), ext,
      node('chOff', { x: Math.round(x), y: Math.round(y) }), node('chExt', { cx: Math.round(w), cy: Math.round(h) })])]), root]);
  }
  const write = (n, top = false) => {
    if (['sp', 'cxnSp', 'grpSp'].includes(n.name)) {
      const group = n.name === 'grpSp', sid = top ? id : localIds.get(n.key) ?? allocateId();
      const connections = ['start', 'end'].map(end => {
        const c = n.connections?.[end], target = c && (localIds.get(c.target) ?? drawingIds.get(c.target));
        return target == null ? '' : xmlTag(end === 'start' ? 'a:stCxn' : 'a:endCxn', { id: target, idx: c.index });
      }).join('');
      const nv = xmlTag(group ? 'xdr:nvGrpSpPr' : n.name === 'cxnSp' ? 'xdr:nvCxnSpPr' : 'xdr:nvSpPr', {}, xmlTag('xdr:cNvPr', { id: sid, name: top ? obj.title || 'Shape' : `Shape ${sid}`, descr: top ? drawingDescription(obj) : null },
        (top && linkId ? xmlTag('a:hlinkClick', { 'r:id': linkId }) : '')
        + decorativeXml(top ? obj.decorative : n.decorative))
        + xmlTag(group ? 'xdr:cNvGrpSpPr' : n.name === 'cxnSp' ? 'xdr:cNvCxnSpPr' : 'xdr:cNvSpPr', {}, connections || undefined));
      return xmlTag(`xdr:${n.name}`, {}, nv + n.children.map(c => write(c)).join(''));
    }
    const prefix = ['spPr', 'grpSpPr', 'txBody'].includes(n.name) ? 'xdr' : 'a';
    const body = n.children.map(c => write(c)).join('') + xmlText(n.text || '');
    return xmlTag(`${prefix}:${n.name}`, n.attrs, body || undefined);
  };
  return write(group, true);
}
