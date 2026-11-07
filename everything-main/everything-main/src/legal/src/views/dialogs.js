/**
 * Record dialogs opened from many places: time and expense entries, tasks,
 * calendar events, notes, communication logs, quick contacts, and the
 * conflict check. Each resolves the saved record (or null when cancelled).
 */
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, meId } from '../app.js';
import { formDialog, openDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { field, textInput, textarea, select, moneyInput, durationInput, segmented, checkbox, searchBox, emptyState, pill } from '../ui/components.js';
import { matterPicker, contactPicker, userSelect, categorySelect, matterLink, contactLink, removeWithUndo } from './common.js';
import { rateFor, activityAmount, lineFromActivity } from '../core/finance.js';
import { formatMoney } from '../core/money.js';
import { roundUpMinutes, formatHM, parseDuration } from '../core/duration.js';
import { today, nowTime, timeToMinutes, minutesToTime, formatDate } from '../core/dates.js';
import { contactName, matterLabel } from '../core/format.js';
import { PRIORITIES } from '../core/settings.js';
import { conflictSearch, matterDescriptionHits } from '../core/matters.js';
import { looksLikeEmail } from '../core/contacts-io.js';

const store = () => app.store;

// ---- Time, expense, and flat fee entries -------------------------------------------

/**
 * openActivityDialog({ kind, matterId, minutes, description, date, activity })
 * Pass `activity` to edit. Resolves the saved activity or null.
 */
export function openActivityDialog(opts = {}) {
  const existing = opts.activity || null;
  const s = app.settings();
  let kind = existing?.kind || opts.kind || 'time';
  // A bill that hasn't been issued yet (a draft, or one awaiting approval)
  // follows its entries; an issued bill never changes.
  const openBill = (b) => b?.status === 'draft' || b?.status === 'pending';
  const onBill = existing?.billId ? store().get('bills', existing.billId) : null;
  const locked = !!existing?.billId && !openBill(onBill);
  const onBillText = onBill?.status === 'pending' ? `bill #${onBill.number}, which is awaiting approval` : 'a draft bill';
  const userId = existing?.userId || opts.userId || meId() || '';

  const kindSeg = existing
    ? null
    : segmented({
        label: 'Entry type',
        value: kind,
        items: [
          { value: 'time', label: 'Time', icon: 'clock' },
          { value: 'expense', label: 'Expense', icon: 'receipt' },
          { value: 'flat', label: 'Flat fee', icon: 'dollar' },
        ],
        onChange: (v) => {
          kind = v;
          layout();
        },
      });

  const matter = matterPicker({ value: existing?.matterId || opts.matterId || '', onChange: () => updateRate() });
  const date = textInput({ name: 'date', type: 'date', value: existing?.date || opts.date || today(), required: true });
  const user = userSelect({ name: 'userId', value: userId, allowNone: false, required: true });
  user.addEventListener('change', () => updateRate());
  const desc = textarea({ name: 'description', value: existing?.description ?? opts.description ?? '', rows: 4, placeholder: 'What was done' });
  const duration = durationInput({ name: 'duration', minutes: existing?.minutes ?? opts.minutes ?? 0, placeholder: '1.0, 1:30, or 45m' });
  let rateTouched = !!existing;
  const rate = moneyInput({ name: 'rate', cents: existing?.rateCents ?? 0 });
  rate.addEventListener('input', () => (rateTouched = true));
  const qty = textInput({ name: 'qty', type: 'number', value: String(existing?.qty ?? 1), min: '0', step: 'any', cls: 'num' });
  const price = moneyInput({ name: 'price', cents: existing?.priceCents ?? 0 });
  const flatAmount = moneyInput({ name: 'amount', cents: existing?.kind === 'flat' ? existing.amountCents : 0 });
  const nonBillable = checkbox({ name: 'nonBillable', label: 'Non-billable', checked: existing ? existing.billable === false : false });
  const catWrap = h('div.field-slot');
  const total = h('output.entry-total', { 'aria-live': 'polite' });
  const rateHint = h('span');

  function updateRate() {
    if (rateTouched || kind !== 'time') return;
    const m = lookup.matter(matter.value);
    const u = lookup.user(user.value);
    const c = m?.clientId ? lookup.contact(m.clientId) : null;
    rate.cents = rateFor({ matter: m, user: u, client: c, settings: s });
    rateHint.textContent = m?.billing?.method === 'hourly' && m.billing.rateCents ? 'Matter rate' : u?.rateCents ? `${u.name}’s rate` : c?.rateCents ? 'Client rate' : 'Firm default rate';
    updateTotal();
  }

  function updateTotal() {
    const a = { kind, minutes: duration.minutes, rateCents: rate.cents, qty: Number(qty.value) || 0, priceCents: price.cents, amountCents: flatAmount.cents };
    if (kind === 'time') a.minutes = roundUpMinutes(a.minutes, s.billing.increment);
    total.textContent = `Total ${formatMoney(activityAmount(a))}${kind === 'time' && duration.minutes ? ` · ${formatHM(a.minutes)} billed` : ''}`;
  }
  for (const el of [duration, rate, qty, price, flatAmount]) el.addEventListener('input', updateTotal);
  duration.addEventListener('blur', updateTotal);

  const body = h('div.entry-form');
  function layout() {
    catWrap.replaceChildren(field('Category', categorySelect({ kind: kind === 'flat' ? 'time' : kind, value: existing?.categoryId || '' })));
    const left = [];
    const right = [field('Matter', matter, { required: kind === 'flat' }), field('Date', date, { required: true }), field('Firm user', user, { required: true })];
    if (kind === 'time') {
      left.push(field('Duration (hours)', duration, { required: true, hint: `Rounded up to ${s.billing.increment} minute increments` }), catWrap, field('Description', desc));
      right.push(field('Rate per hour', rate, { hint: rateHint }));
    } else if (kind === 'expense') {
      left.push(h('div.grid-2', field('Quantity', qty), field('Price', price, { required: true })), catWrap, field('Description', desc));
    } else {
      left.push(field('Amount', flatAmount, { required: true }), field('Description', desc));
    }
    right.push(nonBillable, total);
    mount(
      body,
      locked ? h('div.notice.info', icon('lock', 16), h('span', 'This entry is on an issued bill. Changes here will not change the bill.')) : null,
      existing?.billId && !locked ? h('div.notice.info', icon('info', 16), h('span', `This entry is on ${onBillText}. Saving updates its line on that bill.`)) : null,
      kindSeg ? h('div.entry-kind', kindSeg) : null,
      h('div.entry-grid', h('div.stack', left), h('div.stack', right)),
    );
    updateRate();
    updateTotal();
  }
  layout();

  const title = existing ? (existing.kind === 'expense' ? 'Edit expense' : existing.kind === 'flat' ? 'Edit flat fee' : 'Edit time entry') : 'New entry';
  return formDialog({
    title,
    size: 'wide',
    body,
    submitLabel: existing ? 'Save changes' : 'Save entry',
    extraButtons: existing ? [] : [{ label: 'Save and add another', value: 'again' }],
    extraFooter: existing
      ? ({ close }) =>
          h(
            'button.btn.ghost.danger-text',
            {
              type: 'button',
              onClick: async () => {
                const bill = existing.billId ? store().get('bills', existing.billId) : null;
                const onDraft = openBill(bill);
                if (
                  bill &&
                  !(await confirmDialog({
                    title: 'Delete a billed entry?',
                    message: onDraft
                      ? `This entry is on ${bill.status === 'pending' ? 'bill' : 'draft bill'} #${bill.number}${bill.status === 'pending' ? ', which is awaiting approval' : ''}. Deleting it also removes its line from that bill.`
                      : 'This entry is on an issued bill. Deleting it removes it from your activity list but the bill keeps its line.',
                    confirmLabel: 'Delete entry',
                    danger: true,
                  }))
                )
                  return;
                close();
                // The bill may have been approved and issued while the question was open.
                const now = bill ? store().get('bills', bill.id) : null;
                if (openBill(now)) {
                  const at = now.lines.findIndex((l) => l.activityId === existing.id);
                  const line = now.lines[at];
                  store().patch('bills', bill.id, (cur) => ({ ...cur, lines: cur.lines.filter((l) => l.activityId !== existing.id) }));
                  store().remove('activities', existing.id);
                  const undo = () => {
                    // Put back only this line, keeping edits made since; a bill issued
                    // meanwhile is left alone and the entry comes back unbilled.
                    const cur = store().get('bills', bill.id);
                    if (!line || !openBill(cur)) return store().restore('activities', { ...existing, billId: null });
                    store().restore('activities', existing);
                    store().patch('bills', bill.id, (b) => (b.lines.some((l) => l.activityId === existing.id) ? b : { ...b, lines: [...b.lines.slice(0, at), line, ...b.lines.slice(at)] }));
                  };
                  toast('Entry deleted', { action: { label: 'Undo', run: undo } });
                } else removeWithUndo('activities', existing, 'Entry');
              },
            },
            icon('trash', 16),
            'Delete',
          )
      : null,
    onSubmit: (fd, form) => {
      const minutes = roundUpMinutes(duration.minutes, s.billing.increment);
      if (kind === 'time' && minutes <= 0) {
        duration.setAttribute('aria-invalid', 'true');
        duration.focus();
        toast('Enter how long the work took, for example 1.5 or 1:30.', { type: 'error' });
        return false;
      }
      if (kind === 'time' && rate.cents < 0) {
        rate.setAttribute('aria-invalid', 'true');
        rate.focus();
        toast('The hourly rate cannot be negative.', { type: 'error' });
        return false;
      }
      if (kind === 'expense' && price.cents <= 0) {
        price.setAttribute('aria-invalid', 'true');
        price.focus();
        return false;
      }
      if (kind === 'expense' && !(Number(qty.value) > 0)) {
        qty.setAttribute('aria-invalid', 'true');
        qty.focus();
        return false;
      }
      if (kind === 'flat' && (flatAmount.cents <= 0 || !matter.value)) {
        (flatAmount.cents <= 0 ? flatAmount : matter.input).setAttribute('aria-invalid', 'true');
        return false;
      }
      const rec = {
        ...(existing || {}),
        kind,
        date: fd.get('date'),
        userId: fd.get('userId'),
        matterId: matter.value || null,
        categoryId: fd.get('categoryId') || null,
        description: String(fd.get('description') || '').trim(),
        billable: !fd.get('nonBillable'),
        billId: existing?.billId || null,
      };
      if (kind === 'time') Object.assign(rec, { minutes, rateCents: rate.cents });
      if (kind === 'expense') Object.assign(rec, { qty: Number(qty.value), priceCents: price.cents });
      if (kind === 'flat') rec.amountCents = flatAmount.cents;
      rec.amountCents = activityAmount(rec);
      // Keep a bill that isn't issued yet in step with its entries.
      const bill = rec.billId ? store().get('bills', rec.billId) : null;
      if (openBill(bill)) {
        const stays = rec.billable && rec.matterId === bill.matterId;
        if (!stays) rec.billId = null;
        store().patch('bills', bill.id, (cur) => ({
          ...cur,
          lines: stays ? cur.lines.map((l) => (l.activityId === rec.id ? { ...lineFromActivity(rec), id: l.id } : l)) : cur.lines.filter((l) => l.activityId !== rec.id),
        }));
      }
      const saved = store().put('activities', rec);
      toast(existing ? 'Entry updated' : `${kind === 'time' ? 'Time' : kind === 'expense' ? 'Expense' : 'Flat fee'} entry saved`);
      if (fd.get('_action') === 'again') {
        queueMicrotask(() => openActivityDialog({ kind, matterId: rec.matterId, date: rec.date }));
      }
      opts.onSaved?.(saved);
      return saved;
    },
  });
}

// ---- Tasks -------------------------------------------------------------------------------

export function openTaskDialog(opts = {}) {
  const t = opts.task || null;
  const matter = matterPicker({ value: t?.matterId || opts.matterId || '', includeClosed: false });
  return formDialog({
    title: t ? 'Edit task' : 'New task',
    body: h(
      'div.stack',
      field('Task name', textInput({ name: 'name', value: t?.name || '', autofocus: true }), { required: true }),
      field('Description', textarea({ name: 'description', value: t?.description || '', rows: 3 })),
      field('Matter', matter),
      h(
        'div.grid-2',
        field('Assignee', userSelect({ name: 'assigneeId', value: t ? t.assigneeId || '' : (opts.assigneeId ?? meId() ?? '') })),
        field('Due date', textInput({ name: 'dueDate', type: 'date', value: t?.dueDate || opts.dueDate || '' })),
        field('Priority', select({ name: 'priority', value: t?.priority || 'normal', options: PRIORITIES.map((p) => ({ value: p.id, label: p.label })) })),
      ),
    ),
    submitLabel: t ? 'Save changes' : 'Create task',
    extraFooter: t ? ({ close }) => h('button.btn.ghost.danger-text', { type: 'button', onClick: () => (close(), removeWithUndo('tasks', t, 'Task')) }, icon('trash', 16), 'Delete') : null,
    onSubmit: (fd) => {
      const rec = store().put('tasks', {
        ...(t || { done: false }),
        name: String(fd.get('name')).trim(),
        description: String(fd.get('description') || '').trim(),
        matterId: matter.value || null,
        assigneeId: fd.get('assigneeId') || null,
        dueDate: fd.get('dueDate') || '',
        priority: fd.get('priority') || 'normal',
      });
      toast(t ? 'Task updated' : 'Task created');
      return rec;
    },
  });
}

/** Mark a task done or not done, with undo. */
export function toggleTask(task) {
  const done = !task.done;
  store().patch('tasks', task.id, { done, completedAt: done ? new Date().toISOString() : null, completedBy: done ? meId() : null });
  if (done) toast(`Completed "${task.name}"`, { action: { label: 'Undo', run: () => store().patch('tasks', task.id, { done: false, completedAt: null, completedBy: null }) } });
}

// ---- Calendar events ----------------------------------------------------------------------

export const EVENT_KINDS = [
  { id: 'meeting', label: 'Meeting', tone: 'accent' },
  { id: 'court', label: 'Court date', tone: 'danger' },
  { id: 'deadline', label: 'Deadline', tone: 'warning' },
  { id: 'call', label: 'Call', tone: 'info' },
  { id: 'other', label: 'Other', tone: 'neutral' },
];

export function openEventDialog(opts = {}) {
  const e = opts.event || null;
  const date = e?.date || opts.date || today();
  const startT = e?.start || opts.start || '09:00';
  const endT = e?.end || opts.end || minutesToTime((timeToMinutes(startT) || 540) + 60);
  const allDay = checkbox({ name: 'allDay', label: 'All day', checked: e ? !!e.allDay : !!opts.allDay });
  const startI = textInput({ name: 'start', type: 'time', value: startT });
  const endI = textInput({ name: 'end', type: 'time', value: endT });
  const times = h('div.grid-2', field('Starts', startI), field('Ends', endI));
  const syncAllDay = () => (times.hidden = allDay.querySelector('input').checked);
  allDay.querySelector('input').addEventListener('change', syncAllDay);
  syncAllDay();
  // Keep the duration when the start moves.
  let lastStart = timeToMinutes(startI.value);
  startI.addEventListener('change', () => {
    const ns = timeToMinutes(startI.value);
    const ne = timeToMinutes(endI.value);
    if (ns !== null && ne !== null && lastStart !== null) endI.value = minutesToTime(Math.min(24 * 60 - 1, ne + (ns - lastStart)));
    lastStart = ns;
  });
  const matter = matterPicker({ value: e?.matterId || opts.matterId || '' });
  const chosen = new Set(e?.attendeeIds || [meId()].filter(Boolean));
  // Attendees who have since been deactivated stay listed (and on the event).
  const active = lookup.activeUsers();
  const former = [...chosen].filter((id) => !active.some((u) => u.id === id)).map((id) => lookup.user(id)).filter(Boolean);
  const attendees = [...active, ...former];
  return formDialog({
    title: e ? 'Edit event' : 'New event',
    size: 'wide',
    body: h(
      'div.stack',
      field('Title', textInput({ name: 'title', value: e?.title || '', autofocus: true }), { required: true }),
      h(
        'div.grid-2',
        field('Type', select({ name: 'kind', value: e?.kind || opts.kind || 'meeting', options: EVENT_KINDS.map((k) => ({ value: k.id, label: k.label })) })),
        field('Date', textInput({ name: 'date', type: 'date', value: date }), { required: true }),
      ),
      allDay,
      times,
      field('Matter', matter),
      field('Location', textInput({ name: 'location', value: e?.location || '', placeholder: 'Courtroom, office, or video link' })),
      h(
        'fieldset.field',
        h('legend', 'Attendees'),
        h(
          'div.check-grid',
          attendees.map((u) => checkbox({ name: `att_${u.id}`, label: u.active === false ? `${u.name} (inactive)` : u.name, checked: chosen.has(u.id) })),
        ),
      ),
      field('Description', textarea({ name: 'description', value: e?.description || '', rows: 3 })),
      field(
        'Reminder',
        select({
          name: 'reminder',
          value: String(e?.reminder ?? ''),
          options: [
            { value: '', label: 'None' },
            { value: '15', label: '15 minutes before' },
            { value: '60', label: '1 hour before' },
            { value: '1440', label: '1 day before' },
            { value: '10080', label: '1 week before' },
          ],
        }),
      ),
    ),
    submitLabel: e ? 'Save changes' : 'Create event',
    extraFooter: e ? ({ close }) => h('button.btn.ghost.danger-text', { type: 'button', onClick: () => (close(), removeWithUndo('events', e, 'Event')) }, icon('trash', 16), 'Delete') : null,
    onSubmit: (fd) => {
      const isAllDay = !!fd.get('allDay');
      const start = String(fd.get('start') || '');
      let end = String(fd.get('end') || '');
      // Ending at midnight means running to the end of the day.
      if (end === '00:00' && start > '00:00') end = '23:59';
      if (!isAllDay && end && start && end <= start) end = minutesToTime((timeToMinutes(start) || 0) + 30);
      const rec = store().put('events', {
        ...(e || {}),
        title: String(fd.get('title')).trim(),
        kind: fd.get('kind') || 'meeting',
        date: fd.get('date'),
        allDay: isAllDay,
        start: isAllDay ? '' : start,
        end: isAllDay ? '' : end,
        matterId: matter.value || null,
        location: String(fd.get('location') || '').trim(),
        description: String(fd.get('description') || '').trim(),
        attendeeIds: attendees.filter((u) => fd.get(`att_${u.id}`)).map((u) => u.id),
        reminder: fd.get('reminder') ? Number(fd.get('reminder')) : null,
      });
      toast(e ? 'Event updated' : 'Event created');
      return rec;
    },
  });
}

// ---- Notes -------------------------------------------------------------------------------------

export function openNoteDialog(opts = {}) {
  const n = opts.note || null;
  return formDialog({
    title: n ? 'Edit note' : 'New note',
    size: 'wide',
    body: h(
      'div.stack',
      h(
        'div.grid-2',
        field('Subject', textInput({ name: 'subject', value: n?.subject || '', autofocus: true })),
        field('Date', textInput({ name: 'date', type: 'date', value: n?.date || today() }), { required: true }),
      ),
      field('Note', textarea({ name: 'body', value: n?.body || '', rows: 10 }), { required: true }),
    ),
    submitLabel: n ? 'Save changes' : 'Save note',
    extraFooter: n ? ({ close }) => h('button.btn.ghost.danger-text', { type: 'button', onClick: () => (close(), removeWithUndo('notes', n, 'Note')) }, icon('trash', 16), 'Delete') : null,
    onSubmit: (fd) => {
      const rec = store().put('notes', {
        ...(n || {}),
        matterId: n?.matterId ?? opts.matterId ?? null,
        contactId: n?.contactId ?? opts.contactId ?? null,
        subject: String(fd.get('subject') || '').trim(),
        body: String(fd.get('body') || '').trim(),
        date: fd.get('date'),
        authorId: n?.authorId || meId(),
      });
      toast(n ? 'Note updated' : 'Note saved');
      return rec;
    },
  });
}

// ---- Communication logs -----------------------------------------------------------------------

export const LOG_KINDS = [
  { id: 'phone', label: 'Phone call', icon: 'phone' },
  { id: 'email', label: 'Email', icon: 'mail' },
  { id: 'meeting', label: 'Meeting', icon: 'users' },
  { id: 'message', label: 'Internal message', icon: 'message' },
];

/**
 * Log a phone call, email, meeting, or internal message. Optionally records
 * the time spent as a time entry on the matter in the same step.
 */
export function openLogDialog(opts = {}) {
  const c = opts.log || null;
  let kind = c?.kind || opts.kind || 'phone';
  const matter = matterPicker({ value: c?.matterId || opts.matterId || '' });
  const contact = contactPicker({ name: 'contactId', value: c?.contactId || opts.contactId || '', label: 'Contact' });
  const dirSel = select({
    name: 'direction',
    value: c?.direction || 'out',
    options: [
      { value: 'out', label: 'Outgoing' },
      { value: 'in', label: 'Incoming' },
    ],
  });
  const duration = durationInput({ name: 'duration', minutes: c?.minutes || 0, placeholder: '0.3' });
  const recipient = userSelect({ name: 'toUserId', value: c?.toUserId || '', noneLabel: 'Everyone on the matter' });
  const addTime = checkbox({ name: 'addTime', label: 'Also record this as a time entry', checked: false });
  const kindSeg = segmented({
    label: 'Type',
    value: kind,
    items: LOG_KINDS.map((k) => ({ value: k.id, label: k.label, icon: k.icon })),
    onChange: (v) => {
      kind = v;
      sync();
    },
  });
  const dirField = field('Direction', dirSel);
  const contactField = field('Contact', contact);
  const durField = field('Duration (hours)', duration);
  const toField = field('To', recipient);
  function sync() {
    const internal = kind === 'message';
    dirField.hidden = internal || kind === 'meeting';
    contactField.hidden = internal;
    toField.hidden = !internal;
    durField.hidden = internal;
    addTime.hidden = internal || !!c;
  }
  sync();
  return formDialog({
    title: c ? 'Edit communication' : 'Log communication',
    size: 'wide',
    body: h(
      'div.stack',
      c ? null : h('div.entry-kind', kindSeg),
      h(
        'div.grid-2',
        field('Subject', textInput({ name: 'subject', value: c?.subject || '', autofocus: true }), { required: true }),
        field('Date', textInput({ name: 'date', type: 'date', value: c?.date || today() }), { required: true }),
      ),
      h('div.grid-2', field('Matter', matter), contactField, toField, dirField, durField, field('Time', textInput({ name: 'time', type: 'time', value: c?.time || nowTime() }))),
      field('Details', textarea({ name: 'body', value: c?.body || '', rows: 6 })),
      addTime,
    ),
    submitLabel: c ? 'Save changes' : 'Save log',
    extraFooter: c ? ({ close }) => h('button.btn.ghost.danger-text', { type: 'button', onClick: () => (close(), removeWithUndo('communications', c, 'Log')) }, icon('trash', 16), 'Delete') : null,
    onSubmit: (fd) => {
      const timed = kind !== 'message';
      const typed = duration.value.trim();
      const wantsTime = timed && !c && !!fd.get('addTime');
      if (timed && ((typed && parseDuration(typed) === null) || (wantsTime && !(duration.minutes > 0)))) {
        duration.setAttribute('aria-invalid', 'true');
        duration.focus();
        toast(wantsTime && !typed ? 'Enter how long it took to record it as a time entry, for example 0.3 or 0:20.' : 'Enter the duration as 0.3, 0:20, or 20m.', { type: 'error' });
        return false;
      }
      const rec = store().put('communications', {
        ...(c || {}),
        kind,
        subject: String(fd.get('subject')).trim(),
        date: fd.get('date'),
        time: fd.get('time') || '',
        matterId: matter.value || null,
        contactId: kind === 'message' ? null : fd.get('contactId') || null,
        toUserId: kind === 'message' ? fd.get('toUserId') || null : null,
        direction: kind === 'phone' || kind === 'email' ? fd.get('direction') : null,
        minutes: kind === 'message' ? 0 : duration.minutes,
        body: String(fd.get('body') || '').trim(),
        fromUserId: c?.fromUserId || meId(),
      });
      if (wantsTime) {
        const s = app.settings();
        const m = lookup.matter(rec.matterId);
        const u = app.me();
        const minutes = roundUpMinutes(duration.minutes, s.billing.increment);
        const act = {
          kind: 'time',
          date: rec.date,
          userId: u?.id || null,
          matterId: rec.matterId,
          categoryId: kind === 'phone' ? 'ac-call' : kind === 'meeting' ? 'ac-meeting' : 'ac-corr',
          description: rec.subject,
          minutes,
          rateCents: rateFor({ matter: m, user: u, client: m?.clientId ? lookup.contact(m.clientId) : null, settings: s }),
          billable: true,
          billId: null,
        };
        act.amountCents = activityAmount(act);
        const saved = store().put('activities', act);
        store().patch('communications', rec.id, { activityId: saved.id });
        toast(`Logged and recorded ${formatHM(minutes)}`);
      } else toast(c ? 'Log updated' : 'Communication logged');
      return rec;
    },
  });
}

// ---- Contacts --------------------------------------------------------------------------------

/** Minimal contact creation from a picker. Resolves the new contact or null. */
export function quickContactDialog(query = '') {
  let type = 'person';
  const parts = String(query).trim().split(/\s+/);
  const first = textInput({ name: 'firstName', value: parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '' });
  const last = textInput({ name: 'lastName', value: parts.length > 1 ? parts[parts.length - 1] : '' });
  const company = textInput({ name: 'companyName', value: query });
  const personFields = h('div.grid-2', field('First name', first), field('Last name', last));
  const companyField = field('Company name', company);
  const sync = () => {
    personFields.hidden = type !== 'person';
    companyField.hidden = type === 'person';
  };
  sync();
  return formDialog({
    title: 'New contact',
    body: h(
      'div.stack',
      segmented({
        label: 'Contact type',
        value: type,
        items: [
          { value: 'person', label: 'Person', icon: 'user' },
          { value: 'company', label: 'Company', icon: 'building' },
        ],
        onChange: (v) => {
          type = v;
          sync();
        },
      }),
      personFields,
      companyField,
      h('div.grid-2', field('Email', textInput({ name: 'email', type: 'email' })), field('Phone', textInput({ name: 'phone', type: 'tel' }))),
    ),
    submitLabel: 'Create contact',
    onSubmit: (fd, form) => {
      const name = type === 'person' ? `${fd.get('firstName')}${fd.get('lastName')}`.trim() : String(fd.get('companyName')).trim();
      if (!name) {
        (type === 'person' ? first : company).setAttribute('aria-invalid', 'true');
        (type === 'person' ? first : company).focus();
        return false;
      }
      const email = String(fd.get('email') || '').trim();
      const phone = String(fd.get('phone') || '').trim();
      if (email && !looksLikeEmail(email)) {
        const input = form.querySelector('[name=email]');
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        toast(`"${email}" does not look like an email address.`, { type: 'error' });
        return false;
      }
      const rec = store().put('contacts', {
        type,
        firstName: type === 'person' ? String(fd.get('firstName')).trim() : '',
        lastName: type === 'person' ? String(fd.get('lastName')).trim() : '',
        companyName: type === 'company' ? String(fd.get('companyName')).trim() : '',
        emails: email ? [{ address: email, type: 'work', primary: true }] : [],
        phones: phone ? [{ number: phone, type: 'work', primary: true }] : [],
        addresses: [],
        tags: [],
      });
      toast(`${contactName(rec)} added to contacts`);
      return rec;
    },
  });
}

// ---- Conflict check -----------------------------------------------------------------------------

/**
 * Search every contact and matter for a name before taking on a client.
 * The result can be saved as a note on a matter (or on the contact the
 * check was run from), where it shows on that record's Notes tab.
 */
export function openConflictCheck(initial = '', { matterId = '', contactId = '' } = {}) {
  const results = h('div.conflict-results', { role: 'region', 'aria-live': 'polite', 'aria-label': 'Conflict check results' });
  let query = initial;
  const draw = () => {
    const q = query.trim();
    if (q.length < 2) {
      results.replaceChildren(
        emptyState({
          compact: true,
          icon: 'shield-check',
          title: 'Search for a name',
          text: 'Enter a person or company name, email, or phone number. Every contact and matter is checked.',
          headingLevel: 3,
        }),
      );
      return;
    }
    const all = { contacts: store().all('contacts'), matters: store().all('matters') };
    const hits = conflictSearch(q, all);
    const descHits = matterDescriptionHits(q, all.matters);
    if (!hits.length && !descHits.length) {
      results.replaceChildren(h('div.notice.success', icon('shield-check', 16), h('span', h('strong', 'No potential conflicts found'), ` for "${q}".`)));
      return;
    }
    mount(
      results,
      h(
        'div.notice.warning',
        icon('warning', 16),
        h('span', h('strong', `${hits.length + descHits.length} potential ${hits.length + descHits.length === 1 ? 'match' : 'matches'}`), ' Review each one before taking on the matter.'),
      ),
      hits.length
        ? h(
            'ul.list.conflict-list',
            hits.map((r) =>
              h(
                'li.conflict-item',
                h('div.row', contactLink(r.contact.id), r.score >= 100 ? pill('Exact name', 'danger') : pill('Similar', 'warning')),
                r.matters.length
                  ? h(
                      'ul.conflict-matters',
                      r.matters.map((x) => h('li', h('span.subtle', `${x.relationship} on `), matterLink(x.matter.id), x.matter.status === 'closed' ? h('span.subtle', ' (closed)') : null)),
                    )
                  : h('div.subtle', 'Not a party to any matter'),
              ),
            ),
          )
        : null,
      descHits.length
        ? h(
            'div.stack-sm',
            h('h3.small-head', 'Mentioned in matter descriptions'),
            h(
              'ul.list',
              descHits.map((m) => h('li', matterLink(m.id))),
            ),
          )
        : null,
    );
  };
  const box = searchBox({
    value: initial,
    placeholder: 'Name, company, email, or phone',
    label: 'Name to check',
    delay: 150,
    onInput: (v) => {
      query = v;
      draw();
    },
  });
  draw();
  const fileLabel = contactId ? 'Also file the saved note under a matter' : 'File the saved note under a matter';
  const fileTo = matterPicker({ name: 'fileTo', value: matterId, label: fileLabel });
  // Run before any matter exists (intake), the note can go on the prospective client instead.
  const fileContact = contactId ? null : contactPicker({ name: 'fileContact', label: 'Or a contact', placeholder: 'Find or create a contact' });
  const fileFields = contactId
    ? field(fileLabel, fileTo, { hint: 'The note is saved on this contact.' })
    : h('div.grid-2', field(fileLabel, fileTo, { hint: 'The matter this check is for.' }), field('Or a contact', fileContact, { hint: 'For example, the prospective client.' }));
  openDialog({
    title: 'Conflict check',
    subtitle: 'Find every contact and matter that could conflict with a new client or party.',
    size: 'wide',
    body: h('div.stack', box, results, fileFields),
    footer: ({ close }) => [
      h('div.spacer'),
      h(
        'button.btn',
        {
          type: 'button',
          onClick: () => {
            const q = query.trim();
            if (q.length < 2) return box.input.focus();
            // A note on neither a matter nor a contact would show nowhere.
            const onContact = contactId || fileContact?.value || '';
            if (!fileTo.value && !onContact) {
              fileTo.input.setAttribute('aria-invalid', 'true');
              fileTo.input.focus();
              toast('Choose a matter or a contact to file this conflict check under.', { type: 'error' });
              return;
            }
            const all = { contacts: store().all('contacts'), matters: store().all('matters') };
            const hits = conflictSearch(q, all);
            const descHits = matterDescriptionHits(q, all.matters);
            const lines = hits.map((r) => `- ${contactName(r.contact)}: ${r.matters.map((x) => `${x.relationship} on ${matterLabel(x.matter)}`).join('; ') || 'no matters'}`);
            if (descHits.length) lines.push('Mentioned in matter descriptions:', ...descHits.map((m) => `- ${matterLabel(m)}`));
            store().put('notes', {
              subject: `Conflict check: ${q}`,
              body: lines.length ? `Potential matches found on ${formatDate(today())}:\n${lines.join('\n')}` : `No potential conflicts found on ${formatDate(today())}.`,
              date: today(),
              authorId: meId(),
              matterId: fileTo.value || null,
              contactId: onContact || null,
              conflictCheck: true,
            });
            toast(fileTo.value ? `Conflict check saved to the notes of ${lookup.matter(fileTo.value)?.displayNumber || 'the matter'}` : `Conflict check saved to the notes of ${lookup.contactName(onContact) || 'the contact'}`);
            close();
          },
        },
        icon('save', 16),
        'Save result as a note',
      ),
      h('button.btn.primary', { type: 'button', onClick: () => close() }, 'Done'),
    ],
    initialFocus: 'input[type=search]',
  });
}
