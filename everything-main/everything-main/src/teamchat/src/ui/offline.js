/**
 * The offline strip: a slim status row across the top of the window while
 * the browser says the network is gone, above the app frame rather than over
 * it, so it covers no control on any layout (the top bar's search box, a
 * phone's conversation title). Its root stays in the page as an empty live
 * region while online, so the words are announced when they arrive; the
 * body lays out as a column and the frame takes the room left.
 *
 * Mounted before sign-in, so the word is there over every screen the app
 * can be on without a network: the sign-in page, the "Could not load your
 * account" page a cached app lands on when opened offline, and the app
 * itself. `note` says whether the line about messages going out later
 * applies at the moment the strip appears (there is nothing to send from
 * the sign-in page); left out, it always does.
 */
import { el, append } from './dom.js';
import { icon } from './icons.js';

export function mountOfflineBanner({ onReconnect, note = () => true } = {}) {
  const root = el('div.offline-banner', { role: 'status', 'aria-live': 'polite' });
  document.body.prepend(root);
  let shown = false;
  const update = () => {
    const offline = !navigator.onLine;
    if (offline && !shown) {
      shown = true;
      // Sends queue in the outbox and go out on reconnect; said where there
      // is room for it, and only where it applies (not from the sign-in
      // page). Through append, which drops what is not there: handed to
      // replaceChildren, a `false` is written into the strip as the word.
      const withNote = note();
      root.replaceChildren();
      append(root, [
        el('span.offline-icon', { html: icon('wifiOff', 15, 2), 'aria-hidden': 'true' }),
        el('span', {}, 'You are offline.'),
        // A space between the two sentences: the flex row lays them out with
        // its gap, but a screen reader reads the text as written.
        withNote && ' ',
        withNote && el('span.offline-note', {}, 'Messages you send will go out when you are back.'),
      ]);
    } else if (!offline && shown) {
      shown = false;
      root.replaceChildren();
      onReconnect?.();
    }
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
  return { el: root, update };
}
