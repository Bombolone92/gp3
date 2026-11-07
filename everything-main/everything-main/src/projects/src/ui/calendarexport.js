import { el } from '../lib/dom.js';
import { fieldId, formatBytes } from '../lib/util.js';
import { icon } from './icons.js';
import { store } from '../lib/store.js';
import { toast } from './toast.js';
import { openModal } from './modal.js';
import { radioGroupKeys } from './bits.js';
import { downloadBlob } from './backupactions.js';
import { canSaveFiles, saveToPuter } from '../lib/puterui.js';
import { calendarEvents, buildCalendar, countEvents } from '../lib/ics.js';
import { todayISO } from '../lib/dates.js';

/**
 * Write a calendar file for dated work, for the calendar the user already
 * carries — the honest answer to reminders that only fire while a tab is open.
 *
 * It is a snapshot, not a subscription, and the dialog says so: a
 * subscribable URL needs hosting, and an unguessable URL is not a permission.
 */

/* The day the file was made, in the user's own timezone: toISOString() is UTC,
   which names a backup taken on Friday evening in the Americas after Saturday.
   Every other date in the app is local (see lib/dates.js). */
const stamp = () => todayISO();

const safeSlug = (name) => String(name || 'projects')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'projects';

/** The app's own address, so an event can lead back to the task it came from. */
function appBaseUrl() {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}`;
}

export function openCalendarExport({ projectId = null } = {}) {
  let scope = projectId ? 'project' : 'all';
  let includeTasks = true;
  let includeMilestones = true;

  const entry = projectId ? store.projectEntry(projectId) : null;
  const scopes = [
    projectId && { value: 'project', label: entry?.name ?? 'This project', sub: 'Its dated tasks and milestones' },
    { value: 'all', label: 'Every project', sub: 'Everything Today draws on, archived projects aside' },
  ].filter(Boolean);

  const scopeGroup = el('div.template-list', { role: 'radiogroup', 'aria-label': 'What to export' });
  function renderScopes() {
    scopeGroup.replaceChildren(...scopes.map((s) => {
      const selected = s.value === scope;
      return el('div.template-row', { className: `template-row${selected ? ' selected' : ''}` },
        el('button.template-pick', {
          type: 'button',
          role: 'radio',
          'aria-checked': selected ? 'true' : 'false',
          tabindex: selected ? 0 : -1,
          onclick: () => {
          scope = s.value;
          renderScopes();
          syncCount();
          // Widening the scope brings in projects nobody has read yet.
          loadMissing();
        },
        },
          el('span.template-name', {}, s.label),
          el('span.template-sub', {}, s.sub)
        )
      );
    }));
  }
  renderScopes();
  radioGroupKeys(scopeGroup, '.template-pick');

  const check = (label, checked, onchange) => {
    const id = fieldId('ics');
    const box = el('input', { id, type: 'checkbox', checked, onchange: () => onchange(box.checked) });
    return el('label.row.export-check', { htmlFor: id }, box, el('span', {}, label));
  };

  const countNote = el('p.form-hint', { role: 'status', 'aria-live': 'polite' });
  const loadNote = el('p.form-hint');

  /* Only what is already in memory can be counted; the rest arrives as the
     reads land, exactly as Today and home do it. */
  function inScope() {
    return scope === 'project'
      ? store.projects.filter((p) => p.id === projectId)
      : store.projects.filter((p) => !p.archived);
  }

  function sources() {
    return inScope()
      .map((e) => ({ entry: e, doc: store.getDoc(e.id) }))
      .filter((s) => s.doc);
  }

  function events() {
    return calendarEvents(sources(), {
      includeTasks,
      includeMilestones,
      baseUrl: appBaseUrl(),
    });
  }

  function syncCount() {
    const { total, tasks, milestones } = countEvents(events());
    const parts = [
      includeTasks ? `${tasks} task${tasks === 1 ? '' : 's'}` : null,
      includeMilestones ? `${milestones} milestone${milestones === 1 ? '' : 's'}` : null,
    ].filter(Boolean);
    countNote.textContent = total
      ? `${total} all-day event${total === 1 ? '' : 's'}: ${parts.join(', ')}.`
      : 'Nothing dated to export yet. Give a task a due date, or add a milestone.';
    downloadBtn.disabled = !total;
    if (puterBtn) puterBtn.disabled = !total;
  }

  /* Reads for whatever the current scope needs and nobody has in memory yet:
     the count fills in as they land, and says so meanwhile rather than
     under-reporting in silence. Run again whenever the scope widens —
     switching from one project to every project used to leave the unread ones
     out of the file without a word. */
  const reading = new Set();

  function syncLoadNote() {
    loadNote.textContent = reading.size
      ? `Reading ${reading.size} project${reading.size === 1 ? '' : 's'}…`
      : '';
  }

  function loadMissing() {
    const wanted = inScope()
      .filter((p) => !store.getDoc(p.id) && !reading.has(p.id));
    if (!wanted.length) { syncLoadNote(); return; }
    for (const p of wanted) reading.add(p.id);
    syncLoadNote();
    for (const p of wanted) {
      store.loadProject(p.id).catch((err) => console.error(err)).finally(() => {
        reading.delete(p.id);
        if (!countNote.isConnected) return;
        syncLoadNote();
        syncCount();
      });
    }
  }

  async function run(toPuter, button) {
    button.disabled = true;
    try {
      const list = events();
      const name = scope === 'project' ? (entry?.name ?? 'Project') : 'Projects';
      const text = buildCalendar(list, { name });
      const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
      const filename = `${safeSlug(name)}-${stamp()}.ics`;
      if (toPuter) {
        const saved = await saveToPuter(blob, filename);
        if (!saved) return;
        toast(`Saved to ${saved.path}`, { icon: 'cloud' });
      } else {
        downloadBlob(blob, filename);
        toast(`${filename} downloaded (${formatBytes(blob.size)})`, { icon: 'download' });
      }
      modal.close();
    } catch (err) {
      console.error(err);
      toast('Could not write the calendar file', { icon: 'cloudOff' });
    } finally {
      button.disabled = false;
    }
  }

  const downloadBtn = el('button.btn.btn-primary', {
    type: 'button',
    html: icon('download', 15, 2),
    onclick: () => run(false, downloadBtn),
  }, ' Download .ics');

  const puterBtn = canSaveFiles() && el('button.btn.btn-ghost', {
    type: 'button',
    html: icon('cloud', 15, 2),
    onclick: () => run(true, puterBtn),
  }, ' Save to Puter…');

  const modal = openModal({
    title: 'Calendar file',
    dismissOnBack: true,
    content: el('div', {},
      el('div.field', {}, el('span.label', {}, 'What to export'), scopeGroup),
      el('div.field', {},
        el('span.label', {}, 'Include'),
        check('Dated tasks that are not done yet', includeTasks, (on) => {
          includeTasks = on; syncCount();
        }),
        check('Milestones', includeMilestones, (on) => { includeMilestones = on; syncCount(); }),
        countNote,
        loadNote
      ),
      el('p.form-hint', {}, 'Events are all-day, because dates here have no time of day. '
        + 'Each one keeps the same identity every time you export, so re-importing the '
        + 'file updates your calendar instead of duplicating it — and saving over the '
        + 'same file in your Drive makes "refresh my calendar" one click. This is a '
        + 'snapshot, not a subscription: nothing here is published anywhere.'),
      el('div.row.row-end', {},
        el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
        puterBtn || null,
        downloadBtn
      )
    ),
  });

  syncCount();
  loadMissing();

  return modal;
}
