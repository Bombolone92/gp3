/** Home: the director's and teachers' day at a glance, or a family's "Today". */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { card, stat, pill, emptyState } from '../ui/components.js';
import { app, isFamily, isManager, myStudents } from '../app.js';
import { personName, pluralize, firstName } from '../core/format.js';
import { attendanceName, indexDay, roomRatios, statusOf, currentRoom, firstIn, lastOut, nowHHMM } from '../core/attendance.js';
import { activityName, countByType, openNaps, sortActivities } from '../core/activities.js';
import { upcomingBirthdays, expiringCertifications, sortRooms, hasAllergy } from '../core/people.js';
import { allAccounts } from '../core/billing.js';
import { unreadCount } from '../core/messages.js';
import { formatTime, formatDate, addDays, relativeDay, timeToMinutes } from '../core/dates.js';
import { money, childAvatar, typeTile, roomDot, longDate, lazyImage, openLightbox, activityCard, isWeekend } from './common.js';
import { openLogActivity } from './log.js';

export function render(ctx) {
  return isFamily() ? renderFamily(ctx) : renderStaff(ctx);
}

function greeting() {
  const hr = new Date().getHours();
  return hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
}

// ---- Staff -----------------------------------------------------------------

function renderStaff(ctx) {
  const store = app.store;
  let day = app.today();
  store.open([attendanceName(day), activityName(day)]);
  // Keep "now" based numbers fresh through the day, and move to the new
  // day at midnight.
  const tick = setInterval(() => {
    if (day !== app.today()) {
      day = app.today();
      store.open([attendanceName(day), activityName(day)]);
    }
    titles.replaceChildren(...drawTitles());
    body.redraw();
  }, 60000);
  ctx.onDispose(() => clearInterval(tick));

  const body = ctx.live(() => {
    const rooms = sortRooms(store.all('rooms'));
    const att = store.all(attendanceName(day));
    const acts = store.all(activityName(day));
    const idx = indexDay(att);
    const enrolled = store.all('students').filter((s) => s.status === 'active');
    const here = enrolled.filter((s) => statusOf(idx.students.get(s.id)) === 'in');
    const absent = enrolled.filter((s) => statusOf(idx.students.get(s.id)) === 'absent');
    const staffIn = store.all('staff').filter((m) => statusOf(idx.staff.get(m.id)) === 'in');
    const ratios = roomRatios(rooms, att);
    const alerts = ratios.rows.filter((r) => !r.ok).length;
    const loaded = store.isOpen(attendanceName(day));

    return [
      h(
        'div.stats',
        stat({ label: 'Children here', value: loaded ? `${here.length}` : '...', sub: `of ${enrolled.length} enrolled`, href: '#/attendance' }),
        stat({ label: 'Absent today', value: loaded ? String(absent.length) : '...', sub: absent.length ? absent.slice(0, 2).map((s) => firstName(s)).join(', ') + (absent.length > 2 ? '...' : '') : 'Nobody reported', href: '#/attendance?filter=absent' }),
        stat({ label: 'Staff on site', value: loaded ? String(staffIn.length) : '...', sub: pluralize(store.all('staff').filter((m) => m.active !== false).length, 'staff member'), href: '#/attendance?tab=staff' }),
        stat({ label: 'Ratio alerts', value: loaded ? String(alerts) : '...', sub: alerts ? 'Rooms need more staff' : 'All rooms in ratio', tone: alerts ? 'danger' : 'success', href: '#/rooms' }),
      ),
      h(
        'div.home-grid',
        h('div.home-main', ratiosCard(ratios), activityCardToday(acts, rooms, idx, enrolled), photosCard(acts)),
        h('div.home-aside', attentionCard({ acts, idx, enrolled, day }), birthdaysCard(), eventsCard()),
      ),
    ];
  }, ['attendance', 'activities', 'students', 'rooms', 'staff', 'threads', 'invoices', 'payments', 'events']);

  // The greeting and date follow the clock too (morning to evening, and the
  // new day after midnight).
  const drawTitles = () => [h('h1', `${greeting()}`), h('div.subtitle', `${longDate(day)} · ${app.settings().school.name || 'Your school'}`)];
  const titles = h('div.titles', drawTitles());
  return h(
    'div.page',
    h(
      'header.page-header',
      titles,
      h(
        'div.actions',
        h('a.btn', { href: '#/kiosk' }, icon('tablet', 17), h('span.hide-mobile', 'Kiosk')),
        h('a.btn', { href: '#/attendance' }, icon('user-check', 17), 'Check in'),
        h('button.btn.primary', { type: 'button', onClick: () => openLogActivity() }, icon('plus', 17), 'Log activity'),
      ),
    ),
    body,
  );
}

