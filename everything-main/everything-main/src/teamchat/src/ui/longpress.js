/**
 * A long press with a finger stands in for the right click and the hover
 * bar a touch screen does not have. iOS Safari fires no contextmenu event
 * for a long press on a link (it shows its own preview instead), so the
 * press is timed from pointerdown; a move of more than a few pixels is a
 * scroll and cancels it, and the click that follows a press that fired is
 * swallowed so a row does not also open.
 */
export function attachLongPress(node, onLong, { ignore = 'button, a', delay = 480 } = {}) {
  let timer = null;
  let fired = false;
  let startX = 0;
  let startY = 0;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  node.addEventListener('pointerdown', (e) => {
    // A new press, whatever it is on: the click to swallow, when one comes,
    // is the long press's own, and follows it before any other press begins.
    // Chrome on Android sends no click after a long press at all (the
    // release is a long tap, not a tap), so the mark stood until the next
    // press on the row's own words, and a tap meanwhile on a button or a
    // link inside the row (which the timer leaves alone, below) had its
    // click swallowed as if it were the long press's: a reaction that did
    // not toggle, a link that did not open, until tapped again.
    fired = false;
    // And a press in flight ends with it: a second finger coming down (a
    // pinch to zoom, a two-finger scroll) is a gesture, not a long press,
    // and it is not one itself either. Armed again for the second finger,
    // the first finger's timer ran on unseen, since a move or the browser
    // taking the gesture over cancelled only the second's, and the menu
    // opened in the middle of the pinch.
    cancel();
    if (e.pointerType !== 'touch' || e.isPrimary === false) return;
    if (ignore && e.target.closest(ignore)) return;
    startX = e.clientX;
    startY = e.clientY;
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      onLong({ currentTarget: node, clientX: startX, clientY: startY });
    }, delay);
  });
  node.addEventListener('pointermove', (e) => {
    if (timer && (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8)) cancel();
  });
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('click', (e) => {
    if (!fired) return;
    fired = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  node.addEventListener('contextmenu', (e) => {
    if (matchMedia('(pointer: coarse)').matches) e.preventDefault();
  });
}
