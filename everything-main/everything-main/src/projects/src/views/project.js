import { el, clear } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { store, docTrash, docArchive, TRASH_DAYS } from '../lib/store.js';
import { toast } from '../ui/toast.js';
import { openMenu } from '../ui/menu.js';
import { confirmDialog, promptDialog } from '../ui/modal.js';
import { openProjectForm } from '../ui/projectform.js';
import { openDuplicateProject } from '../ui/duplicateproject.js';
import { openExportProject } from '../ui/exportproject.js';
import { openCalendarExport } from '../ui/calendarexport.js';
import { openMembersLabels } from '../ui/memberslabels.js';
import { openTaskTrash } from '../ui/trash.js';
import { openTaskArchive } from '../ui/archive.js';
import { openRestorePoints } from '../ui/restorepoints.js';
import { menuButton } from '../ui/navdrawer.js';
import { offlineNotice } from '../ui/offlinebar.js';
import { boardView } from './board.js';
import { timelineView } from './timeline.js';
import { milestonesView } from './milestones.js';
import { listView } from './list.js';

const TABS = [
  { key: 'board', label: 'Board', icon: 'board', hash: (id) => `#/p/${id}` },
  { key: 'list', label: 'List', icon: 'listTodo', hash: (id) => `#/p/${id}/list` },
  { key: 'timeline', label: 'Timeline', icon: 'timeline', hash: (id) => `#/p/${id}/timeline` },
  { key: 'milestones', label: 'Milestones', icon: 'flag', hash: (id) => `#/p/${id}/milestones` },
];

