import { el, clear } from '../lib/dom.js';
import { icon } from './icons.js';
import { store } from '../lib/store.js';
import { emptyFilter, isFilterActive, DUE_FILTERS } from '../lib/filters.js';
import { LIST_SORTS, LIST_GROUPS } from '../lib/list.js';
import {
  chipsForScope, viewsForScope, sameViewFilter, pruneViewFilter, BUILT_IN_VIEWS,
} from '../lib/savedviews.js';
import { filterFor } from './filterbar.js';
import { viewStateFor, setViewState } from './viewstate.js';
import { openMenu } from './menu.js';
import { openModal, promptDialog, confirmDialog } from './modal.js';
import { initListReorder } from './reorder.js';
import { toast } from './toast.js';

/**
 * Saved views, as a row of chips above the filter bar.
 *
 * A view is a named filter plus the arrangement that went with it. Applying
 * one writes the same session state the filter bar and the list already keep,
 * so nothing downstream has to know this feature exists — which is also why a
 * view applies from the command palette before the view it belongs to is even
 * on screen.
 */

/* Which scopes have already had their remembered view restored this session.
   Clearing a filter by hand must not be undone by walking back into the
   project a minute later. */
const restored = new Set();

/** How an applied view reaches a view that is already mounted. */
const VIEW_APPLIED = 'pm:view-applied';

/** Everything a view holds, taken from the live session state. */
export function currentViewState(scope) {
  const filter = filterFor(scope);
  const { sort, group } = viewStateFor(scope);
  return { filter: { ...filter }, sort: { ...sort }, group };
}

/**
 * Apply a view to a scope. `available` is what the scope can still filter by,
 * so a view that names a deleted label loses that facet rather than quietly
 * returning nothing; the number dropped comes back for the caller to say.
 */
export function applySavedView(scope, view, available = null) {
  const { filter: pruned, dropped } = available
    ? pruneViewFilter(view.filter, available)
    : { filter: view.filter, dropped: 0 };
  Object.assign(filterFor(scope), emptyFilter(), {
    ...pruned,
    labelIds: [...(pruned.labelIds ?? [])],
    assigneeIds: [...(pruned.assigneeIds ?? [])],
    priorities: [...(pruned.priorities ?? [])],
    due: [...(pruned.due ?? [])],
  });
  setViewState(scope, view);
  restored.add(scope);
  store.rememberView(scope, view.id).catch((err) => console.error(err));
  return dropped;
}

/**
 * Tell whatever is on screen that a scope's view changed under it. The chips
 * and the host both re-render — which is what makes applying a view from the
 * command palette work while the board it belongs to is already open.
 */
export function announceView(scope) {
  window.dispatchEvent(new CustomEvent(VIEW_APPLIED, { detail: { scope } }));
}

/** Back to everything, and stop restoring this scope's last view. */
export function clearSavedView(scope) {
  Object.assign(filterFor(scope), emptyFilter());
  restored.add(scope);
  store.rememberView(scope, null).catch((err) => console.error(err));
}

/** Every view a scope offers, built-ins first. Used by the palette too. */
export function scopeViews(scope) {
  return chipsForScope(store.views, scope);
}

/**
 * savedViewsBar({ scope, available, onChange }) → node with .sync() and
 * .destroy()
 *
 * `available` returns { labelIds, assigneeIds } for the scope right now, so a
 * view can be pruned honestly; `onChange` is the host's re-render.
 */
