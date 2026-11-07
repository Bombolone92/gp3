/** Timesheets: clock in and out, weekly hours per person, entry editing. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { pageHeader, avatar, emptyState, field, textInput, textarea, select, moreButton } from '../ui/components.js';
import { openMenu } from '../ui/menu.js';
import { formDialog, confirmDialog } from '../ui/dialog.js';
import { setQuery } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { addDays, startOfWeek, daysInRange, formatDate, formatTime, isISODate, timeToMinutes } from '../core/dates.js';
import { clientName, formatHours, formatDecimalHours } from '../core/format.js';
import { entryMinutes, isRunning, parseLocal, toLocalStamp } from './timesheets-core.js';
import { money } from './common.js';
import { downloadText, toCSV } from '../core/csv.js';

export function render(ctx) {
  const store = app.store;
  const state = { week: startOfWeek(isISODate(ctx.query.week) ? ctx.query.week : app.today(), app.settings().weekStart || 0) };

  const clockNode = h('div');
  const gridNode = h('div');
  const entriesNode = h('div');

  const team = () => store.all('team').filter((m) => m.active !== false);
  const entries = () => store.all('timeEntries');

  // ---- Clock -------------------------------------------------------------
  function drawClock() {
    const members = team();
    if (!members.length) {
      clockNode.replaceChildren(
        h('section.card', emptyState({ icon: 'users', title: 'Add your team to track time', text: 'Each person can clock in and out from here, and their hours roll up into weekly timesheets.', actions: [h('a.btn.primary', { href: '#/settings/team' }, 'Add team members')], headingLevel: 2 })),
      );
      return;
    }
    const now = new Date();
    clockNode.replaceChildren(
      h(
        'section.card',
        h('div.card-head', h('h2.grow', 'On the clock'), h('span.subtle', { style: { fontSize: '13px' } }, `${members.filter((m) => entries().some((e) => e.memberId === m.id && isRunning(e))).length} of ${members.length} working`)),
        h(
          'div.card-body.flush',
          h(
            'ul.list',
            members.map((m) => {
              const running = entries().find((e) => e.memberId === m.id && isRunning(e));
              const todayMin = entries()
                .filter((e) => e.memberId === m.id && e.date === app.today())
                .reduce((s, e) => s + entryMinutes(e, now), 0);
              const job = running?.jobId ? store.get('jobs', running.jobId) : null;
              return h(
                'li',
                h(
                  'div.list-item.clock-row',
                  avatar(m.name, { color: m.color }),
                  h(
                    'div.grow',
                    { style: { minWidth: '0' } },
                    h('div.title', m.name),
                    h(
                      'div.meta',
                      running
                        ? [h('span.pill.success', { style: { height: '20px', marginRight: '6px' } }, 'Working'), `Since ${formatTime(running.start.slice(11, 16))}`, job ? ` · Job #${job.number}` : '']
                        : 'Not clocked in',
                    ),
                  ),
                  h('div', { style: { textAlign: 'right' } }, h('div.money', { style: { fontWeight: '700' }, dataset: running ? { ticker: running.id } : {} }, formatHours(todayMin)), h('div.meta', 'Today')),
                  running
                    ? h('button.btn', { type: 'button', dataset: { focus: `clock-${m.id}` }, onClick: () => clockOut(running) }, icon('pause', 15), 'Clock out')
                    : h('button.btn.primary', { type: 'button', dataset: { focus: `clock-${m.id}` }, onClick: (e) => clockIn(m, e.currentTarget) }, icon('play', 15), 'Clock in'),
                ),
              );
            }),
          ),
        ),
      ),
    );
  }

  function clockIn(member, anchor) {
    // Most likely first: this person's visits today, then the soonest open visit.
    const today = app.today();
    const mineToday = (j) => ((j.visits || []).some((v) => v.date === today && !v.completedAt && (v.assignees || []).includes(member.id)) ? 0 : 1);
    const nextVisit = (j) => (j.visits || []).filter((v) => !v.completedAt && v.date && v.date >= today).reduce((min, v) => (v.date < min ? v.date : min), '9999');
    const openJobs = store
      .all('jobs')
      .filter((j) => !j.archived && !j.closedAt)
      .sort((a, b) => mineToday(a) - mineToday(b) || nextVisit(a).localeCompare(nextVisit(b)) || (b.number || 0) - (a.number || 0))
      .slice(0, 30);
    openMenu(anchor, [
      { heading: 'Clock in to' },
      { label: 'General time', icon: 'clock', run: () => doClockIn(member, null) },
      ...openJobs.map((j) => ({ label: `#${j.number} ${j.title || 'Untitled'}`, description: clientName(lookup.client(j.clientId)), icon: 'hammer', run: () => doClockIn(member, j.id) })),
    ], { align: 'end' });
  }

  function doClockIn(member, jobId) {
    const now = new Date();
    // The menu has closed: back to this person's button once it redraws.
    refocus = `clock-${member.id}`;
    store.put('timeEntries', { memberId: member.id, date: app.today(), start: toLocalStamp(now), end: null, jobId, notes: '' });
    toast(`${member.name.split(' ')[0]} clocked in`);
  }

  function clockOut(entry) {
    const now = new Date();
    store.patch('timeEntries', entry.id, { end: toLocalStamp(now) });
    const m = lookup.member(entry.memberId);
    toast(`${m?.name.split(' ')[0] || 'Clocked out'}: ${formatHours(entryMinutes({ ...entry, end: toLocalStamp(now) }))} logged`);
  }

  // ---- Weekly grid -----------------------------------------------------------
  function drawGrid() {
    const days = daysInRange(state.week, addDays(state.week, 6));
    const now = new Date();
    const today = app.today();
    const weekEntries = entries().filter((e) => e.date >= days[0] && e.date <= days[6]);
    // Hours logged by people since made inactive or removed still count.
    const active = team();
    const others = [...new Set(weekEntries.map((e) => e.memberId))].filter((id) => !active.some((m) => m.id === id)).map((id) => store.get('team', id) || { id, name: 'Former member' });
    const members = [...active, ...others];
    const cell = (mid, d) => weekEntries.filter((e) => e.memberId === mid && e.date === d).reduce((s, e) => s + entryMinutes(e, now), 0);
    let grand = 0;
    let grandCost = 0;
    const rows = members.map((m) => {
      const mins = days.map((d) => cell(m.id, d));
      const total = mins.reduce((a, b) => a + b, 0);
      grand += total;
      const cost = Math.round((total / 60) * (m.laborRate || 0));
      grandCost += cost;
      return h(
        'tr',
        h('th', { scope: 'row' }, h('span.member-chip', avatar(m.name, { color: m.color, size: 'sm' }), m.name)),
        mins.map((v, i) => h(`td.r.ts-cell${v ? '' : '.zero'}${days[i] === today ? '.today' : ''}`, v ? formatHours(v) : '-')),
        h('td.r.ts-cell', { style: { fontWeight: '700' } }, formatHours(total)),
        h('td.r.money.subtle', m.laborRate ? money(cost) : '-'),
      );
    });
    const dayTotals = days.map((d) => members.reduce((s, m) => s + cell(m.id, d), 0));
    gridNode.replaceChildren(
      h(
        'section.card',
        h(
          'div.card-head',
          h('h2.grow', 'Weekly hours'),
          h(
            'div.btn-group',
            h('button.btn.sm.icon-only', { type: 'button', 'aria-label': 'Previous week', onClick: () => go(-7) }, icon('chevron-left', 16)),
            h('button.btn.sm', { type: 'button', onClick: () => ((state.week = startOfWeek(app.today(), app.settings().weekStart || 0)), setQuery({ week: '' }), drawAll()) }, 'This week'),
            h('button.btn.sm.icon-only', { type: 'button', 'aria-label': 'Next week', onClick: () => go(7) }, icon('chevron-right', 16)),
          ),
        ),
        h('div.card-body', { style: { paddingBottom: '0' } }, h('div.subtle', `${formatDate(days[0], { month: 'long', day: 'numeric' })} to ${formatDate(days[6], { month: 'long', day: 'numeric', year: 'numeric' })}`)),
        h(
          'div.card-body.flush',
          h(
            'div.table-wrap',
            { tabindex: '0', role: 'region', 'aria-label': 'Weekly hours' },
            h(
              'table.table.ts-grid',
              h('caption.sr-only', 'Hours per team member per day'),
              h(
                'thead',
                h(
                  'tr',
                  h('th', { scope: 'col' }, 'Team member'),
                  days.map((d) => h(`th.r${d === today ? '.today' : ''}`, { scope: 'col' }, formatDate(d, { weekday: 'short', day: 'numeric' }))),
                  h('th.r', { scope: 'col' }, 'Total'),
                  h('th.r', { scope: 'col' }, 'Labour cost'),
                ),
              ),
              h('tbody', rows.length ? rows : h('tr', h('td', { colspan: '10' }, h('span.subtle', 'No team members yet.')))),
              h(
                'tfoot',
                h(
                  'tr',
                  h('th', { scope: 'row' }, 'Total'),
                  dayTotals.map((v, i) => h(`td.r.ts-cell${v ? '' : '.zero'}${days[i] === today ? '.today' : ''}`, { style: { fontWeight: '700' } }, v ? formatHours(v) : '-')),
                  h('td.r.ts-cell', { style: { fontWeight: '750' } }, formatHours(grand)),
                  h('td.r.money', { style: { fontWeight: '700' } }, money(grandCost)),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function go(n) {
    state.week = addDays(state.week, n);
    setQuery({ week: state.week });
    drawAll();
  }

  // ---- Entries ----------------------------------------------------------------
  function drawEntries() {
    const days = daysInRange(state.week, addDays(state.week, 6));
    const now = new Date();
    const list = entries()
      .filter((e) => e.date >= days[0] && e.date <= days[6])
      .sort((a, b) => (b.start || b.date).localeCompare(a.start || a.date));
    entriesNode.replaceChildren(
      h(
        'section.card',
        h('div.card-head', h('h2.grow', 'Time entries', h('span.count', ` ${list.length}`)), h('button.btn.sm', { type: 'button', dataset: { focus: 'add-time' }, onClick: () => entryDialog() }, icon('plus', 14), 'Add time')),
        h(
          'div.card-body.flush',
          list.length
            ? h(
                'div.table-wrap',
                { tabindex: '0', role: 'region', 'aria-label': 'Time entries' },
                h(
                  'table.table',
                  h('thead', h('tr', h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col' }, 'Team member'), h('th', { scope: 'col' }, 'Time'), h('th', { scope: 'col' }, 'Job'), h('th.r', { scope: 'col' }, 'Hours'), h('th.r', { scope: 'col' }, h('span.sr-only', 'Actions')))),
                  h(
                    'tbody',
                    list.map((e) => {
                      const m = lookup.member(e.memberId);
                      const job = e.jobId ? store.get('jobs', e.jobId) : null;
                      const more = moreButton((btn) => entryMenu(btn, e), 'Entry actions');
                      more.dataset.focus = `entry-${e.id}`;
                      return h(
                        'tr',
                        h('td.nowrap', formatDate(e.date, { weekday: 'short', month: 'short', day: 'numeric' })),
                        h('td', m ? h('span.member-chip', avatar(m.name, { color: m.color, size: 'sm' }), m.name) : 'Former member'),
                        h('td.nowrap', e.start ? `${formatTime(e.start.slice(11, 16))} - ${e.end ? formatTime(e.end.slice(11, 16)) : 'now'}` : 'Manual', isRunning(e) ? h('span.pill.success', { style: { marginLeft: '8px', height: '20px' } }, 'Running') : null),
                        h('td', job ? h('a', { href: `#/jobs/${job.id}` }, `#${job.number} ${job.title || ''}`) : h('span.subtle', 'General')),
                        h('td.r.money', formatDecimalHours(entryMinutes(e, now))),
                        h('td.r', more),
                      );
                    }),
                  ),
                ),
              )
            : h('div.section-empty', h('span', 'No time logged this week.'), h('button.btn.sm', { type: 'button', onClick: () => entryDialog() }, 'Add time')),
        ),
      ),
    );
  }

  function entryMenu(anchor, e) {
    openMenu(
      anchor,
      [
        // Focus the menu button first: the dialog hands focus back to it.
        { label: 'Edit entry', icon: 'pencil', run: () => (anchor.focus(), entryDialog(e)) },
        isRunning(e) ? { label: 'Clock out now', icon: 'pause', run: () => ((refocus = `entry-${e.id}`), clockOut(e)) } : null,
        {
          label: 'Delete entry',
          icon: 'trash',
          danger: true,
          run: async () => {
            if (!(await confirmDialog({ title: 'Delete this time entry?', message: 'The hours are removed from the timesheet and job costing.', confirmLabel: 'Delete', danger: true }))) return;
            const removed = store.remove('timeEntries', e.id);
            toast('Entry deleted', { action: { label: 'Undo', run: () => store.restore('timeEntries', removed) } });
          },
        },
      ],
      { align: 'end' },
    );
  }

  // Redrawing replaces every button: keep keyboard focus on the same one
  // (data-focus names it), or on the one an action asked for.
  let refocus = null;
  function drawAll() {
    const keep = refocus || document.activeElement?.dataset?.focus;
    refocus = null;
    drawClock();
    drawGrid();
    drawEntries();
    if (keep) document.querySelector(`[data-focus="${keep}"]`)?.focus();
  }

  drawAll();
  ctx.onDispose(store.subscribe((c) => (c.has('timeEntries') || c.has('team') || c.has('jobs')) && drawAll()));
  // Tick running timers. Redrawing replaces every button, so wait while
  // someone is on one (or has a menu open) rather than drop their focus.
  const busy = () => [clockNode, gridNode, entriesNode].some((n) => n.contains(document.activeElement)) || document.querySelector('.popover');
  const timer = setInterval(() => entries().some(isRunning) && !busy() && drawAll(), 30000);
  ctx.onDispose(() => clearInterval(timer));

  const exportCSV = () => {
    const days = daysInRange(state.week, addDays(state.week, 6));
    const rows = [['Date', 'Team member', 'Start', 'End', 'Hours', 'Job', 'Notes']];
    for (const e of entries().filter((x) => x.date >= days[0] && x.date <= days[6]).sort((a, b) => a.date.localeCompare(b.date))) {
      const job = e.jobId ? store.get('jobs', e.jobId) : null;
      rows.push([e.date, lookup.member(e.memberId)?.name || '', e.start?.slice(11, 16) || '', e.end?.slice(11, 16) || '', formatDecimalHours(entryMinutes(e)), job ? `#${job.number} ${job.title || ''}` : '', e.notes || '']);
    }
    downloadText(`timesheet-${state.week}.csv`, toCSV(rows));
  };

  return {
    node: h(
      'div.page',
      pageHeader({
        title: 'Timesheets',
        actions: [moreButton((btn) => openMenu(btn, [{ label: 'Export this week to CSV', icon: 'file-down', run: exportCSV }])), h('button.btn.primary', { type: 'button', onClick: () => entryDialog() }, icon('plus', 16), 'Add time')],
      }),
      h('div.stack', { style: { gap: '16px' } }, clockNode, gridNode, entriesNode),
    ),
    title: 'Timesheets',
  };
}

/** Add or edit a time entry by hand. */
export function entryDialog(entry = null, defaults = {}) {
  const store = app.store;
  const team = store.all('team').filter((m) => m.active !== false || m.id === entry?.memberId);
  if (!team.length) {
    toast('Add a team member first', { type: 'error' });
    return;
  }
  const jobs = store.all('jobs').filter((j) => !j.archived || j.id === entry?.jobId);
  const start = entry?.start ? entry.start.slice(11, 16) : '08:00';
  const end = entry?.end ? entry.end.slice(11, 16) : entry ? '' : '16:00';
  const startIn = textInput({ name: 'start', type: 'time', value: start, step: 300, required: true });
  const endIn = textInput({ name: 'end', type: 'time', value: end, step: 300 });
  const endField = field('End', endIn, { hint: 'Leave empty if still working' });
  // An end before the start is a shift that runs past midnight.
  const updateEndHint = () => (endField.querySelector('.hint').textContent = endIn.value && startIn.value && endIn.value < startIn.value ? 'Ends the next day' : 'Leave empty if still working');
  startIn.addEventListener('input', updateEndHint);
  endIn.addEventListener('input', updateEndHint);
  updateEndHint();
  return formDialog({
    title: entry ? 'Edit time entry' : 'Add time',
    submitLabel: entry ? 'Save' : 'Add time',
    body: h(
      'div.form-grid',
      field('Team member', select({ name: 'member', value: entry?.memberId || defaults.memberId || team[0].id, options: team.map((m) => ({ value: m.id, label: m.name })) }), { span2: true }),
      field('Date', textInput({ name: 'date', type: 'date', value: entry?.date || defaults.date || app.today(), required: true }), { span2: true }),
      field('Start', startIn),
      endField,
      field('Unpaid break (minutes)', textInput({ name: 'break', type: 'number', min: 0, value: String(entry?.breakMinutes || 0), cls: 'num' })),
      field('Job', select({ name: 'job', value: entry?.jobId || defaults.jobId || '', options: [{ value: '', label: 'General time' }, ...jobs.map((j) => ({ value: j.id, label: `#${j.number} ${j.title || 'Untitled'}` }))] })),
      field('Notes', textarea({ name: 'notes', value: entry?.notes || '', rows: 2 }), { span2: true }),
    ),
    onSubmit: (fd) => {
      const date = String(fd.get('date'));
      const s = String(fd.get('start'));
      const e = String(fd.get('end') || '');
      if (e && e === s) {
        toast('End time must be after the start time', { type: 'error' });
        return false;
      }
      const breakMin = Math.max(0, Number(fd.get('break')) || 0);
      if (e && breakMin) {
        const span = (timeToMinutes(e) - timeToMinutes(s) + 24 * 60) % (24 * 60);
        if (breakMin >= span) {
          toast('The unpaid break must be shorter than the time worked.', { type: 'error' });
          return false;
        }
      }
      // Leaving End empty means still working: only today, and one timer per person.
      if (!e) {
        const memberId = String(fd.get('member'));
        // (A shift clocked in last night and still running keeps running.)
        if (date !== app.today() && !(entry && isRunning(entry) && entry.date === date)) {
          toast('Enter an end time. Only time worked today can still be running.', { type: 'error' });
          return false;
        }
        if (store.all('timeEntries').some((x) => x.memberId === memberId && x.id !== entry?.id && isRunning(x))) {
          toast(`${lookup.member(memberId)?.name || 'This person'} is already clocked in. Enter an end time.`, { type: 'error' });
          return false;
        }
      }
      const rec = {
        ...(entry || {}),
        memberId: String(fd.get('member')),
        date,
        start: `${date}T${s}`,
        end: e ? `${e < s ? addDays(date, 1) : date}T${e}` : null,
        breakMinutes: breakMin,
        jobId: String(fd.get('job')) || null,
        notes: String(fd.get('notes') || ''),
      };
      store.put('timeEntries', rec);
      toast(entry ? 'Time entry updated' : 'Time added');
      return true;
    },
  });
}

export { parseLocal };
