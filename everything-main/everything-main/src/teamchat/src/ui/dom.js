/**
 * Attributes whose `false` means something: spellcheck="false" turns the
 * checker off (it is on by default in a text field) and draggable="false"
 * stops an image being picked up. Every other false is "leave it out", so
 * `disabled: cond` and `hidden: cond` read naturally.
 */
const FALSE_IS_A_VALUE = new Set(['spellcheck', 'draggable']);

/** Whether the main pointer is a finger: no hover, and no Shift+Enter on the keyboard. */
export const coarsePointer = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

/**
 * Whether a bare Enter sends (or saves) rather than breaking the line: it
 * breaks the line on phones, where Shift+Enter does not exist, and when the
 * preference says so; Cmd/Ctrl+Enter sends either way.
 */
export const enterSends = (prefs) => prefs?.enterSends !== false && !coarsePointer();

/**
 * Whether a keydown is the input method's (a Japanese, Chinese or Korean
 * candidate being chosen), when Enter takes the candidate rather than
 * sending. `isComposing` says so everywhere but Safari, which fires the
 * confirming Enter after compositionend with isComposing false, and only
 * the legacy keyCode 229 ("process") left to tell it from a real Enter.
 */
export const composing = (e) => !!e.isComposing || e.keyCode === 229;

/**
 * The window's safe area: how far in from each edge the notch, the rounded
 * corners and the home indicator reach, in pixels, for what is laid out
 * against the window's edges by script (a popover placed at a point; see
 * menu.js place). The stylesheet reads env(safe-area-inset-*) itself and
 * script cannot, so a box is laid out by those insets once, kept out of
 * sight, and measured. A box without a size (nothing laid out) says the
 * whole window is safe.
 */
let safeProbe = null;
export function safeInsets() {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof document === 'undefined' || !document.body) return none;
  if (!safeProbe || !safeProbe.isConnected) {
    safeProbe = document.createElement('div');
    safeProbe.className = 'safe-probe';
    safeProbe.setAttribute('aria-hidden', 'true');
    safeProbe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;top:env(safe-area-inset-top,0px);right:env(safe-area-inset-right,0px);bottom:env(safe-area-inset-bottom,0px);left:env(safe-area-inset-left,0px);';
    document.body.append(safeProbe);
  }
  const r = safeProbe.getBoundingClientRect();
  if (!r.width && !r.height) return none;
  const at = (n) => Math.max(0, Math.round(n) || 0);
  return { top: at(r.top), right: at(window.innerWidth - r.right), bottom: at(window.innerHeight - r.bottom), left: at(r.left) };
}

/** Tiny element builder: el('button.btn.btn-primary', { onclick }, ...children) */
export function el(spec, attrs = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || (v === false && !FALSE_IS_A_VALUE.has(k))) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k in node && k !== 'list' && k !== 'form' && k !== 'type') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  append(node, children);
  return node;
}

/** Appends children, dropping every falsy value so `cond && el()` is safe. */
export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (!child && child !== 0) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

let uidCounter = 0;
export function fieldId(prefix = 'f') {
  uidCounter += 1;
  return `${prefix}-${uidCounter}`;
}

/** Focusable descendants in tab order. */
export function focusables(root) {
  // tabindex="-1" takes an element out of the Tab order (a grid's cells,
  // reached by arrow keys), whatever kind of element it is.
  return [...root.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]',
  )].filter((n) => n.getAttribute('tabindex') !== '-1' && !n.closest('[hidden]') && n.offsetParent !== null);
}

/**
 * Replace a container's children without dropping keyboard focus: a
 * choice group, picker, or segment control redrawn on selection would
 * otherwise send focus to <body>, so the next Tab starts over and a screen
 * reader hears nothing. The child at the same position (the one that was
 * just activated, in a list that keeps its order) gets focus back, or the
 * last one when the list shrank under it.
 */
