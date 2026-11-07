/** Settings > Lists: vendor categories, task categories, lead sources. */
import { h, uniqueId } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app } from '../../app.js';
import { defaultSettings } from '../../core/settings.js';

const LISTS = [
  { key: 'vendorCategories', title: 'Vendor categories', hint: 'Used to group and filter vendors.' },
  { key: 'taskCategories', title: 'Task categories', hint: 'Used to sort tasks and resident requests.' },
  { key: 'leadSources', title: 'Lead sources', hint: 'Where applicants heard about your rentals.' },
];

export function listsSection() {
  return h('div.stack.settings-stack', LISTS.map((l) => listCard(l)));
}

function listCard({ key, title, hint }) {
  const status = h('span.save-status', { role: 'status', 'aria-live': 'polite' });
  const items = [...(app.settings().lists?.[key] || [])];
  const listId = uniqueId('lst');
  const input = h('input.input', { type: 'text', placeholder: 'Add an item and press Enter', 'aria-label': `Add to ${title.toLowerCase()}`, autocomplete: 'off' });
  const ul = h('ul.edit-list', { id: listId, 'aria-label': title });
  const count = h('span.count');
  let timer;

  const save = () => {
    app.store.saveSettings({ lists: { [key]: [...items] } });
    status.replaceChildren(icon('check', 14), 'Saved');
    clearTimeout(timer);
    timer = setTimeout(() => status.replaceChildren(), 1800);
  };

  const draw = () => {
    count.textContent = ` ${items.length}`;
    ul.replaceChildren(
      ...items.map((item, i) =>
        h(
          'li',
          h('span.grow', item),
          h(
            'button.icon-btn.sm',
            { type: 'button', 'aria-label': `Move ${item} up`, title: 'Move up', disabled: i === 0 || null, onClick: () => move(i, -1) },
            icon('arrow-up', 14),
          ),
          h(
            'button.icon-btn.sm',
            { type: 'button', 'aria-label': `Move ${item} down`, title: 'Move down', disabled: i === items.length - 1 || null, onClick: () => move(i, 1) },
            icon('arrow-down', 14),
          ),
          h(
            'button.icon-btn.sm',
            {
              type: 'button',
              'aria-label': `Remove ${item}`,
              title: 'Remove',
              onClick: () => {
                items.splice(i, 1);
                draw();
                save();
                input.focus();
              },
            },
            icon('x', 14),
          ),
        ),
      ),
    );
  };

  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    draw();
    save();
    ul.children[j]?.querySelectorAll('button')[d < 0 ? 0 : 1]?.focus();
  };

  const add = () => {
    const v = input.value.trim();
    if (!v) return;
    if (!items.some((x) => x.toLowerCase() === v.toLowerCase())) {
      items.push(v);
      draw();
      save();
    }
    input.value = '';
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  });

  const reset = () => {
    items.splice(0, items.length, ...defaultSettings().lists[key]);
    draw();
    save();
  };

  draw();
  return h(
    'section.card',
    h('div.card-head', h('h2.grow', title, count), status),
    h(
      'div.card-body.stack',
      h('p.subtle', hint),
      ul,
      h('div.row', input, h('button.btn', { type: 'button', onClick: add }, icon('plus', 16), 'Add')),
      h('div', h('button.link-btn', { type: 'button', onClick: reset }, 'Restore the default list')),
    ),
  );
}
