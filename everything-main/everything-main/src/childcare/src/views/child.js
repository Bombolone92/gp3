/**
 * One child: feed, daily report, profile and health, family and approved
 * pickups, attendance history, billing, and documents. Families see the
 * same page for their own children, without the staff-only parts.
 */
import { h, keepFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { tabs, card, pill, emptyState, field, textInput, textarea, select, chips } from '../ui/components.js';
import { openDialog, confirmDialog, formDialog } from '../ui/dialog.js';
import { openMenu } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { navigate, setQuery } from '../ui/router.js';
import { app, isFamily, isManager, myName, myStudents } from '../app.js';
import { personName, firstName, pluralize, formatHours, telHref } from '../core/format.js';
import { statusMeta, guardiansOf, immunizationSummary, VACCINES, hasAllergy } from '../core/people.js';
import { attendanceName, indexDay, statusOf, currentRoom, firstIn, lastOut, minutesPresent, checkIn, checkOut, markAbsent, clearAbsent, nowHHMM, studentRecordId } from '../core/attendance.js';
import { activityName, sortActivities, dailyReport, describe, durationLabel, ACTIVITY_TYPES } from '../core/activities.js';
import { account, STATUS_META } from '../core/billing.js';
import { ageLabel, formatDate, formatTime, addDays, addMonths, startOfMonth, endOfMonth, daysInRange, monthLabel } from '../core/dates.js';
import { monthMetaKey } from '../core/keys.js';
import { PAYMENT_METHODS } from '../core/settings.js';
import { saveFile, deleteFile, formatBytes } from '../files.js';
import { childAvatar, guardianAvatar, activityCard, attendancePill, roomDot, dayNav, money, mediaGrid, openAttachment } from './common.js';
import { openLogActivity } from './log.js';

const TABS = [
  { id: 'feed', label: 'Feed' },
  { id: 'report', label: 'Daily report' },
  { id: 'profile', label: 'Profile' },
  { id: 'family', label: 'Family' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'billing', label: 'Billing', manager: true },
  { id: 'files', label: 'Documents', staff: true },
];

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  if (isFamily() && !myStudents().some((s) => s.id === id)) return notFound();
  let tab = TABS.some((t) => t.id === ctx.query.tab) ? ctx.query.tab : 'feed';
  const visibleTabs = () => TABS.filter((t) => (!t.manager || isManager() || isFamily()) && (!t.staff || !isFamily()));
  const today = app.today();
  store.open([attendanceName(today)]);

  // Check in and Check out swap in place, so the second click of a double-click
  // would undo the first: ignore a toggle right after the last one.
  let toggledAt = 0;
  const toggle = (fn) => () => {
    if (Date.now() - toggledAt < 700) return;
    toggledAt = Date.now();
    fn();
  };

  const head = ctx.live(() => {
    const s = store.get('students', id);
    if (!s) return notFound();
    const rec = indexDay(store.all(attendanceName(today))).students.get(id);
    const state = statusOf(rec);
    const room = store.get('rooms', currentRoom(rec) || s.roomId);
    const meta = statusMeta(s.status);
    const actions = [];
    if (!isFamily()) {
      if (s.status === 'active') {
        if (state === 'in') actions.push(h('button.btn', { type: 'button', onClick: toggle(() => quickCheckOut(s)) }, icon('log-out', 16), 'Check out'));
        else actions.push(h('button.btn', { type: 'button', onClick: toggle(() => (checkIn(store, today, s.id, { roomId: s.roomId, by: myName() }), toast(`${personName(s)} checked in`))) }, icon('log-in', 16), 'Check in'));
      }
      actions.push(h('button.btn.primary', { type: 'button', onClick: () => openLogActivity({ studentIds: [s.id] }) }, icon('plus', 16), 'Log activity'));
    }
    actions.push(h('a.btn', { href: `#/messages/${s.id}` }, icon('message', 16), isFamily() ? 'Message teachers' : 'Message family'));
    if (!isFamily())
      actions.push(
        h(
          'button.icon-btn.bordered',
          {
            type: 'button',
            'aria-label': 'More actions',
            onClick: (e) =>
              openMenu(e.currentTarget, [
                { label: 'Edit details', icon: 'pencil', href: `#/children/${s.id}/edit` },
                { label: 'Print daily report', icon: 'printer', run: () => (setTab('report'), setTimeout(() => window.print(), 300)) },
                state === 'none' ? { label: 'Mark absent today', icon: 'calendar-x', run: () => reportAbsence(s, today) } : null,
                { separator: true },
                s.status !== 'active' ? { label: 'Enroll', icon: 'user-check', run: () => store.patch('students', s.id, { status: 'active', startDate: s.startDate || today }) } : null,
                s.status === 'active' ? { label: 'Mark as graduated', icon: 'graduation', run: () => store.patch('students', s.id, { status: 'graduated', endDate: today }) } : null,
                s.status === 'active' ? { label: 'Mark as inactive', icon: 'archive', run: () => store.patch('students', s.id, { status: 'inactive', endDate: today }) } : null,
                isManager() ? { label: 'Delete child', icon: 'trash', danger: true, run: () => deleteChild(s) } : null,
              ]),
          },
          icon('more'),
        ),
      );
    return h(
      'header.child-head',
      childAvatar(s, { size: 'xl' }),
      h(
        'div.child-titles',
        !isFamily() ? h('nav.crumbs', { 'aria-label': 'Breadcrumb' }, h('a', { href: '#/children' }, 'Children'), icon('chevron-right', 14)) : null,
        h('h1', personName(s)),
        h(
          'div.child-meta',
          room ? roomDot(room) : null,
          s.birthday ? h('span', ageLabel(s.birthday, today)) : null,
          s.status !== 'active' ? pill(meta.label, meta.tone) : attendancePill(state, state === 'in' ? room?.name : ''),
          state === 'in' && firstIn(rec) ? h('span.subtle', `since ${formatTime(firstIn(rec))}`) : null,
        ),
        hasAllergy(s) ? h('p.allergy-banner', icon('warning', 16), h('span', h('strong', 'Allergies: '), s.allergies)) : null,
      ),
      h('div.child-actions', actions),
    );
  }, ['students', 'attendance', 'rooms']);

  const tabBar = h('div');
  const drawTabs = () => keepFocus(tabBar, () => tabBar.replaceChildren(tabs({ label: 'Sections', items: visibleTabs(), selected: tab, onSelect: setTab })));
  function setTab(t) {
    tab = t;
    setQuery({ tab: t === 'feed' ? null : t });
    drawTabs();
    drawPanel();
  }
  drawTabs();

  const panel = h('div.tab-panel', { role: 'tabpanel' });
  let disposePanel = null;
  function drawPanel() {
    disposePanel?.();
    disposePanel = null;
    const s = store.get('students', id);
    if (!s) return panel.replaceChildren();
    const out = { feed: feedTab, report: reportTab, profile: profileTab, family: familyTab, attendance: attendanceTab, billing: billingTab, files: filesTab }[tab](ctx, s);
    panel.replaceChildren(out.node || out);
    disposePanel = out.dispose || null;
  }
  drawPanel();
  ctx.onDispose(() => disposePanel?.());

  const s = store.get('students', id);
  return { node: h('div.page', head, tabBar, panel), title: s ? personName(s) : 'Child not found' };
}

