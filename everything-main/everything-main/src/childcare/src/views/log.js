/**
 * Logging an activity: choose the kind, choose the children (one or a whole
 * room), fill in the few fields that kind needs, optionally attach photos.
 * The same dialog edits a single existing entry.
 */
import { h, uniqueId } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { field, textInput, textarea, select, segmented } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { app, myName } from '../app.js';
import { ACTIVITY_TYPES, TYPE, MEAL_AMOUNTS, BOTTLE_CONTENTS, MOODS, KUDOS, DOMAINS, MILESTONE_LEVELS, logActivity, updateActivity, deleteActivity, activityName } from '../core/activities.js';
import { attendanceName, indexDay, statusOf, nowHHMM } from '../core/attendance.js';
import { personName } from '../core/format.js';
import { sortByName, sortRooms } from '../core/people.js';
import { startOfWeek, weekday } from '../core/dates.js';
import { saveFile, isImage, deleteFile } from '../files.js';
import { childAvatar, typeTile } from './common.js';

/** Today's menu item for a meal, if the menu has one. */
function menuItemFor(day, meal) {
  const week = app.store.get('menus', startOfWeek(day, 1));
  const key = { Breakfast: 'breakfast', 'AM snack': 'amSnack', Lunch: 'lunch', 'PM snack': 'pmSnack', Dinner: 'dinner' }[meal];
  return (key && week?.days?.[weekday(day)]?.[key]) || '';
}

function defaultMeal(at) {
  const m = Number(at.slice(0, 2));
  if (m < 9) return 'Breakfast';
  if (m < 11) return 'AM snack';
  if (m < 14) return 'Lunch';
  if (m < 17) return 'PM snack';
  return 'Dinner';
}

/**
 * openLogActivity({ type, studentIds, roomId, day, edit })
 * Resolves the saved records (or null when cancelled).
 */
export function openLogActivity({ type = null, studentIds = [], roomId = null, day = app.today(), edit = null } = {}) {
  if (edit) return openForm({ type: edit.type, studentIds: [edit.studentId], day: edit.day, edit });
  if (type) return openForm({ type, studentIds, roomId, day });
  return new Promise((resolve) => {
    let chosen = null;
    openDialog({
      title: 'Log an activity',
      size: 'narrow',
      body: ({ close }) =>
        h(
          'div.type-grid',
          { role: 'list' },
          ACTIVITY_TYPES.map((t) =>
            h(
              'div',
              { role: 'listitem' },
              h(
                'button.type-choice',
                {
                  type: 'button',
                  onClick: () => {
                    chosen = t.id;
                    close();
                  },
                },
                typeTile(t.id, 'lg'),
                h('span', t.short || t.label),
              ),
            ),
          ),
        ),
      onClose: () => resolve(chosen ? openForm({ type: chosen, studentIds, roomId, day }) : null),
    });
  });
}