export function savedViewsBar({ scope, available = () => null, onChange }) {
  const chips = el('div.views-chips');
  const note = el('span.views-note', { role: 'status', 'aria-live': 'polite' });

  const moreBtn = el('button.icon-btn.small.views-more', {
    type: 'button',
    html: icon('more', 16, 2),
    'aria-label': 'View options',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    onclick: () => openMenu(moreBtn, [
      {
        label: 'Save this view…',
        icon: 'plus',
        // A view of nothing is a view of everything, which needs no name.
        disabled: !isFilterActive(filterFor(scope)),
        onClick: saveCurrent,
      },
      {
        label: 'Manage views…',
        icon: 'gear',
        disabled: !viewsForScope(store.views, scope).length,
        onClick: () => openManageViews(scope, () => { render(); onChange?.(); }),
      },
    ]),
  });

  const root = el('div.views-bar', { role: 'group', 'aria-label': 'Saved views' },
    chips, note, el('span.grow'), moreBtn);

  async function saveCurrent() {
    const name = await promptDialog({
      title: 'Save this view',
      label: 'View name',
      placeholder: 'e.g. My week',
      confirmLabel: 'Save view',
    });
    if (!name) return;
    const { filter, sort, group } = currentViewState(scope);
    try {
      const view = await store.saveView({ name, scope, filter, sort, group });
      await store.rememberView(scope, view.id);
      render();
      toast(`Saved “${view.name}”`, { icon: 'check' });
    } catch (err) {
      console.error(err);
      toast('Could not save the view. Check your connection', { icon: 'cloudOff' });
    }
  }

  function apply(view) {
    const dropped = applySavedView(scope, view, available());
    render();
    onChange?.();
    note.textContent = dropped
      ? `${dropped} filter${dropped === 1 ? '' : 's'} no longer applies`
      : '';
  }

  function unapply() {
    clearSavedView(scope);
    note.textContent = '';
    render();
    onChange?.();
  }

  /**
   * Which chips are lit. The view that was actually applied wins, compared
   * against its own pruned filter — otherwise deleting the label a view
   * filtered by would light a *different* chip that happens to match what is
   * left. With nothing applied, any view whose filter matches lights up, so a
   * filter assembled by hand still finds its name.
   */
  function activeIds() {
    const current = filterFor(scope);
    const list = scopeViews(scope);
    const appliedId = store.lastViewFor(scope);
    const applied = list.find((v) => v.id === appliedId);
    if (applied) {
      const { filter: pruned } = pruneViewFilter(applied.filter, available() ?? {
        labelIds: applied.filter.labelIds, assigneeIds: applied.filter.assigneeIds,
      });
      if (sameViewFilter(pruned, current)) return new Set([applied.id]);
    }
    return new Set(list.filter((v) => sameViewFilter(v.filter, current)).map((v) => v.id));
  }

  function chipEl(view, lit) {
    const active = lit.has(view.id);
    const btn = el('button.view-chip', {
      type: 'button',
      className: `view-chip${active ? ' on' : ''}`,
      'aria-pressed': active ? 'true' : 'false',
      title: active ? `${view.name} — showing. Activate to clear` : `Show ${view.name}`,
      onclick: () => (active ? unapply() : apply(view)),
      // The same options the manage dialog holds, where the chip is.
      oncontextmenu: (e) => {
        if (view.builtIn) return;
        e.preventDefault();
        openMenu(btn, [
          { label: 'Rename…', icon: 'pencil', onClick: () => renameView(view, () => { render(); }) },
          {
            label: 'Delete view',
            icon: 'trash',
            danger: true,
            onClick: () => deleteView(view, () => { render(); }),
          },
        ]);
      },
    },
      view.builtIn && el('span.view-chip-ic', {
        html: icon('sparkle', 12, 2), 'aria-hidden': 'true',
      }),
      el('span', {}, view.name)
    );
    return btn;
  }

  function render() {
    clear(chips);
    const lit = activeIds();
    for (const view of scopeViews(scope)) chips.append(chipEl(view, lit));
  }

  /**
   * Restore the view this scope was last looked at through — once per session,
   * and never over a filter the user has already set by hand.
   */
  function restore() {
    if (restored.has(scope)) return false;
    restored.add(scope);
    const id = store.lastViewFor(scope);
    if (!id || isFilterActive(filterFor(scope))) return false;
    const view = scopeViews(scope).find((v) => v.id === id);
    if (!view) return false;
    const dropped = applySavedView(scope, view, available());
    note.textContent = dropped
      ? `${dropped} filter${dropped === 1 ? '' : 's'} in “${view.name}” no longer applies`
      : '';
    return true;
  }

  const onStoreChange = (e) => {
    if (e.detail?.scope === 'views' || e.detail?.scope === 'settings') render();
  };
  store.addEventListener('change', onStoreChange);

  /* Applied from somewhere else — the command palette, say. The bar redraws
     and the host re-renders through it. */
  const onApplied = (e) => {
    if (e.detail?.scope !== scope) return;
    render();
    onChange?.();
  };
  window.addEventListener(VIEW_APPLIED, onApplied);

  // Before the host's first render, so it draws through the restored view.
  restore();
  render();

  return Object.assign(root, {
    /** Called by the host after its own render, to relight the chips. */
    sync() {
      render();
      /* A filter edited by hand is no longer the view it started as, so the
         scope stops remembering one: restoring a named view over someone's own
         filter next session would be a surprise. At most one write, since the
         next call finds nothing to forget. */
      const id = store.lastViewFor(scope);
      if (id && !activeIds().has(id)) {
        store.rememberView(scope, null).catch((err) => console.error(err));
      }
    },
    destroy() {
      store.removeEventListener('change', onStoreChange);
      window.removeEventListener(VIEW_APPLIED, onApplied);
    },
  });
}

async function renameView(view, done) {
  const name = await promptDialog({
    title: 'Rename view',
    label: 'View name',
    value: view.name,
    confirmLabel: 'Save',
  });
  if (!name) return;
  try {
    await store.renameView(view.id, name);
    done?.();
  } catch (err) {
    console.error(err);
    toast('Could not rename. Check your connection', { icon: 'cloudOff' });
  }
}

