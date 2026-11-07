/** Form pieces shared by the tenant and owner forms. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { textInput } from '../../ui/components.js';

/**
 * Repeatable rows of small text fields (vehicles, pets). Mutates `list`.
 * fields: [{ key, label, placeholder }]
 */
export function rowsEditor(list, fields, { noun = 'item', addLabel = 'Add' } = {}) {
  const wrap = h('div.stack.sm.rn-rows');
  const draw = () => {
    wrap.replaceChildren(
      ...list.map((entry, i) =>
        h(
          'div.rn-rows-row',
          { style: { '--cols': fields.length } },
          fields.map((f) => {
            const inp = textInput({ value: entry[f.key] || '', placeholder: f.placeholder || f.label, 'aria-label': `${f.label}, ${noun} ${i + 1}` });
            inp.addEventListener('input', () => (entry[f.key] = inp.value));
            return inp;
          }),
          h(
            'button.icon-btn',
            {
              type: 'button',
              'aria-label': `Remove ${noun} ${i + 1}`,
              onClick: () => {
                list.splice(i, 1);
                draw();
              },
            },
            icon('x', 16),
          ),
        ),
      ),
      h(
        'div',
        h(
          'button.btn.sm.ghost',
          {
            type: 'button',
            onClick: () => {
              list.push(Object.fromEntries(fields.map((f) => [f.key, ''])));
              draw();
              wrap.querySelectorAll('.rn-rows-row')[list.length - 1]?.querySelector('input')?.focus();
            },
          },
          icon('plus', 14),
          addLabel,
        ),
      ),
    );
  };
  draw();
  return wrap;
}

/** Drop rows where every field is blank, and trim values. */
export function cleanRows(list) {
  return list.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '').trim()]))).filter((r) => Object.values(r).some(Boolean));
}

/** Only follow in-app "next" links (a path starting with a single slash). */
export function safeNext(next) {
  const n = String(next || '');
  return /^\/[^/]/.test(n) || n === '/' ? n : null;
}
