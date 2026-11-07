/**
 * Popover menus anchored to a button. One open at a time; closes on outside
 * click, Escape, scroll, or resize — except on touch screens, where a resize
 * or a scroll of the page itself is the on-screen keyboard at work and moves
 * the popover with its anchor instead. Items are keyboard navigable.
 *
 *   openMenu(anchor, [
 *     { label: 'Edit', icon: 'pencil', onSelect, key: 'E' },   // key: a shortcut hint, shown on the right
 *     { label: 'Ana', leading: avatarNode, onSelect },           // leading: a node in place of the icon
 *     'sep',
 *     { label: 'Delete', icon: 'trash', danger: true, onSelect },
 *   ])
 */
import { el, focusables, composing, safeInsets } from './dom.js';
import { icon } from './icons.js';

let current = null;
/** Where the last popover stood as it closed: what one opened right after it opens from when its own anchor is gone (see openPopover). */
let lastClosed = null;

export function closeMenu() {
  if (current) current.close();
}

/**
 * Within 8px of the window's edges, less the safe area (see safeInsets): a
 * popover placed at a point (a long press, a right-click) or pushed in from
 * an anchor near the edge used to sit against the edge itself, which on a
 * phone held sideways is under the notch or the rounded corner, and at the
 * top or bottom under the status bar or the home indicator.
 */
function place(node, r, { align = 'start', side = 'bottom' } = {}) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  const safe = safeInsets();
  const minLeft = 8 + safe.left;
  const maxLeft = vw - w - 8 - safe.right;
  const minTop = 8 + safe.top;
  const maxTop = vh - h - 8 - safe.bottom;
  let left = align === 'end' ? r.right - w : r.left;
  left = Math.max(minLeft, Math.min(left, maxLeft));
  let top = side === 'top' ? r.top - h - 6 : r.bottom + 6;
  if (top + h > vh - 8 - safe.bottom) top = Math.max(minTop, r.top - h - 6);
  if (top < minTop) top = Math.min(r.bottom + 6, maxTop);
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

/** An anchor at a point, so a context menu opens where the pointer is. */
export function pointAnchor(x, y) {
  return { getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 }) };
}

