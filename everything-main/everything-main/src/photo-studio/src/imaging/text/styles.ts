// Character and paragraph styles: named sets of attributes stored with the
// document. Runs and paragraphs link to a style by ID (`charStyle`,
// `paragraphStyle`); text whose attributes differ from its style's
// definition shows an override, which "Clear Override" removes. Redefining a
// style updates linked text everywhere except where it was overridden.
import {
  applyCharStyle,
  applyParagraphStyle,
  charStyleOfRange,
  optionalCharKeys,
  optionalParagraphKeys,
  paragraphStyleOfRange,
  paragraphsInRange,
  type CharStyle,
  type ParagraphStyle,
  type TextContent,
} from './model';

export type CharacterStyleDef = { id: string; name: string; style: Partial<CharStyle> };
export type ParagraphStyleDef = { id: string; name: string; paragraph: Partial<ParagraphStyle>; char: Partial<CharStyle> };
export type TextStyles = { character: CharacterStyleDef[]; paragraph: ParagraphStyleDef[] };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// Style links are not attributes; every other optional key is.
const linkKeys = new Set<string>([optionalCharKeys[0], optionalParagraphKeys[0]]);
/** Attributes a style records: defined (not mixed) values minus links. */
export function styleAttributes<T extends object>(style: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(style)) if (v !== undefined && !linkKeys.has(k)) (out as Record<string, unknown>)[k] = Array.isArray(v) ? [...v] : v;
  return out;
}
/** True when `style` differs from the definition on any attribute it sets. */
export function differsFrom<T extends object>(style: Partial<T>, def: Partial<T>): boolean {
  return Object.entries(def).some(([k, v]) => v !== undefined && !same((style as Record<string, unknown>)[k] ?? '', v ?? ''));
}

/** Link a range to a character style (null unlinks) and apply its attributes. */
export function applyCharacterStyleDef(c: TextContent, start: number, end: number, def: CharacterStyleDef | null): TextContent {
  return applyCharStyle(c, start, end, def ? { ...def.style, charStyle: def.id } : { charStyle: '' });
}
/** Link the paragraphs touching a range to a paragraph style (null unlinks).
 * Runs without their own character style take the style's base attributes. */
export function applyParagraphStyleDef(c: TextContent, start: number, end: number, def: ParagraphStyleDef | null): TextContent {
  let out = applyParagraphStyle(c, start, end, def ? { ...def.paragraph, paragraphStyle: def.id } : { paragraphStyle: '' });
  if (!def || !Object.keys(def.char).length) return out;
  for (const p of paragraphsInRange(out, start, end)) {
    let pos = paragraphOffset(out, p);
    for (const r of out.paragraphs[p].runs) {
      const len = r.text.length;
      if (!r.style.charStyle) out = applyCharStyle(out, pos, pos + len, def.char);
      pos += len;
    }
    // An empty paragraph carries its caret style.
    if (!out.paragraphs[p].runs.some((r) => r.text)) out = applyCharStyle(out, pos, pos, def.char);
  }
  return out;
}
function paragraphOffset(c: TextContent, p: number) {
  let n = 0;
  for (let i = 0; i < p; i++) n += c.paragraphs[i].runs.reduce((m, r) => m + r.text.length, 0) + 1;
  return n;
}

/** The character style linked over a range (undefined when mixed or none) and whether it is overridden. */
export function characterStyleState(c: TextContent, start: number, end: number, styles: TextStyles): { id?: string; mixed: boolean; overridden: boolean } {
  const st = charStyleOfRange(c, start, end);
  if (!('charStyle' in st)) return { mixed: true, overridden: false };
  const id = st.charStyle || undefined;
  const def = styles.character.find((d) => d.id === id);
  if (!def) return { id: undefined, mixed: false, overridden: false };
  return { id, mixed: false, overridden: rangeDiffers(c, start, end, (s) => differsFrom(s, def.style)) };
}
export function paragraphStyleState(c: TextContent, start: number, end: number, styles: TextStyles): { id?: string; mixed: boolean; overridden: boolean } {
  const ps = paragraphStyleOfRange(c, start, end);
  if (!('paragraphStyle' in ps)) return { mixed: true, overridden: false };
  const id = ps.paragraphStyle || undefined;
  const def = styles.paragraph.find((d) => d.id === id);
  if (!def) return { id: undefined, mixed: false, overridden: false };
  const paras = paragraphsInRange(c, start, end);
  const overridden =
    paras.some((p) => differsFrom(c.paragraphs[p].style, def.paragraph)) ||
    paras.some((p) => c.paragraphs[p].runs.some((r) => !r.style.charStyle && differsFrom(r.style, def.char)));
  return { id, mixed: false, overridden };
}
function rangeDiffers(c: TextContent, start: number, end: number, test: (s: CharStyle) => boolean) {
  const [a, b] = start <= end ? [start, end] : [end, start];
  if (a === b) return test(charStyleOfRange(c, a, a) as CharStyle);
  let base = 0;
  for (const p of c.paragraphs) {
    let pos = base;
    for (const r of p.runs) {
      if (pos + r.text.length > a && pos < b && r.text && test(r.style)) return true;
      pos += r.text.length;
    }
    base = pos + 1;
  }
  return false;
}

