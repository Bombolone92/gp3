import { el } from './dom.js';
import { icon } from './icons.js';

const syncModalState = () => {
  const roots = [...document.querySelectorAll('.modal-root')];
  const active = roots.filter((root) => !root.hidden).at(-1);
  for (const root of roots) root.toggleAttribute('inert', root !== active);
  document.getElementById('app')?.toggleAttribute('inert', Boolean(active));
  document.querySelector('.compose-dock')?.toggleAttribute('inert', Boolean(active));
};

/**
 * Centered dialog on desktop, bottom sheet on small screens (CSS decides).
 * openModal({ title, content, onClose, beforeClose }) -> { close() }
 * The app root goes inert while a dialog is open, so Tab and screen readers
 * cannot reach the covered page; focus returns to the opener on close.
 * `beforeClose` returning false vetoes Escape, scrim, and ✕ — close(true)
 * bypasses it for a close the dialog itself decided on.
 */
export function openModal({ title, content, onClose, beforeClose }) {
  const panel = el('div.modal-panel', {
    role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: -1,
  });
  const rootNode = el('div.modal-root', {},
    el('div.modal-scrim', { onclick: () => close() }),
    panel,
  );

  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  panel.append(
    el('div.modal-head', {},
      el('h2.modal-title', {}, title),
      el('button.icon-btn', { html: icon('x', 18), 'aria-label': 'Close dialog', onclick: () => close() }),
    ),
    content,
  );

  let closed = false;
  let resumeFocus = null;
  let resumeRange = null;
  const returnFocus = () => {
    if (opener?.isConnected && !opener.closest('[inert], [hidden]')) opener.focus();
  };
  const suspend = () => {
    if (closed || rootNode.hidden) return;
    resumeFocus = panel.contains(document.activeElement) ? document.activeElement : null;
    const selection = document.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    // Store endpoints, not a live Range: bringing the dialog to the front
    // moves its root and the browser collapses live ranges during that move.
    resumeRange = range && panel.contains(range.commonAncestorContainer) ? {
      start: range.startContainer, startOffset: range.startOffset,
      end: range.endContainer, endOffset: range.endOffset,
    } : null;
    rootNode.hidden = true;
    panel.removeAttribute('aria-modal');
    syncModalState();
    returnFocus();
  };
  const resume = () => {
    if (closed) return;
    const anotherOpen = [...document.querySelectorAll('.modal-root')]
      .some((root) => root !== rootNode && !root.hidden);
    rootNode.hidden = false;
    panel.setAttribute('aria-modal', 'true');
    if (anotherOpen) document.body.append(rootNode);
    syncModalState();
    (resumeFocus?.isConnected ? resumeFocus : panel).focus({ preventScroll: true });
    if (resumeRange && panel.contains(resumeRange.start) && panel.contains(resumeRange.end)) {
      try {
        const range = document.createRange();
        range.setStart(resumeRange.start, resumeRange.startOffset);
        range.setEnd(resumeRange.end, resumeRange.endOffset);
        const selection = document.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      } catch { /* content changed while the dialog was suspended */ }
    }
  };
  /**
   * `focusOpener` is off for a close that something else on the page
   * decided on -- a minimized dialog discarded from a list -- where the
   * keyboard belongs to the control that did it, not to the one that opened
   * the dialog a while ago.
   */
  function close(force = false, { focusOpener = true } = {}) {
    if (closed) return;
    if (!force && beforeClose?.() === false) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    onClose?.();
    rootNode.remove();
    syncModalState();
    if (focusOpener) returnFocus();
  }

  /**
   * The controls Tab can actually reach, in order. The selector alone counted
   * everything that is a control, including the ones the keyboard skips: a
   * hidden file input, a "+3 more" button with nothing to show, a Discard
   * button disabled for the length of a send. When one of those was the last
   * thing in the panel the trap waited for focus to land on it, which never
   * happened, and Tab from the real last control left the dialog for the
   * browser's own chrome.
   */
  const focusables = () => [...panel.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )].filter((node) => !node.disabled && node.tabIndex >= 0 && !node.closest('[hidden]') && node.type !== 'hidden');

  function onKey(e) {
    if (rootNode.hidden || rootNode.hasAttribute('inert')) return;
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') close();
    if (e.key !== 'Tab') return;
    // Single-dialog focus trap: wrap Tab at the edges of the panel.
    const reachable = focusables();
    if (!reachable.length) return;
    const first = reachable[0];
    const last = reachable[reachable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  document.addEventListener('keydown', onKey);
  document.body.append(rootNode);
  syncModalState();

  const focusable = panel.querySelector('input, select, textarea, button:not(.icon-btn)');
  if (focusable) focusable.focus();
  else panel.focus({ preventScroll: true });

  return { close, panel, suspend, resume };
}

/**
 * A yes/no question, as a dialog of this app's own. Resolves to true only if
 * the confirming button is pressed -- Escape, the scrim, and Cancel all answer
 * no.
 *
 * Not `window.confirm`: a Puter app runs in a cross-origin iframe, and Chrome
 * suppresses the native dialogs there outright, answering `false` without ever
 * showing anything. A guard on a destructive action cannot be built on a
 * dialog that may never appear.
 */
export function confirmDialog({
  title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false,
}) {
  return new Promise((resolve) => {
    let answer = false;
    let modal;
    const content = el('div.confirm', {},
      el('p.confirm-text', {}, message),
      el('div.confirm-actions', {},
        el('button.btn', { type: 'button', onclick: () => modal.close(true) }, cancelLabel),
        el(`button.btn${danger ? '.btn-danger' : '.btn-primary'}`, {
          type: 'button',
          onclick: () => {
            answer = true;
            modal.close(true);
          },
        }, confirmLabel),
      ),
    );
    // Cancel comes first in the DOM, so openModal's initial focus lands on the
    // way out rather than on the destructive button.
    modal = openModal({ title, content, onClose: () => resolve(answer) });
  });
}
