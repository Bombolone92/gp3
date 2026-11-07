/**
 * Put text on the clipboard. The browser's own clipboard where it offers
 * one; where it does not (a page served over plain http on a LAN, some
 * in-app browsers), the older way: a box off screen with the text in it,
 * selected and copied with the document's command. A copy that has no way
 * through rejects, so the caller can say so; the copies used to ask the
 * clipboard only when the browser had one, and did nothing at all, without
 * a word, when it did not.
 */
export async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // The box takes the keyboard while it is selected: whoever had it gets it back.
  const had = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const box = document.createElement('textarea');
  box.value = text;
  box.setAttribute('readonly', '');
  box.setAttribute('aria-hidden', 'true');
  box.setAttribute('tabindex', '-1');
  box.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.append(box);
  let ok = false;
  try {
    box.focus?.({ preventScroll: true });
    box.select?.();
    box.setSelectionRange?.(0, text.length);
    ok = document.execCommand?.('copy') === true;
  } catch {
    ok = false;
  } finally {
    box.remove();
    had?.focus({ preventScroll: true });
  }
  if (!ok) throw new Error('Could not copy');
}
