/**
 * Character and paragraph styles.
 *
 * Styles live in the document root as `charStyles` and `paraStyles`, lists
 * of { id, name, basedOn, attrs }. `attrs` holds only the attributes a style
 * defines itself; the rest come from the style it is based on. Paragraph
 * styles carry paragraph attributes and character attributes; a paragraph
 * style based on nothing is based on the Normal Paragraph Style, whose
 * unset attributes are the factory defaults. Character styles define only
 * the keys they set (a bold style sets the weight and nothing else).
 *
 * Applying a style copies its resolved attributes into the text (runs and
 * paragraph overrides) and records the style id in `charStyle` /
 * `paraStyle`, so layout and export never need the style lists. A
 * character's expected attributes are its paragraph style's character
 * attributes with its character style on top; anything that differs is a
 * local override (the "+" in the panels). Editing a style restyles every
 * text in the document: attributes that matched the old style take the new
 * values, overrides stay.
 *
 * Everything here is pure except the functions taking a document, which
 * must run inside a transaction.
 */
import { DEFAULT_CHAR, DEFAULT_PARA } from '../../model/nodes.js';
import { CHAR_KEYS, PARA_KEYS, PAINT_KEYS, MIXED, styledRuns, paragraphRanges, paraAt, baseStyle, normalizeRuns, wholeStylePatch, paragraphIndexAt } from '../../model/text-runs.js';
import { uid } from '../../lib/ids.js';

export const NORMAL = 'normal';
export const NORMAL_CHAR_NAME = 'Normal Character Style';
export const NORMAL_PARA_NAME = 'Normal Paragraph Style';

/** Character attributes a style can define (paint included, the glyph alternate and style id not). */
export const CHAR_STYLE_KEYS = [...CHAR_KEYS.filter((k) => k !== 'charStyle' && k !== 'altGlyph'), ...PAINT_KEYS];
/** Paragraph attributes a paragraph style can define. */
export const PARA_STYLE_KEYS = PARA_KEYS.filter((k) => k !== 'paraStyle');

/** Factory values of every paragraph style attribute (what the Normal Paragraph Style starts as). */
export const FACTORY_PARA_STYLE = Object.freeze({
  ...Object.fromEntries(CHAR_STYLE_KEYS.filter((k) => k in DEFAULT_CHAR).map((k) => [k, DEFAULT_CHAR[k]])),
  fill: { type: 'solid', color: '#000000' },
  stroke: null,
  strokeWidth: 1,
  ...Object.fromEntries(PARA_STYLE_KEYS.map((k) => [k, DEFAULT_PARA[k]])),
});