function notFound() {
  return h('div.page', emptyState({ icon: 'search', title: 'Child not found', text: 'This child may have been removed.', headingLevel: 1, actions: [h('a.btn.primary', { href: isFamily() ? '#/' : '#/children' }, 'Back')] }));
}

/** A tab that redraws when collections change. */
function liveTab(drawFn, colls) {
  const node = h('div');
  const draw = () => keepFocus(node, () => node.replaceChildren(...[drawFn()].flat(Infinity).filter(Boolean)));
  draw();
  const off = app.store.subscribe((changed) => {
    if (colls.some((c) => changed.has(c)) && node.isConnected) queueMicrotask(draw);
  });
  return { node, dispose: off, redraw: draw };
}

function quickCheckOut(s) {
  checkOut(app.store, app.today(), s.id, { at: nowHHMM(), by: myName() });
  toast(`${personName(s)} checked out`);
}

async function deleteChild(s) {
  const ok = await confirmDialog({ title: `Delete ${personName(s)}?`, message: 'Their profile is removed. Activity logs, attendance, and statements stay in reports. To keep the profile, mark them inactive or graduated instead.', confirmLabel: 'Delete child', danger: true });
  if (!ok) return;
  app.store.remove('students', s.id);
  for (const g of app.store.all('guardians')) if (g.studentIds?.includes(s.id)) app.store.patch('guardians', g.id, { studentIds: g.studentIds.filter((x) => x !== s.id) });
  toast(`${personName(s)} deleted`);
  navigate('/children');
}

