/**
 * Template gallery: categories, search, a card grid, and a preview of the
 * selected template (an outline of every question, or the live survey as
 * respondents see it). Resolves with a fresh survey built from the chosen
 * template, or null.
 *
 * The grid is a single-select listbox: arrow keys move the selection (up and
 * down by row), Enter uses the selected template. On narrow screens the
 * preview becomes a second screen with a Back button.
 */
import '../styles/respond.css';
import '../styles/create.css';
import { h, replace, debounce, announce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { openDialog } from '../lib/ui.js';
import { plural } from '../lib/format.js';
import { TYPE_BY_ID } from '../model/survey.js';
import { CATEGORIES, TEMPLATES, buildTemplate, sampleOf, searchTemplates, templateInfo } from '../model/templates/index.js';
import { mountSurvey } from '../respond/render.js';

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

/** An outline of every page and question, for a quick read of a survey. */
export function surveyOutline(survey) {
  return h(
    'ol',
    { class: 'outline' },
    survey.pages.map((p, i) =>
      h(
        'li',
        { class: 'outline-page' },
        survey.pages.length > 1 || p.title ? h('div', { class: 'outline-page-title' }, p.title || `Page ${i + 1}`) : null,
        h(
          'ol',
          { class: 'outline-questions' },
          p.questions.map((q) => {
            const t = TYPE_BY_ID[q.type];
            const count = (q.choices || q.rows || []).length;
            return h(
              'li',
              { class: 'outline-q' },
              h('span', { class: 'outline-q-icon', title: t.label }, icon(t.icon, { size: 14 })),
              h(
                'span',
                { class: 'outline-q-text' },
                h('span', { class: 'outline-q-title' }, q.title || q.description, q.required ? [h('span', { class: 'outline-req', 'aria-hidden': 'true' }, ' *'), h('span', { class: 'sr-only' }, ' (required)')] : null),
                h('span', { class: 'outline-q-meta' }, t.label, count ? ` · ${plural(count, q.rows ? 'row' : 'choice')}` : '', q.display ? ' · shown conditionally' : ''),
              ),
            );
          }),
        ),
      ),
    ),
  );
}

export function openTemplates() {
  const state = { category: '', query: '', selected: TEMPLATES[0].id, mode: 'outline', showPreview: false };
  return openDialog({
    title: 'Start from a template',
    className: 'tpl-dialog',
    build: (close) => {
      // Only a template the search still shows can be used.
      const useTemplate = () => {
        const def = visible.find((t) => t.id === state.selected);
        if (def) close(buildTemplate(def));
      };
      const useBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: useTemplate }, 'Use this template');

      /* ---- Sidebar ---- */
      const search = h('input', {
        class: 'input',
        type: 'search',
        placeholder: 'Search templates',
        'aria-label': 'Search templates',
        oninput: debounce(() => {
          state.query = search.value;
          renderGrid(true);
        }, 120),
      });
      const cats = h('div', { class: 'tpl-cats', role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Categories' });
      const catSelect = h(
        'select',
        { class: 'select tpl-cat-select', 'aria-label': 'Category', onchange: () => pickCategory(catSelect.value) },
        h('option', { value: '' }, 'All templates'),
        CATEGORIES.map((c) => h('option', { value: c.id }, c.label)),
      );
      function pickCategory(id) {
        state.category = id;
        catSelect.value = id;
        renderCats();
        renderGrid(true);
      }
      function renderCats() {
        const entries = [{ id: '', label: 'All templates' }, ...CATEGORIES];
        replace(
          cats,
          entries.map((c) => {
            const n = c.id ? TEMPLATES.filter((t) => t.category === c.id).length : TEMPLATES.length;
            return h(
              'button',
              {
                type: 'button',
                role: 'tab',
                class: 'tpl-cat',
                'aria-selected': String(state.category === c.id),
                tabindex: state.category === c.id ? '0' : '-1',
                onclick: () => pickCategory(c.id),
                onkeydown: (e) => {
                  const i = entries.findIndex((x) => x.id === state.category);
                  const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : null;
                  if (to == null || to < 0 || to >= entries.length) return;
                  e.preventDefault();
                  pickCategory(entries[to].id);
                  cats.querySelector('[aria-selected="true"]').focus();
                },
              },
              h('span', null, c.label),
              h('span', { class: 'count' }, String(n)),
            );
          }),
        );
      }

      /* ---- Grid ---- */
      const grid = h('div', { class: 'tpl-grid', role: 'listbox', 'aria-label': 'Templates', tabindex: '0' });
      const status = h('p', { class: 'sr-only', role: 'status' });
      let visible = [];

      function columns() {
        const cards = grid.querySelectorAll('.tpl-card');
        if (cards.length < 2) return 1;
        const top = cards[0].offsetTop;
        let n = 0;
        for (const c of cards) if (c.offsetTop === top) n++;
        return Math.max(1, n);
      }

      function select(id, { focus = false, preview = false } = {}) {
        state.selected = id;
        for (const c of grid.querySelectorAll('.tpl-card')) c.setAttribute('aria-selected', String(c.dataset.id === id));
        grid.setAttribute('aria-activedescendant', `tpl-${id}`);
        const card = grid.querySelector(`[data-id="${id}"]`);
        if (card) card.scrollIntoView({ block: 'nearest' });
        if (focus) grid.focus();
        if (preview) state.showPreview = true;
        renderPreview();
      }

      grid.addEventListener('keydown', (e) => {
        if (!visible.length) return;
        const i = Math.max(0, visible.findIndex((t) => t.id === state.selected));
        const cols = columns();
        const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -i, End: visible.length - 1 - i };
        if (e.key in moves) {
          e.preventDefault();
          const to = Math.min(visible.length - 1, Math.max(0, i + moves[e.key]));
          select(visible[to].id);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          useTemplate();
        }
      });

      function renderGrid(resetSelection = false) {
        visible = searchTemplates(state.query, state.category);
        if (resetSelection && visible.length && !visible.some((t) => t.id === state.selected)) state.selected = visible[0].id;
        if (!visible.length) {
          replace(grid, h('div', { class: 'tpl-empty' }, h('p', null, 'No templates match your search.')));
          status.textContent = 'No templates found';
          renderPreview();
          return;
        }
        replace(
          grid,
          visible.map((t) => {
            const info = templateInfo(t);
            const card = h(
              'div',
              {
                class: 'tpl-card',
                role: 'option',
                id: `tpl-${t.id}`,
                'data-id': t.id,
                'aria-selected': String(t.id === state.selected),
                onclick: () => select(t.id, { preview: true }),
                ondblclick: () => {
                  state.selected = t.id;
                  useTemplate();
                },
              },
              h('span', { class: 'tpl-card-cat' }, CATEGORY_LABEL[t.category]),
              h('span', { class: 'tpl-card-title' }, t.name),
              h('span', { class: 'tpl-card-sum' }, t.summary),
              h('span', { class: 'tpl-card-meta' }, plural(info.questions, 'question'), ` · about ${info.minutes} min`),
            );
            return card;
          }),
        );
        grid.setAttribute('aria-activedescendant', `tpl-${state.selected}`);
        status.textContent = `${plural(visible.length, 'template')} found`;
        renderPreview();
      }

      /* ---- Preview ---- */
      const preview = h('section', { class: 'tpl-preview', 'aria-label': 'Template preview' });

      function renderPreview() {
        const def = visible.find((t) => t.id === state.selected);
        useBtn.disabled = !def;
        layout.classList.toggle('show-preview', state.showPreview && !!def);
        if (!def) {
          replace(preview, h('div', { class: 'tpl-empty' }, h('p', null, 'Select a template to preview it.')));
          return;
        }
        const sample = sampleOf(def);
        const info = templateInfo(def);
        const body = h('div', { class: 'tpl-preview-body scroll', tabindex: '0', 'aria-label': 'Template preview' });
        if (state.mode === 'live') {
          const host = h('div', { class: 'tpl-live' });
          body.append(host);
          mountSurvey(host, { survey: sample, preview: true });
        } else {
          body.append(sample.description ? h('p', { class: 'tpl-intro' }, sample.description) : null, surveyOutline(sample));
        }
        const modeBtn = (mode, label) =>
          h('button', { type: 'button', 'aria-pressed': String(state.mode === mode), onclick: () => ((state.mode = mode), renderPreview()) }, label);
        replace(
          preview,
          h(
            'div',
            { class: 'tpl-preview-head' },
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm tpl-back', onclick: () => ((state.showPreview = false), renderPreview(), grid.focus()) },
              icon('chevLeft', { size: 14 }), 'All templates'),
            h('h3', null, def.name),
            h('p', { class: 'muted' }, def.summary),
            h('p', { class: 'tpl-preview-meta' }, `${plural(info.questions, 'question')} · ${plural(info.pages, 'page')} · about ${info.minutes} min`),
            h('div', { class: 'seg', role: 'group', 'aria-label': 'Preview style' }, modeBtn('outline', 'Outline'), modeBtn('live', 'As respondents see it')),
          ),
          body,
        );
      }

      const layout = h(
        'div',
        { class: 'tpl' },
        h('div', { class: 'tpl-side' }, search, catSelect, cats),
        h('div', { class: 'tpl-main scroll' }, grid, status),
        preview,
      );
      renderCats();
      renderGrid();
      requestAnimationFrame(() => search.focus());
      announce(`${TEMPLATES.length} templates available`);

      return {
        body: layout,
        foot: [
          h('span', { class: 'spacer' }),
          h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'Cancel'),
          useBtn,
        ],
      };
    },
  }).then((v) => v || null);
}
