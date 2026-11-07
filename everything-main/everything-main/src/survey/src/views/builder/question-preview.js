/**
 * How a question looks to respondents, drawn on the builder canvas with the
 * respondent stylesheet's classes. It is a picture, not a form: the
 * container is `inert`, so none of it takes focus or input.
 */
import { h } from '../../lib/dom.js';
import { fieldsOf, ratingMax, sliderBounds, OTHER_ID } from '../../shared/runtime.js';

const named = (list) => (list || []).filter((c) => (c.label || '').trim());

function choices(q, type) {
  const list = named(q.choices);
  const rows = list.length ? list : [{ id: 'x', label: 'Answer choices appear here' }];
  const extras = [];
  if (q.other && q.other.enabled) extras.push({ id: OTHER_ID, label: q.other.label || 'Other' });
  if (q.none && q.none.enabled) extras.push({ id: 'n', label: q.none.label || 'None of the above' });
  return h(
    'div',
    { class: `sv-choices sv-layout-${q.layout || 'vertical'}` },
    [...rows, ...extras].map((c) =>
      h('label', { class: `sv-choice${list.length ? '' : ' faint'}` }, h('input', { type, disabled: true, tabindex: '-1' }), h('span', { class: 'sv-choice-label' }, c.label)),
    ),
  );
}

const SHAPE_PATH = {
  star: 'M12 2.8l2.83 5.73 6.32.92-4.57 4.46 1.08 6.29L12 17.23l-5.66 2.97 1.08-6.29L2.85 9.45l6.32-.92z',
  heart: 'M12 20.5s-7.5-4.6-9.2-9.3C1.6 7.8 3.9 4.5 7.3 4.5c2 0 3.6 1.1 4.7 2.7 1.1-1.6 2.7-2.7 4.7-2.7 3.4 0 5.7 3.3 4.5 6.7-1.7 4.7-9.2 9.3-9.2 9.3z',
  thumb: 'M7 10v10H3V10h4zm2 10V9.6l4.5-6.6c.9-.9 2.6-.2 2.4 1.2L15.2 9H20c1.2 0 2.1 1.1 1.9 2.3l-1.4 7.2c-.2.9-1 1.5-1.9 1.5H9z',
  circle: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
};

function shape(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'sv-shape');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', SHAPE_PATH[name] || SHAPE_PATH.star);
  svg.append(p);
  return svg;
}

function labels(q) {
  if (!q.minLabel && !q.maxLabel) return null;
  return h('div', { class: 'sv-scale-labels' }, h('span', null, q.minLabel || ''), h('span', null, q.maxLabel || ''));
}

const PREVIEWS = {
  single: (q) => choices(q, 'radio'),
  multi: (q) => choices(q, 'checkbox'),
  dropdown: (q) =>
    h('div', { class: 'sv-dropdown' }, h('div', { class: 'sv-select-wrap' }, h('select', { class: 'sv-input sv-select', disabled: true }, h('option', null, `Select an answer (${named(q.choices).length} choices)`)))),
  ranking: (q) => {
    const list = named(q.choices);
    return h(
      'ol',
      { class: 'sv-rank sv-set' },
      (list.length ? list : [{ label: 'Items to rank appear here' }]).map((c, i) =>
        h('li', { class: 'sv-rank-item' }, h('span', { class: 'sv-rank-pos' }, String(i + 1)), h('span', { class: 'sv-rank-handle' }, '☰'), h('span', { class: 'sv-rank-label' }, c.label)),
      ),
    );
  },
  rating: (q) =>
    h('div', null, h('div', { class: `sv-rating sv-shape-${q.shape || 'star'}` },
      Array.from({ length: ratingMax(q) }, () => h('span', { class: 'sv-rating-item' }, shape(q.shape)))), labels(q)),
  nps: (q) => h('div', null, h('div', { class: 'sv-nps' }, Array.from({ length: 11 }, (_, i) => h('span', { class: 'sv-nps-item' }, String(i)))), labels(q)),
  matrix: (q) => {
    const cols = named(q.columns);
    const rows = named(q.rows);
    return h(
      'div',
      { class: 'sv-matrix-wrap' },
      h(
        'table',
        { class: 'sv-matrix' },
        h('thead', null, h('tr', null, h('td'), cols.map((c) => h('th', null, c.label)))),
        h('tbody', null, (rows.length ? rows : [{ label: 'Rows appear here' }]).map((r) =>
          h('tr', null, h('th', null, r.label), cols.map(() => h('td', null, h('span', { class: 'sv-cell' }, h('input', { type: q.multi ? 'checkbox' : 'radio', disabled: true, tabindex: '-1' }))))))),
      ),
    );
  },
  slider: (q) => {
    const { min, max } = sliderBounds(q);
    return h('div', { class: 'sv-slider' }, h('div', { class: 'sv-slider-row' }, h('input', { type: 'range', class: 'sv-range', min, max, disabled: true, tabindex: '-1' })),
      labels(q) || h('div', { class: 'sv-scale-labels' }, h('span', null, String(min)), h('span', null, String(max))));
  },
  text: (q) => h('input', { class: 'sv-input', disabled: true, tabindex: '-1', placeholder: q.placeholder || '' }),
  textarea: (q) => h('textarea', { class: 'sv-input sv-textarea', rows: 3, disabled: true, tabindex: '-1', placeholder: q.placeholder || '' }),
  multitext: (q) => fieldsPreview(q),
  contact: (q) => fieldsPreview(q),
  datetime: (q) =>
    h('div', { class: 'sv-datetime' }, q.date !== false ? h('input', { class: 'sv-input sv-date', type: 'date', disabled: true, tabindex: '-1' }) : null,
      q.time ? h('input', { class: 'sv-input sv-time', type: 'time', disabled: true, tabindex: '-1' }) : null),
};

function fieldsPreview(q) {
  const fields = fieldsOf(q).filter((f) => f.label.trim());
  return h(
    'div',
    { class: 'sv-fields' },
    (fields.length ? fields : [{ id: 'x', label: 'Box labels appear here' }]).map((f) =>
      h('div', { class: 'sv-field' }, h('label', null, f.label, f.required ? h('span', { class: 'sv-req' }, ' *') : null), h('input', { class: 'sv-input', disabled: true, tabindex: '-1' })),
    ),
  );
}

/** The respondent-facing body of a question (no title). */
export function questionPreview(q) {
  const draw = PREVIEWS[q.type];
  const node = h('div', { class: 'q-preview', inert: true, 'aria-hidden': 'true' }, draw ? draw(q) : null);
  return node;
}