// ---- Feed ----------------------------------------------------------------------

function feedTab(ctx, s) {
  const store = app.store;
  let days = []; // day partitions known to hold activities, newest first
  let shown = 7;
  let type = 'all';
  let months = 0;
  let loading = true;

  async function discover() {
    // The meta items say which days have any activity, so empty days cost nothing.
    const keys = [];
    for (let i = months; i < months + 3; i++) keys.push(monthMetaKey(addMonths(startOfMonth(app.today()), -i).slice(0, 7)));
    months += 3;
    await store.peekMeta(keys);
    days = store.knownPartitions('activities').filter((n) => n.slice(11) <= app.today()).reverse();
    await store.open(days.slice(0, shown));
    loading = false;
    t.redraw();
  }

  const t = liveTab(() => {
    const names = days.slice(0, shown);
    const list = [];
    for (const n of names) for (const a of store.all(n)) if (a.studentId === s.id && (!isFamily() || !a.staffOnly)) list.push(a);
    const filtered = sortActivities(type === 'all' ? list : list.filter((a) => a.type === type)).sort((a, b) => b.day.localeCompare(a.day));
    const types = new Set(list.map((a) => a.type));
    const byDay = new Map();
    for (const a of filtered) {
      if (!byDay.has(a.day)) byDay.set(a.day, []);
      byDay.get(a.day).push(a);
    }
    return [
      h('div.toolbar', chips({ label: 'Type', items: [{ id: 'all', label: 'All' }, ...ACTIVITY_TYPES.filter((x) => types.has(x.id)).map((x) => ({ id: x.id, label: x.short || x.label }))], selected: type, onSelect: (v) => ((type = v), t.redraw()) })),
      loading
        ? h('div.skeleton-feed', h('div.skeleton'), h('div.skeleton'), h('div.skeleton'))
        : byDay.size
          ? h(
              'div.feed-days',
              [...byDay].map(([day, acts]) =>
                h(
                  'section.feed-day',
                  { 'aria-label': formatDate(day, { weekday: 'long', month: 'long', day: 'numeric' }) },
                  h('h2.feed-day-title', day === app.today() ? 'Today' : formatDate(day, { weekday: 'long', month: 'long', day: 'numeric' }), h('a.btn.sm.ghost', { href: `#/children/${s.id}?tab=report&date=${day}` }, 'Daily report')),
                  h('div.feed', acts.map((a) => activityCard(a, { showChild: false, onEdit: isFamily() ? null : (rec) => openLogActivity({ edit: rec }) }))),
                ),
              ),
            )
          : emptyState({ icon: 'notebook-pen', title: 'No activity yet', text: isFamily() ? 'Updates from teachers appear here.' : 'Meals, naps, photos, and notes logged for this child appear here.', compact: true, actions: isFamily() ? null : [h('button.btn.primary', { type: 'button', onClick: () => openLogActivity({ studentIds: [s.id] }) }, 'Log activity')] }),
      !loading && (days.length > shown || months < 24)
        ? h(
            'div.show-more',
            h(
              'button.btn',
              {
                type: 'button',
                onClick: async () => {
                  shown += 7;
                  if (days.length <= shown) await discover();
                  else await store.open(days.slice(0, shown));
                  t.redraw();
                },
              },
              'Show older days',
            ),
          )
        : null,
    ];
  }, ['activities']);
  discover();
  return t;
}

