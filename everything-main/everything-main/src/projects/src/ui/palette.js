import { el, clear } from '../lib/dom.js';
import { icon } from './icons.js';
import { store } from '../lib/store.js';
import { debounce } from '../lib/util.js';
import { searchTasks } from '../lib/tasksearch.js';
import { parseRoute, projectHash } from '../lib/routes.js';
import { orderedProjects } from '../lib/projects.js';
import { scopeViews, applySavedView, announceView } from './savedviews.js';
import { undoProject, redoProject, undoLabelFor, redoLabelFor } from './history.js';
import { doneColumnIds } from '../lib/board.js';
import { applyTheme } from './theme.js';
import { openModal } from './modal.js';
import { openTaskSheet } from './tasksheet.js';
import { openTaskSearch } from './search.js';
import { openQuickAdd } from './quickadd.js';
import { openProjectForm } from './projectform.js';
import { openMembersLabels } from './memberslabels.js';
import { exportBackup } from './backupactions.js';
import { openShortcuts, MOD_KEY } from './shortcuts.js';
import { dueBadge, priorityBadge } from './bits.js';

/**
 * Command palette: one input over the four things that would otherwise be
 * four separate affordances — jump to a project, switch view, run an action,
 * find a task. Task results come from the same matcher the search dialog
 * uses, so "found" means the same thing in both.
 */

const MAX_TASKS = 8;
const MAX_ROWS = 40;

const GROUPS = ['Actions', 'Go to', 'Projects', 'Tasks'];

const THEMES = ['light', 'dark', 'system'];