export function eq(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == b; // eslint-disable-line eqeqeq
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && k in obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// ---- lists ----

const normalChar = () => ({ id: NORMAL, name: NORMAL_CHAR_NAME, basedOn: null, attrs: {} });
const normalPara = () => ({ id: NORMAL, name: NORMAL_PARA_NAME, basedOn: null, attrs: {} });

/** The document's style lists with the Normal styles first: { char, para }. */
export function styleLists(doc) {
  return listsFromRoot(doc.root);
}

export function listsFromRoot(root) {
  const fill = (stored, normal) => {
    const list = Array.isArray(stored) ? stored.filter((s) => s && s.id) : [];
    const n = list.find((s) => s.id === NORMAL);
    return [n ? { ...normal(), ...n, basedOn: null } : normal(), ...list.filter((s) => s.id !== NORMAL)];
  };
  return { char: fill(root.charStyles, normalChar), para: fill(root.paraStyles, normalPara) };
}

/** Root patch storing lists (Normal styles are stored only once edited). */
export function rootPatch(lists) {
  const strip = (list, normal) => list.filter((s) => s.id !== NORMAL || Object.keys(s.attrs || {}).length || s.name !== normal().name);
  return { charStyles: strip(lists.char, normalChar), paraStyles: strip(lists.para, normalPara) };
}

export function findStyle(list, id) {
  return list.find((s) => s.id === (id || NORMAL)) || null;
}

/** Ancestors of a style from the style itself to its root, stopping at cycles and missing styles. */
export function chainOf(list, id, para = false) {
  const out = [];
  const seen = new Set();
  let s = findStyle(list, id) || (para ? findStyle(list, NORMAL) : null);
  while (s && !seen.has(s.id)) {
    seen.add(s.id);
    out.push(s);
    const next = s.basedOn || (para && s.id !== NORMAL ? NORMAL : null);
    s = next ? findStyle(list, next) : null;
  }
  return out;
}

/** True when basing style `id` on `basedOn` would make a cycle. */
export function wouldCycle(list, id, basedOn, para = false) {
  if (!basedOn) return false;
  if (basedOn === id) return true;
  return chainOf(list, basedOn, para).some((s) => s.id === id);
}

/** Attributes a character style sets (its own on top of its ancestors'); only defined keys. */
export function resolveChar(list, id) {
  if (!id) id = NORMAL;
  const out = {};
  for (const s of chainOf(list, id).reverse()) Object.assign(out, pick(s.attrs, CHAR_STYLE_KEYS));
  return out;
}

/** Every attribute of a paragraph style (paragraph and character keys). */
export function resolvePara(list, id) {
  const out = { ...FACTORY_PARA_STYLE };
  for (const s of chainOf(list, id || NORMAL, true).reverse()) Object.assign(out, pick(s.attrs, [...CHAR_STYLE_KEYS, ...PARA_STYLE_KEYS]));
  return out;
}

/** Resolved attributes of the style a style is based on (what its blank fields inherit). */
export function inheritedAttrs(lists, kind, style) {
  if (kind === 'char') return style.basedOn ? resolveChar(lists.char, style.basedOn) : {};
  if (style.id === NORMAL) return { ...FACTORY_PARA_STYLE };
  return resolvePara(lists.para, style.basedOn || NORMAL);
}

/** Expected character attributes for a paragraph style and character style. */
export function expectedChar(lists, paraId, charId) {
  return { ...pick(resolvePara(lists.para, paraId), CHAR_STYLE_KEYS), ...resolveChar(lists.char, charId) };
}

export function expectedPara(lists, paraId) {
  return pick(resolvePara(lists.para, paraId), PARA_STYLE_KEYS);
}

// ---- restyling ----

/** Character segments of a node: style runs split at paragraph boundaries. */
function segments(node) {
  const text = String(node.text ?? '');
  const out = [];
  const ranges = paragraphRanges(text);
  let pi = 0;
  for (const r of styledRuns(node)) {
    let s = r.start;
    while (s < r.end) {
      while (pi < ranges.length - 1 && s > ranges[pi].end) pi++;
      // A paragraph's segment includes its newline.
      const pEnd = Math.min(r.end, ranges[pi].end + 1);
      out.push({ start: s, end: pEnd, style: r.style, pi });
      s = pEnd;
    }
  }
  return out;
}

function splitSegments(segs, cuts) {
  const out = [];
  for (const sg of segs) {
    let s = sg.start;
    for (const c of cuts) {
      if (c > s && c < sg.end) {
        out.push({ ...sg, start: s, end: c });
        s = c;
      }
    }
    out.push({ ...sg, start: s, end: sg.end });
  }
  return out;
}

/**
 * Restyle one text node. Returns a full patch { runs, paras, para, char,
 * fill, stroke, strokeWidth } (every key present, so previews can overwrite
 * earlier previews), or null when nothing changes.
 *
 *   oldLists / newLists   style lists before and after (the same object for
 *                         a plain apply)
 *   paraTarget(pi, id)    -> { id, clear } to restyle paragraph pi, or null
 *   charTarget(start, end, id, pi)
 *                         -> { id, clear, keep } for a character segment, or null;
 *                         `keep` changes only the reference, not the attributes
 *   cuts                  character offsets where segments must split
 */
export function restyleNode(node, { oldLists, newLists = oldLists, paraTarget = null, charTarget = null, cuts = [] }) {
  const text = String(node.text ?? '');
  const ranges = paragraphRanges(text);
  // Paragraphs.
  const oldParaIds = [];
  const newParaIds = [];
  const clearParas = [];
  const fulls = [];
  let paraChanged = false;
  for (let pi = 0; pi < ranges.length; pi++) {
    const P = paraAt(node, pi);
    const cur = P.paraStyle || null;
    const t = paraTarget?.(pi, cur) || null;
    const next = t && t.id !== undefined ? t.id || null : cur;
    const clear = Boolean(t?.clear);
    oldParaIds.push(cur);
    newParaIds.push(next);
    clearParas.push(clear);
    const Eold = expectedPara(oldLists, cur);
    const Enew = expectedPara(newLists, next);
    const full = { ...P };
    for (const k of PARA_STYLE_KEYS) full[k] = !clear && !eq(P[k], Eold[k]) ? P[k] : Enew[k];
    full.paraStyle = next === NORMAL ? null : next;
    if (!paraChanged && PARA_KEYS.some((k) => !eq(full[k], P[k]))) paraChanged = true;
    fulls.push(full);
  }
  // Characters.
  const segs = splitSegments(segments(node), [...new Set(cuts)].sort((a, b) => a - b));
  const runs = [];
  let charChanged = false;
  let emptyStyle = null;
  const restyleChars = (V, pi, s, e) => {
    const cur = V.charStyle || null;
    const t = charTarget?.(s, e, cur, pi) || null;
    const nextC = t && t.id !== undefined ? t.id || null : cur;
    const out = { ...V, charStyle: nextC === NORMAL ? null : nextC };
    if (!t?.keep) {
      const clear = Boolean(t?.clear) || (clearParas[pi] && !t);
      const Eold = expectedChar(oldLists, oldParaIds[pi], cur);
      const Enew = expectedChar(newLists, newParaIds[pi], nextC);
      for (const k of CHAR_STYLE_KEYS) out[k] = !clear && !eq(V[k], Eold[k]) ? V[k] : Enew[k];
    }
    if (!charChanged && [...CHAR_KEYS, ...PAINT_KEYS].some((k) => !eq(out[k], V[k]))) charChanged = true;
    return out;
  };
  if (!text.length) emptyStyle = restyleChars(baseStyle(node), 0, 0, 0);
  else for (const sg of segs) runs.push({ len: sg.end - sg.start, ...restyleChars(sg.style, sg.pi, sg.start, sg.end) });
  if (!paraChanged && !charChanged) return null;
  // Paragraph patch: one `para` when every paragraph agrees, else overrides per paragraph.
  let para = node.para;
  let paras;
  if (fulls.every((f) => PARA_KEYS.every((k) => eq(f[k], fulls[0][k])))) {
    para = pick(fulls[0], PARA_KEYS);
    paras = undefined;
  } else {
    const base = { ...DEFAULT_PARA, ...(node.para || {}) };
    let any = false;
    paras = fulls.map((f) => {
      const d = {};
      for (const k of PARA_KEYS) if (!eq(f[k], base[k])) d[k] = f[k];
      if (Object.keys(d).length) {
        any = true;
        return d;
      }
      return null;
    });
    if (!any) paras = undefined;
  }
  const patch = { para, paras, char: node.char, fill: node.fill, stroke: node.stroke, strokeWidth: node.strokeWidth, runs: node.runs };
  if (emptyStyle) {
    Object.assign(patch, wholeStylePatch({ ...node, runs: undefined }, pick(emptyStyle, [...CHAR_KEYS, ...PAINT_KEYS])));
    patch.runs = undefined;
  } else if (runs.length) {
    // Text that is uniform after restyling moves into the object's own style.
    const first = runs[0];
    const uniform = runs.every((r) => [...CHAR_KEYS, ...PAINT_KEYS].every((k) => eq(r[k], first[k])));
    if (uniform) {
      Object.assign(patch, wholeStylePatch({ ...node, runs: undefined }, pick(first, [...CHAR_KEYS, ...PAINT_KEYS])));
      patch.runs = undefined;
    } else patch.runs = normalizeRuns(runs, node);
  }
  return patch;
}

/** Restyle every text object in a document (style edits); returns the number of objects changed. */
export function restyleDocument(doc, oldLists, newLists, opts = {}) {
  let count = 0;
  for (const n of doc.leaves()) {
    if (n.type !== 'text' || n.threadPrev) continue;
    const patch = restyleNode(doc.get(n.id), { oldLists, newLists, ...opts });
    if (patch) {
      doc.update(n.id, patch);
      count++;
    }
  }
  return count;
}

/** Store new lists and restyle the document from the old ones. */
export function commitLists(doc, newLists, opts = {}) {
  const oldLists = styleLists(doc);
  doc.updateRoot(rootPatch(newLists));
  return restyleDocument(doc, oldLists, newLists, opts);
}

// ---- reading the state of text ----

/**
 * Style state of a character range or of paragraphs:
 *   charStyleState(lists, node, a, b) -> { id | MIXED, override }
 */
export function charStyleState(lists, node, a, b) {
  const text = String(node.text ?? '');
  if (b <= a) {
    // Insertion point: the character before it (or after it at the start).
    if (!text.length) return charStateOf(lists, baseStyle(node), paraAt(node, 0).paraStyle);
    const i = Math.max(0, Math.min(text.length - 1, a > 0 ? a - 1 : 0));
    a = i;
    b = i + 1;
  }
  let id;
  let override = false;
  for (const sg of segments(node)) {
    if (sg.end <= a || sg.start >= b) continue;
    const st = charStateOf(lists, sg.style, paraAt(node, sg.pi).paraStyle);
    if (id === undefined) id = st.id;
    else if (id !== st.id) id = MIXED;
    if (st.override) override = true;
  }
  return { id: id ?? NORMAL, override };
}

function charStateOf(lists, V, paraId) {
  const id = V.charStyle && findStyle(lists.char, V.charStyle) ? V.charStyle : NORMAL;
  const E = expectedChar(lists, paraId, id);
  return { id, override: CHAR_STYLE_KEYS.some((k) => !eq(V[k], E[k])) };
}

/** Paragraph style state of paragraphs p0..p1 (overrides include character-level differences). */
export function paraStyleState(lists, node, p0, p1) {
  let id;
  let override = false;
  for (let pi = p0; pi <= p1; pi++) {
    const P = paraAt(node, pi);
    const pid = P.paraStyle && findStyle(lists.para, P.paraStyle) ? P.paraStyle : NORMAL;
    if (id === undefined) id = pid;
    else if (id !== pid) id = MIXED;
    const E = expectedPara(lists, pid);
    if (PARA_STYLE_KEYS.some((k) => !eq(P[k], E[k]))) override = true;
  }
  if (!override) {
    for (const sg of segments(node)) {
      if (sg.pi < p0 || sg.pi > p1) continue;
      if (charStateOf(lists, sg.style, paraAt(node, sg.pi).paraStyle).override) {
        override = true;
        break;
      }
    }
    if (!String(node.text ?? '').length && charStateOf(lists, baseStyle(node), paraAt(node, 0).paraStyle).override) override = true;
  }
  return { id: id ?? NORMAL, override };
}

/** Ids of styles any text in the document uses (character and paragraph). */
export function usedStyles(doc) {
  const char = new Set();
  const para = new Set();
  for (const n of doc.leaves()) {
    if (n.type !== 'text') continue;
    for (const r of styledRuns(n)) if (r.style.charStyle) char.add(r.style.charStyle);
    const count = paragraphRanges(n.text).length;
    for (let pi = 0; pi < count; pi++) {
      const id = paraAt(n, pi).paraStyle;
      if (id) para.add(id);
    }
  }
  return { char, para };
}

// ---- building styles ----

export function uniqueName(list, base) {
  const names = new Set(list.map((s) => s.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

export function nextStyleName(list, kind) {
  const base = kind === 'char' ? 'Character Style' : 'Paragraph Style';
  for (let i = 1; ; i++) if (!list.some((s) => s.name === `${base} ${i}`)) return `${base} ${i}`;
}

export function newStyleId(kind) {
  return uid(kind === 'char' ? 'cs' : 'ps');
}

/** Attributes in `values` (skipping MIXED) that differ from `base`. */
export function diffAttrs(values, base, keys) {
  const out = {};
  for (const k of keys) {
    const v = values[k];
    if (v === MIXED || v === undefined) continue;
    if (!eq(v, base[k])) out[k] = v;
  }
  return out;
}

/** Where a selection is: the paragraph index of a character offset (for callers that need it). */
export { paragraphIndexAt };