// ---- Daily report ------------------------------------------------------------------

function reportTab(ctx, s) {
  const store = app.store;
  let day = ctx.query.date || app.today();
  const load = () => store.open([activityName(day), attendanceName(day)]);
  load();
  const t = liveTab(() => {
    const acts = store.all(activityName(day)).filter((a) => a.studentId === s.id && (!isFamily() || !a.staffOnly));
    const rec = indexDay(store.all(attendanceName(day))).students.get(s.id);
    const r = dailyReport(acts);
    const section = (title, ic, tone, items, empty) =>
      h('section.report-section', h('h3', h(`span.type-tile.sm.tone-${tone}`, icon(ic, 15)), title), items.length ? h('ul.report-list', items) : h('p.subtle', empty));
    const line = (a, text) => h('li', h('time', formatTime(a.at)), h('span', text || describe(a), a.note ? h('span.report-note', a.note) : null));
    return h(
      'div.report',
      h(
        'div.report-bar.no-print',
        dayNav({ value: day, max: app.today(), onChange: (d) => ((day = d), setQuery({ date: d }), load(), t.redraw()) }),
        h('span.spacer'),
        h('button.btn', { type: 'button', onClick: () => window.print() }, icon('printer', 16), 'Print'),
      ),
      h(
        'article.report-sheet',
        h('header.report-head', childAvatar(s, { size: 'lg' }), h('div', h('h2', personName(s)), h('p.subtle', formatDate(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))), h('span.spacer'), h('span.report-school', app.settings().school.name || '')),
        h(
          'div.report-stats',
          h('div', h('span.subtle', 'Arrived'), h('strong', firstIn(rec) ? formatTime(firstIn(rec)) : rec?.absent ? 'Absent' : '-')),
          h('div', h('span.subtle', 'Went home'), h('strong', statusOf(rec) === 'out' ? formatTime(lastOut(rec)) : '-')),
          h('div', h('span.subtle', 'Sleep'), h('strong', r.sleepMinutes ? durationLabel(r.sleepMinutes) : '-')),
          h('div', h('span.subtle', 'Entries'), h('strong', String(r.total))),
        ),
        h(
          'div.report-grid',
          section('Meals and bottles', 'utensils', 'green', r.meals.map((a) => line(a)), 'No meals logged.'),
          section('Naps', 'moon', 'indigo', r.naps.map((a) => line(a)), 'No naps logged.'),
          section('Diapers and potty', 'baby', 'sky', r.toilet.map((a) => line(a)), 'None logged.'),
          section('Notes and moments', 'notebook-pen', 'teal', r.other.filter((a) => a.type !== 'photo').map((a) => line(a)), 'Nothing else logged.'),
        ),
        r.photos.length ? h('section.report-section.report-photos', h('h3', h('span.type-tile.sm.tone-violet', icon('camera', 15)), 'Photos'), h('div.report-photo-list', r.photos.map((a) => mediaGrid(a.media, { ref: activityName(day), id: a.id })))) : null,
      ),
    );
  }, ['activities', 'attendance']);
  return t;
}

// ---- Profile -------------------------------------------------------------------------