function openForm({ type, studentIds, roomId, day, edit = null }) {
  const store = app.store;
  const t = TYPE[type];
  const settings = app.settings();
  let selected = [...studentIds];
  const d = structuredClone(edit?.details || {});
  let files = []; // new File objects
  let keepMedia = [...(edit?.media || [])];
  const at = edit?.at || nowHHMM();

  return new Promise((resolve) => {
    let saved = null;
    let closed = false;
    const formId = uniqueId('log');
    const kids = h('div.kid-chips');
    const timeInput = textInput({ type: 'time', value: at, name: 'at', required: true });
    const dayInput = textInput({ type: 'date', value: day, name: 'day', max: app.today(), required: true });
    const note = textarea({ name: 'note', value: edit?.note || '', rows: type === 'note' || type === 'incident' ? 4 : 2, placeholder: type === 'photo' ? 'Add a caption' : type === 'note' ? 'What happened today?' : 'Add a note (optional)' });
    const staffOnly = h('input', { type: 'checkbox', name: 'staffOnly', checked: edit ? !!edit.staffOnly : type !== 'incident' && type !== 'meds' && !!settings.access?.staffOnlyByDefault });
    const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    const previews = h('div.upload-previews');
    const submitBtn = h('button.btn.primary', { type: 'submit', form: formId });
    const status = h('span.sr-only', { role: 'status', 'aria-live': 'polite' });

    function drawKids() {
      kids.replaceChildren(
        ...selected.map((id) => {
          const s = store.get('students', id);
          if (!s) return null;
          return h(
            'span.kid-chip',
            childAvatar(s, { size: 'xs' }),
            h('span', personName(s)),
            edit ? null : h('button.icon-btn.xs', { type: 'button', 'aria-label': `Remove ${personName(s)}`, onClick: () => ((selected = selected.filter((x) => x !== id)), drawKids()) }, icon('x', 13)),
          );
        }),
        edit ? null : h('button.btn.sm', { type: 'button', onClick: () => pickChildren({ selected, roomId, day: dayInput.value }).then((ids) => ids && ((selected = ids), drawKids())) }, icon(selected.length ? 'pencil' : 'plus', 15), selected.length ? 'Change' : 'Choose children'),
      );
      submitBtn.textContent = edit ? 'Save changes' : selected.length > 1 ? `Log for ${selected.length} children` : 'Log activity';
    }

    function drawPreviews() {
      previews.replaceChildren(
        ...keepMedia.map((m) => h('span.upload-thumb', h('span.upload-name', m.name || 'Photo'), h('button.icon-btn.xs', { type: 'button', 'aria-label': `Remove ${m.name || 'photo'}`, onClick: () => ((keepMedia = keepMedia.filter((x) => x !== m)), drawPreviews()) }, icon('x', 13)))),
        ...files.map((f) => {
          const url = URL.createObjectURL(f);
          return h('span.upload-thumb', h('img', { src: url, alt: '', onLoad: () => URL.revokeObjectURL(url) }), h('button.icon-btn.xs', { type: 'button', 'aria-label': `Remove ${f.name}`, onClick: () => ((files = files.filter((x) => x !== f)), drawPreviews()) }, icon('x', 13)));
        }),
      );
    }
    fileInput.addEventListener('change', () => {
      const picked = [...fileInput.files].filter((f) => isImage(f.type) || /^image\//.test(f.type));
      files = [...files, ...picked].slice(0, 12);
      fileInput.value = '';
      drawPreviews();
      status.textContent = `${files.length} photo${files.length === 1 ? '' : 's'} attached`;
    });

    const fields = typeFields(type, d, { day, at });

    const form = h(
      'form.log-form',
      { id: formId, novalidate: true },
      h('div.field', h('span.field-label', 'Children'), kids),
      fields,
      field(type === 'photo' ? 'Caption' : 'Note', note),
      h(
        'div.attach-row',
        h('button.btn.sm', { type: 'button', onClick: () => fileInput.click() }, icon('camera', 16), type === 'photo' ? 'Add photos' : 'Attach photo'),
        fileInput,
        previews,
      ),
      h('div.form-grid', field('Date', dayInput), field('Time', timeInput)),
      h('label.check', staffOnly, h('span', 'Staff only', h('span.hint.block', 'Families will not see this entry'))),
      status,
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!selected.length) {
        toast('Choose at least one child.', { type: 'error' });
        return;
      }
      if (!timeInput.value) {
        toast('Enter the time.', { type: 'error' });
        timeInput.focus();
        return;
      }
      if (dayInput.value > app.today()) {
        toast('The date cannot be in the future.', { type: 'error' });
        dayInput.focus();
        return;
      }
      if (type === 'photo' && !files.length && !keepMedia.length) {
        toast('Add at least one photo.', { type: 'error' });
        return;
      }
      const details = fields.collect ? fields.collect() : {};
      if (details === false) return;
      // The medication was given at the entry's time, as edited in the form.
      if (type === 'meds' && timeInput.value) details.time = timeInput.value;
      submitBtn.disabled = true;
      const day2 = dayInput.value || day;
      try {
        let media = keepMedia;
        if (files.length) {
          submitBtn.textContent = 'Uploading photos';
          const uploaded = [];
          for (const f of files) uploaded.push(await saveFile(f, { area: 'media', owner: day2.slice(0, 7) }));
          // Cancelled while the photos were uploading: nothing is saved.
          if (closed) {
            for (const m of uploaded) deleteFile(m).catch(() => {});
            return;
          }
          media = [...keepMedia, ...uploaded];
        }
        if (edit) {
          // Photos shared with other children's entries stay until no entry uses them.
          const used = (m) => store.all(activityName(edit.day)).some((a) => a.id !== edit.id && a.media?.some((x) => x.path === m.path));
          for (const m of edit.media || []) if (!media.includes(m) && !app.demo && !used(m)) deleteFile(m).catch(() => {});
          if (day2 !== edit.day) {
            deleteActivity(store, edit);
            saved = logActivity(store, { type, day: day2, at: timeInput.value, studentIds: [edit.studentId], roomOf: () => edit.roomId, details, note: note.value, media, staffOnly: staffOnly.checked, by: edit.by, byId: edit.byId });
          } else saved = [updateActivity(store, edit, { at: timeInput.value, details, note: note.value.trim(), media: media.length ? media : undefined, staffOnly: staffOnly.checked || undefined })];
          toast('Entry updated');
        } else {
          const roomIdx = indexDay(store.all(attendanceName(day2))).students;
          const roomOf = (sid) => roomIdx.get(sid)?.roomId || store.get('students', sid)?.roomId;
          saved = logActivity(store, { type, day: day2, at: timeInput.value, studentIds: selected, roomOf, details, note: note.value, media, staffOnly: staffOnly.checked, by: myName(), byId: app.me.staffId || app.user?.uuid || '' });
          toast(selected.length > 1 ? `${t.label} logged for ${selected.length} children` : `${t.label} logged for ${personName(store.get('students', selected[0]))}`);
        }
        api.close();
      } catch (err) {
        console.error(err);
        toast(err.message || 'Could not save this entry.', { type: 'error' });
        submitBtn.disabled = false;
        drawKids();
      }
    });

    drawKids();
    drawPreviews();
    const api = openDialog({
      title: h('span.row', { style: { gap: '10px' } }, typeTile(type, 'sm'), edit ? `Edit ${t.label.toLowerCase()}` : t.label),
      body: form,
      footer: ({ close }) => [
        edit
          ? h(
              'button.btn.ghost.danger-text',
              {
                type: 'button',
                onClick: async () => {
                  const ok = await confirmDialog({ title: 'Delete this entry?', message: 'It is removed from the child\'s feed and daily report.', confirmLabel: 'Delete', danger: true });
                  if (!ok) return;
                  deleteActivity(store, edit);
                  for (const m of edit.media || []) if (!app.demo && !store.all(activityName(edit.day)).some((a) => a.media?.some((x) => x.path === m.path))) deleteFile(m).catch(() => {});
                  toast('Entry deleted');
                  close();
                },
              },
              icon('trash', 16),
              'Delete',
            )
          : null,
        h('span.spacer'),
        h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
        submitBtn,
      ],
      onClose: () => {
        closed = true;
        resolve(saved);
      },
      initialFocus: selected.length ? '.type-fields button, .type-fields input, .type-fields select, .log-form textarea' : '.kid-chips button',
    });
  });
}