export function rerender(container, ...nodes) {
  const active = document.activeElement;
  const index = active && container.contains(active) ? [...container.children].findIndex((c) => c === active || c.contains(active)) : -1;
  container.replaceChildren(...nodes.flat(Infinity).filter((n) => n || n === 0));
  if (index < 0) return;
  const kids = [...container.children];
  const target = kids[Math.min(index, kids.length - 1)];
  if (!target) return;
  const next = target.matches('button:not([disabled]), a[href], [tabindex]') ? target : target.querySelector('button:not([disabled]), a[href], [tabindex]');
  next?.focus({ preventScroll: true });
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Remember where keyboard focus is inside a container about to be redrawn,
 * and return a function that puts it back on the redrawn content: the
 * control with the same label, or the one at the same position when the
 * label changed with the press (Mark done → Mark not done) or the row went
 * (Remove); the last one when the list shrank under it. For a redraw that
 * spans an await (a list fetched again after an action); keepFocus() is
 * the same in one step.
 */
export function focusMemo(container) {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body || !container.contains(active)) return () => {};
  const labelOf = (n) => n.getAttribute('aria-label') || n.textContent.trim();
  const before = [...container.querySelectorAll(FOCUSABLE)];
  const index = before.indexOf(active);
  const label = labelOf(active);
  // A label names its control only when no other control in the list wore
  // it: "Move Wiki up" is one button wherever the row goes, but "Mark done"
  // on every open item names a row's place, not the row. Sought by label
  // after the press flipped its own to "Mark not done", the keyboard landed
  // on the next item's done mark, a Space away from marking that one too.
  const unique = !!label && before.filter((n) => labelOf(n) === label).length === 1;
  return (target = container) => {
    if (active.isConnected && document.activeElement === active) return;
    if (document.activeElement !== document.body && document.activeElement?.isConnected) return;
    // The control itself, when the redraw kept it and put it back (a reply
    // box built once, a pinned bar taken out and appended again): detached,
    // it lost the keyboard to the page, and the guess below by label or by
    // place could land on a neighbour wearing the same label. Back in the
    // list, it is the surest place. Not one the redraw hid or disabled,
    // which a browser will not focus (the guess stands in for it).
    if (active.isConnected && target.contains(active) && active.matches(FOCUSABLE) && active.offsetParent !== null) {
      active.focus({ preventScroll: true });
      return;
    }
    const after = [...target.querySelectorAll(FOCUSABLE)];
    // The same place first, when the control there still carries the same
    // label: in a list whose rows all offer the same control ("Open in
    // conversation" on every file, the done mark on every saved item), the
    // first control with that label is the top row's, and a redraw after a
    // press in the middle of the list sent the keyboard to the top.
    const same = after[index];
    const next = (same && label && labelOf(same) === label ? same : null)
      || (unique && after.find((n) => labelOf(n) === label))
      || after[Math.min(Math.max(index, 0), after.length - 1)];
    next?.focus({ preventScroll: true });
  };
}

export function keepFocus(container, redraw) {
  const restore = focusMemo(container);
  redraw();
  restore();
}

/**
 * One press at a time on a button whose press waits on the worker (Join,
 * Try again, Remove), said with aria-busy rather than by disabling the
 * button: a focused button that is disabled hands its focus to the page
 * body, so the keyboard was left on nothing while the worker answered, and
 * after a refusal, when the button came back enabled with nobody on it, the
 * next Tab started over from the top of the page. The press runs `fn`
 * unless one is already out; `.btn[aria-busy="true"]` draws the wait as a
 * disabled button is drawn.
 */
export function pressOnce(btn, fn) {
  return async (...args) => {
    if (btn.getAttribute('aria-busy') === 'true') return;
    btn.setAttribute('aria-busy', 'true');
    try {
      await fn(...args);
    } finally {
      btn.removeAttribute('aria-busy');
    }
  };
}

/**
 * Redraw a tablist's tabs. With a roving tabindex only the selected tab is
 * in the tab order, so when focus was in the list it lands on the selected
 * tab rather than on <body> (which is where a rebuilt, detached tab leaves it).
 */
export function rerenderTabs(tablist, ...tabs) {
  const had = tablist.contains(document.activeElement);
  tablist.replaceChildren(...tabs.flat(Infinity).filter(Boolean));
  if (had) tablist.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
}

/**
 * Escape in a filter box with something in it clears the box and stops
 * there, as the sidebar's filter does: left alone, the key travelled on to
 * the document and closed the side panel under the words being cleared,
 * and only some browsers clear a search field on their own (Chrome and
 * Safari do, Firefox does not). Empty, the key goes on as usual. During an
 * IME composition the key cancels the composition and nothing more, and a
 * modified Escape is somebody else's key (Shift+Esc marks everything read)
 * and passes. `onClear` runs after the box is emptied and its input event
 * sent.
 */
export function clearOnEscape(input, onClear = null) {
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || composing(e) || !input.value) return;
    e.preventDefault();
    e.stopPropagation();
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    onClear?.();
  });
}

/**
 * A radiogroup made of buttons, the way the ARIA pattern has it: one tab
 * stop (the checked radio, or the first), and the arrow keys move to the
 * neighbour and choose it, Left and Up back, Right and Down forward, round
 * at the ends, Home and End to the ends. A modified arrow (Alt/Cmd/Ctrl) is
 * a shortcut's and passes; one during an IME composition is the IME's. The
 * groups here are redrawn on every choice (see rerender, which keeps the
 * focus at the same place, that is on the radio just chosen): the tab stop
 * is put back after every click on the group, and the returned function
 * puts it back after any other redraw the caller makes.
 */