function profileTab(ctx, s) {
  const store = app.store;
  const canEdit = !isFamily() || app.settings().access?.parentsCanEditInfo !== false;
  const kv = (pairs) => h('dl.kv', pairs.filter(Boolean).map(([k, v]) => [h('dt', k), h('dd', v || h('span.subtle', 'Not set'))]));
  return liveTab(() => {
    const c = store.get('students', s.id);
    if (!c) return null;
    const room = store.get('rooms', c.roomId);
    const imm = immunizationSummary(c);
    return h(
      'div.profile-grid',
      card({
        title: 'About',
        actions: isFamily() ? null : h('a.btn.sm.ghost', { href: `#/children/${c.id}/edit` }, icon('pencil', 15), 'Edit'),
        body: kv([
          ['Name', personName(c, { preferred: false })],
          c.preferredName ? ['Goes by', c.preferredName] : null,
          ['Birthday', c.birthday ? `${formatDate(c.birthday)} (${ageLabel(c.birthday)})` : ''],
          ['Gender', c.gender],
          ['Room', room ? roomDot(room) : ''],
          ['Usual days', (c.schedule || []).length ? (c.schedule || []).map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ') : ''],
          ['Started', c.startDate ? formatDate(c.startDate) : ''],
          ['Address', c.address],
        ]),
      }),
      card({
        title: 'Health',
        actions: canEdit ? h('button.btn.sm.ghost', { type: 'button', onClick: () => editHealth(c) }, icon('pencil', 15), 'Edit') : null,
        body: kv([
          ['Allergies', hasAllergy(c) ? h('span.allergy-text', icon('warning', 14), c.allergies) : 'None'],
          ['Medications', c.medications || 'None'],
          ['Conditions', c.conditions || 'None'],
          ['Dietary needs', c.dietary || 'None'],
          ['Doctor', [c.doctor?.name, c.doctor?.phone].filter(Boolean).join(' · ')],
        ]),
      }),
      card({
        title: 'Immunizations',
        actions: isFamily() ? null : h('button.btn.sm.ghost', { type: 'button', onClick: () => addDose(c) }, icon('plus', 15), 'Add dose'),
        flush: true,
        body: imm.length
          ? h('ul.mini-list', imm.map((v) => h('li', h('span.grow', h('span.person-name', v.vaccine), h('span.person-sub', v.dates.map((d) => formatDate(d)).join(', ') || 'Date not recorded')), pill(pluralize(v.dates.length || 1, 'dose'), 'plain'))))
          : h('p.card-pad.subtle', 'No immunization records yet.'),
      }),
      !isFamily() && (c.status === 'waitlist' || c.status === 'inquiry' || c.inquiry)
        ? card({
            title: 'Enrollment',
            body: kv([
              ['Status', pill(statusMeta(c.status).label, statusMeta(c.status).tone)],
              ['First contact', c.inquiry?.firstContact ? formatDate(c.inquiry.firstContact) : ''],
              ['Toured', c.inquiry?.toured ? formatDate(c.inquiry.toured) : ''],
              ['Wants to start', c.inquiry?.desiredStart ? formatDate(c.inquiry.desiredStart) : ''],
              ['Source', c.inquiry?.source],
              c.inquiry?.notes ? ['Notes', c.inquiry.notes] : null,
            ]),
          })
        : null,
      !isFamily() ? card({ title: 'Staff notes', actions: h('span.badge-private', icon('eye-off', 13), 'Staff only'), body: c.staffNotes ? h('p.pre', c.staffNotes) : h('p.subtle', 'No notes. Add routines or comfort items in Edit.') }) : null,
    );
  }, ['students', 'rooms']);
}

function editHealth(c) {
  const vals = { allergies: c.allergies || '', medications: c.medications || '', conditions: c.conditions || '', dietary: c.dietary || '', docName: c.doctor?.name || '', docPhone: c.doctor?.phone || '' };
  const ta = (k) => textarea({ name: k, value: vals[k], rows: 2 });
  formDialog({
    title: `${firstName(c)}'s health information`,
    body: h('div.form-grid', field('Allergies', ta('allergies'), { span2: true }), field('Medications', ta('medications')), field('Conditions', ta('conditions')), field('Dietary needs', textInput({ name: 'dietary', value: vals.dietary }), { span2: true }), field('Doctor', textInput({ name: 'docName', value: vals.docName })), field('Doctor phone', textInput({ name: 'docPhone', type: 'tel', value: vals.docPhone }))),
    onSubmit: (fd) => {
      app.store.patch('students', c.id, { allergies: fd.get('allergies').trim(), medications: fd.get('medications').trim(), conditions: fd.get('conditions').trim(), dietary: fd.get('dietary').trim(), doctor: { name: fd.get('docName').trim(), phone: fd.get('docPhone').trim() } });
      toast('Health information saved');
    },
  });
}

function addDose(c) {
  formDialog({
    title: 'Add an immunization',
    size: 'narrow',
    body: h('div.stack', field('Vaccine', (() => {
      const i = textInput({ name: 'vaccine', list: 'vaccine-list', required: true });
      return h('div', i, h('datalist#vaccine-list', VACCINES.map((v) => h('option', { value: v }))));
    })()), field('Date given', textInput({ name: 'date', type: 'date', max: app.today() }))),
    onSubmit: (fd) => {
      const vaccine = String(fd.get('vaccine') || '').trim();
      if (!vaccine) return false;
      app.store.patch('students', c.id, (cur) => ({ ...cur, immunizations: [...(cur.immunizations || []), { vaccine, date: fd.get('date') || '' }] }));
      toast('Immunization added');
    },
  });
}

// ---- Family ----------------------------------------------------------------------------

function familyTab(ctx, s) {
  const store = app.store;
  return liveTab(() => {
    const fam = guardiansOf(store.all('guardians'), s.id);
    const badge = (on, label, ic) => (on ? h('span.flag', icon(ic, 13), label) : null);
    return h(
      'div.stack',
      !isFamily()
        ? h(
            'div.row',
            h('button.btn', { type: 'button', onClick: () => import('./families.js').then((m) => m.openGuardianForm({ studentIds: [s.id] })) }, icon('user-plus', 16), 'Add family member'),
            h('button.btn', { type: 'button', onClick: () => import('./families.js').then((m) => m.openGuardianForm({ studentIds: [s.id], relation: 'Family friend', pickupOnly: true })) }, icon('user-check', 16), 'Add approved pickup'),
            h('button.btn.ghost', { type: 'button', onClick: () => import('./families.js').then((m) => m.linkExisting(s)) }, icon('link', 16), 'Link existing'),
          )
        : null,
      fam.length
        ? h(
            'div.guardian-grid',
            fam.map((g) =>
              h(
                'article.guardian-card',
                h('div.row', guardianAvatar(g, { size: 'lg' }), h('div.grow', h('h3', personName(g)), h('p.subtle', g.relation || 'Family'))),
                h('div.flags', badge(g.primary, 'Primary', 'star'), badge(g.canPickup, 'Can pick up', 'user-check'), badge(g.emergency, 'Emergency contact', 'phone'), badge(g.billing, 'Billing', 'wallet')),
                h(
                  'ul.contact-list',
                  g.phone ? h('li', icon('phone', 15), h('a', { href: telHref(g.phone) }, g.phone)) : null,
                  g.email ? h('li', icon('mail', 15), h('a', { href: `mailto:${g.email}` }, g.email)) : null,
                ),
                !isFamily() ? h('div.guardian-foot', g.memberUuid ? pill('Using the app', 'success') : pill('Not invited yet', 'plain'), h('span.spacer'), h('button.btn.sm.ghost', { type: 'button', onClick: () => import('./families.js').then((m) => m.openGuardianForm({ guardian: g })) }, 'Edit'), g.pin ? h('button.btn.sm.ghost', { type: 'button', onClick: (e) => ((e.currentTarget.textContent = `PIN ${g.pin}`), (e.currentTarget.disabled = true)) }, 'Show kiosk PIN') : null) : null,
                isFamily() && g.id === app.me.guardianId && g.pin ? h('p.subtle.small', `Your check-in PIN: ${g.pin}`) : null,
              ),
            ),
          )
        : emptyState({ icon: 'users', title: 'No family members yet', text: 'Add parents, guardians, and anyone allowed to pick up.', compact: true }),
    );
  }, ['guardians', 'students']);
}

// ---- Attendance ------------------------------------------------------------------------

function attendanceTab(ctx, s) {
  const store = app.store;
  let month = startOfMonth(app.today());
  const names = () => daysInRange(month, endOfMonth(month) < app.today() ? endOfMonth(month) : app.today()).map((d) => attendanceName(d));
  const load = async () => {
    await store.peekMeta([monthMetaKey(month.slice(0, 7))]);
    const known = new Set(store.knownPartitions('attendance'));
    await store.open(names().filter((n) => known.has(n)));
    t.redraw();
  };
  const t = liveTab(() => {
    const rows = [];
    let total = 0;
    let present = 0;
    let absent = 0;
    for (const n of names().reverse()) {
      const rec = store.get(n, studentRecordId(s.id));
      // "Remove absence" leaves a record with neither events nor an absence.
      if (!rec || (!rec.absent && !rec.events?.length)) continue;
      const day = n.slice(11);
      const mins = minutesPresent(rec, day === app.today() ? nowHHMM() : null);
      total += mins;
      if (rec.absent && !rec.events?.length) absent++;
      else present++;
      rows.push(h('tr', h('td', formatDate(day, { weekday: 'short', month: 'short', day: 'numeric' })), h('td', rec.absent && !rec.events?.length ? pill(rec.absent.reason ? `Absent: ${rec.absent.reason}` : 'Absent', 'warning') : formatTime(firstIn(rec)) || '-'), h('td', statusOf(rec) === 'in' ? pill('Here now', 'success') : lastOut(rec) ? formatTime(lastOut(rec)) : '-'), h('td.r', mins ? formatHours(mins) : '-')));
    }
    return [
      h('div.toolbar', h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'Previous month', onClick: () => ((month = addMonths(month, -1)), load()) }, icon('chevron-left')), h('strong.month-label', monthLabel(month)), h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'Next month', disabled: month >= startOfMonth(app.today()) || null, onClick: () => ((month = addMonths(month, 1)), load()) }, icon('chevron-right'))),
      h('div.stats', h('div.stat', h('span.stat-label', 'Days present'), h('span.stat-value', String(present))), h('div.stat', h('span.stat-label', 'Absences'), h('span.stat-value', String(absent))), h('div.stat', h('span.stat-label', 'Hours'), h('span.stat-value', formatHours(total)))),
      rows.length ? h('div.table-wrap.mt', h('table.table', h('thead', h('tr', h('th', 'Day'), h('th', 'In'), h('th', 'Out'), h('th.r', 'Hours'))), h('tbody', rows))) : h('p.subtle.mt', 'No attendance this month.'),
    ];
  }, ['attendance']);
  load();
  return t;
}