/** The fields one activity type needs. Returns a node with .collect(). */
function typeFields(type, d, { day, at }) {
  const settings = app.settings();
  const wrap = h('div.type-fields');
  const seg = (label, items, value, onChange) => h('div.field', h('span.field-label', label), segmented({ label, items, value, onChange }));
  const check = (label, key) => {
    const c = h('input', { type: 'checkbox', checked: !!d[key], onChange: () => (d[key] = c.checked || undefined) });
    return h('label.check.inline', c, h('span', label));
  };
  const text = (label, key, opts = {}) => {
    const i = textInput({ value: d[key] || '', ...opts });
    i.addEventListener('input', () => (d[key] = i.value.trim()));
    return field(label, i);
  };
  const choiceChips = (label, items, key) => {
    // Updated in place, so the chip that was pressed keeps focus.
    const buttons = items.map((it) => {
      const v = typeof it === 'string' ? it : it.id;
      const l = typeof it === 'string' ? it : it.label;
      const b = h('button.chip', { type: 'button', role: 'radio', onClick: () => ((d[key] = d[key] === v ? undefined : v), draw()) }, l);
      b.value = v;
      return b;
    });
    const group = h('div.choice-chips', { role: 'radiogroup', 'aria-label': label }, buttons);
    const draw = () => {
      for (const b of buttons) b.setAttribute('aria-checked', String(d[key] === b.value));
    };
    draw();
    return h('div.field', h('span.field-label', label), group);
  };

  switch (type) {
    case 'meal': {
      d.kind ||= 'food';
      const inner = h('div');
      const drawMeal = () => {
        if (d.kind === 'bottle') {
          const amount = textInput({ type: 'number', min: '0', step: '0.5', value: d.amount || '', inputmode: 'decimal' });
          amount.addEventListener('input', () => (d.amount = amount.value));
          const unit = select({ options: [{ value: 'oz', label: 'oz' }, { value: 'ml', label: 'ml' }], value: d.unit || 'oz' });
          unit.addEventListener('change', () => (d.unit = unit.value));
          d.unit ||= 'oz';
          inner.replaceChildren(h('div.form-grid', field('Amount', h('div.row', amount, unit)), field('Contents', (() => {
            const s = select({ options: [{ value: '', label: 'Choose' }, ...BOTTLE_CONTENTS], value: d.contents || '' });
            s.addEventListener('change', () => (d.contents = s.value));
            return s;
          })())));
        } else {
          d.meal ||= defaultMeal(at);
          const items = textInput({ value: d.items ?? menuItemFor(day, d.meal), placeholder: 'What was served' });
          if (d.items === undefined && items.value) d.items = items.value;
          items.addEventListener('input', () => (d.items = items.value.trim()));
          const meal = select({ options: settings.mealTypes, value: d.meal });
          meal.addEventListener('change', () => {
            d.meal = meal.value;
            const m = menuItemFor(day, d.meal);
            if (m) items.value = d.items = m;
          });
          inner.replaceChildren(
            h('div.form-grid', field('Meal', meal), field('Food', items)),
            seg('How much', MEAL_AMOUNTS.map((a) => ({ value: a.id, label: a.label })), d.amount || '', (v) => (d.amount = v)),
          );
        }
      };
      // Food and bottle amounts mean different things ("most" vs 4 oz), so
      // switching kind starts the amount over.
      const setKind = (v) => {
        if (v !== d.kind) for (const k of ['amount', 'unit', 'contents']) delete d[k];
        d.kind = v;
        drawMeal();
      };
      wrap.append(seg('Type', [{ value: 'food', label: 'Food' }, { value: 'bottle', label: 'Bottle' }], d.kind, setKind), inner);
      drawMeal();
      break;
    }
    case 'nap': {
      d.start ||= at;
      const start = textInput({ type: 'time', value: d.start });
      const end = textInput({ type: 'time', value: d.end || '' });
      start.addEventListener('input', () => (d.start = start.value));
      end.addEventListener('input', () => (d.end = end.value));
      wrap.append(h('div.form-grid', field('Fell asleep', start), field('Woke up', end, { hint: 'Leave empty while still sleeping' })));
      wrap.collect = () => {
        if (d.end && d.start && d.end < d.start) {
          toast('Wake time is before the start of the nap.', { type: 'error' });
          return false;
        }
        return d;
      };
      break;
    }
    case 'toilet': {
      d.kind ||= 'diaper';
      wrap.append(
        seg('Type', [{ value: 'diaper', label: 'Diaper' }, { value: 'potty', label: 'Potty' }, { value: 'accident', label: 'Accident' }], d.kind, (v) => (d.kind = v)),
        h('div.check-row', check('Wet', 'wet'), check('BM', 'bm'), check('Dry', 'dry'), check('Cream applied', 'cream')),
      );
      break;
    }
    case 'mood':
      wrap.append(choiceChips('Mood', MOODS, 'mood'));
      break;
    case 'kudos':
      wrap.append(choiceChips('For', KUDOS, 'category'));
      break;
    case 'observation': {
      const domain = select({ options: [{ value: '', label: 'Choose an area' }, ...DOMAINS], value: d.domain || '' });
      domain.addEventListener('change', () => (d.domain = domain.value));
      wrap.append(h('div.form-grid', field('Learning area', domain), text('Skill or milestone', 'skill', { placeholder: 'Counts objects up to 10' })), seg('Progress', MILESTONE_LEVELS.map((l) => ({ value: l.id, label: l.label })), d.level || '', (v) => (d.level = v)));
      break;
    }
    case 'meds':
      d.time ||= at;
      wrap.append(h('div.form-grid', text('Medication', 'medication', { placeholder: 'Name', required: true }), text('Dose', 'dose', { placeholder: '5 ml' })));
      wrap.collect = () => {
        if (!d.medication) {
          toast('Enter the medication name.', { type: 'error' });
          return false;
        }
        return d;
      };
      break;
    case 'health': {
      d.result ||= 'ok';
      const temp = textInput({ type: 'number', step: '0.1', value: d.temperature || '', inputmode: 'decimal', placeholder: '98.6' });
      temp.addEventListener('input', () => (d.temperature = temp.value));
      const unit = select({ options: [{ value: 'F', label: 'F' }, { value: 'C', label: 'C' }], value: d.tempUnit || 'F' });
      unit.addEventListener('change', () => (d.tempUnit = unit.value));
      wrap.append(
        seg('Result', [{ value: 'ok', label: 'Healthy' }, { value: 'concern', label: 'Needs attention' }], d.result, (v) => (d.result = v)),
        h('div.form-grid', field('Temperature', h('div.row', temp, unit)), text('Symptoms', 'symptoms', { placeholder: 'None' })),
      );
      break;
    }
    case 'incident': {
      const kind = select({ options: [{ value: '', label: 'Choose' }, ...settings.incidentTypes], value: d.kind || '' });
      kind.addEventListener('change', () => (d.kind = kind.value));
      const action = textarea({ value: d.action || '', rows: 2, placeholder: 'First aid given, comfort, follow-up' });
      action.addEventListener('input', () => (d.action = action.value.trim()));
      wrap.append(
        h('div.form-grid', field('What happened', kind), text('Where', 'location', { placeholder: 'Playground' })),
        field('Action taken', action),
        text('Family notified', 'notified', { placeholder: 'Phone call at pickup' }),
      );
      wrap.collect = () => {
        if (!d.kind) {
          toast('Choose what happened.', { type: 'error' });
          return false;
        }
        return d;
      };
      break;
    }
    default:
      break;
  }
  if (!wrap.collect) wrap.collect = () => d;
  return wrap;
}

