import { el, clear } from '../lib/dom.js';
import { icon } from './icons.js';
import { store } from '../lib/store.js';
import { openModal } from './modal.js';
import { openTaskSheet } from './tasksheet.js';
import { doneColumnIds } from '../lib/board.js';
import { searchTasks, matchSnippet, MATCH_LABELS } from '../lib/tasksearch.js';
import { debounce } from '../lib/util.js';
import { dueBadge, priorityBadge, radioGroupKeys } from './bits.js';

// Enough to scan, few enough to stay a list rather than a second board.
const MAX_RESULTS = 40;

/* Scope survives the dialog closing: someone who narrowed to titles is
   usually about to search again the same way. */
let scope = 'all';

const SCOPES = [
  { value: 'all', label: 'Everything' },
  { value: 'titles', label: 'Titles only' },
];

/**
 * Cross-project task search over every project document — titles, and by
 * default the content too: descriptions, checklist items, comments, and
 * attachment names. It jumps straight to the task sheet in the right project
 * (a plain route change now that tasks are linkable).
 *
 * Documents are loaded on open — one read per project, cached by the store —
 * so no index or search engine is involved at this scale.
 */
export function openTaskSearch() {
  const input = el('input.input.search-input', {
    type: 'search',
    placeholder: 'Search tasks, descriptions, comments',
    'aria-label': 'Search tasks in every project',
    autocomplete: 'off',
    oninput: debounce(() => render(), 100),
    onkeydown: (e) => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        rows()[0]?.focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        rows()[0]?.click();
      }
    },
  });

  // The rows are buttons, so the container is a plain group: a role="list"
  // here would only be honoured by giving every row role="listitem", and that
  // overwrites the button role a screen reader needs to announce.
  const list = el('div.search-results', { role: 'group', 'aria-label': 'Results' });
  // How many matched is the answer to what was just typed, so it is said out
  // loud rather than only drawn.
  const hint = el('p.form-hint.search-hint', { role: 'status', 'aria-live': 'polite' });

  /* Everything by default, because that is what people mean by search — with
     a way back to titles only for when a title is precisely the question. */
  const scopeGroup = el('div.seg.search-scope', { role: 'radiogroup', 'aria-label': 'Search in' });
  function renderScope() {
    scopeGroup.replaceChildren(...SCOPES.map((o) => el('button.seg-btn', {
      type: 'button',
      role: 'radio',
      'aria-checked': o.value === scope ? 'true' : 'false',
      tabindex: o.value === scope ? 0 : -1,
      className: `seg-btn${o.value === scope ? ' active' : ''}`,
      onclick: () => {
        if (scope === o.value) return;
        scope = o.value;
        renderScope();
        render();
      },
    }, el('span', {}, o.label))));
  }
  renderScope();
  radioGroupKeys(scopeGroup, '.seg-btn');

  const content = el('div.search-body', {},
    el('div.filter-search.search-field', {},
      el('span.filter-search-ic', { html: icon('search', 16, 2), 'aria-hidden': 'true' }),
      input
    ),
    el('div.row.search-tools', {}, scopeGroup, el('span.grow'), hint),
    list
  );

  const rows = () => [...list.querySelectorAll('.search-row')];

  let docs = [];       // [{ entry, doc }]
  let failed = 0;
  let loading = true;

  function onRowKey(e) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const all = rows();
    const i = all.indexOf(document.activeElement);
    if (e.key === 'Home') all[0]?.focus();
    else if (e.key === 'End') all[all.length - 1]?.focus();
    else if (e.key === 'ArrowDown') (all[i + 1] || all[0])?.focus();
    else if (i <= 0) input.focus();
    else all[i - 1].focus();
  }

  /** Text with one run marked, built from text nodes (never HTML). */
  function marked(spec, text, at, length) {
    if (at < 0) return el(spec, {}, text);
    return el(spec, {},
      text.slice(0, at),
      el('mark', {}, text.slice(at, at + length)),
      text.slice(at + length)
    );
  }

  function titleNode(title, query) {
    return marked('span.search-title', title, title.toLowerCase().indexOf(query), query.length);
  }

  /**
   * Why this row is here, when the title does not say it: where the match was,
   * and the line it sits in with the query marked. A result showing a title
   * that plainly does not contain what was typed is a result that looks wrong.
   */
  function snippetNode(match, query) {
    const label = MATCH_LABELS[match.field];
    if (!label) return null;
    const snip = matchSnippet(match.text, match.at, query.length);
    return el('span.search-snippet', {},
      el('span.search-where', {}, label),
      marked('span.search-excerpt', `${snip.cutStart ? '…' : ''}${snip.text}${snip.cutEnd ? '…' : ''}`,
        snip.at + (snip.cutStart ? 1 : 0), snip.length)
    );
  }

  function render() {
    const query = input.value.trim().toLowerCase();
    clear(list);

    if (loading) {
      hint.textContent = 'Loading your projects…';
      list.append(el('div.view-loading', { role: 'status' }, el('span.spinner')));
      return;
    }
    if (!docs.length) {
      hint.textContent = 'No projects to search yet.';
      return;
    }
    if (!query) {
      const tasks = docs.reduce((n, d) => n + d.doc.tasks.length, 0);
      hint.textContent = `Type to search ${tasks} task${tasks === 1 ? '' : 's'} across `
        + `${docs.length} project${docs.length === 1 ? '' : 's'}`
        + (scope === 'titles' ? ', by title.' : ', including descriptions and comments.');
      return;
    }

    const found = searchTasks(docs, query, { scope });

    if (!found.length) {
      hint.textContent = scope === 'titles'
        ? `No task title matches “${input.value.trim()}”.`
        : `Nothing matches “${input.value.trim()}”.`;
      return;
    }
    hint.textContent = found.length > MAX_RESULTS
      ? `${found.length} matches. Showing the first ${MAX_RESULTS}.`
      : `${found.length} match${found.length === 1 ? '' : 'es'}.`;

    for (const { entry, doc, task, match } of found.slice(0, MAX_RESULTS)) {
      const column = doc.columns.find((c) => c.id === task.columnId);
      const isDone = doneColumnIds(doc).has(task.columnId);
      list.append(el('button.search-row', {
        type: 'button',
        onkeydown: onRowKey,
        onclick: () => {
          // Navigate first, then close: the dialog's history entry is
          // consumed by the task route (see modal.js dismissOnBack).
          openTaskSheet(entry.id, task.id);
          modal.close();
        },
      },
        el('span.search-main', {},
          titleNode(String(task.title || 'Untitled'), query),
          snippetNode(match, query),
          el('span.search-meta', {},
            el('span.dot', { style: { background: entry.color }, 'aria-hidden': 'true' }),
            el('span.search-project', {}, entry.name),
            column && el('span.search-column', {}, column.name),
            entry.archived && el('span.nav-tag.muted', {}, 'archived')
          )
        ),
        el('span.search-badges', {},
          priorityBadge(task.priority),
          dueBadge(task, isDone)
        )
      ));
    }
  }

  render();
  const modal = openModal({ title: 'Find a task', content, dismissOnBack: true });

  // One read per project (cached), so opening a second time is instant.
  store.loadAllProjects().then((loaded) => {
    docs = loaded.docs;
    failed = loaded.failed;
    loading = false;
    render();
    if (failed) {
      hint.textContent += ` ${failed} project${failed === 1 ? '' : 's'} could not be loaded.`;
    }
  });

  setTimeout(() => input.focus(), 30);
  return modal;
}
