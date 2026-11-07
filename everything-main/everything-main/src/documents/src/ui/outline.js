/**
 * Document outline: the headings, indented by level, as a sidebar next to
 * the page. Clicking one moves the caret there and scrolls it into view.
 *
 * createOutline({ onJump }) -> { el, update(headings), setActive(nodeId), get isOpen, open(), close(), toggle() }
 * headings: [{ nodeId, text, level }]
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';

const LS_KEY = 'documents:outline';

/** Outline entries from the engine's block list: headings and title styles. */
export function headingsFromBlocks(blocks = []) {
  const out = [];
  for (const b of blocks) {
    const style = String(b.styleId || '');
    let level = null;
    // The block list reports a heading's level as headingLevel (from the outline level or the style's role).
    if (b.nodeType === 'heading') level = Number.parseInt(String(b.headingLevel ?? b.level ?? style.match(/(\d)/)?.[1] ?? 1), 10) || 1;
    else if (/^title$/i.test(style)) level = 0;
    else if (/^heading\s*(\d)$/i.test(style)) level = Number.parseInt(style.match(/(\d)/)[1], 10);
    if (level == null) continue;
    const text = String(b.textPreview || '').replace(/￼/g, '').trim();
    out.push({ nodeId: b.nodeId, text: text || 'Untitled heading', level, empty: !text });
  }
  return out;
}

export function outlineRemembered() {
  try { return localStorage.getItem(LS_KEY) === '1'; } catch { return false; }
}

export function createOutline({ onJump = () => {} } = {}) {
  let headings = [];
  let active = null;
  const list = el('div.outline-list', { role: 'list' });
  const empty = el('p.outline-empty', {}, 'Headings you add will appear here. Use the Style menu to make one.');
  const root = el('aside.outline', { 'aria-label': 'Document outline', hidden: true },
    el('div.outline-head', {}, el('h2.outline-title', {}, 'Outline'),
      el('button.icon-btn', { type: 'button', 'aria-label': 'Close outline', html: icon('x', 18), onclick: () => close() })),
    // The list takes the panel's height, so the hint sits above it to stay under the title.
    empty, list);

  function render() {
    const focused = list.contains(document.activeElement) ? document.activeElement : null;
    const previousIndex = focused ? [...list.querySelectorAll('.outline-item')].indexOf(focused) : -1;
    clear(list);
    empty.hidden = headings.length > 0;
    for (const h of headings) {
      list.append(el('div', { role: 'listitem' }, el('button.outline-item', {
        type: 'button', dataset: { level: String(Math.min(6, Math.max(0, h.level))), nodeId: h.nodeId },
        'aria-current': active === h.nodeId ? 'true' : null,
        className: `outline-item level-${Math.min(6, Math.max(0, h.level))}${h.empty ? ' is-empty' : ''}${active === h.nodeId ? ' active' : ''}`,
        title: h.text,
        onclick: () => onJump(h),
      }, h.text)));
    }
    if (focused) {
      const buttons = [...list.querySelectorAll('.outline-item')];
      const target = buttons.find((button) => button.dataset.nodeId === focused.dataset.nodeId)
        || buttons[Math.min(previousIndex, buttons.length - 1)]
        || root.querySelector('[aria-label="Close outline"]');
      target.focus({ preventScroll: true });
    }
  }

  function update(next) {
    const same = next.length === headings.length && next.every((h, i) => h.nodeId === headings[i].nodeId && h.text === headings[i].text && h.level === headings[i].level);
    headings = next;
    if (!same) render();
  }

  function setActive(nodeId) {
    if (nodeId === active) return;
    active = nodeId;
    for (const b of list.querySelectorAll('.outline-item')) {
      const on = b.dataset.nodeId === nodeId;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    }
  }

  const remember = (open) => { try { if (open) localStorage.setItem(LS_KEY, '1'); else localStorage.removeItem(LS_KEY); } catch { /* storage unavailable */ } };
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(!root.hidden); };
  function open() { if (!root.hidden) return; root.hidden = false; remember(true); emit(); }
  function close() { if (root.hidden) return; root.hidden = true; remember(false); emit(); }
  function toggle() { if (root.hidden) open(); else close(); }

  render();
  return { el: root, update, setActive, open, close, toggle, onToggle: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, get isOpen() { return !root.hidden; }, get headings() { return headings; } };
}
