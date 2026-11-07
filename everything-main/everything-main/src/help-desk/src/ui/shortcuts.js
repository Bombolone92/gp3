/**
 * Keyboard shortcuts. Bindings are strings like 'c', '?', 'g h' (a two-key
 * sequence), 'mod+k', 'alt+shift+s'. Single-key shortcuts are ignored while
 * typing in a field or moving through a menu; modifier shortcuts work
 * everywhere. Views add bindings in a scope and remove the scope when they
 * unmount.
 */
import { isMac } from './dom.js';

const scopes = new Map();
let pending = null;
let pendingTimer = null;

function isTyping(target) {
  if (!target || !(target instanceof Element)) return false;
  if (target.isContentEditable || target.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !['checkbox', 'radio', 'button', 'submit', 'range'].includes(target.type);
  return false;
}

function comboOf(e) {
  const parts = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey && e.key.length > 1) parts.push('shift');
  if (e.shiftKey && e.altKey && e.key.length === 1) parts.push('shift');
  let key = e.key;
  // With alt held, macOS reports a composed character; use the physical key.
  if (e.altKey && e.code?.startsWith('Key')) key = e.code.slice(3).toLowerCase();
  else if (e.altKey && e.code?.startsWith('Digit')) key = e.code.slice(5);
  else key = key.length === 1 ? key.toLowerCase() : key.toLowerCase();
  if (e.key === '?') key = '?';
  parts.push(key);
  return parts.join('+');
}

export function bind(scope, map) {
  scopes.set(scope, map);
  return () => scopes.delete(scope);
}

export function unbind(scope) {
  scopes.delete(scope);
}

function lookup(combo) {
  const list = [...scopes.values()].reverse();
  for (const map of list) {
    if (map[combo]) return map[combo];
  }
  return null;
}

function hasPrefix(prefix) {
  for (const map of scopes.values()) {
    for (const k of Object.keys(map)) if (k.startsWith(`${prefix} `)) return true;
  }
  return false;
}

export function installShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    if (document.querySelector('dialog[open]') && !e.target.closest?.('dialog')) return;
    if (e.target.closest?.('dialog')) return;
    const combo = comboOf(e);
    const hasModifier = combo.includes('mod+') || combo.includes('alt+');
    // Menus and pickers use plain keys for type-ahead and navigation.
    if (!hasModifier && (isTyping(e.target) || e.target.closest?.('.popover'))) return;
    // Alt with an arrow key moves the caret by word (macOS) or through history
    // (Windows), so it belongs to the field being typed in.
    if (combo.startsWith('alt+') && /arrow|home|end/.test(combo) && isTyping(e.target)) return;
    if (pending) {
      const seq = `${pending} ${combo}`;
      pending = null;
      clearTimeout(pendingTimer);
      const fn = lookup(seq);
      if (fn) {
        e.preventDefault();
        fn(e);
        return;
      }
    }
    const fn = lookup(combo);
    if (fn) {
      if (fn(e) !== false) e.preventDefault();
      return;
    }
    if (!hasModifier && hasPrefix(combo)) {
      pending = combo;
      pendingTimer = setTimeout(() => {
        pending = null;
      }, 1200);
    }
  });
}

/** Human labels for display, e.g. 'mod+k' -> '⌘ K'. */
export function label(binding) {
  return binding
    .split(' ')
    .map((part) =>
      part
        .split('+')
        .map((k) => ({ mod: isMac ? '⌘' : 'Ctrl', alt: isMac ? '⌥' : 'Alt', shift: isMac ? '⇧' : 'Shift', enter: 'Enter', escape: 'Esc', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' }[k] || k.toUpperCase()))
        .join(isMac ? '' : '+'),
    )
    .join(' then ');
}

/** The list shown in the keyboard shortcuts dialog. */
export const SHORTCUT_HELP = [
  ['General', [
    ['?', 'Show keyboard shortcuts'],
    ['/', 'Search'],
    ['mod+k', 'Search'],
    ['c', 'New ticket'],
    ['g h', 'Go to Home'],
    ['g v', 'Go to Views'],
    ['g u', 'Go to Customers'],
    ['g o', 'Go to Organizations'],
    ['g k', 'Go to Knowledge base'],
    ['g r', 'Go to Reports'],
    ['g a', 'Go to Admin'],
    ['alt+w', 'Close the current tab'],
    ['alt+arrowright', 'Next tab'],
    ['alt+arrowleft', 'Previous tab'],
  ]],
  ['Ticket lists', [
    ['j', 'Next ticket'],
    ['k', 'Previous ticket'],
    ['enter', 'Open ticket'],
    ['x', 'Select ticket'],
  ]],
  ['Ticket', [
    ['r', 'Public reply'],
    ['n', 'Internal note'],
    ['mod+enter', 'Submit'],
    ['alt+shift+o', 'Submit as Open'],
    ['alt+shift+p', 'Submit as Pending'],
    ['alt+shift+h', 'Submit as On hold'],
    ['alt+shift+s', 'Submit as Solved'],
    ['m', 'Apply a macro'],
    ['a', 'Assign to me'],
    ['alt+j', 'Next ticket in view'],
  ]],
];
