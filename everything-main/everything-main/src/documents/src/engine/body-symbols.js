// w:sym owns its font independently of the surrounding run's formatting.
// Keep one model position even when the encoded glyph is a combining mark.
export const bodySymbolText = (run, text) => run?.bodySymbol ? String.fromCharCode(parseInt(run.bodySymbol.code, 16)) : text;
export function bodySymbolStyle(run, style) {
  if (!run?.bodySymbol) return style;
  const font = run.bodySymbol.font;
  return { ...style, fontAscii: font, fontHAnsi: font, fontEastAsia: font, fontCs: font, capitalization: 'normal' };
}