function ratiosCard(ratios) {
  const rows = ratios.rows;
  return card({
    title: 'Room ratios',
    actions: h('span.subtle.small', `As of ${formatTime(nowHHMM())}`),
    flush: true,
    body: rows.length
      ? h(
          'div.ratio-list',
          rows.map((r) =>
            h(
              'a.ratio-row',
              { href: `#/rooms/${r.room.id}` },
              h('span.ratio-name', roomDot(r.room), r.room.ageRange ? h('span.subtle.small', r.room.ageRange) : null),
              h('span.ratio-num', h('strong', String(r.students)), h('span.subtle', r.room.capacity ? ` / ${r.room.capacity}` : ''), h('span.ratio-cap', ' children')),
              h('span.ratio-num', h('strong', String(r.staff)), h('span.ratio-cap', ' staff')),
              h(
                'span.ratio-state',
                r.room.ratio ? h('span.subtle.small.hide-mobile', `1:${r.room.ratio} required`) : null,
                r.ok ? pill(r.students ? `1:${r.label} now` : 'Empty', r.students ? 'success' : 'plain') : pill(r.staff ? `Needs ${r.needed - r.staff} more staff` : 'No staff in room', 'danger'),
              ),
            ),
          ),
        )
      : emptyState({ icon: 'door-open', title: 'No rooms yet', text: 'Add your classrooms to track who is where.', compact: true, actions: [h('a.btn.primary', { href: '#/rooms' }, 'Add a room')] }),
  });
}

function activityCardToday(acts, rooms, idx, enrolled) {
  const counts = countByType(acts);
  const byRoom = rooms.map((r) => {
    const kids = enrolled.filter((s) => (currentRoom(idx.students.get(s.id)) || s.roomId) === r.id && statusOf(idx.students.get(s.id)) !== 'absent' && statusOf(idx.students.get(s.id)) !== 'none');
    const ids = new Set(kids.map((k) => k.id));
    const mine = acts.filter((a) => ids.has(a.studentId));
    const logged = new Set(mine.map((a) => a.studentId));
    return { room: r, total: mine.length, missing: kids.filter((k) => !logged.has(k.id)) };
  });
  return card({
    title: "Today's activities",
    actions: h('a.btn.sm.ghost', { href: '#/activities' }, 'Open log', icon('arrow-right', 15)),
    body: acts.length
      ? h(
          'div',
          h('div.type-counts', h('span.big-num', String(acts.length)), h('span.subtle', 'entries'), counts.map((c) => h('span.type-count', typeTile(c.type.id, 'sm'), `${c.count} ${c.type.short || c.type.label}`))),
          h(
            'ul.room-activity',
            byRoom.map((r) =>
              h(
                'li',
                h('a', { href: `#/activities?room=${r.room.id}` }, roomDot(r.room)),
                h('span.subtle', pluralize(r.total, 'entry', 'entries')),
                h('span.spacer'),
                r.missing.length ? h('span.hint-warn', icon('alert', 14), `${r.missing.length} without entries`) : r.total ? h('span.hint-ok', icon('circle-check', 14), 'Everyone logged') : null,
              ),
            ),
          ),
        )
      : emptyState({ icon: 'notebook-pen', title: 'Nothing logged yet today', text: 'Log meals, naps, diapers, and photos for one child or a whole room at once.', compact: true, actions: [h('button.btn.primary', { type: 'button', onClick: () => openLogActivity() }, 'Log an activity')] }),
  });
}