// ---- Billing ------------------------------------------------------------------------------

function billingTab(ctx, s) {
  const store = app.store;
  return liveTab(() => {
    const acc = account(s.id, store.all('invoices'), store.all('payments'), app.today());
    const pays = store.all('payments').filter((p) => p.studentId === s.id).sort((a, b) => b.date.localeCompare(a.date));
    return [
      h(
        'div.stats',
        h('div.stat', h('span.stat-label', acc.balance < 0 ? 'Credit' : 'Balance'), h('span.stat-value', money(Math.abs(acc.balance)))),
        h(`div.stat${acc.overdue ? '.tone-danger' : ''}`, h('span.stat-label', 'Overdue'), h('span.stat-value', money(acc.overdue))),
        h('div.stat', h('span.stat-label', 'Paid to date'), h('span.stat-value', money(acc.paid))),
      ),
      isManager() ? h('div.row.mt', h('button.btn', { type: 'button', onClick: () => import('./billing.js').then((m) => m.openInvoiceForm({ studentId: s.id })) }, icon('receipt', 16), 'New statement'), h('button.btn', { type: 'button', onClick: () => import('./billing.js').then((m) => m.openPaymentForm({ studentId: s.id })) }, icon('wallet', 16), 'Record payment')) : null,
      card({
        title: 'Statements',
        flush: true,
        body: acc.rows.length
          ? h('ul.mini-list', [...acc.rows].reverse().map((r) => h('li', h('a.grow.plain-link', { href: `#/statements/${r.invoice.id}` }, h('span.person-name', `Statement #${r.invoice.number}`), h('span.person-sub', `${formatDate(r.invoice.issueDate)} · due ${formatDate(r.invoice.dueDate)}`)), h('strong.num', money(r.total)), pill(STATUS_META[r.status].label, STATUS_META[r.status].tone))))
          : h('p.card-pad.subtle', 'No statements yet.'),
      }),
      card({
        title: 'Payments',
        flush: true,
        body: pays.length ? h('ul.mini-list', pays.map((p) => h('li', h('span.grow', h('span.person-name', formatDate(p.date)), h('span.person-sub', [PAYMENT_METHODS.find((m) => m.id === p.method)?.label || p.method, p.reference].filter(Boolean).join(' · '))), h('strong.num', money(p.amountCents))))) : h('p.card-pad.subtle', 'No payments recorded.'),
      }),
    ];
  }, ['invoices', 'payments']);
}