/** Generic popover: caller supplies the content. Returns { close }. */
export function openPopover(anchor, content, { align = 'start', side = 'bottom', role = 'dialog', label, onClose, autofocus = true } = {}) {
  // The rail, the sidebar, a message row and the conversation header are
  // rebuilt as activity arrives, and a menu is often open across such a
  // redraw: its anchor is then an element off the page, whose rectangle is
  // all zeros. A popover opened from that menu (a submenu, the reminder
  // times, the emoji picker) would open in the corner of the window; it
  // opens where the menu stood instead. And the anchor's own place, as last
  // measured while it was on the page, is remembered for the focus to
  // return to whatever stands there when the popover closes: the same
  // button, rebuilt.
  const isEl = anchor instanceof Element;
  const detached = isEl && !anchor.isConnected;
  const recent = lastClosed && Date.now() - lastClosed.at < 2000 ? lastClosed : null;
  const fallback = detached ? current?.node.getBoundingClientRect() || recent?.rect || null : null;
  // Opened from a menu on the same gone anchor: where that anchor stood is
  // inherited, so the focus finds its way back from here too.
  let seenRect = detached ? current?.seenRect || recent?.anchorRect || null : null;
  closeMenu();
  const rectOf = () => {
    if (isEl && !anchor.isConnected) return seenRect || fallback || anchor.getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    if (isEl) seenRect = r;
    return r;
  };
  const node = el('div.menu', { role, 'aria-label': label, tabindex: -1 }, content);
  document.body.append(node);
  anchor.setAttribute?.('aria-expanded', 'true');
  place(node, rectOf(), { align, side });

  /**
   * The control drawn in the anchor's place while this popover stands: a
   * message row's More, the conversation header's, are drawn anew by the
   * poll under an open menu, and the list and the header carry the word
   * that the menu is open (aria-expanded) onto the fresh control, along
   * with the row's light. That control is the menu's opener for all
   * purposes: pressing it closes the menu (measured against the anchor
   * off the page, the press closed the menu and the control's own click
   * then opened a second one in its place), it goes quiet as the menu
   * closes, and the keyboard comes back to it. Told by the anchor's own
   * label, once the anchor is off the page; only one popover stands at a
   * time.
   */
  const standIn = () => {
    if (!isEl || anchor.isConnected) return null;
    const label = anchor.getAttribute('aria-label');
    if (!label) return null;
    return [...document.querySelectorAll('[aria-expanded="true"]')].find((n) => n !== anchor && !node.contains(n) && n.getAttribute('aria-label') === label) || null;
  };

  let closed = false;
  const close = (restoreFocus = true) => {
    if (closed) return;
    closed = true;
    clearTimeout(arm);
    lastClosed = { at: Date.now(), rect: node.getBoundingClientRect(), anchorRect: seenRect };
    const twin = standIn();
    node.remove();
    anchor.setAttribute?.('aria-expanded', 'false');
    twin?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onMove);
    document.removeEventListener('scroll', onMove, true);
    if (current?.close === close) current = null;
    // Focus goes home before onClose runs: an onClose that drops the class
    // keeping a hover-summoned anchor visible (the message toolbar, a Later
    // card's pill) would hide the anchor first, and focusing a display:none
    // element is a no-op — the keyboard would land on <body>. Restored first,
    // the focus itself then holds the anchor visible through :focus-within.
    if (restoreFocus && anchor instanceof HTMLElement) {
      if (anchor.isConnected) {
        // An anchor drawn only while its row is under the pointer or holds
        // the keyboard (a message's hover bar, see .msg-actions): with the
        // keyboard in the popover the row holds it no longer, and a browser
        // will not focus a control that is not drawn, so the keyboard fell
        // to the page. The row takes it first, which draws the bar, and the
        // anchor takes it from there (as the list's own restore does).
        if (anchor.offsetParent === null) anchor.parentElement?.closest('[tabindex]')?.focus({ preventScroll: true });
        anchor.focus({ preventScroll: true });
      } else if (twin) {
        // The control drawn in the anchor's place (see standIn), wherever
        // the page has moved it since: by its place on the page alone
        // (below), a list that had scrolled on meanwhile handed the
        // keyboard to whatever stood at the old spot.
        if (twin.offsetParent === null) twin.parentElement?.closest('[tabindex]')?.focus({ preventScroll: true });
        twin.focus({ preventScroll: true });
      } else if (seenRect) {
        const at = document.elementFromPoint(seenRect.left + seenRect.width / 2, seenRect.top + seenRect.height / 2);
        at?.closest?.('button, [tabindex], a[href], input, select, textarea')?.focus({ preventScroll: true });
      }
    }
    onClose?.();
  };
  // The button that opened the popover toggles it. Closing on the press
  // would let the button's own click handler open a fresh one right after,
  // so the popover waits for that click and swallows it instead. Anchors
  // that are not buttons (a message row under a right-click, a point) are
  // not toggles: a click there does what it always does.
  const toggles = anchor instanceof HTMLElement && anchor.matches('button, [role="button"], [aria-haspopup]');
  /** Whether a press landed on the opener: the anchor, or the control drawn in its place (see standIn). */
  const onOpener = (target) => toggles && (anchor.contains(target) || !!standIn()?.contains(target));
  const onDown = (e) => {
    if (node.contains(e.target)) return;
    if (onOpener(e.target)) return;
    close(false);
  };
  const onClick = (e) => {
    if (!onOpener(e.target)) return;
    e.stopPropagation();
    e.preventDefault();
    close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      // An input method's Escape cancels the word being composed in a text
      // box of the popover (the link address, the emoji search), nothing
      // more; the popover stays, as a dialog does (see modal.js).
      if (composing(e)) return;
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      const list = focusables(node);
      if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      e.preventDefault();
      const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i >= list.length - 1 ? 0 : i + 1);
      list[next].focus();
    }
    // Arrow keys step through a menu's items. Any other popover (the emoji
    // picker, a form) handles its own keys, and inputs keep their caret.
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && role === 'menu') {
      const list = focusables(node);
      if (!list.length) return;
      e.preventDefault();
      const i = list.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next].focus();
    }
    // Home and End go to a menu's first and last item, as a menu's are
    // expected to (the ARIA menu pattern); the last of a long list (the
    // reminder times, a message's fifteen actions) was reached by walking
    // down it or by the up arrow's wrap alone.
    if ((e.key === 'Home' || e.key === 'End') && role === 'menu') {
      const list = focusables(node);
      if (!list.length) return;
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1].focus();
    }
  };
  const onMove = (e) => {
    // The page scrolling or resizing under the anchor closes the popover;
    // scrolling inside it (a long list, the emoji grid) does not.
    if (e?.type === 'scroll' && e.target instanceof Node && node.contains(e.target)) return;
    // A scroll of the container the anchor sits in moves the anchor: the
    // popover follows it while it is in view (a message list growing under
    // a reader at its bottom used to close the emoji picker mid-word) and
    // closes once the anchor has left the container's view.
    if (e?.type === 'scroll' && e.target instanceof Element && anchor instanceof Element && anchor.isConnected) {
      // A scroll of a container the anchor does not sit in cannot have moved
      // it: the message list growing under a reader at its bottom leaves the
      // composer's emoji picker where it is.
      if (!e.target.contains(anchor)) return;
      const a = anchor.getBoundingClientRect();
      const c = e.target.getBoundingClientRect();
      if (a.bottom > c.top && a.top < c.bottom && a.right > c.left && a.left < c.right) {
        place(node, rectOf(), { align, side });
        return;
      }
    }
    // On a phone the on-screen keyboard resizes the window as it comes and
    // goes, and scrolls the page to keep a focused field in view; neither is
    // the reader moving away (opening the emoji picker with the keyboard up
    // used to close it before a first tap could land). A resize or a scroll
    // of the page itself moves the popover with its anchor instead of
    // closing it; a scroll of an inner container still closes above once the
    // anchor leaves its view.
    if (matchMedia('(pointer: coarse)').matches && (e?.type === 'resize' || !(e?.target instanceof Element))) {
      place(node, rectOf(), { align, side });
      return;
    }
    close(false);
  };
  // Deferred past the click that opened the popover (see onClick). One
  // closed before then (a route closing it at once, a menu swapped for
  // another in the same breath) adds nothing: added after its close, the
  // listeners had nothing to remove them, and stayed on the page for good.
  const arm = setTimeout(() => {
    if (closed) return;
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onMove);
    document.addEventListener('scroll', onMove, true);
  }, 0);
  current = { close, node, get seenRect() { return seenRect; } };
  const first = autofocus ? focusables(node)[0] : null;
  (first || node).focus({ preventScroll: true });
  return { close, node };
}

