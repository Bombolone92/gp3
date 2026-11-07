/**
 * Anchored floating panels. Popovers stack (a menu can open a submenu or a
 * picker), close on Escape or a click outside, return focus to what opened
 * them, and become bottom sheets on phones.
 */
import { h, overlayRoot } from '../lib/dom.js';

const stack = [];
let listening = false;

export function isPhone() {
  return typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches;
}

/** Was this element inside a modal dialog opened after the popover? */
function inLaterDialog(el, p) {
  const dlg = el?.closest?.('dialog[open]');
  return !!dlg && !dlg.contains(p.el) && (dlg._openedAt || 0) > p.openedAt;
}

function onPointerDown(e) {
  if (!stack.length) return;
  // Clicks in a dialog that opened over the popover belong to that dialog.
  if (inLaterDialog(e.target, stack[stack.length - 1])) return;
  // Close every popover above the one that was clicked (or all of them).
  let keep = -1;
  for (let i = stack.length - 1; i >= 0; i--) {
    const p = stack[i];
    if (p.el.contains(e.target) || p.anchor?.contains?.(e.target) || p.keepFor?.(e.target)) {
      keep = i;
      break;
    }
  }
  for (let i = stack.length - 1; i > keep; i--) {
    if (stack[i].closeOnOutside === false) continue;
    // A click on the anchor of the top popover toggles it: let the anchor's
    // own handler decide, but do not reopen.
    stack[i].close({ restoreFocus: false, reason: 'outside' });
  }
}

function onKeyDown(e) {
  if (e.key !== 'Escape' || !stack.length) return;
  // Escape that ends an IME composition belongs to the text being typed.
  if (e.isComposing || e.keyCode === 229) return;
  const top = stack[stack.length - 1];
  if (top.escape === false) return;
  if (inLaterDialog(document.activeElement, top)) return;
  e.preventDefault();
  e.stopPropagation();
  top.close({ reason: 'escape' });
}

function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', () => {
    for (const p of stack) p.reposition();
  });
}

export function popoverOpen() {
  return stack.length > 0;
}

export function topPopover() {
  return stack[stack.length - 1] || null;
}

export function closeAllPopovers() {
  for (let i = stack.length - 1; i >= 0; i--) stack[i].close({ restoreFocus: false });
}

/** Open popovers whose anchor is inside an element (about to be redrawn). */
export function popoversAnchoredIn(node) {
  return stack.filter((p) => p.anchor && node.contains(p.anchor));
}

/** Close the popovers placed inside an element (a dialog that is closing). */
export function closePopoversIn(node) {
  for (let i = stack.length - 1; i >= 0; i--) if (node.contains(stack[i].el)) stack[i]?.close({ restoreFocus: false });
}

/**
 * Open content next to an anchor element (or a point {x, y}).
 * opts: placement ('bottom-start' | 'bottom-end' | 'right-start' | 'left-start' | 'top-start'),
 * className, label, role, onClose, beforeClose (runs while still open, to
 * save what it holds), focus ('first' | element | false), sheet (bottom sheet
 * on phones, default true), width, offset.
 */