function photosCard(acts) {
  const seen = new Set();
  const photos = [];
  for (const a of sortActivities(acts)) {
    for (const m of a.media || []) {
      if (seen.has(m.path)) continue;
      seen.add(m.path);
      photos.push({ m, a });
    }
  }
  if (!photos.length) return null;
  const list = photos.slice(0, 8);
  return card({
    title: "Today's photos",
    count: photos.length,
    body: h(
      'div.photo-strip',
      list.map(({ m, a }, i) =>
        h('button.media-item', { type: 'button', 'aria-label': `Open photo: ${a.note || 'photo'}`, onClick: () => openLightbox(list.map((x) => x.m), i, { ref: `activities:${a.day}`, id: a.id }) }, lazyImage(m, { ref: `activities:${a.day}`, id: a.id })),
      ),
    ),
  });
}

function attentionCard({ acts, idx, enrolled, day }) {
  const store = app.store;
  const items = [];
  const now = nowHHMM();
  const close = app.settings().hours?.close || '18:00';
  const sleeping = openNaps(acts);
  if (sleeping.length) items.push({ icon: 'moon', tone: 'info', text: `${pluralize(sleeping.length, 'child', 'children')} still napping`, sub: sleeping.slice(0, 3).map((a) => firstName(store.get('students', a.studentId))).join(', '), href: '#/activities' });
  if (timeToMinutes(now) > timeToMinutes(close)) {
    const late = enrolled.filter((s) => statusOf(idx.students.get(s.id)) === 'in');
    if (late.length) items.push({ icon: 'clock', tone: 'warning', text: `${pluralize(late.length, 'child', 'children')} not checked out after closing`, href: '#/attendance' });
  }
  if (!isWeekend(day) && timeToMinutes(now) > 9 * 60 + 30) {
    const notHere = enrolled.filter((s) => statusOf(idx.students.get(s.id)) === 'none' && (s.schedule || [1, 2, 3, 4, 5]).includes(new Date().getDay()));
    if (notHere.length) items.push({ icon: 'user-x', tone: 'neutral', text: `${pluralize(notHere.length, 'child has', 'children have')} not arrived`, sub: notHere.slice(0, 3).map((s) => firstName(s)).join(', ') + (notHere.length > 3 ? '...' : ''), href: '#/attendance?filter=none' });
  }
  const allergic = enrolled.filter((s) => hasAllergy(s) && statusOf(idx.students.get(s.id)) === 'in');
  if (allergic.length) items.push({ icon: 'warning', tone: 'warning', text: `${pluralize(allergic.length, 'child', 'children')} here with allergies`, sub: allergic.slice(0, 3).map((s) => `${firstName(s)} (${s.allergies})`).join(', '), href: '#/reports?r=allergies' });
  const unread = unreadCount(store.all('threads'), { role: 'staff' });
  if (unread) items.push({ icon: 'messages', tone: 'accent', text: `${pluralize(unread, 'unread message')}`, href: '#/messages' });
  const certs = expiringCertifications(store.all('staff'), 30, day);
  if (certs.length) items.push({ icon: 'shield', tone: certs.some((c) => c.left < 0) ? 'danger' : 'warning', text: `${pluralize(certs.length, 'certification')} expiring`, sub: certs.slice(0, 2).map((c) => `${firstName(c.member)}: ${c.cert.name}`).join(', '), href: '#/staff' });
  if (isManager()) {
    const accounts = allAccounts(store.all('invoices'), store.all('payments'), day);
    let overdue = 0;
    let n = 0;
    for (const acc of accounts.values()) if (acc.overdue > 0) (overdue += acc.overdue), n++;
    if (n) items.push({ icon: 'wallet', tone: 'danger', text: `${money(overdue)} overdue`, sub: `${pluralize(n, 'family', 'families')}`, href: '#/billing/balances' });
  }
  return card({
    title: 'Needs attention',
    flush: true,
    body: items.length
      ? h(
          'ul.attention',
          items.map((it) => h('li', h('a', { href: it.href }, h(`span.att-icon.tone-${it.tone}`, icon(it.icon, 16)), h('span.grow', h('span.att-text', it.text), it.sub ? h('span.att-sub', it.sub) : null), icon('chevron-right', 16)))),
        )
      : h('p.card-pad.subtle', 'All caught up. Nothing needs your attention right now.'),
  });
}