// ---- Documents --------------------------------------------------------------------------

function filesTab(ctx, s) {
  const store = app.store;
  const input = h('input', { type: 'file', multiple: true, hidden: true });
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    for (const f of files) {
      try {
        const att = await saveFile(f, { area: 'students', owner: s.id });
        store.patch('students', s.id, (cur) => ({ ...cur, documents: [...(cur.documents || []), att] }));
        toast(`${f.name} uploaded`);
      } catch (err) {
        toast(err.message || `${f.name} could not be uploaded`, { type: 'error' });
      }
    }
  });
  return liveTab(() => {
    const docs = store.get('students', s.id)?.documents || [];
    return [
      h('div.row', h('button.btn', { type: 'button', onClick: () => input.click() }, icon('upload', 16), 'Upload documents'), input, h('span.subtle.small', 'Enrollment forms, medical records, permission slips. Only staff can see these.')),
      docs.length
        ? h(
            'ul.file-list.mt',
            docs.map((d) =>
              h(
                'li',
                icon('file', 18),
                h('span.grow', h('span.person-name', d.name), h('span.person-sub', `${formatBytes(d.size)} · ${formatDate(d.createdAt?.slice(0, 10) || app.today())}`)),
                h('button.btn.sm.ghost', { type: 'button', onClick: () => openAttachment(d).catch(() => toast(`${d.name} could not be opened.`, { type: 'error' })) }, 'Open'),
                h(
                  'button.icon-btn',
                  {
                    type: 'button',
                    'aria-label': `Delete ${d.name}`,
                    onClick: async () => {
                      if (!(await confirmDialog({ title: `Delete ${d.name}?`, message: 'The file is removed permanently.', confirmLabel: 'Delete', danger: true }))) return;
                      store.patch('students', s.id, (cur) => ({ ...cur, documents: (cur.documents || []).filter((x) => x.id !== d.id) }));
                      deleteFile(d).catch(() => {});
                    },
                  },
                  icon('trash', 16),
                ),
              ),
            ),
          )
        : emptyState({ icon: 'file', title: 'No documents', text: 'Upload forms and records to keep them with this child.', compact: true }),
    ];
  }, ['students']);
}

