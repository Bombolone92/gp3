/**
 * Special characters: a picker of the symbols people reach for most in prose
 * (dashes, quotes, currency, math, arrows, Greek, accented letters). Picking
 * one calls back with the character; the caller inserts it at the caret.
 */

import { el } from './dom.js';
import { openModal } from './modal.js';
import { keyboardGrids } from './gridkeys.js';

export const SYMBOL_GROUPS = [
  ['Punctuation', ['—', '–', '…', '‘', '’', '“', '”', '«', '»', '•', '·', '§', '¶', '†', '‡', '′', '″', '¡', '¿']],
  ['Currency and marks', ['€', '£', '¥', '¢', '₹', '©', '®', '™', '°', '№', '‰']],
  ['Math', ['±', '×', '÷', '≠', '≈', '≤', '≥', '∞', '√', '∑', '∆', 'π', 'µ', '½', '⅓', '¼', '¾', '¹', '²', '³']],
  ['Arrows', ['←', '→', '↑', '↓', '↔', '⇐', '⇒', '⇔', '↵']],
  ['Greek', ['α', 'β', 'γ', 'δ', 'ε', 'θ', 'λ', 'μ', 'σ', 'φ', 'ψ', 'ω', 'Δ', 'Σ', 'Ω']],
  ['Letters', ['à', 'á', 'â', 'ä', 'ã', 'å', 'ç', 'é', 'è', 'ê', 'ë', 'í', 'î', 'ï', 'ñ', 'ó', 'ô', 'ö', 'õ', 'ú', 'û', 'ü', 'ß', 'æ', 'ø', 'œ']],
];

/** Human-readable names for screen readers on the most cryptic glyphs. */
const NAMES = {
  '—': 'Em dash', '–': 'En dash', '…': 'Ellipsis', '‘': 'Left single quote', '’': 'Right single quote',
  '“': 'Left double quote', '”': 'Right double quote', '«': 'Left guillemet', '»': 'Right guillemet',
  '•': 'Bullet', '·': 'Middle dot', '§': 'Section sign', '¶': 'Pilcrow', '†': 'Dagger', '‡': 'Double dagger',
  '′': 'Prime', '″': 'Double prime', '¡': 'Inverted exclamation', '¿': 'Inverted question mark',
  '€': 'Euro', '£': 'Pound', '¥': 'Yen', '¢': 'Cent', '₹': 'Rupee', '©': 'Copyright', '®': 'Registered',
  '™': 'Trademark', '°': 'Degree', '№': 'Numero', '‰': 'Per mille', '±': 'Plus minus', '×': 'Multiplication',
  '÷': 'Division', '≠': 'Not equal', '≈': 'Approximately equal', '≤': 'Less than or equal', '≥': 'Greater than or equal',
  '∞': 'Infinity', '√': 'Square root', '∑': 'Sum', '∆': 'Increment', 'π': 'Pi', 'µ': 'Micro', '½': 'One half',
  '⅓': 'One third', '¼': 'One quarter', '¾': 'Three quarters', '¹': 'Superscript one', '²': 'Superscript two',
  '³': 'Superscript three', '←': 'Left arrow', '→': 'Right arrow', '↑': 'Up arrow', '↓': 'Down arrow',
  '↔': 'Left right arrow', '⇐': 'Left double arrow', '⇒': 'Right double arrow', '⇔': 'Left right double arrow', '↵': 'Return',
};

export function symbolName(ch) {
  return NAMES[ch] || ch;
}

/** openSymbolPicker({ onPick }) -> { close } */
export function openSymbolPicker({ onPick }) {
  let modal = null;
  const content = el('div.symbols', { role: 'group', 'aria-label': 'Special characters' },
    SYMBOL_GROUPS.map(([title, chars]) => el('section.symbol-group', {},
      el('h3', {}, title),
      el('div.symbol-grid', { role: 'group', 'aria-label': title },
        chars.map((ch) => el('button.symbol', {
          type: 'button', title: symbolName(ch), 'aria-label': symbolName(ch),
          onclick: () => { modal?.close(); onPick(ch); },
        }, ch))))));
  keyboardGrids(content);
  modal = openModal({ title: 'Special characters', content, wide: true });
  return modal;
}
