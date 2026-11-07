import { h } from '../ui/dom.js';
import { openDialog } from '../ui/dialog.js';
import { SHORTCUT_HELP, label } from '../ui/shortcuts.js';

let open = null;

export function showShortcuts() {
  if (open) return;
  const body = h('div.shortcut-groups', SHORTCUT_HELP.map(([group, list]) =>
    h('section.shortcut-group',
      h('h3', group),
      h('dl', list.map(([key, text]) => [h('dt', text), h('dd', key.split(' ').map((part, i) => [i ? h('span.subtle', ' then ') : null, h('kbd', label(part))]))])),
    )));
  open = openDialog({ title: 'Keyboard shortcuts', body, size: 'lg', onClose: () => { open = null; } });
}