export function radioNav(group) {
  const radios = () => [...group.querySelectorAll('[role="radio"]:not([disabled])')];
  const rove = () => {
    const list = radios();
    const stop = list.find((n) => n.getAttribute('aria-checked') === 'true') || list[0];
    for (const n of list) n.setAttribute('tabindex', n === stop ? '0' : '-1');
  };
  group.addEventListener('keydown', (e) => {
    if (e.altKey || e.metaKey || e.ctrlKey || composing(e)) return;
    const list = radios();
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    let next;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i + list.length - 1) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else return;
    e.preventDefault();
    const target = list[next];
    if (target === list[i]) return;
    // Focused first, so a redraw the choice brings finds the keyboard here
    // and puts it back on the radio that took this one's place.
    target.focus({ preventScroll: true });
    if (target.getAttribute('aria-checked') !== 'true') target.click();
    rove();
  });
  group.addEventListener('click', () => rove());
  rove();
  return rove;
}

/** Debounce a function. */
export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Roving keyboard navigation for a vertical list of items. Only the bare
 * keys are the list's: an arrow held with Alt, Cmd or Ctrl is a shortcut
 * (Alt+↑/↓ step through conversations, Shift with them through the unread
 * ones) and passes on to the page, where it would otherwise have arrived
 * already claimed and done nothing but move the focus a row.
 */
export function listKeyNav(container, itemSelector) {
  container.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || e.altKey || e.metaKey || e.ctrlKey) return;
    // Rendered items only: one hidden by a collapsed section or a layout
    // rule (the sidebar's Activity and Later rows are the rail's on wide
    // screens) cannot take focus, and the arrow would stick on it.
    const items = [...container.querySelectorAll(itemSelector)].filter((n) => n.getClientRects().length > 0);
    if (!items.length) return;
    const active = document.activeElement;
    const i = items.indexOf(active);
    if (i < 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      // The keyboard is on a control that is not a row: one of a row's own
      // (a Later row's Remove, a card's Message, the kebab of a sidebar row)
      // or one between the rows (a section heading, Load more). The step is
      // taken from there rather than from the top of the list, where the
      // arrow used to land it whatever row it left: from a row's control to
      // the row below or above (the row is the item whose box holds the
      // control), from anything else to the nearest row on that side.
      const order = [...container.querySelectorAll('*')];
      const at = order.indexOf(active);
      if (at < 0) return;
      const pos = new Map(order.map((n, k) => [n, k]));
      const before = items.filter((n) => pos.get(n) < at);
      const after = items.filter((n) => pos.get(n) > at);
      const row = [...before].reverse().find((n) => n.parentElement !== container && n.parentElement.contains(active));
      const target = row
        ? items[items.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)]
        : e.key === 'ArrowDown' ? after[0] : before[before.length - 1];
      if (!target) return;
      e.preventDefault();
      target.focus();
      return;
    }
    let next = i;
    if (e.key === 'ArrowDown') next = Math.min(items.length - 1, i + 1);
    if (e.key === 'ArrowUp') next = Math.max(0, i - 1);
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = items.length - 1;
    if (next !== i && items[next]) {
      e.preventDefault();
      items[next].focus();
    }
  });
}

/**
 * A toolbar of buttons, the way the ARIA pattern has it: one tab stop (the
 * button last used, or the first), and the arrow keys move between the
 * buttons without pressing them, Left and Up back, Right and Down forward,
 * round at the ends, Home and End to the ends. A modified arrow (Alt, Cmd,
 * Ctrl) is a shortcut's and passes; one during an IME composition is the
 * IME's. Every button stays clickable as before, and the one focused (by a
 * click, an arrow, or a Tab into the bar) becomes the stop; a button that is
 * disabled or hidden is skipped, and the stop falls back to the first live
 * one when its own goes. The returned function puts the stops back after
 * the caller enables or disables buttons.
 */
export function toolbarNav(toolbar) {
  const live = () => [...toolbar.querySelectorAll('button:not([disabled])')].filter((n) => !n.hidden);
  let stop = null;
  const rove = () => {
    const list = live();
    if (!list.includes(stop)) stop = list[0] || null;
    for (const n of toolbar.querySelectorAll('button')) n.setAttribute('tabindex', n === stop ? '0' : '-1');
  };
  toolbar.addEventListener('keydown', (e) => {
    if (e.altKey || e.metaKey || e.ctrlKey || composing(e)) return;
    const list = live();
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    let next;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i + list.length - 1) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else return;
    e.preventDefault();
    stop = list[next];
    rove();
    stop.focus({ preventScroll: true });
  });
  toolbar.addEventListener('focusin', (e) => {
    if (!(e.target instanceof HTMLElement) || !e.target.matches('button') || e.target === stop) return;
    stop = e.target;
    rove();
  });
  rove();
  return rove;
}
