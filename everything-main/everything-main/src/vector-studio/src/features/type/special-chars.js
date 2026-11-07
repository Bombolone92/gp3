/**
 * Type > Insert Special Character, Insert Whitespace Character and Insert
 * Break Character, plus their shortcuts while typing. The shortcuts share
 * chords with global commands (Move, New from Template), so they are
 * handled by the editing session and only apply while editing type.
 */
import { formatShortcut, eventShortcut, normalizeShortcut } from '../../commands/registry.js';
import { TextSession } from './session.js';
import { session } from './type-ops.js';

export const SPECIAL_GROUPS = [
  {
    label: 'Symbols',
    chars: [
      ['Bullet', '\u2022'],
      ['Copyright Symbol', '\u00a9'],
      ['Degree Sign', '\u00b0'],
      ['Ellipsis', '\u2026'],
      ['Multiplication Sign', '\u00d7'],
      ['Paragraph Symbol', '\u00b6'],
      ['Plus-Minus Sign', '\u00b1'],
      ['Registered Trademark Symbol', '\u00ae'],
      ['Section Symbol', '\u00a7'],
      ['Trademark Symbol', '\u2122'],
    ],
  },
  {
    label: 'Hyphens and Dashes',
    chars: [
      ['Em Dash', '\u2014'],
      ['En Dash', '\u2013'],
      ['Nonbreaking Hyphen', '\u2011'],
      null,
      ['Discretionary Hyphen', '\u00ad', 'Shift+Mod+-'],
    ],
  },
  {
    label: 'Quotation Marks',
    chars: [
      ['Double Left Quotation Mark', '\u201c'],
      ['Double Right Quotation Mark', '\u201d'],
      ['Single Left Quotation Mark', '\u2018'],
      ['Single Right Quotation Mark', '\u2019'],
      null,
      ['Left Guillemet', '\u00ab'],
      ['Right Guillemet', '\u00bb'],
    ],
  },
];

export const WHITESPACE_CHARS = [
  ['Em Space', '\u2003', 'Shift+Mod+M'],
  ['En Space', '\u2002', 'Shift+Mod+N'],
  null,
  ['Nonbreaking Space', '\u00a0'],
  ['Figure Space', '\u2007'],
  null,
  ['Thin Space', '\u2009', 'Alt+Shift+Mod+M'],
  ['Hair Space', '\u200a'],
];

/** U+2028 breaks the line without starting a new paragraph. */
export const BREAK_CHARS = [['Forced Line Break', '\u2028', 'Shift+Enter']];

/** Insert characters at the caret of the active editing session. */
export function insertAtCaret(app, ch) {
  const s = session(app);
  if (!s) return false;
  s.insert(ch, 'typing');
  s.focus();
  return true;
}

function menuItems(list) {
  return list.map((c) =>
    c
      ? { type: 'cmd', label: c[0], shortcut: c[2] ? formatShortcut(c[2]) : '', enabled: true, run: (a) => insertAtCaret(a, c[1]) }
      : '-',
  );
}

export function installSpecialChars(app) {
  const editing = (a) => Boolean(session(a));
  const gate = (items) => (editing(app) ? items : items.map((it) => (it.type === 'cmd' ? { ...it, enabled: false } : it)));
  app.menuSources.set('insertSpecial', () => SPECIAL_GROUPS.map((g) => ({ label: g.label, submenu: gate(menuItems(g.chars)) })));
  app.menuSources.set('insertWhitespace', () => gate(menuItems(WHITESPACE_CHARS)));
  app.menuSources.set('insertBreak', () => gate(menuItems(BREAK_CHARS)));

  const keys = new Map();
  for (const list of [WHITESPACE_CHARS, BREAK_CHARS, ...SPECIAL_GROUPS.map((g) => g.chars)]) for (const c of list) if (c?.[2]) keys.set(normalizeShortcut(c[2]), c[1]);
  TextSession.keyHooks.push((s, e) => {
    const ch = keys.get(eventShortcut(e));
    if (ch === undefined || s !== session(app)) return false;
    e.preventDefault?.();
    s.insert(ch, 'typing');
    return true;
  });
}