export function openMenu(anchor, items, opts = {}) {
  const content = [];
  // Callers write separators between groups and leave out the entries a
  // reader may not use; a group that ends up empty must not leave its
  // separator behind, at the edge of the menu or doubled up with the next.
  const present = items.filter(Boolean);
  const kept = present.filter((item, i) => item !== 'sep' || (i > 0 && i < present.length - 1 && present[i - 1] !== 'sep'));
  while (kept.length && kept[kept.length - 1] === 'sep') kept.pop();
  for (const item of kept) {
    if (item === 'sep') {
      content.push(el('div.menu-sep', { role: 'separator' }));
      continue;
    }
    if (item.header) {
      content.push(el('div.menu-label', {}, item.header));
      continue;
    }
    // A card on top of a menu: what the menu is about (a workspace, a
    // person), heading the workspace and user menus.
    if (item.card) {
      content.push(el('div.menu-card', {},
        item.card.node || (item.card.mark != null && el('span.ws-mark.menu-card-mark', { 'aria-hidden': 'true' }, item.card.mark)),
        el('span.menu-card-text', {}, el('strong', {}, item.card.title), item.card.sub && el('span', {}, item.card.sub))));
      continue;
    }
    // An item that cannot be used just now (a level with the conversation
    // muted, "Mark as unread" with nothing to mark, a token another admin
    // rotates) stays in the menu's walk, dimmed and inert, as the ARIA menu
    // pattern has it: a disabled button is skipped by Tab and the arrows and
    // read by nothing, so a keyboard or screen-reader user found no such item
    // at all, and never heard the line under it saying why.
    const btn = el(`button.menu-item${item.danger ? '.danger' : ''}`, {
      type: 'button',
      role: item.checked !== undefined ? 'menuitemradio' : 'menuitem',
      'aria-checked': item.checked !== undefined ? String(!!item.checked) : null,
      'aria-disabled': item.disabled ? 'true' : null,
      onclick: () => {
        if (item.disabled) return;
        pop.close(!item.keepFocus);
        item.onSelect?.();
      },
    },
    item.leading || (item.icon && el('span', { html: icon(item.icon, 18) })),
    el('span', { style: { flex: 1, minWidth: 0 } },
      item.label,
      item.sub && el('span.menu-sub', {}, item.sub)),
    item.key && el('kbd.menu-kbd', { 'aria-hidden': 'true' }, item.key),
    item.checked && el('span.menu-check', { html: icon('check', 16, 2.4) }));
    content.push(btn);
  }
  const pop = openPopover(anchor, content, { ...opts, role: 'menu', label: opts.label || 'Menu' });
  return pop;
}