export function openPopover(anchor, content, opts = {}) {
  listen();
  const sheet = opts.sheet !== false && isPhone();
  const el = h(`div.popover${opts.className ? `.${opts.className.split(' ').join('.')}` : ''}${sheet ? '.sheet' : ''}`, {
    role: opts.role || 'dialog',
    'aria-label': opts.label || null,
    'aria-modal': opts.role === 'dialog' || !opts.role ? 'false' : null,
  });
  if (opts.width) el.style.width = typeof opts.width === 'number' ? `${opts.width}px` : opts.width;
  el.append(content);
  const backdrop = sheet ? h('div.sheet-backdrop') : null;
  const root = overlayRoot();
  if (backdrop) root.append(backdrop);
  root.append(el);
  let previous = document.activeElement;
  let anchorEl = anchor instanceof Element ? anchor : null;
  if (anchorEl && opts.expanded !== false) anchorEl.setAttribute('aria-expanded', 'true');

  const handle = {
    el,
    anchor: anchorEl,
    closeOnOutside: opts.closeOnOutside,
    escape: opts.escape,
    keepFor: opts.keepFor,
    closed: false,
    openedAt: performance.now(),
    reposition() {
      if (sheet || handle.closed) return;
      position(el, anchor, opts);
    },
    /** Follow an anchor that was drawn afresh (a toolbar redrawn after an edit). */
    reanchor(next) {
      if (handle.closed || next === anchorEl) return;
      if (previous === anchorEl) previous = next;
      anchor = anchorEl = handle.anchor = next;
      if (opts.expanded !== false) next.setAttribute('aria-expanded', 'true');
    },
    close({ restoreFocus = true, reason } = {}) {
      if (handle.closed || handle.closing) return;
      handle.closing = true;
      opts.beforeClose?.();
      // Close anything stacked above first.
      const i = stack.indexOf(handle);
      for (let k = stack.length - 1; k > i; k--) stack[k].close({ restoreFocus: false });
      handle.closed = true;
      if (i >= 0) stack.splice(i, 1);
      el.remove();
      backdrop?.remove();
      if (anchorEl && opts.expanded !== false) anchorEl.setAttribute('aria-expanded', 'false');
      opts.onClose?.(reason);
      if (restoreFocus && previous && document.contains(previous) && typeof previous.focus === 'function') {
        previous.focus({ preventScroll: true });
      }
    },
  };
  stack.push(handle);
  handle.reposition();
  // Content can grow after first paint (async lists); keep it in view.
  if (typeof ResizeObserver === 'function' && !sheet) {
    const ro = new ResizeObserver(() => handle.reposition());
    ro.observe(el);
    const close = handle.close;
    handle.close = (o) => {
      ro.disconnect();
      close(o);
    };
  }
  if (opts.focus !== false) {
    const target = opts.focus instanceof Element ? opts.focus : el.querySelector('[autofocus], input:not([type=hidden]), textarea, select, button, [tabindex]:not([tabindex="-1"])') || el;
    if (target === el) el.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
  return handle;
}

function position(el, anchor, opts) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 8;
  const gap = opts.offset ?? 4;
  let r;
  // An anchor that was re-rendered away keeps the popover where it is.
  if (anchor instanceof Element && !anchor.isConnected && el.style.left) return;
  if (anchor instanceof Element) r = anchor.getBoundingClientRect();
  else if (anchor && typeof anchor.x === 'number') r = { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
  else r = { left: vw / 2, right: vw / 2, top: vh / 3, bottom: vh / 3, width: 0, height: 0 };
  el.style.maxHeight = `${vh - margin * 2}px`;
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  const placement = opts.placement || 'bottom-start';
  let left;
  let top;
  if (placement.startsWith('right') || placement.startsWith('left')) {
    left = placement.startsWith('right') ? r.right + gap : r.left - w - gap;
    if (left + w > vw - margin) left = r.left - w - gap;
    if (left < margin) left = Math.min(vw - margin - w, r.right + gap);
    top = r.top - 4;
    if (top + hgt > vh - margin) top = Math.max(margin, vh - margin - hgt);
  } else {
    left = placement.endsWith('end') ? r.right - w : placement.endsWith('center') ? r.left + r.width / 2 - w / 2 : r.left;
    top = placement.startsWith('top') ? r.top - hgt - gap : r.bottom + gap;
    if (!placement.startsWith('top') && top + hgt > vh - margin && r.top - hgt - gap >= margin) top = r.top - hgt - gap;
    if (placement.startsWith('top') && top < margin) top = r.bottom + gap;
    top = Math.max(margin, Math.min(top, vh - margin - hgt));
  }
  left = Math.max(margin, Math.min(left, vw - margin - w));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}