export function projectView({ id, tab, navigate }) {
  const entry = store.projectEntry(id);
  const body = el('div.project-body', {},
    el('div.view-loading', { role: 'status', 'aria-label': 'Loading project' },
      el('span.spinner'))
  );

  /* Save indicator: quiet when clean, "Saving" pulse while a write is
     pending, "Not saved" once a write has failed (the retry toast handles
     recovery). aria-live keeps screen readers informed without spam.

     Every question it asks is about *this* project. The store is dirty
     whenever any project is, and plenty of them are written without anyone
     looking: the reminder pass stamps what it raised, opening a project
     catches up its recurring work and sweeps its trash, and a bulk edit from
     All tasks spans boards. Reading the global flag here made this header
     announce another project's write, and another project's failure. */
  const saveDot = el('span.save-state', { role: 'status', 'aria-live': 'polite' });
  let saveFailed = false;
  function renderSaveState() {
    const pending = store.hasPendingSave(id);
    const stale = store.hasConflict(id);
    const offline = !stale && store.offline;
    const failed = !stale && !offline && saveFailed && pending;
    saveDot.textContent = stale ? 'Changed elsewhere'
      : offline ? 'Offline'
      : failed ? 'Not saved'
      : pending ? 'Saving' : '';
    saveDot.classList.toggle('busy', pending && !failed && !stale && !offline);
    saveDot.classList.toggle('failed', failed);
    saveDot.classList.toggle('stale', stale || offline);
    saveDot.title = stale
      ? 'This project was saved somewhere else; choose which copy to keep'
      : offline
        ? 'No connection. Changes are saved on this device and go out when there is one'
        : '';
  }

  const menuBtn = el('button.icon-btn', {
    html: icon('more', 20, 2),
    'aria-label': 'Project options',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    onclick: () => {
      const doc = store.getDoc(id);
      const trashed = docTrash(doc).length;
      const archived = docArchive(doc).length;
      const entry = store.projectEntry(id);
      openMenu(menuBtn, [
        { label: 'Edit project', icon: 'pencil', onClick: () => openProjectForm({ project: entry }) },
        {
          label: entry?.pinned ? 'Unpin project' : 'Pin project',
          icon: entry?.pinned ? 'unpin' : 'pin',
          onClick: () => togglePinned(!entry?.pinned),
        },
        { label: 'Members and labels', icon: 'users', onClick: () => openMembersLabels(id) },
        {
          label: archived ? `Archived tasks (${archived})` : 'Archived tasks',
          icon: 'archive',
          disabled: !doc,
          onClick: () => openTaskArchive(id),
        },
        {
          label: trashed ? `Trash (${trashed})` : 'Trash',
          icon: 'trashBin',
          disabled: !doc,
          onClick: () => openTaskTrash(id),
        },
        'sep',
        {
          label: 'Duplicate project',
          icon: 'copy',
          onClick: () => openDuplicateProject(id),
        },
        {
          label: 'Save as template',
          icon: 'template',
          onClick: saveAsTemplate,
        },
        {
          label: 'Restore points',
          icon: 'history',
          onClick: () => openRestorePoints({ projectId: id }),
        },
        {
          label: 'Export project…',
          icon: 'download',
          onClick: () => openExportProject(id),
        },
        {
          label: 'Calendar file (.ics)…',
          icon: 'calendarClock',
          onClick: () => openCalendarExport({ projectId: id }),
        },
        {
          label: 'Print this view…',
          icon: 'fileText',
          // The browser's own dialog is already a PDF writer; the app's job is
          // to hand it a page worth printing (see styles/print.css).
          onClick: () => window.print(),
        },
        'sep',
        {
          label: entry?.archived ? 'Unarchive project' : 'Archive project',
          icon: entry?.archived ? 'unarchive' : 'archive',
          onClick: () => toggleArchived(!entry?.archived),
        },
        { label: 'Delete project', icon: 'trash', danger: true, onClick: deleteProject },
      ]);
    },
  });

  const title = el('h1.view-title.project-title', {}, entry?.name || '');

  const tabsNav = el('nav.tabs', { 'aria-label': 'Project views' },
    TABS.map((t) => el('a.tab', {
      href: t.hash(id),
      className: `tab${t.key === tab ? ' active' : ''}`,
      'aria-current': t.key === tab ? 'page' : null,
      html: icon(t.icon, 16, 2),
    }, el('span', {}, t.label)))
  );

  /* Offline is a state to name, not to hide: the view says which copy it is
     showing, and how much is still only on this device. Shared with the
     cross-project list, so both say it the same way. */
  const offlineBar = offlineNotice();

  /* Paper has no sidebar to say which project this is, and no tab strip to
     say when it was printed. */
  const printHead = el('div.print-head');
  function renderPrintHead() {
    const current = store.projectEntry(id);
    printHead.textContent = `${current?.name ?? ''} · ${TABS.find((t) => t.key === tab)?.label ?? ''}`
      + ` · printed ${new Date().toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
      })}`;
  }
  renderPrintHead();

  const root = el('section.view.project-view', {},
    printHead,
    el('header.view-head.project-head', {},
      menuButton(),
      el('a.icon-btn.back-btn', { href: '#/', 'aria-label': 'All projects', html: icon('arrowL', 20, 2) }),
      el('span.dot', { style: { background: entry?.color }, 'aria-hidden': 'true' }),
      title,
      saveDot,
      el('span.grow'),
      menuBtn
    ),
    tabsNav,
    offlineBar,
    body
  );
  // The save chip has to speak for the state the view is *mounted* in, not
  // only for the next event: switching tab while offline (or while a conflict
  // is unresolved) rebuilds this header, and a blank chip beside a visible
  // offline bar reads as "everything is fine". (The bar renders itself.)
  renderSaveState();

  async function saveAsTemplate() {
    const suggested = store.projectEntry(id)?.name || 'Template';
    const name = await promptDialog({
      title: 'Save as template',
      label: 'Template name',
      value: suggested,
      confirmLabel: 'Save template',
    });
    if (!name) return;
    try {
      await store.saveTemplate(id, name);
      toast('Template saved. Pick it when creating a project', { icon: 'template' });
    } catch (err) {
      console.error(err);
      toast('Could not save the template. Check your connection', { icon: 'cloudOff' });
    }
  }

  async function togglePinned(pinned) {
    try {
      await store.setProjectPinned(id, pinned);
      toast(pinned ? 'Project pinned to the top' : 'Project unpinned', {
        icon: pinned ? 'pin' : 'unpin',
      });
    } catch (err) {
      console.error(err);
      toast('Could not save. Check your connection', { icon: 'cloudOff' });
    }
  }

  async function toggleArchived(archived) {
    try {
      await store.setProjectArchived(id, archived);
      if (archived) {
        // Leave the board: an archived project is out of the way by design.
        navigate('#/');
        toast('Project archived', {
          icon: 'archive',
          duration: 7000,
          action: {
            label: 'Undo',
            onClick: () => store.setProjectArchived(id, false).catch(() => {}),
          },
        });
      } else {
        toast('Project unarchived', { icon: 'unarchive' });
      }
    } catch (err) {
      console.error(err);
      toast('Could not save. Check your connection', { icon: 'cloudOff' });
    }
  }

  async function deleteProject() {
    const current = store.projectEntry(id);
    const ok = await confirmDialog({
      title: `Delete "${current?.name}"?`,
      message: `The project moves to the trash, where it can be restored for ${TRASH_DAYS} days.`,
      confirmLabel: 'Delete project',
    });
    if (!ok) return;
    try {
      await store.deleteProject(id);
      navigate('#/');
      toast('Project moved to trash', {
        icon: 'trash',
        duration: 7000,
        action: {
          label: 'Undo',
          onClick: () => store.restoreProject(id).catch((err) => {
            console.error(err);
            toast('Could not restore. Check your connection', { icon: 'cloudOff' });
          }),
        },
      });
    } catch (err) {
      console.error(err);
      toast('Could not delete. Check your connection', { icon: 'cloudOff' });
    }
  }

  let inner = null;
  /* Switching tab destroys this view and builds the next one, which can
     easily happen while the document is still being read. Building the inner
     view anyway would attach a board nobody can see: its store listener, its
     window-level drag listeners and its `n` shortcut would all outlive it —
     and the shortcut, registered last, would win over the live view's. */
  let destroyed = false;
  store.loadProject(id).then(() => {
    if (destroyed) return;
    clear(body);
    inner =
      tab === 'timeline' ? timelineView({ projectId: id, navigate })
      : tab === 'milestones' ? milestonesView({ projectId: id, navigate })
      : tab === 'list' ? listView({ projectId: id, navigate })
      : boardView({ projectId: id, navigate });
    body.append(inner);
  }).catch((err) => {
    if (destroyed) return;
    console.error(err);
    clear(body);
    body.append(el('div.empty', {},
      el('div.empty-icon', { html: icon('cloudOff', 28) }),
      el('h3', {}, 'Could not load this project'),
      el('p', {}, 'Check your connection and try again.'),
      el('button.btn.btn-primary', { onclick: () => location.reload() }, 'Reload')
    ));
  });

  const onChange = (e) => {
    if (e.detail?.scope === 'projects') {
      const p = store.projectEntry(id);
      if (p) {
        title.textContent = p.name;
        root.querySelector('.project-head .dot').style.background = p.color;
        renderPrintHead();
      }
    }
  };
  /* Only this project's write events move the chip; another project's are
     none of this header's business. */
  const mine = (e) => e.detail?.projectId === id;
  const onSaving = (e) => { if (mine(e)) { saveFailed = false; renderSaveState(); } };
  const onSaved = (e) => { if (mine(e)) { saveFailed = false; renderSaveState(); } };
  const onSaveError = (e) => { if (mine(e)) { saveFailed = true; renderSaveState(); } };
  const onConflict = (e) => { if (mine(e)) renderSaveState(); };
  const onConnection = () => renderSaveState();
  store.addEventListener('change', onChange);
  store.addEventListener('saving', onSaving);
  store.addEventListener('saved', onSaved);
  store.addEventListener('save-error', onSaveError);
  store.addEventListener('conflict', onConflict);
  store.addEventListener('connection', onConnection);
  store.addEventListener('outbox', onConnection);

  root.destroy = () => {
    destroyed = true;
    inner?.destroy?.();
    offlineBar.destroy();
    store.removeEventListener('change', onChange);
    store.removeEventListener('saving', onSaving);
    store.removeEventListener('saved', onSaved);
    store.removeEventListener('save-error', onSaveError);
    store.removeEventListener('conflict', onConflict);
    store.removeEventListener('connection', onConnection);
    store.removeEventListener('outbox', onConnection);
  };
  return root;
}
