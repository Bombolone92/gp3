import { describe, expect, it } from 'vitest';
import { applyCharStyle, charStyleOfRange, fromPlainText, insertText, plainText, sameCharStyle, defaultCharStyle, type TextContent } from '../src/imaging/text/model';
import {
  applyCharacterStyleDef,
  applyParagraphStyleDef,
  characterStyleState,
  clearOverrides,
  paragraphStyleState,
  restyleContent,
  styleAttributes,
  unlinkStyle,
  usesStyle,
  validTextStyles,
  type TextStyles,
} from '../src/imaging/text/styles';
import { glyphCategory, isPrintable } from '../src/features/type/glyphs';

const heading = { id: 'h', name: 'Heading', style: { family: 'Crimson Pro', weight: 700, size: 36 } };
const body = { id: 'b', name: 'Body', paragraph: { align: 'justify-left' as const, spaceAfter: 6 }, char: { family: 'Inter', size: 11 } };
const styles: TextStyles = { character: [heading], paragraph: [body] };
const doc = (): TextContent => fromPlainText('Title words\nSecond paragraph');

describe('character styles', () => {
  it('links a range and applies the definition', () => {
    const c = applyCharacterStyleDef(doc(), 0, 5, heading);
    const st = charStyleOfRange(c, 0, 5);
    expect(st).toMatchObject({ family: 'Crimson Pro', weight: 700, size: 36, charStyle: 'h' });
    expect(charStyleOfRange(c, 6, 11).charStyle).toBeUndefined();
    expect(characterStyleState(c, 0, 5, styles)).toEqual({ id: 'h', mixed: false, overridden: false });
    expect(characterStyleState(c, 0, 8, styles).mixed).toBe(true);
    expect(usesStyle(c, 'character', 'h')).toBe(true);
  });
  it('shows an override, which Clear Override removes', () => {
    let c = applyCharacterStyleDef(doc(), 0, 5, heading);
    c = applyCharStyle(c, 0, 5, { size: 40 });
    expect(characterStyleState(c, 0, 5, styles).overridden).toBe(true);
    c = clearOverrides(c, 0, 5, styles, 'character');
    expect(charStyleOfRange(c, 0, 5).size).toBe(36);
    expect(characterStyleState(c, 0, 5, styles).overridden).toBe(false);
  });
  it('redefining updates linked text but keeps overrides', () => {
    let c = applyCharacterStyleDef(doc(), 0, 11, heading);
    c = applyCharStyle(c, 6, 11, { weight: 300 });
    const next = { family: 'Crimson Pro', weight: 600, size: 48 };
    c = restyleContent(c, 'character', heading.style, next, 'h');
    expect(charStyleOfRange(c, 0, 5)).toMatchObject({ weight: 600, size: 48 });
    // The overridden weight stays; the size follows.
    expect(charStyleOfRange(c, 6, 11)).toMatchObject({ weight: 300, size: 48 });
  });
  it('unlinking keeps the attributes and new text continues the run style', () => {
    let c = applyCharacterStyleDef(doc(), 0, 5, heading);
    c = unlinkStyle(c, 'character', 'h');
    expect(charStyleOfRange(c, 0, 5)).toMatchObject({ family: 'Crimson Pro', size: 36 });
    expect(usesStyle(c, 'character', 'h')).toBe(false);
    c = insertText(c, 5, '!');
    expect(plainText(c).startsWith('Title!')).toBe(true);
  });
  it('treats a missing link like an empty one when merging runs', () => {
    const a = defaultCharStyle();
    expect(sameCharStyle(a, { ...a, charStyle: '' })).toBe(true);
    expect(sameCharStyle(a, { ...a, charStyle: 'x' })).toBe(false);
  });
  it('records attributes without links', () => {
    expect(styleAttributes({ size: 12, charStyle: 'h', features: 'onum', weight: undefined })).toEqual({ size: 12, features: 'onum' });
  });
});

describe('paragraph styles', () => {
  it('applies paragraph attributes and base character attributes', () => {
    let c = applyCharacterStyleDef(doc(), 0, 5, heading);
    c = applyParagraphStyleDef(c, 0, 0, body);
    expect(c.paragraphs[0].style).toMatchObject({ align: 'justify-left', spaceAfter: 6, paragraphStyle: 'b' });
    expect(c.paragraphs[1].style.paragraphStyle).toBeUndefined();
    // Runs with their own character style keep it.
    expect(charStyleOfRange(c, 0, 5).family).toBe('Crimson Pro');
    expect(charStyleOfRange(c, 6, 11)).toMatchObject({ family: 'Inter', size: 11 });
    expect(paragraphStyleState(c, 0, 3, styles)).toEqual({ id: 'b', mixed: false, overridden: false });
    expect(paragraphStyleState(c, 0, 15, styles).mixed).toBe(true);
  });
  it('detects and clears paragraph overrides', () => {
    let c = applyParagraphStyleDef(doc(), 0, 0, body);
    c = applyCharStyle(c, 0, 5, { size: 20 });
    expect(paragraphStyleState(c, 0, 0, styles).overridden).toBe(true);
    c = clearOverrides(c, 0, 0, styles, 'paragraph');
    expect(paragraphStyleState(c, 0, 0, styles).overridden).toBe(false);
  });
  it('redefines and unlinks paragraph styles', () => {
    let c = applyParagraphStyleDef(doc(), 0, 20, body);
    const next = { ...body, paragraph: { align: 'center' as const, spaceAfter: 6 } };
    c = restyleContent(c, 'paragraph', body, next, 'b');
    expect(c.paragraphs.map((p) => p.style.align)).toEqual(['center', 'center']);
    c = unlinkStyle(c, 'paragraph', 'b');
    expect(c.paragraphs.every((p) => !p.style.paragraphStyle)).toBe(true);
  });
  it('validates stored styles', () => {
    expect(validTextStyles(styles)).toBe(true);
    expect(validTextStyles({ character: [{ id: 1 }], paragraph: [] })).toBe(false);
    expect(validTextStyles({ character: [] })).toBe(false);
  });
});

describe('glyph categories', () => {
  it('classifies code points for the Glyphs panel filter', () => {
    expect(glyphCategory(0x41)).toBe('letters');
    expect(glyphCategory(0xe9)).toBe('accented');
    expect(glyphCategory(0x37)).toBe('numbers');
    expect(glyphCategory(0x20ac)).toBe('currency');
    expect(glyphCategory(0x2192)).toBe('arrows');
    expect(glyphCategory(0x2211)).toBe('math');
    expect(glyphCategory(0x3b1)).toBe('greek');
    expect(glyphCategory(0x416)).toBe('cyrillic');
    expect(glyphCategory(0x2014)).toBe('punctuation');
    expect(isPrintable(0x20)).toBe(false);
    expect(isPrintable(0xad)).toBe(false);
    expect(isPrintable(0x41)).toBe(true);
  });
});
