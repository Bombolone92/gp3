// Read existing layout and availability state without probing or activating fonts.
// Code-point counts describe displayed text occurrences, not shaped glyph counts.
import { displayedFont, fontAvailable } from '../src/engine/font-availability.js';

export function recordLayoutFontSelection(editor, alternatives) {
  const choices = new Map();
  for (const [context, lines] of [
    ['body', editor.layout.lines], ['repeatedBody', editor.layout.repeatedLines || []],
    ['pageStory', editor.storyLayout.lines],
  ]) for (const line of lines) for (const fragment of line.fragments) {
    if (fragment.image || !fragment.text) continue;
    const codePoints = Array.from(fragment.text.replace(/[\s\ufffc]/gu, '')).length;
    if (!codePoints) continue;
    const declared = fragment.fontFamily || fragment.fontAscii || 'Noto Sans';
    const selected = displayedFont(fragment, alternatives);
    const state = fontAvailable(declared);
    const available = state === true ? true : state === false ? false : null;
    const key = JSON.stringify([declared, selected, available, context]);
    if (!choices.has(key)) choices.set(key, { declared, selected, available, context,
      fragments: 0, nonWhitespaceCodePoints: 0 });
    const row = choices.get(key);
    row.fragments++; row.nonWhitespaceCodePoints += codePoints;
  }
  return [...choices.values()].sort((a,b) =>
    a.declared.localeCompare(b.declared) || a.selected.localeCompare(b.selected) || a.context.localeCompare(b.context));
}