async function deleteView(view, done) {
  const ok = await confirmDialog({
    title: `Delete “${view.name}”?`,
    message: 'The view is removed. Nothing about your tasks changes.',
    confirmLabel: 'Delete view',
  });
  if (!ok) return;
  try {
    await store.deleteView(view.id);
    done?.();
  } catch (err) {
    console.error(err);
    toast('Could not delete. Check your connection', { icon: 'cloudOff' });
  }
}

/**
 * Rename, delete, and reorder — in a list, because that is where dragging a
 * row means something. Built-ins are shown as what they are: always there,
 * and not yours to rename.
 */
export function openManageViews(scope, onDone) {
  const list = el('div.recover-list.views-manage');

  function render() {
    clear(list);
    const saved = viewsForScope(store.views, scope);
    if (!saved.length) {
      list.append(el('p.form-hint', {}, 'No saved views yet. '
        + 'Filter the board however you like, then save it from the view menu.'));
    }
    for (const view of saved) {
      list.append(el('div.recover-row.views-row', { dataset: { id: view.id } },
        el('button.checklist-grip.drag-handle', {
          type: 'button',
          html: icon('grip', 14, 2),
          'aria-label': `Reorder ${view.name}. Alt with up or down arrow moves it.`,
          title: 'Drag to reorder',
          onkeydown: (e) => {
            if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
            e.preventDefault();
            const at = viewsForScope(store.views, scope).findIndex((v) => v.id === view.id);
            const to = e.key === 'ArrowUp' ? at - 1 : at + 1;
            if (to < 0 || to >= saved.length) return;
            move(view.id, to);
          },
        }),
        el('span.recover-main', {},
          el('div.recover-title', {}, view.name),
          el('div.recover-sub', {}, describeView(view))
        ),
        el('button.icon-btn.small', {
          type: 'button',
          html: icon('pencil', 14, 2),
          'aria-label': `Rename ${view.name}`,
          onclick: () => renameView(view, () => { render(); onDone?.(); }),
        }),
        el('button.icon-btn.small', {
          type: 'button',
          html: icon('trash', 14, 2),
          'aria-label': `Delete ${view.name}`,
          onclick: () => deleteView(view, () => { render(); onDone?.(); }),
        })
      ));
    }
  }

  function move(id, toIndex) {
    store.moveView(scope, id, toIndex).then((moved) => {
      if (!moved) return;
      render();
      onDone?.();
      list.querySelector(`[data-id="${CSS.escape(id)}"] .drag-handle`)?.focus();
    }).catch((err) => {
      console.error(err);
      toast('Could not save the order. Check your connection', { icon: 'cloudOff' });
    });
  }

  render();

  const reorder = initListReorder(list, {
    itemSelector: '.views-row',
    handleSelector: '.drag-handle',
    onReorder: (id, toIndex) => move(id, toIndex),
  });

  const doneBtn = el('button.btn.btn-primary', {});
  const modal = openModal({
    title: 'Saved views',
    dismissOnBack: true,
    onClose: () => reorder.destroy(),
    content: el('div', {},
      list,
      el('p.form-hint', {}, `Overdue, High priority, and Unscheduled are always `
        + 'available and cannot be changed.'),
      el('div.row.row-end', {}, doneBtn)
    ),
  });
  doneBtn.textContent = 'Done';
  doneBtn.addEventListener('click', () => modal.close());
  return modal;
}

const labelFor = (list, key, fallback) =>
  list.find((item) => (item.key ?? item.value) === key)?.label ?? fallback;

/** A one-line account of what a view shows, in the words the menus use. */
export function describeView(view) {
  const parts = [];
  const f = view.filter ?? {};
  if (f.text?.trim()) parts.push(`“${f.text.trim()}”`);
  if (f.labelIds?.length) parts.push(`${f.labelIds.length} label${f.labelIds.length === 1 ? '' : 's'}`);
  if (f.assigneeIds?.length) parts.push(`${f.assigneeIds.length} assignee${f.assigneeIds.length === 1 ? '' : 's'}`);
  if (f.priorities?.length) parts.push(`${f.priorities.length} priorit${f.priorities.length === 1 ? 'y' : 'ies'}`);
  if (f.due?.length) parts.push(f.due.map((d) => labelFor(DUE_FILTERS, d, d)).join(', '));
  if (!parts.length) parts.push('everything');
  const sort = view.sort?.key && view.sort.key !== 'board'
    ? `sorted by ${labelFor(LIST_SORTS, view.sort.key, view.sort.key).toLowerCase()}`
      + (view.sort.dir === 'desc' ? ', descending' : '')
    : null;
  const group = view.group && view.group !== 'column'
    ? `grouped by ${labelFor(LIST_GROUPS, view.group, view.group).toLowerCase()}`
    : null;
  return [parts.join(' · '), sort, group].filter(Boolean).join(' · ');
}

/** Built-in views, for anything that wants to list them without the store. */
export { BUILT_IN_VIEWS };