function birthdaysCard() {
  const list = upcomingBirthdays(app.store.all('students'), 30, app.today());
  return card({
    title: 'Upcoming birthdays',
    flush: true,
    body: list.length
      ? h(
          'ul.mini-list',
          list.slice(0, 5).map((b) => h('li', h('a.person-link', { href: `#/children/${b.student.id}` }, childAvatar(b.student, { size: 'sm' }), h('span.person-text', h('span.person-name', personName(b.student)), h('span.person-sub', `Turns ${b.turning}`))), h('span.subtle.small', b.inDays === 0 ? h('strong', 'Today') : relativeDay(b.date, app.today())))),
        )
      : h('p.card-pad.subtle', 'No birthdays in the next 30 days.'),
  });
}

function eventsCard() {
  const today = app.today();
  const end = addDays(today, 21);
  const events = app.store
    .all('events')
    .filter((e) => (e.endDate || e.date) >= today && e.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.start || '').localeCompare(String(b.start || '')))
    .slice(0, 5);
  return card({
    title: 'Coming up',
    actions: h('a.btn.sm.ghost', { href: '#/calendar' }, 'Calendar'),
    flush: true,
    body: events.length
      ? h(
          'ul.mini-list',
          events.map((e) =>
            h(
              'li',
              h('span.date-chip', { 'aria-hidden': 'true' }, h('span', formatDate(e.date, { month: 'short' })), h('strong', formatDate(e.date, { day: 'numeric' }))),
              h('span.grow', h('span.person-name', e.title), h('span.person-sub', [relativeDay(e.date, today), e.allDay === false && e.start ? formatTime(e.start) : ''].filter(Boolean).join(' · '))),
              e.kind === 'closure' ? pill('Closed', 'warning') : null,
            ),
          ),
        )
      : h('p.card-pad.subtle', 'Nothing on the calendar for the next three weeks.'),
  });
}

// ---- Family ------------------------------------------------------------------

function renderFamily(ctx) {
  const store = app.store;
  let day = ctx.query.date || app.today();
  let childId = ctx.query.child || null;
  const load = () => store.open([attendanceName(day), activityName(day)]);
  load();

  const body = ctx.live(() => {
    const kids = myStudents().filter((s) => s.status === 'active' || s.status === 'waitlist');
    if (!kids.length) return emptyState({ icon: 'baby', title: 'No children linked yet', text: 'Your school has not linked a child to your account yet. Ask them to check your family details.' });
    const child = kids.find((k) => k.id === childId) || kids[0];
    childId = child.id;
    const rec = indexDay(store.all(attendanceName(day))).students.get(child.id);
    const acts = sortActivities(store.all(activityName(day)).filter((a) => a.studentId === child.id && !a.staffOnly));
    return [
      kids.length > 1
        ? h(
            'div.child-switch',
            { role: 'group', 'aria-label': 'Child' },
            kids.map((k) => h('button', { type: 'button', 'aria-pressed': String(k.id === child.id), dataset: { key: `child-${k.id}` }, onClick: () => ((childId = k.id), body.redraw()) }, childAvatar(k, { size: 'sm' }), firstName(k))),
          )
        : null,
      statusHero(child, rec, day),
      h(
        'div.home-grid',
        h(
          'div.home-main',
          h(
            'div.feed-day-head',
            h('h2', day === app.today() ? 'Today' : formatDate(day, { weekday: 'long', month: 'long', day: 'numeric' })),
            h(
              'div.row',
              h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'Previous day', onClick: () => ((day = addDays(day, -1)), load(), body.redraw()) }, icon('chevron-left')),
              h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'Next day', disabled: day >= app.today() || null, onClick: () => ((day = addDays(day, 1)), load(), body.redraw()) }, icon('chevron-right')),
              h('a.btn.sm', { href: `#/children/${child.id}?tab=report&date=${day}` }, icon('file', 15), 'Daily report'),
            ),
          ),
          store.isOpen(activityName(day))
            ? acts.length
              ? h('div.feed', acts.map((a) => activityCard(a, { showChild: false })))
              : emptyState({ icon: 'sun', title: day === app.today() ? 'Nothing shared yet today' : 'Nothing shared this day', text: day === app.today() ? 'Meals, naps, photos, and notes appear here as teachers log them.' : 'Teachers did not share any updates on this day.', compact: true })
            : h('div.skeleton-feed', h('div.skeleton'), h('div.skeleton'), h('div.skeleton')),
        ),
        h('div.home-aside', familyBalanceCard(kids), announcementsCard(child), eventsCard()),
      ),
    ];
  }, ['students', 'attendance', 'activities', 'invoices', 'payments', 'announcements', 'events']);

  return h('div.page', h('header.page-header', h('div.titles', h('h1', `${greeting()}`), h('div.subtitle', `${longDate(app.today())} · ${app.settings().school.name || ''}`))), body);
}

