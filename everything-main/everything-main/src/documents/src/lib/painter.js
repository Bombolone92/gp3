/**
 * Format painter. The engine's `copy-format` command captures the formatting
 * at the selection and arms a painter; the next selection the user makes
 * receives it (a second click within half a second keeps the painter on for
 * repeated use). The controller only learns about selections through these
 * notifications, so while the painter is armed the host forwards pointer
 * and keyboard selection gestures to it. Escape cancels.
 */

export const SELECTION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/**
 * bindFormatPainter(ui, host, { onMode }) -> unbind
 * Listeners live on `host` (and the release on `window`) only while the
 * painter is armed or persistent.
 */
export function bindFormatPainter(ui, host, { onMode = () => {} } = {}) {
  const fp = ui?.formatPainter;
  if (!fp?.onModeChange) return () => {};
  let detach = null;

  const arm = () => {
    if (detach) return;
    const onPointerDown = () => fp.setPointerSelecting(true);
    const onPointerUp = () => { fp.setPointerSelecting(false); fp.notifyPointerUp(); };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') { fp.cancel(); return; }
      if (SELECTION_KEYS.has(e.key)) fp.setKeyboardSelecting(true);
    };
    const onKeyUp = () => { fp.setKeyboardSelecting(false); fp.notifyKeyUp(); };
    // A selection drag that starts on the page can end over the toolbar or
    // outside the window; the release must still reach the painter, or it
    // stays armed without painting.
    const onPointerEnd = (e) => { if (e.type === 'pointercancel' || !host.contains(e.target)) onPointerUp(); };
    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
    host.addEventListener('keydown', onKeyDown);
    host.addEventListener('keyup', onKeyUp);
    detach = () => {
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      host.removeEventListener('keydown', onKeyDown);
      host.removeEventListener('keyup', onKeyUp);
    };
  };
  const disarm = () => { detach?.(); detach = null; };

  const off = fp.onModeChange((mode) => {
    if (mode === 'armed' || mode === 'persistent') arm(); else disarm();
    host.classList.toggle('painting', mode !== 'idle');
    onMode(mode);
  });
  return () => { off?.(); disarm(); host.classList.remove('painting'); };
}
