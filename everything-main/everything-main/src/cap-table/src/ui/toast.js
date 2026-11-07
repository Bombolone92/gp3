import { el } from './dom.js';
import { icon } from './icons.js';

let stack = null;
let root = null;

/**
 * The one stack everything that speaks from the bottom of the screen shares.
 * Toasts and the offline banner used to be positioned independently at the
 * same spot, so they landed exactly on top of each other - and "Couldn't
 * save. Check your connection" is precisely the toast that fires while the
 * banner is up, hiding the explanation behind the symptom.
 *
 * A plain container, deliberately: the toast list and the banner are each
 * their own live region, and nesting one region inside another is announced
 * inconsistently across screen readers.
 */
export function bottomStack() {
  if (!stack) {
    stack = el('div.bottom-stack');
    document.body.append(stack);
  }
  return stack;
}

/**
 * The live region is the container, not the toast.
 *
 * A region only announces reliably when it is already in the document as its
 * contents change - stamping role=status on the node being inserted is a
 * coin flip across screen readers. aria-atomic=false so a second toast
 * announces only itself rather than re-reading the stack.
 */
function ensureRoot() {
  if (!root) {
    root = el('div.toast-root', {
      role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false',
    });
    bottomStack().append(root);
  }
  return root;
}

/* How long a toast stays, when the caller does not say: a floor for the
   two-word confirmations, and a reading pace on top of it for anything
   longer - a refusal is a sentence of twenty-odd words, and at the flat two
   and a half seconds every "Saved" got, it was gone before it could be read.
   Roughly 240 words a minute, with a moment to notice the toast first. */
const TOAST_MIN_MS = 2400;
const TOAST_ACTION_MIN_MS = 6000;
const TOAST_MS_PER_CHAR = 55;
const TOAST_MAX_MS = 10_000;

/* The one action toast whose button a keystroke can press. The toast stack
   is the last thing in the document, so from the content landmark its Undo
   button was thirty-eight Tabs away and gone in six seconds: the only offer
   to put a deleted record back could not be reached by keyboard inside its
   own lifetime. Cmd/Ctrl-Z presses it - the key every editor already means
   "undo" by - whenever the keystroke is not headed into a text field or a
   dialog. The newest action wins, as the topmost toast does on screen. */
/* Every toast whose action still stands, oldest first. One slot held only
   the newest: pressing its shortcut emptied the slot, and an older toast
   still on screen kept advertising a shortcut that did nothing. */
const pendingActions = [];
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const SHORTCUT_LABEL = IS_MAC ? '⌘Z' : 'Ctrl Z';
const SHORTCUT_ARIA = IS_MAC ? 'Meta+Z' : 'Control+Z';
// Guarded: the search and router tests import this module without a document.
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (!pendingActions.length || e.key.toLowerCase() !== 'z' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    /* Left to a field with text of its own to undo; a checkbox, a date
       picker or a select has none, and the shortcut is theirs to spend. */
    const target = e.target;
    const editable = target instanceof HTMLElement && (target.isContentEditable
      || target.matches('textarea') || (target.matches('input') && typeof target.selectionStart === 'number'));
    if (editable) return;
    if (document.querySelector('.modal-root:not(.closing)')) return;
    e.preventDefault();
    pendingActions[pendingActions.length - 1]();
  });
}

function readingTime(message, action) {
  const floor = action ? TOAST_ACTION_MIN_MS : TOAST_MIN_MS;
  return Math.min(TOAST_MAX_MS, Math.max(floor, 1500 + TOAST_MS_PER_CHAR * String(message ?? '').length));
}

/**
 * toast('Saved')
 * toast('Deleted', { icon: 'trash', action: { label: 'Undo', onClick } })
 * With an action the toast lingers longer, and reaching for that button -
 * with a pointer or with the Tab key - pauses dismissal so it can't vanish
 * mid-reach. A long message stays long enough to be read - see readingTime.
 */
export function toast(message, { icon: name = 'check', duration, action = null } = {}) {
  const ms = duration ?? readingTime(message, action);
  let timer = null;
  let gone = false;

  const dismiss = () => {
    if (gone) return;
    gone = true;
    const at = pendingActions.indexOf(press);
    if (at >= 0) pendingActions.splice(at, 1);
    clearTimeout(timer);
    /* A toast dismissed from its own button takes the focused element with
       it, and focus fell to the document body: after every Undo a keyboard
       user started over from the top. The main landmark is where the shell
       puts focus after a navigation too. */
    if (node.contains(document.activeElement)) {
      document.getElementById('main')?.focus({ preventScroll: true });
    }
    node.classList.add('leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  };

  const press = () => {
    dismiss();
    action.onClick();
  };
  const node = el('div.toast', { html: icon(name, 16, 2.2) },
    el('span', {}, message),
    action && el('button.toast-action', {
      type: 'button',
      'aria-keyshortcuts': SHORTCUT_ARIA,
      onclick: press,
    }, action.label, el('kbd', { 'aria-hidden': 'true' }, SHORTCUT_LABEL))
  );
  if (action) pendingActions.push(press);

  const arm = (t) => { clearTimeout(timer); timer = setTimeout(dismiss, t); };
  const hold = () => clearTimeout(timer);
  const release = () => { if (!gone) arm(1500); };
  node.addEventListener('pointerenter', hold);
  node.addEventListener('pointerleave', release);
  /* Focus holds the toast open on exactly the same terms as the cursor.
     Only hovering did, so the one person who could not hover was the one
     the clock ran out on: tab to "Undo" on a deletion and the six seconds
     kept running underneath, taking the button - and the only offer to put
     the record back - out from under the keyboard on its way there. */
  node.addEventListener('focusin', hold);
  node.addEventListener('focusout', release);

  ensureRoot().append(node);
  arm(ms);
  return { dismiss };
}
