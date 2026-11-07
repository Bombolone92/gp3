/**
 * Cmd/Ctrl+K palette: type-ahead search over candidates, jobs, and
 * interviews, fully keyboard-driven (combobox + listbox pattern).
 */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { quickFind } from '../core/search.js';
import { badge } from './components.js';

const TYPE_ICONS = { candidate: 'user', job: 'briefcase', interview: 'calendar' };

export function openQuickFind(ctx) {
  if (document.querySelector('.palette-overlay')) return;

  const previouslyFocused = document.activeElement;
  let results = [];
  let active = 0;

  const input = el('input', {
    class: 'palette-input',
    type: 'text',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-autocomplete': 'list',
    'aria-controls': 'palette-results',
    'aria-label': 'Search candidates, jobs, and interviews',
    placeholder: 'Search candidates, jobs, interviews…',
  });
  const list = el('div', { class: 'palette-results', id: 'palette-results', role: 'listbox', 'aria-label': 'Results' });
  const hint = el('div', { class: 'palette-hint', 'aria-live': 'polite' });

  function close({ refocus = true } = {}) {
    document.removeEventListener('keydown', onKeydown, true);
    overlay.remove();
    if (refocus && previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
      previouslyFocused.focus();
    }
  }

  function go(result) {
    // Picking the view already on screen sets an unchanged hash: no
    // hashchange, no re-render, nothing to take focus — so restore it
    // the way Esc does instead of dropping it on <body>.
    const alreadyThere = location.hash === `#/${result.route}`;
    close({ refocus: alreadyThere });
    if (alreadyThere) return;
    ctx.navigate(result.route);
    // Removing the focused palette parked focus on <body>, and the render
    // the hashchange triggers restores nothing from there — a keyboard or
    // screen-reader user would have to Tab through the whole sidebar to
    // reach what they just opened. Land on the view instead (the same
    // fallback modal.close uses); render keeps the node, so it holds.
    const view = document.querySelector('main.content');
    if (view instanceof HTMLElement) {
      view.tabIndex = -1;
      view.focus();
    }
  }

  function paint() {
    list.replaceChildren(
      ...results.map((r, i) =>
        el(
          'div',
          {
            class: `palette-item${i === active ? ' is-active' : ''}`,
            id: `palette-item-${i}`,
            role: 'option',
            'aria-selected': String(i === active),
            // mousedown, not click: the input must keep focus throughout.
            onMousedown: (e) => {
              e.preventDefault();
              go(r);
            },
            onMousemove: () => {
              if (active !== i) {
                active = i;
                paint();
              }
            },
          },
          el('span', { class: 'palette-item-icon' }, icon(TYPE_ICONS[r.type], 15)),
          el(
            'div',
            { class: 'palette-item-main' },
            el('div', { class: 'palette-item-title' }, r.title),
            r.subtitle ? el('div', { class: 'palette-item-sub' }, r.subtitle) : null
          ),
          r.archived ? badge(r.type === 'job' ? 'Closed' : 'Archived') : null
        )
      )
    );
    input.setAttribute('aria-activedescendant', results.length > 0 ? `palette-item-${active}` : '');
    const q = input.value.trim();
    hint.textContent = !q
      ? 'Type to search. ↑↓ to move, Enter to open, Esc to close.'
      : results.length === 0
        ? 'No matches.'
        : '';
  }

  function search() {
    results = quickFind(ctx.store.state, input.value);
    active = 0;
    paint();
    // A new query highlights its first result; start the list at the top.
    list.scrollTop = 0;
  }

  input.addEventListener('input', search);

  function onKeydown(e) {
    if (!overlay.isConnected) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (results.length === 0) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      paint();
      // The list scrolls (max-height in CSS); keep the keyboard-driven
      // highlight visible. Mouse hover skips this — the pointer already is.
      list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (results[active]) go(results[active]);
    } else if (e.key === 'Tab') {
      // The palette is a single-field dialog; there is nowhere to tab to.
      e.preventDefault();
    }
  }

  const overlay = el(
    'div',
    {
      class: 'modal-overlay palette-overlay',
      onMousedown: (e) => {
        if (e.target !== overlay) return;
        // Same rule as the result rows below: without this, the browser's
        // default focus-on-mousedown runs after close() and blanks the
        // focus it just restored to the search button.
        e.preventDefault();
        close();
      },
    },
    el(
      'div',
      { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Quick find' },
      el('div', { class: 'palette-input-row' }, icon('search', 16), input),
      list,
      hint
    )
  );

  document.addEventListener('keydown', onKeydown, true);
  document.body.appendChild(overlay);
  input.focus();
  paint();
}