/** Re-apply a range's linked styles, dropping local overrides. */
export function clearOverrides(c: TextContent, start: number, end: number, styles: TextStyles, kind: 'character' | 'paragraph'): TextContent {
  if (kind === 'paragraph') {
    let out = c;
    for (const p of paragraphsInRange(c, start, end)) {
      const def = styles.paragraph.find((d) => d.id === c.paragraphs[p].style.paragraphStyle);
      if (!def) continue;
      const a = paragraphOffset(out, p);
      out = applyParagraphStyleDef(out, a, a + out.paragraphs[p].runs.reduce((m, r) => m + r.text.length, 0), def);
    }
    return out;
  }
  const st = charStyleOfRange(c, start, end);
  const def = styles.character.find((d) => d.id === st.charStyle);
  return def ? applyCharacterStyleDef(c, start, end, def) : c;
}

/** Update text linked to a redefined style: attributes still equal to the
 * old definition take the new values; overridden ones stay. */
export function restyleContent(c: TextContent, kind: 'character' | 'paragraph', before: Partial<CharStyle> | ParagraphStyleDef, after: Partial<CharStyle> | ParagraphStyleDef, id: string): TextContent {
  const changes = <T extends object>(from: Partial<T>, to: Partial<T>, current: T): Partial<T> => {
    const patch: Partial<T> = {};
    for (const k of new Set([...Object.keys(from), ...Object.keys(to)])) {
      const key = k as keyof T;
      const now = current[key];
      // Untouched by the user: it still has the old value (or the style did not set it).
      if (to[key] !== undefined && (from[key] === undefined || same(now, from[key]))) patch[key] = to[key];
    }
    return patch;
  };
  let out = c;
  let base = 0;
  for (let p = 0; p < out.paragraphs.length; p++) {
    const para = out.paragraphs[p];
    const len = para.runs.reduce((m, r) => m + r.text.length, 0);
    if (kind === 'paragraph' && para.style.paragraphStyle === id) {
      const b = before as ParagraphStyleDef,
        a = after as ParagraphStyleDef;
      out = applyParagraphStyle(out, base, base + len, changes(b.paragraph, a.paragraph, para.style));
      let pos = base;
      for (const r of out.paragraphs[p].runs) {
        if (!r.style.charStyle && r.text) out = applyCharStyle(out, pos, pos + r.text.length, changes(b.char, a.char, r.style));
        pos += r.text.length;
      }
    } else if (kind === 'character') {
      let pos = base;
      for (const r of para.runs) {
        if (r.style.charStyle === id && r.text) out = applyCharStyle(out, pos, pos + r.text.length, changes(before as Partial<CharStyle>, after as Partial<CharStyle>, r.style));
        pos += r.text.length;
      }
    }
    base += len + 1;
  }
  return out;
}

/** Unlink every run or paragraph from a deleted style (attributes stay). */
export function unlinkStyle(c: TextContent, kind: 'character' | 'paragraph', id: string): TextContent {
  if (kind === 'paragraph') {
    let out = c;
    c.paragraphs.forEach((p, i) => {
      if (p.style.paragraphStyle === id) {
        const a = paragraphOffset(out, i);
        out = applyParagraphStyle(out, a, a, { paragraphStyle: '' });
      }
    });
    return out;
  }
  let out = c;
  let pos = 0;
  for (const p of c.paragraphs) {
    for (const r of p.runs) {
      if (r.style.charStyle === id) out = applyCharStyle(out, pos, pos + r.text.length, { charStyle: '' });
      pos += r.text.length;
    }
    pos++;
  }
  return out;
}
export const usesStyle = (c: TextContent, kind: 'character' | 'paragraph', id: string) =>
  kind === 'paragraph' ? c.paragraphs.some((p) => p.style.paragraphStyle === id) : c.paragraphs.some((p) => p.runs.some((r) => r.style.charStyle === id));

/** Valid style lists from untrusted project data. */
export function validTextStyles(v: unknown): v is TextStyles {
  const t = v as TextStyles;
  const ok = (d: { id?: unknown; name?: unknown }) => !!d && typeof d.id === 'string' && typeof d.name === 'string' && d.name.length <= 200;
  return (
    !!t &&
    Array.isArray(t.character) &&
    Array.isArray(t.paragraph) &&
    t.character.length <= 1000 &&
    t.paragraph.length <= 1000 &&
    t.character.every((d) => ok(d) && !!d.style && typeof d.style === 'object') &&
    t.paragraph.every((d) => ok(d) && !!d.paragraph && typeof d.paragraph === 'object' && !!d.char && typeof d.char === 'object')
  );
}
