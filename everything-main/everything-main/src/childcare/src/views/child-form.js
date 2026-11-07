/** Add or edit a child: personal details, health, enrollment, tuition plans, and (when new) a first family member. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pageHeader, field, textInput, textarea, select, card, moneyInput } from '../ui/components.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { app, isManager } from '../app.js';
import { personName } from '../core/format.js';
import { STUDENT_STATUSES, RELATIONS, sortRooms } from '../core/people.js';
import { formatMoney } from '../core/money.js';
import { saveFile, isImage } from '../files.js';
import { childAvatar } from './common.js';

const DAYS = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [0, 'Sun'],
];

export function render(ctx) {
  const store = app.store;
  const existing = ctx.params.id ? store.get('students', ctx.params.id) : null;
  if (ctx.params.id && !existing) return h('div.page', pageHeader({ title: 'Child not found' }), h('p', h('a', { href: '#/children' }, 'Back to children')));
  const s = structuredClone(existing || { status: ctx.query.status || 'active', roomId: ctx.query.room || sortRooms(store.all('rooms'))[0]?.id || null, schedule: [1, 2, 3, 4, 5], plans: [], doctor: {}, inquiry: {} });
  s.doctor ||= {};
  s.inquiry ||= {};
  s.plans ||= [];
  let dirty = false;
  let photoFile = null;
  const mark = () => (dirty = true);

  const inp = (key, opts = {}) => {
    const i = textInput({ value: s[key] || '', ...opts });
    i.addEventListener('input', () => ((s[key] = i.value), mark()));
    return i;
  };
  const sub = (obj, key, opts = {}) => {
    const i = textInput({ value: obj[key] || '', ...opts });
    i.addEventListener('input', () => ((obj[key] = i.value), mark()));
    return i;
  };
  const area = (key, opts = {}) => {
    const t = textarea({ value: s[key] || '', rows: 2, ...opts });
    t.addEventListener('input', () => ((s[key] = t.value), mark()));
    return t;
  };

  // Photo
  const avatarBox = h('div.photo-edit');
  const drawAvatar = () => {
    let preview;
    if (photoFile) {
      const url = URL.createObjectURL(photoFile);
      preview = h('span.avatar.xl', h('img', { src: url, alt: '' }));
    } else preview = childAvatar({ ...s, firstName: s.firstName || '?', id: s.id || 'new' }, { size: 'xl' });
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
    file.addEventListener('change', () => {
      if (file.files[0] && isImage(file.files[0].type)) {
        photoFile = file.files[0];
        mark();
        drawAvatar();
      }
    });
    avatarBox.replaceChildren(
      preview,
      h('div.stack', h('button.btn.sm', { type: 'button', onClick: () => file.click() }, icon('camera', 15), s.photo || photoFile ? 'Change photo' : 'Add photo'), s.photo || photoFile ? h('button.btn.sm.ghost', { type: 'button', onClick: () => ((s.photo = null), (photoFile = null), mark(), drawAvatar()) }, 'Remove') : null, file),
    );
  };
  drawAvatar();

  const status = select({ options: STUDENT_STATUSES.map((x) => ({ value: x.id, label: x.label })), value: s.status });
  const inquiryCard = h('div');
  const drawInquiry = () =>
    inquiryCard.replaceChildren(
      s.status === 'waitlist' || s.status === 'inquiry'
        ? card({
            title: 'Enrollment',
            body: h(
              'div.form-grid',
              field('First contact', sub(s.inquiry, 'firstContact', { type: 'date' })),
              field('Toured', sub(s.inquiry, 'toured', { type: 'date' })),
              field('Wants to start', sub(s.inquiry, 'desiredStart', { type: 'date' })),
              field('How they heard about us', sub(s.inquiry, 'source', { placeholder: 'Referral, website...' })),
              field('Notes', (() => {
                const t = textarea({ value: s.inquiry.notes || '', rows: 2 });
                t.addEventListener('input', () => ((s.inquiry.notes = t.value), mark()));
                return t;
              })(), { span2: true }),
            ),
          })
        : null,
    );
  status.addEventListener('change', () => ((s.status = status.value), mark(), drawInquiry()));
  drawInquiry();

  const room = select({ options: [{ value: '', label: 'No room' }, ...sortRooms(store.all('rooms')).map((r) => ({ value: r.id, label: r.name }))], value: s.roomId || '' });
  room.addEventListener('change', () => ((s.roomId = room.value || null), mark()));
  const gender = select({ options: [{ value: '', label: 'Not specified' }, 'Girl', 'Boy', 'Nonbinary'], value: s.gender || '' });
  gender.addEventListener('change', () => ((s.gender = gender.value), mark()));

  const days = h(
    'div.day-toggles',
    { role: 'group', 'aria-label': 'Schedule' },
    DAYS.map(([n, label]) => {
      const b = h('button.chip', { type: 'button', 'aria-pressed': String(s.schedule.includes(n)) }, label);
      b.addEventListener('click', () => {
        s.schedule = s.schedule.includes(n) ? s.schedule.filter((x) => x !== n) : [...s.schedule, n].sort();
        b.setAttribute('aria-pressed', String(s.schedule.includes(n)));
        mark();
      });
      return b;
    }),
  );

  // Tuition plans (directors and admins)
  const plansBox = h('div.plan-rows');
  const drawPlans = () => {
    const plans = store.all('plans');
    plansBox.replaceChildren(
      ...s.plans.map((sp, i) => {
        const sel = select({ options: plans.map((p) => ({ value: p.id, label: `${p.name} (${formatMoney(p.amountCents)} ${p.frequency})` })), value: sp.planId, 'aria-label': 'Plan' });
        sel.addEventListener('change', () => ((sp.planId = sel.value), mark()));
        const amt = moneyInput({ cents: Number.isFinite(sp.amountCents) ? sp.amountCents : 0, placeholder: 'Plan price', 'aria-label': 'Custom price' });
        amt.addEventListener('input', () => {
          sp.amountCents = amt.value.trim() ? amt.cents : undefined;
          mark();
        });
        return h('div.plan-row', sel, amt, h('button.icon-btn', { type: 'button', 'aria-label': 'Remove plan', onClick: () => (s.plans.splice(i, 1), mark(), drawPlans()) }, icon('trash', 16)));
      }),
      plans.length
        ? h('button.btn.sm', { type: 'button', onClick: () => (s.plans.push({ planId: plans[0].id }), mark(), drawPlans()) }, icon('plus', 15), 'Add a plan')
        : h('p.subtle.small', 'No tuition plans yet. ', h('a', { href: '#/billing/plans' }, 'Create plans in Billing'), '.'),
    );
  };
  drawPlans();

  // First family member (new children only)
  const fam = { firstName: '', lastName: '', relation: 'Mother', email: '', phone: '' };
  const famRel = select({ options: RELATIONS, value: fam.relation });
  famRel.addEventListener('change', () => (fam.relation = famRel.value));

  const errors = h('div', { role: 'alert' });
  const firstInput = inp('firstName', { required: true, autocomplete: 'off' });

  let saving = false;
  function save() {
    // A second click while the photo uploads, or before the child's page has loaded, must not add the child twice.
    if (saving) return;
    if (!String(s.firstName || '').trim()) {
      errors.replaceChildren(h('p.notice.danger', icon('alert', 16), h('span', 'Enter the child\'s first name.')));
      firstInput.setAttribute('aria-invalid', 'true');
      firstInput.focus();
      return;
    }
    saving = true;
    return (async () => {
      const rec = { ...s, firstName: s.firstName.trim(), lastName: (s.lastName || '').trim() };
      if (!rec.inquiry || !Object.values(rec.inquiry).some(Boolean)) delete rec.inquiry;
      if (!rec.doctor?.name && !rec.doctor?.phone) delete rec.doctor;
      if (photoFile) {
        try {
          rec.id ||= (await import('../core/ids.js')).newId();
          rec.photo = await saveFile(photoFile, { area: 'students', owner: rec.id });
        } catch (err) {
          toast(err.message || 'The photo could not be uploaded.', { type: 'error' });
        }
      }
      const saved = store.put('students', rec);
      if (!existing && fam.firstName.trim()) {
        store.put('guardians', { firstName: fam.firstName.trim(), lastName: fam.lastName.trim() || saved.lastName, relation: fam.relation, email: fam.email.trim(), phone: fam.phone.trim(), studentIds: [saved.id], canPickup: true, emergency: true, primary: true, billing: true });
      }
      dirty = false;
      toast(existing ? 'Changes saved' : `${personName(saved)} added`);
      navigate(`/children/${saved.id}${existing ? '?tab=profile' : ''}`);
    })().catch((err) => {
      // Only a failed save frees the form: a saved child's page is still on its way.
      saving = false;
      toast(err.message || 'The child could not be saved.', { type: 'error' });
    });
  }

  const famField = (key, label, opts = {}) => {
    const i = textInput({ value: fam[key], ...opts });
    i.addEventListener('input', () => (fam[key] = i.value));
    return field(label, i);
  };

  const node = h(
    'div.page.narrow',
    pageHeader({
      title: existing ? `Edit ${personName(existing)}` : 'Add a child',
      crumbs: [{ label: 'Children', href: '#/children' }, existing ? { label: personName(existing), href: `#/children/${existing.id}` } : null].filter(Boolean),
    }),
    h(
      'form.form-page',
      { novalidate: true, onSubmit: (e) => (e.preventDefault(), save()) },
      errors,
      card({
        title: 'Child',
        body: h(
          'div.stack',
          avatarBox,
          h(
            'div.form-grid',
            field('First name', firstInput, { required: true }),
            field('Last name', inp('lastName')),
            field('Preferred name', inp('preferredName', { placeholder: 'Optional' })),
            field('Birthday', inp('birthday', { type: 'date', max: app.today() })),
            field('Gender', gender),
            field('Status', status),
            field('Room', room),
            field('Start date', inp('startDate', { type: 'date' })),
          ),
          h('div.field', h('span.field-label', 'Usual days'), days),
        ),
      }),
      inquiryCard,
      card({
        title: 'Health',
        body: h(
          'div.form-grid',
          field('Allergies', area('allergies', { placeholder: 'None' }), { span2: true, hint: 'Shown with a warning everywhere this child appears.' }),
          field('Medications', area('medications', { placeholder: 'None' })),
          field('Medical conditions', area('conditions', { placeholder: 'None' })),
          field('Dietary needs', inp('dietary', { placeholder: 'Vegetarian, no pork...' })),
          field('Address', inp('address')),
          field('Doctor', sub(s.doctor, 'name', { placeholder: 'Name' })),
          field('Doctor phone', sub(s.doctor, 'phone', { type: 'tel' })),
        ),
      }),
      isManager() ? card({ title: 'Tuition plans', body: h('div.stack', h('p.subtle.small', 'Billing runs create statements from these plans. Leave the price empty to use the plan price.'), plansBox) }) : null,
      !existing
        ? card({
            title: 'Family member',
            body: h(
              'div.stack',
              h('p.subtle.small', 'Optional. You can add more family members and approved pickups later.'),
              h('div.form-grid', famField('firstName', 'First name'), famField('lastName', 'Last name', { placeholder: 'Same as child' }), field('Relationship', famRel), famField('phone', 'Phone', { type: 'tel' }), famField('email', 'Email', { type: 'email' })),
            ),
          })
        : null,
      card({ title: 'Staff notes', body: field('Only visible to staff', area('staffNotes', { rows: 3, placeholder: 'Routines, comfort items, anything teachers should know' })) }),
      h('div.form-actions', h('a.btn', { href: existing ? `#/children/${existing.id}` : '#/children' }, 'Cancel'), h('button.btn.primary', { type: 'submit' }, existing ? 'Save changes' : 'Add child')),
    ),
  );
  setTimeout(() => !existing && firstInput.focus(), 0);
  return { node, title: existing ? `Edit ${personName(existing)}` : 'Add a child', dirty: () => dirty };
}