/**
 * Choose children, grouped by room. Defaults to children checked in today;
 * "Everyone" shows the whole roster. Resolves the ids, or null.
 */
export function pickChildren({ selected = [], roomId = null, day = app.today(), title = 'Choose children', onlyIn = true } = {}) {
  const store = app.store;
  const picked = new Set(selected);
  let scope = onlyIn ? 'in' : 'all';
  let room = roomId || 'all';
  return new Promise((resolve) => {
    let result = null;
    const list = h('div.pick-list');
    const count = h('span.subtle');
    const draw = () => {
      const idx = indexDay(store.all(attendanceName(day))).students;
      const students = sortByName(store.all('students').filter((s) => s.status === 'active'));
      const rooms = sortRooms(store.all('rooms'));
      const roomOf = (s) => idx.get(s.id)?.roomId || s.roomId;
      const shown = (s) => scope === 'all' || statusOf(idx.get(s.id)) === 'in';
      const groups = (room === 'all' ? rooms : rooms.filter((r) => r.id === room)).map((r) => ({
        room: r,
        kids: students.filter((s) => roomOf(s) === r.id && shown(s)),
      }));
      // Children with no room, or a room that was deleted, can be chosen too.
      if (room === 'all') {
        const known = new Set(rooms.map((r) => r.id));
        groups.push({ room: { id: '', name: 'No room' }, kids: students.filter((s) => !known.has(roomOf(s)) && shown(s)) });
      }
      list.replaceChildren(
        ...groups
          .filter((g) => g.kids.length)
          .map((g) =>
            h(
              'fieldset.pick-group',
              h(
                'legend',
                h('span.room-dot', { style: { '--room': g.room.color } }, g.room.name),
                h(
                  'button.link-btn',
                  {
                    type: 'button',
                    onClick: () => {
                      const all = g.kids.every((k) => picked.has(k.id));
                      for (const k of g.kids) all ? picked.delete(k.id) : picked.add(k.id);
                      draw();
                    },
                  },
                  g.kids.every((k) => picked.has(k.id)) ? 'Clear room' : 'Select room',
                ),
              ),
              h(
                'div.pick-grid',
                g.kids.map((s) => {
                  const cb = h('input.sr-only', { type: 'checkbox', checked: picked.has(s.id), onChange: () => (cb.checked ? picked.add(s.id) : picked.delete(s.id), card.classList.toggle('on', cb.checked), updateCount()) });
                  const card = h(`label.pick-card${picked.has(s.id) ? '.on' : ''}`, cb, childAvatar(s), h('span.pick-name', personName(s)), h('span.pick-check', icon('check', 14)));
                  return card;
                }),
              ),
            ),
          ),
      );
      if (!list.children.length) list.append(h('p.subtle.pick-empty', scope === 'in' ? 'No children are checked in here. Show everyone to choose from the whole roster.' : 'No children enrolled in this room.'));
      updateCount();
    };
    const updateCount = () => (count.textContent = `${picked.size} selected`);
    const roomSel = select({ options: [{ value: 'all', label: 'All rooms' }, ...sortRooms(store.all('rooms')).map((r) => ({ value: r.id, label: r.name }))], value: room, 'aria-label': 'Room' });
    roomSel.addEventListener('change', () => ((room = roomSel.value), draw()));
    openDialog({
      title,
      size: 'wide',
      body: () =>
        h(
          'div.picker',
          h('div.toolbar', roomSel, segmented({ label: 'Show', items: [{ value: 'in', label: 'Checked in' }, { value: 'all', label: 'Everyone' }], value: scope, onChange: (v) => ((scope = v), draw()) }), h('span.spacer'), count),
          list,
        ),
      footer: ({ close }) => [
        h('button.btn.ghost', { type: 'button', onClick: () => (picked.clear(), draw()) }, 'Clear'),
        h('span.spacer'),
        h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
        h('button.btn.primary', { type: 'button', onClick: () => ((result = [...picked]), close()) }, 'Done'),
      ],
      onClose: () => resolve(result),
    });
    draw();
    if (!store.isOpen(attendanceName(day))) store.open([attendanceName(day)]).then(draw);
  });
}
