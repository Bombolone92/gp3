/**
 * Editable ordered lists for settings: practice areas, stages, activity
 * categories, document categories, and relationship types. Rows rename in
 * place, reorder with up and down buttons (keyboard friendly), and delete
 * with a guard when something still uses the item.
 */
import '../styles/settings.css';
import { h, uniqueId } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { newId } from '../core/ids.js';

/**
 * listEditor({
 *   label, items: [{ id, name, ... }], onChange(items),
 *   addLabel, placeholder,
 *   usage(item) -> number of records using it (deletion asks first),
 *   usageText(n) -> text for the confirm, onRemoveUsed(item) -> clean up,
 *   idPrefix, extra(item) -> node shown at the end of a row,
 *   onRename(oldName, newName) -> carry a rename over to records,
 * })
 * Returns a node with .setItems(items).
 */
export function listEditor({ label, items, onChange, addLabel = 'Add', placeholder = 'New item', usage, usageText, onRemoveUsed, onRename, idPrefix = 'it', extra, minItems = 0 }) {
  let list = items.map((x) => ({ ...x }));
  const listId = uniqueId('list');
  const ul = h('ul.list-editor', { id: listId, 'aria-label': label });
  const live = h('div.sr-only', { role: 'status', 'aria-live': 'polite' });

  function commit(next, message) {
    list = next;
    onChange(list.map((x) => ({ ...x })));
    draw();
    if (message) live.textContent = message;
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next, `${next[j].name} moved ${d < 0 ? 'up' : 'down'} to position ${j + 1} of ${next.length}`);
    // Keep focus on the same control of the moved row.
    requestAnimationFrame(() => ul.children[j]?.querySelector(d < 0 ? '.le-up' : '.le-down')?.focus() || ul.children[j]?.querySelector('input')?.focus());
  }

  async function remove(i) {
    const it = list[i];
    if (list.length <= minItems) {
      toast(`Keep at least ${minItems} ${minItems === 1 ? 'item' : 'items'}.`, { type: 'info' });
      return;
    }
    const n = usage ? usage(it) : 0;
    if (n) {
      const ok = await confirmDialog({
        title: `Remove "${it.name}"?`,
        message: usageText ? usageText(n, it) : `${n} records use "${it.name}". They will keep working but lose this value.`,
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
      onRemoveUsed?.(it);
    }
    commit(
      list.filter((_, k) => k !== i),
      `${it.name} removed`,
    );
    requestAnimationFrame(() => (ul.children[Math.min(i, ul.children.length - 1)]?.querySelector('input') || addInput).focus());
  }

  function draw() {
    ul.replaceChildren(
      ...list.map((it, i) => {
        const input = h('input.input.le-name', { type: 'text', value: it.name, 'aria-label': `${label} ${i + 1} name`, autocomplete: 'off' });
        input.addEventListener('change', () => {
          const v = input.value.trim();
          if (!v) {
            input.value = it.name;
            return;
          }
          if (v === it.name) return;
          if (list.some((x, k) => k !== i && x.name.toLowerCase() === v.toLowerCase())) {
            toast(`"${v}" is already in the list.`, { type: 'info' });
            input.value = it.name;
            return;
          }
          // Rename in place without redrawing, so focus stays where the person tabbed to.
          list = list.map((x, k) => (k === i ? { ...x, name: v } : x));
          onChange(list.map((x) => ({ ...x })));
          onRename?.(it.name, v);
          for (const b of input.parentNode.querySelectorAll('[aria-label]')) b.setAttribute('aria-label', b.getAttribute('aria-label').replace(it.name, v));
          it.name = v;
        });
        return h(
          'li.le-row',
          h('span.le-pos.subtle', { 'aria-hidden': 'true' }, String(i + 1)),
          input,
          extra ? extra(it, i) : null,
          h('button.icon-btn.sm.le-up', { type: 'button', 'aria-label': `Move ${it.name} up`, disabled: i === 0 || null, onClick: () => move(i, -1) }, icon('arrow-up', 15)),
          h('button.icon-btn.sm.le-down', { type: 'button', 'aria-label': `Move ${it.name} down`, disabled: i === list.length - 1 || null, onClick: () => move(i, 1) }, icon('arrow-down', 15)),
          h('button.icon-btn.sm.le-del', { type: 'button', 'aria-label': `Remove ${it.name}`, onClick: () => remove(i) }, icon('trash', 15)),
        );
      }),
    );
    if (!list.length) ul.append(h('li.le-empty.subtle', 'Nothing here yet.'));
  }

  const addInput = h('input.input', { type: 'text', placeholder, 'aria-label': addLabel, autocomplete: 'off' });
  const add = () => {
    const v = addInput.value.trim();
    if (!v) return addInput.focus();
    if (list.some((x) => x.name.toLowerCase() === v.toLowerCase())) {
      toast(`"${v}" is already in the list.`, { type: 'info' });
      return;
    }
    commit([...list, { id: `${idPrefix}-${newId()}`, name: v }], `${v} added`);
    addInput.value = '';
    addInput.focus();
  };
  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  });
  draw();
  const node = h('div.list-editor-wrap', ul, h('div.le-add', addInput, h('button.btn', { type: 'button', onClick: add }, icon('plus', 15), addLabel)), live);
  node.setItems = (next) => {
    list = next.map((x) => ({ ...x }));
    draw();
  };
  return node;
}

/** Edit a plain list of strings with the same editor. */
export function stringListEditor({ label, values, onChange, addLabel, placeholder, usage, usageText, onRename }) {
  const items = values.map((v, i) => ({ id: `s${i}`, name: v }));
  return listEditor({
    label,
    items,
    addLabel,
    placeholder,
    usage: usage ? (it) => usage(it.name) : undefined,
    usageText,
    onRename,
    onChange: (next) => onChange(next.map((x) => x.name)),
  });
}