export function openCommandPalette() {
  const route = parseRoute(location.hash);
  const projectId = route.name === 'project' ? route.id : null;

  let docs = [];
  let loading = true;
  let rows = [];
  let active = 0;

  const input = el('input.input.palette-input', {
    type: 'text',
    placeholder: 'Search projects, views, actions, and tasks…',
    'aria-label': 'Command palette',
    autocomplete: 'off',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'palette-list',
    'aria-autocomplete': 'list',
    oninput: debounce(() => render(), 80),
    onkeydown: onKey,
  });

  const list = el('div.palette-list', { id: 'palette-list', role: 'listbox', 'aria-label': 'Results' });
  const hint = el('p.form-hint.palette-hint');

  const content = el('div.palette', {},
    el('div.filter-search.palette-field', {},
      el('span.filter-search-ic', { html: icon('search', 16, 2), 'aria-hidden': 'true' }),
      input
    ),
    list,
    hint
  );

  // ---- the things the palette can do ---------------------------------------

  function actions() {
    const items = [
      {
        label: 'Quick add a task', icon: 'circlePlus', keywords: 'new task create',
        run: () => openQuickAdd({ projectId }),
      },
      {
        label: 'New project', icon: 'plus', keywords: 'create',
        run: () => openProjectForm({}),
      },
      {
        label: 'Find a task', icon: 'search', keywords: 'search',
        run: () => openTaskSearch(),
      },
    ];
    if (projectId) {
      items.push({
        label: 'Members and labels', icon: 'users', keywords: 'assignee label',
        run: () => openMembersLabels(projectId),
      });
      /* Undo is a keyboard binding people have to be told about; naming what
         it will undo is what makes it safe to press. */
      const undoable = undoLabelFor(projectId);
      const redoable = redoLabelFor(projectId);
      items.push({
        label: undoable ? `Undo ${undoable}` : 'Undo — nothing to undo yet',
        icon: 'undo',
        keywords: 'undo revert back mistake',
        sub: undoable ? `${MOD_KEY}Z` : null,
        run: () => undoProject(projectId),
      });
      if (redoable) {
        items.push({
          label: `Redo ${redoable}`,
          icon: 'repeat',
          keywords: 'redo again',
          sub: `Shift ${MOD_KEY}Z`,
          run: () => redoProject(projectId),
        });
      }
    }
    const theme = store.settings.theme || 'system';
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    items.push(
      {
        label: `Switch theme to ${next}`,
        icon: next === 'dark' ? 'moon' : next === 'light' ? 'sun' : 'monitor',
        keywords: 'dark light appearance',
        run: () => {
          applyTheme(next);
          store.updateSettings({ theme: next }).catch(() => {});
        },
      },
      {
        label: 'Export everything', icon: 'download', keywords: 'backup zip save',
        run: () => exportBackup(null, { withAttachments: true }),
      },
      {
        label: 'Calendar file', icon: 'calendarClock', keywords: 'ics export due dates',
        run: () => import('./calendarexport.js').then((m) => m.openCalendarExport({ projectId })),
      },
      { label: 'Settings', icon: 'gear', keywords: 'preferences', run: () => { location.hash = '#/settings'; } },
      { label: 'Keyboard shortcuts', icon: 'help', keywords: 'keys help', run: () => openShortcuts() },
    );
    return items.map((a) => ({ ...a, group: 'Actions' }));
  }

  function views() {
    if (!projectId) {
      return [
        { group: 'Go to', label: 'All projects', icon: 'grid', run: () => { location.hash = '#/'; } },
        { group: 'Go to', label: 'Today', icon: 'calendarClock', run: () => { location.hash = '#/today'; } },
        { group: 'Go to', label: 'All tasks', icon: 'listTodo', run: () => { location.hash = '#/all'; } },
      ];
    }
    const tabs = [
      { tab: 'board', label: 'Board', icon: 'board' },
      { tab: 'list', label: 'List', icon: 'listTodo' },
      { tab: 'timeline', label: 'Timeline', icon: 'timeline' },
      { tab: 'milestones', label: 'Milestones', icon: 'flag' },
    ];
    return [
      ...tabs.map((t) => ({
        group: 'Go to',
        label: t.label,
        icon: t.icon,
        sub: t.tab === route.tab ? 'Current view' : null,
        run: () => { location.hash = projectHash(projectId, t.tab); },
      })),
      { group: 'Go to', label: 'All projects', icon: 'grid', run: () => { location.hash = '#/'; } },
      { group: 'Go to', label: 'Today', icon: 'calendarClock', run: () => { location.hash = '#/today'; } },
      { group: 'Go to', label: 'All tasks', icon: 'listTodo', run: () => { location.hash = '#/all'; } },
    ];
  }

  /**
   * Saved views under "Go to", for the scope the palette was opened in: the
   * shortcut-free way to reach the question you ask every morning. Applying
   * writes the same session state the chips do, so the view is already on when
   * the board renders.
   */
  function savedViews() {
    const scope = projectId ?? (route.name === 'all' ? 'all' : null);
    if (!scope) return [];
    return scopeViews(scope).map((view) => ({
      group: 'Go to',
      label: view.name,
      icon: view.builtIn ? 'sparkle' : 'search',
      sub: 'View',
      keywords: 'view filter saved',
      run: () => {
        const doc = scope === 'all' ? null : store.getDoc(scope);
        applySavedView(scope, view, doc
          ? { labelIds: doc.labels.map((l) => l.id), assigneeIds: doc.members.map((m) => m.id) }
          : null);
        // The view is already on screen, so it is told rather than rebuilt:
        // navigating to the route it is already on would do nothing at all.
        announceView(scope);
      },
    }));
  }

  function projects() {
    // The same arrangement the sidebar and the home grid show.
    return orderedProjects(store.projects).map((p) => ({
      group: 'Projects',
      label: p.name,
      dot: p.color,
      sub: p.archived ? 'Archived' : p.pinned ? 'Pinned' : null,
      run: () => { location.hash = projectHash(p.id); },
    }));
  }

  function tasks(query) {
    if (query.length < 2) return [];
    // Titles only: the palette is a jump-to, not a research tool. The search
    // dialog is where descriptions and comments are searched.
    return searchTasks(docs, query, { scope: 'titles' })
      .slice(0, MAX_TASKS).map(({ entry, doc, task }) => ({
      group: 'Tasks',
      label: task.title || 'Untitled task',
      sub: entry.name,
      dot: entry.color,
      badges: [priorityBadge(task.priority), dueBadge(task, doneColumnIds(doc).has(task.columnId))],
      run: () => openTaskSheet(entry.id, task.id),
    }));
  }

  const norm = (s) => String(s ?? '').toLowerCase();

  function build(query) {
    const q = norm(query).trim();
    const commands = [...actions(), ...views(), ...savedViews(), ...projects()];
    const matched = !q ? commands : commands
      .map((c) => {
        const hay = `${norm(c.label)} ${norm(c.sub)} ${norm(c.keywords)}`;
        const at = hay.indexOf(q);
        return at < 0 ? null : { ...c, score: norm(c.label).startsWith(q) ? 0 : at === 0 ? 1 : 2 };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score);
    return [...matched, ...tasks(q)].slice(0, MAX_ROWS);
  }

  // ---- rendering -----------------------------------------------------------

  function rowEl(item, index) {
    return el('div.palette-row', {
      id: `palette-row-${index}`,
      role: 'option',
      'aria-selected': index === active ? 'true' : 'false',
      className: `palette-row${index === active ? ' active' : ''}`,
      onclick: () => run(index),
      // Hovering marks the row, but must not move the list: scrolling a
      // half-visible row into view slides everything under a pointer that
      // never asked for it.
      onpointermove: () => {
        if (active === index) return;
        active = index;
        syncActive({ scroll: false });
      },
    },
      item.dot
        ? el('span.dot', { style: { background: item.dot }, 'aria-hidden': 'true' })
        : el('span.palette-ic', { html: icon(item.icon || 'circleDashed', 16, 2), 'aria-hidden': 'true' }),
      el('span.palette-label', {}, item.label),
      item.sub && el('span.palette-sub', {}, item.sub),
      item.badges && el('span.palette-badges', {}, item.badges.filter(Boolean))
    );
  }

  function syncActive({ scroll = true } = {}) {
    const nodes = [...list.querySelectorAll('.palette-row')];
    nodes.forEach((node, i) => {
      node.classList.toggle('active', i === active);
      node.setAttribute('aria-selected', i === active ? 'true' : 'false');
    });
    const current = nodes[active];
    input.setAttribute('aria-activedescendant', current?.id ?? '');
    if (scroll) current?.scrollIntoView({ block: 'nearest' });
  }

  function render() {
    rows = build(input.value);
    active = 0;
    clear(list);
    if (!rows.length) {
      hint.textContent = loading
        ? 'Loading your projects…'
        : `Nothing matches “${input.value.trim()}”.`;
      return;
    }
    hint.textContent = loading && input.value.trim().length >= 2
      ? 'Still loading tasks…'
      : 'Enter to run · ↑ ↓ to move';
    let group = null;
    rows.forEach((item, i) => {
      if (item.group !== group) {
        group = item.group;
        list.append(el('div.palette-group', { role: 'presentation' }, group));
      }
      list.append(rowEl(item, i));
    });
    syncActive();
  }

  function run(index) {
    const item = rows[index];
    if (!item) return;
    // Navigate (or open a dialog) before closing, so this dialog's history
    // entry is consumed rather than popped back over the destination.
    item.run();
    modal.close();
  }

  function onKey(e) {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      active = rows.length ? (active + 1) % rows.length : 0;
      syncActive();
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      active = rows.length ? (active - 1 + rows.length) % rows.length : 0;
      syncActive();
    } else if (e.key === 'Home') {
      e.preventDefault(); active = 0; syncActive();
    } else if (e.key === 'End') {
      e.preventDefault(); active = Math.max(0, rows.length - 1); syncActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(active);
    }
  }

  render();
  const modal = openModal({ title: 'Command palette', content, dismissOnBack: true });

  store.loadAllProjects().then((loaded) => {
    docs = loaded.docs;
    loading = false;
    if (input.isConnected) render();
  });

  setTimeout(() => input.focus(), 30);
  return modal;
}
