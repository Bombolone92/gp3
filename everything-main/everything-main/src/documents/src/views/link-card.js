import { el } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { hyperlinkLabel, internalHyperlink, openableHyperlink } from '../engine/hyperlinks.js';

/**
 * The card a click on a link brings up while editing: the click places the caret, as in any text,
 * and the card under the link shows where it goes, follows it on a click, and edits or removes it.
 * The card never takes the focus, so typing carries on in the document. It goes when the selection
 * moves, the document changes or scrolls, the window resizes, Escape is pressed or the pointer goes
 * down anywhere else.
 */
export function createLinkCard({ editor, edit, host }) {
  let shown = null, abort = null;
  const address = el('a.link-card-address', { onclick: e => {
    e.preventDefault();
    const link = shown?.link;
    if (!link || !openableHyperlink(link)) return;
    hide(); editor()?.openHyperlink(link);
  } });
  const note = el('span.link-card-note', {}, 'Can’t be opened here');
  const command = (label, icon, action) => el('button.icon-btn', { type: 'button', 'aria-label': label, title: label, onclick: () => { hide(); action(); } }, iconEl(icon, 16));
  const node = el('div.link-card', { role: 'group', 'aria-label': 'Link', hidden: true,
    // The document keeps the focus (and its caret) through a press on the card.
    onpointerdown: e => e.preventDefault() },
  el('span.link-card-icon', { 'aria-hidden': 'true' }, iconEl('link', 16)), address, note,
  command('Edit link', 'pencil', () => edit()), command('Remove link', 'unlink', () => editor()?.removeHyperlink()));

  function show({ start, end, link, rect }) {
    const ed = editor(); if (!ed) return;
    hide();
    const openable = openableHyperlink(link), label = hyperlinkLabel(link);
    address.textContent = label; address.title = label;
    // A web, email or phone address is a real link (its address shows, and it can be copied); the click goes through the editor.
    if (openable && !internalHyperlink(link)) { address.href = link.target; address.target = '_blank'; address.rel = 'noopener noreferrer'; }
    else { address.removeAttribute('href'); address.removeAttribute('target'); address.removeAttribute('rel'); }
    // A file path or other address this editor can't open is shown, but not as something to click.
    address.classList.toggle('is-retained', !openable); note.hidden = openable;
    shown = { start, end, link, selection: [...ed.model.range], path: ed.session.path };
    if (!node.isConnected) document.body.append(node);
    node.hidden = false;
    place(rect);
    abort = new AbortController();
    const { signal } = abort;
    document.addEventListener('pointerdown', e => { if (!node.contains(e.target)) hide(); }, { capture: true, signal });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); }, { capture: true, signal });
    host.addEventListener('scroll', hide, { signal });
    window.addEventListener('resize', hide, { signal });
  }
  /** Below the link's line, or above it where the window ends; never past either side of the window. */
  function place(rect) {
    const gap = 6, margin = 8, box = node.getBoundingClientRect();
    const below = rect.top + rect.height + gap, above = rect.top - gap - box.height;
    node.style.top = `${Math.max(margin, below + box.height + margin > window.innerHeight && above >= margin ? above : below)}px`;
    node.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - box.width - margin))}px`;
  }
  function hide() {
    if (!shown) return;
    shown = null; abort?.abort(); abort = null;
    node.hidden = true;
  }
  /** The selection or document changed: the card stays only while the caret is where the click put it. */
  function changed() {
    const ed = editor();
    if (!shown) return;
    if (!ed || ed.session.path !== shown.path || ed.model.range[0] !== shown.selection[0] || ed.model.range[1] !== shown.selection[1]) hide();
  }
  return { show, hide, changed, node, get shown() { return shown; }, destroy() { hide(); node.remove(); } };
}
