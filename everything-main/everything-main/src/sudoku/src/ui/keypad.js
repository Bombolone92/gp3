/**
 * The digit keypad.
 *
 * Each key doubles as a counter: the small number in the corner is how many of
 * that digit are still unplaced. It is the one piece of information that turns
 * the keypad from an input device into a solving aid: you can see at a glance
 * that only one 7 is left to find, and it costs a corner of space the keys
 * were not using.
 */

export function createKeypad(root, { onDigit }) {
  const keys = [];
  /** Set while the board cannot be edited at all: paused, or finished. */
  let inert = false;

  for (let d = 1; d <= 9; d++) {
    const key = document.createElement('button');
    key.type = 'button';
    key.className = 'key';
    key.dataset.digit = String(d);

    const label = document.createElement('span');
    label.textContent = String(d);

    const count = document.createElement('span');
    count.className = 'key-count';

    key.append(label, count);
    root.append(key);
    keys.push({ el: key, count, digit: d });
  }

  root.addEventListener('click', (event) => {
    if (inert) return;
    const key = event.target.closest('.key');
    if (key && !key.classList.contains('exhausted')) onDigit(Number(key.dataset.digit));
  });

  /**
   * @param {object} view
   * @param {(digit: number) => number} view.remaining How many are unplaced.
   * @param {boolean} view.notesMode Keys write pencil marks rather than digits.
   * @param {boolean} view.showRemaining Whether to show the counters at all.
   * @param {number} view.selectedDigit Digit in the selected cell, or 0.
   * @param {boolean} [view.disabled] The board cannot be edited at all.
   */
  function render(view) {
    inert = !!view.disabled;
    root.classList.toggle('notes-mode', view.notesMode);
    root.classList.toggle('is-disabled', inert);
    for (const key of keys) {
      const left = view.remaining(key.digit);
      // A digit that is fully placed stays put but stops responding: removing
      // it would reflow the row under the player's finger.
      const exhausted = left === 0;
      key.el.classList.toggle('exhausted', exhausted);
      key.el.classList.toggle('selected-digit', !view.notesMode && key.digit === view.selectedDigit);
      key.el.setAttribute('aria-disabled', inert || exhausted ? 'true' : 'false');
      key.el.title = view.notesMode
        ? `Pencil in ${key.digit}`
        : exhausted
          ? `All nine ${key.digit}s are placed`
          : `Enter ${key.digit} (${left} left)`;
      key.el.setAttribute(
        'aria-label',
        view.notesMode ? `Pencil in ${key.digit}` : `${key.digit}, ${left} remaining`,
      );

      const text = view.showRemaining && !exhausted ? String(left) : '';
      if (key.count.textContent !== text) key.count.textContent = text;
    }
  }

  return { render, keys };
}
