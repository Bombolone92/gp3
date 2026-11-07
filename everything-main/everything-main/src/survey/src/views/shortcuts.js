import { h, modKey, domId } from '../lib/dom.js';
import { openDialog } from '../lib/ui.js';

export const SHORTCUTS = [
  {
    group: 'Everywhere',
    items: [
      [['?'], 'Show keyboard shortcuts'],
      [['Esc'], 'Close a menu or dialog'],
    ],
  },
  {
    group: 'Surveys list',
    items: [
      [['/'], 'Search surveys'],
      [['N'], 'Create a survey'],
    ],
  },
  {
    group: 'Survey builder',
    items: [
      [[modKey(), 'Z'], 'Undo'],
      [[modKey(), 'Shift', 'Z'], 'Redo'],
      [['A'], 'Add a question'],
      [[modKey(), 'D'], 'Duplicate the selected question'],
      [['Alt', '↑'], 'Move the selected question up'],
      [['Alt', '↓'], 'Move the selected question down'],
      [['Delete'], 'Delete the selected question'],
      [['Shift', 'F10'], 'More actions for the selected question'],
      [['↑', '↓'], 'Select the previous or next question'],
      [['Enter'], 'Edit the selected question'],
      [['Esc'], 'Finish editing'],
      [[modKey(), 'Shift', 'P'], 'Preview the survey'],
    ],
  },
  {
    group: 'Choice lists',
    items: [
      [['Enter'], 'Add a choice below'],
      [['Backspace'], 'Remove an empty choice'],
    ],
  },
  {
    group: 'Results',
    items: [
      [['J'], 'Next response'],
      [['K'], 'Previous response'],
    ],
  },
];

// Shortcuts of one key without Ctrl, Alt or Cmd (/, N, A, J, K, ?) can be
// turned off: speech input and stray key presses can set them off
// (WCAG 2.1.4).
let singleKeys = true;
export const singleKeysOn = () => singleKeys;
export function setSingleKeys(on) {
  singleKeys = on !== false;
}

/** The shortcuts list. `onSingleKeys(on)` keeps a change of the setting. */
export function shortcutsDialog({ onSingleKeys = null } = {}) {
  if (document.querySelector('dialog.shortcuts-dialog')) return;
  const id = domId('sw');
  const toggle = h(
    'div',
    { class: 'shortcuts-toggle' },
    h(
      'label',
      { class: 'switch', for: id },
      h('span', null, 'Single-key shortcuts'),
      h('input', {
        type: 'checkbox',
        role: 'switch',
        id,
        checked: singleKeys,
        'aria-describedby': `${id}-hint`,
        onchange: (e) => {
          setSingleKeys(e.target.checked);
          onSingleKeys && onSingleKeys(e.target.checked);
        },
      }),
    ),
    h('p', { class: 'field-hint', id: `${id}-hint` }, 'Shortcuts of one key, such as / or N. Turn them off if they get in the way, for example with speech input.'),
  );
  openDialog({
    title: 'Keyboard shortcuts',
    className: 'shortcuts-dialog',
    build: () =>
      h(
        'div',
        { class: 'shortcuts' },
        toggle,
        SHORTCUTS.map((g) =>
          h(
            'section',
            null,
            h('h3', null, g.group),
            h(
              'dl',
              null,
              g.items.map(([keys, what]) =>
                h('div', { class: 'shortcut' }, h('dt', null, what), h('dd', null, keys.map((k) => h('kbd', null, k)))),
              ),
            ),
          ),
        ),
      ),
  });
}