// ---- Absence (families and staff) -----------------------------------------------------------

/** Report or change an absence for a day. */
export function reportAbsence(child, day = app.today(), current = null) {
  const store = app.store;
  const reasons = app.settings().absenceReasons || ['Sick', 'Other'];
  const reason = select({ options: reasons, value: current?.reason || reasons[0] });
  const note = textarea({ rows: 2, value: current?.note || '', placeholder: isFamily() ? 'Anything the teachers should know' : 'Optional' });
  const dateIn = textInput({ type: 'date', value: day, min: app.today() });
  openDialog({
    title: `${firstName(child)} will be absent`,
    size: 'narrow',
    body: h('div.stack', field('Day', dateIn), field('Reason', reason), field('Note', note)),
    footer: ({ close }) => [
      current ? h('button.btn.ghost.danger-text', { type: 'button', onClick: () => (clearAbsent(store, day, child.id), toast('Absence removed'), close()) }, 'Remove absence') : null,
      h('span.spacer'),
      h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
      h(
        'button.btn.primary',
        {
          type: 'button',
          onClick: async () => {
            const d = dateIn.value || day;
            await store.open([attendanceName(d)]);
            markAbsent(store, d, child.id, { reason: reason.value, note: note.value.trim(), by: myName() });
            toast(isFamily() ? 'Thanks, the school has been told.' : `${firstName(child)} marked absent`);
            close();
          },
        },
        isFamily() ? 'Tell the school' : 'Mark absent',
      ),
    ],
  });
}