function statusHero(child, rec, day) {
  const state = statusOf(rec);
  const room = app.store.get('rooms', currentRoom(rec) || child.roomId);
  const isToday = day === app.today();
  let title;
  let sub;
  let tone;
  if (state === 'in') {
    title = `${firstName(child)} is at school`;
    sub = `Checked in at ${formatTime(firstIn(rec))}${room ? ` · ${room.name}` : ''}`;
    tone = 'success';
  } else if (state === 'out') {
    title = `${firstName(child)} went home`;
    sub = `Here ${formatTime(firstIn(rec))} to ${formatTime(lastOut(rec))}`;
    tone = 'neutral';
  } else if (state === 'absent') {
    title = `${firstName(child)} is marked absent`;
    sub = [rec.absent.reason, rec.absent.note].filter(Boolean).join(': ') || 'Absent';
    tone = 'warning';
  } else {
    title = isToday ? `${firstName(child)} has not arrived yet` : `${firstName(child)} did not attend`;
    sub = room ? room.name : '';
    tone = 'plain';
  }
  const canReport = isToday && state === 'none' && app.settings().access?.parentsCanReportAbsence !== false;
  return h(
    `section.status-hero.tone-${tone}`,
    { 'aria-label': 'Attendance today' },
    childAvatar(child, { size: 'lg' }),
    h('div.grow', h('h2', title), h('p', sub)),
    canReport ? h('button.btn', { type: 'button', onClick: () => import('./child.js').then((m) => m.reportAbsence(child, day)) }, icon('calendar-x', 16), 'Report absence') : null,
    state === 'absent' && rec.absent?.byFamily && isToday ? h('button.btn.ghost', { type: 'button', onClick: () => import('./child.js').then((m) => m.reportAbsence(child, day, rec.absent)) }, 'Change') : null,
  );
}

function familyBalanceCard(kids) {
  const accounts = allAccounts(app.store.all('invoices'), app.store.all('payments'), app.today());
  let balance = 0;
  let overdue = 0;
  for (const k of kids) {
    const a = accounts.get(k.id);
    if (a) {
      balance += a.balance;
      overdue += a.overdue;
    }
  }
  return card({
    title: 'Tuition',
    actions: h('a.btn.sm.ghost', { href: '#/billing' }, 'Statements'),
    body: h(
      'div.balance-mini',
      h('span.subtle', balance < 0 ? 'Credit on account' : 'Balance'),
      h('strong.big-num', money(Math.abs(balance))),
      overdue > 0 ? pill(`${money(overdue)} overdue`, 'danger') : balance > 0 ? pill('Due soon', 'info') : pill('All paid', 'success'),
    ),
  });
}

function announcementsCard(child) {
  const list = app.store
    .all('announcements')
    .filter((a) => !a.roomIds?.length || a.roomIds.includes(child.roomId))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.at).localeCompare(String(a.at)))
    .slice(0, 3);
  if (!list.length) return null;
  return card({
    title: 'From the school',
    flush: true,
    body: h(
      'ul.announce-mini',
      list.map((a) => h('li', h('a', { href: `#/messages?tab=announcements&id=${a.id}` }, h('span.person-name', a.pinned ? [icon('pin', 13), ' '] : null, a.title), h('span.person-sub', a.body.slice(0, 110) + (a.body.length > 110 ? '...' : ''))))),
    ),
  });
}
