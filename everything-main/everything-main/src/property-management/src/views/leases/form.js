/**
 * Create, edit, activate or renew a lease. One sectioned page: unit, term,
 * tenants, rent, other recurring charges, deposit and late fees.
 *
 * Query parameters: unitId, propertyId, applicantId (convert an applicant),
 * renews (lease id being renewed).
 */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, field, textInput, select, moneyInput, segmented, emptyState } from '../../ui/components.js';
import { navigate } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { ACC, chargeableAccounts } from '../../core/accounts.js';
import { buildCharge } from '../../core/ledger.js';
import { newId } from '../../core/ids.js';
import { leaseStatus, newRecurring, defaultPostingStart, monthlyRent, postDue, tenantName, effectiveEnd } from '../../core/leases.js';
import { LEASE_TYPES } from '../../core/settings.js';
import { addDays, addMonths } from '../../core/dates.js';
import { personName } from '../../core/format.js';
import { money, date, propertySelect, unitSelect, tenantPicker, accountSelect, personAvatar } from '../common.js';
import { proration, firstDueAfter } from '../transactions/logic.js';

export function render(ctx) {
  const store = app.store;
  const settings = app.settings();
  const today = app.today();
  const existing = ctx.params.id ? store.get('leases', ctx.params.id) : null;
  if (ctx.params.id && !existing) {
    return h('div.page', emptyState({ icon: 'file-signature', title: 'Lease not found', headingLevel: 1, text: 'It may have been deleted.', actions: [h('a.btn.primary', { href: '#/leases' }, 'Back to rent roll')] }));
  }
  const activating = existing?.draft;
  // A renewal or an applicant's lease saved as a draft finishes those steps
  // when it is activated.
  const renewing = existing ? (activating && existing.renewsLeaseId ? store.get('leases', existing.renewsLeaseId) : null) : ctx.query.renews ? store.get('leases', ctx.query.renews) : null;
  const applicant = existing ? (activating ? store.all('applicants').find((a) => a.leaseId === existing.id) || null : null) : ctx.query.applicantId ? store.get('applicants', ctx.query.applicantId) : null;
  const live = existing && !existing.draft; // an existing active, future or past lease
  let dirty = false;
  const touch = () => (dirty = true);

  // ---- Starting values ------------------------------------------------------
  const termMonths = settings.leases?.termMonths || 12;
  const startDefault = renewing ? addDays(effectiveEnd(renewing) || renewing.end || today, 1) : today;
  const base = existing || {
    propertyId: renewing?.propertyId || applicant?.propertyId || ctx.query.propertyId || lookup.unit(ctx.query.unitId)?.propertyId || '',
    unitId: renewing?.unitId || applicant?.unitId || ctx.query.unitId || '',
    type: renewing?.type === 'at-will' ? 'at-will' : renewing?.type || settings.leases?.type || 'fixed-rollover',
    start: renewing ? startDefault : applicant?.moveIn || today,
    tenantIds: renewing ? [...(renewing.tenantIds || [])] : [],
  };
  const rentSrc = existing ? existing.recurring?.find((r) => r.accountId === ACC.rent) : renewing ? renewing.recurring?.find((r) => r.accountId === ACC.rent && (!r.end || r.end >= today)) : null;
  const unitRent = lookup.unit(base.unitId)?.listing?.rent || lookup.unit(base.unitId)?.marketRent || 0;
  const startRent = existing ? rentSrc?.amount || 0 : renewing ? renewing.renewal?.offerRent || monthlyRent(renewing, today) : unitRent;

  // ---- Unit -------------------------------------------------------------------
  const property = propertySelect({ value: base.propertyId, empty: 'Select a property', required: true });
  let unit = unitSelect({ propertyId: base.propertyId, value: base.unitId, empty: 'Select a unit', required: true });
  const unitField = field('Unit', unit, { required: true });
  const occupancyNote = h('div', { 'aria-live': 'polite' });
  const unitChanged = () => {
    touch();
    const u = lookup.unit(unit.value);
    if (!existing && !renewing && u && !rentTouched) rent.cents = u.listing?.rent || u.marketRent || 0;
    if (!existing && !depositTouched) deposit.cents = rent.cents;
    checkOccupancy();
    refreshRent();
  };
  property.addEventListener('change', () => {
    const next = unitSelect({ propertyId: property.value, value: '', empty: 'Select a unit', required: true });
    next.id = unit.id;
    unit.replaceWith(next);
    unit = next;
    unit.addEventListener('change', unitChanged);
    // Single-unit properties have one unit: pick it.
    const units = lookup.unitsOf(property.value);
    if (units.length === 1) unit.value = units[0].id;
    unitChanged();
  });
  unit.addEventListener('change', unitChanged);
  if (!existing && base.propertyId && !base.unitId) {
    const units = lookup.unitsOf(base.propertyId);
    if (units.length === 1) unit.value = units[0].id;
  }

  function checkOccupancy() {
    const s = start.value;
    const e = type.value === 'at-will' ? null : end.value;
    const clash = store.all('leases').find((l) => {
      if (l.unitId !== unit.value || l.id === existing?.id || l.id === renewing?.id || l.draft) return false;
      const lEnd = effectiveEnd(l) || (l.type === 'fixed' ? l.end : null);
      return (!lEnd || lEnd >= s) && (!e || l.start <= e);
    });
    occupancyNote.replaceChildren(
      ...(clash
        ? [h('div.notice.warning', icon('warning', 16), h('span', `This unit already has a lease for these dates: `, h('a', { href: `#/leases/${clash.id}` }, `${lookup.tenantNames(clash) || 'lease'}, ${leaseStatus(clash, today)}`), '. Record a move-out on that lease first if the tenant is leaving.'))]
        : []),
    );
  }

  // ---- Term -------------------------------------------------------------------
  const type = select({ value: base.type, options: LEASE_TYPES.map((t) => ({ value: t.id, label: t.label })) });
  const start = textInput({ type: 'date', value: base.start, required: true });
  const end = textInput({ type: 'date', value: existing ? existing.end || '' : addDays(addMonths(base.start, termMonths), -1) });
  const signed = textInput({ type: 'date', value: existing?.signedOn || (applicant || renewing ? today : '') });
  let endTouched = !!existing;
  const endField = field('End date', end, { hint: `Set ${termMonths} months from the start` });
  const termNote = h('p.subtle.lf-note');
  const refreshTerm = () => {
    endField.hidden = type.value === 'at-will';
    if (!endTouched && start.value) end.value = addDays(addMonths(start.value, termMonths), -1);
    termNote.textContent = type.value === 'fixed-rollover' ? 'After the end date the lease continues month to month until someone gives notice.' : type.value === 'fixed' ? 'The lease ends on the end date and charges stop.' : 'No end date. Rent is charged every month until a move-out is recorded.';
  };
  type.addEventListener('change', () => (touch(), refreshTerm(), checkOccupancy()));
  start.addEventListener('change', () => {
    touch();
    refreshTerm();
    if (!chargeStartTouched) chargeStart.value = postingStartFor();
    refreshRent();
    checkOccupancy();
  });
  end.addEventListener('input', () => ((endTouched = true), touch()));
  end.addEventListener('change', checkOccupancy);
  signed.addEventListener('input', touch);

  // ---- Tenants ------------------------------------------------------------------
  const tenantIds = [...(existing?.tenantIds || base.tenantIds)];
  const newTenants = []; // { first, last, email, phone } inputs
  const tenantList = h('ul.lf-tenants');
  const newList = h('div.lf-new-tenants');
  const drawTenants = () => {
    tenantList.replaceChildren(
      ...tenantIds.map((tid) => {
        const t = lookup.tenant(tid);
        if (!t) return null;
        return h(
          'li',
          personAvatar(t, { size: 'sm' }),
          h('span.grow', tenantName(t), h('span.subtle', ` ${(t.emails || [])[0] || (t.phones || [])[0] || ''}`)),
          h('button.icon-btn', { type: 'button', 'aria-label': `Remove ${tenantName(t)}`, onClick: () => (tenantIds.splice(tenantIds.indexOf(tid), 1), touch(), drawTenants()) }, icon('x', 16)),
        );
      }),
    );
  };
  const addNewTenant = (pre = {}) => {
    const row = {
      first: textInput({ value: pre.firstName || '', autocomplete: 'given-name', 'aria-label': 'First name', placeholder: 'First name' }),
      last: textInput({ value: pre.lastName || '', autocomplete: 'family-name', 'aria-label': 'Last name', placeholder: 'Last name' }),
      email: textInput({ type: 'email', value: pre.email || '', autocomplete: 'email', 'aria-label': 'Email', placeholder: 'Email' }),
      phone: textInput({ type: 'tel', value: pre.phone || '', autocomplete: 'tel', 'aria-label': 'Phone', placeholder: 'Phone' }),
    };
    const node = h('div.lf-new-tenant', row.first, row.last, row.email, row.phone, h('button.icon-btn', { type: 'button', 'aria-label': 'Remove new tenant', onClick: () => (newTenants.splice(newTenants.indexOf(row), 1), node.remove()) }, icon('x', 16)));
    for (const k of ['first', 'last', 'email', 'phone']) row[k].addEventListener('input', touch);
    newTenants.push(row);
    newList.append(node);
    return row;
  };
  const picker = tenantPicker({
    placeholder: 'Search existing tenants',
    exclude: tenantIds,
    onSelect: (t) => {
      if (!tenantIds.includes(t.id)) tenantIds.push(t.id);
      touch();
      drawTenants();
    },
    onCreate: (q) => {
      const [firstName = '', ...rest] = q.trim().split(/\s+/);
      addNewTenant({ firstName, lastName: rest.join(' ') }).first.focus();
    },
  });
  if (applicant && !existing) addNewTenant({ firstName: applicant.firstName, lastName: applicant.lastName, email: applicant.email, phone: applicant.phone });
  drawTenants();

  // ---- Rent ------------------------------------------------------------------------
  const rent = moneyInput({ cents: startRent, required: true, 'aria-label': 'Monthly rent' });
  const rentDay = textInput({ type: 'number', min: 1, max: 31, value: rentSrc?.day || settings.leases?.rentDay || 1 });
  let rentTouched = false;
  // A draft's charge start still follows its start date unless it was set
  // to something else on purpose.
  let chargeStartTouched =
    !!existing &&
    (live ||
      (!!rentSrc?.start &&
        rentSrc.start !== existing.start &&
        rentSrc.start !== defaultPostingStart(existing, today) &&
        rentSrc.start !== proration(rentSrc.amount, existing.start, rentSrc.day || 1)?.firstDue));
  // A renewal must not bill months the lease it renews already billed.
  const renewFloor = (() => {
    const last = (renewing?.recurring || []).map((r) => r.postedThrough).filter(Boolean).sort().pop();
    return last ? addDays(last, 1) : null;
  })();
  const postingStartFor = () => {
    const s = start.value || today;
    const st = defaultPostingStart({ start: s }, today) || s;
    return renewFloor && renewFloor > st ? renewFloor : st;
  };
  // Only an existing lease keeps its own rent start; a renewal starts fresh.
  const chargeStart = textInput({ type: 'date', value: (existing && rentSrc?.start) || postingStartFor() });
  // A renewal continues a tenancy whose current month is already billed.
  const prorate = h('input', { type: 'checkbox', checked: !live && !renewing });
  const prorateLabel = h('span');
  const prorateRow = h('label.check.lf-prorate', prorate, prorateLabel);
  const rentSummary = h('p.subtle.lf-note', { 'aria-live': 'polite' });
  function prorationNow() {
    if (live) return null;
    const p = proration(rent.cents, start.value, Number(rentDay.value) || 1);
    // Only when charging from the lease start (or, for a saved draft, from
    // the first full month after it, which is where its prorated rent
    // starts). A lease entered after it began starts charging later, and
    // its earlier months are not billed.
    const draftProrated = !!existing && chargeStart.value === p?.firstDue;
    if (p && chargeStart.value && start.value && chargeStart.value > start.value && !draftProrated) return null;
    return p;
  }
  function refreshRent() {
    const p = prorationNow();
    prorateRow.hidden = !p || !!existing?.recurring?.some((r) => r.postedThrough);
    if (p) prorateLabel.textContent = `Charge ${money(p.amount)} prorated rent for ${date(p.from, { month: 'short', day: 'numeric' })} to ${date(p.to, { month: 'short', day: 'numeric' })}, then full rent from ${date(p.firstDue)}`;
    const first = p && prorate.checked ? p.firstDue : firstDueAfter(addDays(chargeStart.value || start.value || today, -1), Number(rentDay.value) || 1);
    rentSummary.textContent = rent.cents ? `${money(rent.cents)} is charged on day ${Number(rentDay.value) || 1} of each month, starting ${date(first)}.` : '';
  }
  rent.addEventListener('input', () => {
    rentTouched = true;
    touch();
    if (!existing && !depositTouched) deposit.cents = rent.cents;
    refreshRent();
  });
  rentDay.addEventListener('input', () => (touch(), refreshRent()));
  chargeStart.addEventListener('input', () => ((chargeStartTouched = true), touch(), refreshRent()));
  prorate.addEventListener('change', () => (touch(), refreshRent()));

  // ---- Other recurring charges --------------------------------------------------------
  const incomeAccounts = chargeableAccounts(store.all('accounts')).filter((a) => a.type === 'income' && a.id !== ACC.rent);
  const extras = [];
  const extraList = h('div.lf-extras');
  const addExtra = (item = {}) => {
    const acc = accountSelect({ value: item.accountId || incomeAccounts[0]?.id, filter: (a) => incomeAccounts.some((x) => x.id === a.id), 'aria-label': 'Account' });
    const amount = moneyInput({ cents: item.amount || 0, 'aria-label': 'Monthly amount' });
    const memo = textInput({ value: item.memo || '', placeholder: 'Description, e.g. Parking space 4', 'aria-label': 'Description' });
    const row = { item, acc, amount, memo };
    const node = h('div.lf-extra', acc, memo, amount, h('button.icon-btn', { type: 'button', 'aria-label': 'Remove charge', onClick: () => (extras.splice(extras.indexOf(row), 1), node.remove(), touch()) }, icon('x', 16)));
    for (const el of [acc, amount, memo]) el.addEventListener('input', touch);
    extras.push(row);
    extraList.append(node);
    return row;
  };
  const extraSource = existing ? existing.recurring?.filter((r) => r.accountId !== ACC.rent) : renewing ? renewing.recurring?.filter((r) => r.accountId !== ACC.rent && (!r.end || r.end >= today)).map((r) => ({ accountId: r.accountId, amount: r.amount, memo: r.memo })) : [];
  (extraSource || []).forEach(addExtra);

  // ---- Deposit ----------------------------------------------------------------------------
  const deposit = moneyInput({ cents: existing ? existing.deposit || 0 : renewing ? renewing.deposit || 0 : startRent });
  let depositTouched = !!existing || !!renewing;
  deposit.addEventListener('input', () => ((depositTouched = true), touch()));
  const renewDeposits = renewing ? app.ledger().lease(renewing.id).deposits : 0;
  const postDeposit = h('input', { type: 'checkbox', checked: !live && !renewing });
  const carryDeposit = h('input', { type: 'checkbox', checked: renewDeposits > 0 });

  // ---- Late fees ------------------------------------------------------------------------------
  const lf = existing?.lateFee || renewing?.lateFee || {};
  let lateMode = lf.enabled === false ? 'none' : Object.keys(lf).some((k) => k !== 'enabled') ? 'custom' : 'company';
  const company = settings.lateFee || {};
  const grace = textInput({ type: 'number', min: 0, max: 31, value: lf.graceDays ?? company.graceDays ?? 5 });
  const feeKind = select({ value: lf.kind || company.kind || 'flat', options: [{ value: 'flat', label: 'Flat amount' }, { value: 'percent', label: 'Percent of rent' }] });
  const feeAmount = moneyInput({ cents: lf.amount ?? company.amount ?? 5000 });
  const feePct = textInput({ type: 'number', min: 0, max: 100, step: '0.5', value: lf.percent ?? company.percent ?? 5 });
  const feeAmountField = field('Fee', feeAmount);
  const feePctField = field('Percent of rent', feePct);
  const customFee = h('div.form-grid.three', field('Grace days', grace), field('Fee type', feeKind), h('div', feeAmountField, feePctField));
  const refreshFee = () => {
    customFee.hidden = lateMode !== 'custom';
    feeAmountField.hidden = feeKind.value !== 'flat';
    feePctField.hidden = feeKind.value !== 'percent';
  };
  feeKind.addEventListener('change', () => (touch(), refreshFee()));
  const lateCtl = segmented({
    label: 'Late fee policy',
    value: lateMode,
    items: [
      { value: 'company', label: 'Company policy' },
      { value: 'custom', label: 'Custom' },
      { value: 'none', label: 'No late fees' },
    ],
    onChange: (v) => ((lateMode = v), touch(), refreshFee()),
  });

  // ---- Layout ------------------------------------------------------------------------------
  const error = h('div.notice.danger', { role: 'alert', hidden: true });
  const section = (title, ic, ...children) => h('section.card.lf-section', h('div.card-head', h('h2.grow', icon(ic, 18), title)), h('div.card-body.stack', ...children));

  const title = existing ? (activating ? 'Finish draft lease' : 'Edit lease') : renewing ? 'Renew lease' : 'New lease';
  const header = pageHeader({
    title,
    crumbs: [{ label: 'Rent roll', href: '#/leases' }, existing ? { label: lookup.leaseLabel(existing), href: `#/leases/${existing.id}` } : renewing ? { label: lookup.leaseLabel(renewing), href: `#/leases/${renewing.id}` } : { label: 'New lease' }],
    subtitle: renewing ? `Renewing for ${lookup.tenantNames(renewing) || 'the current tenants'}. The current lease ends ${date(renewing.end)}.` : applicant ? `Creating a lease for applicant ${personName(applicant)}.` : null,
  });

  const form = h(
    'form.lf-form',
    { novalidate: true },
    error,
    section('Unit', 'door', h('div.form-grid', field('Property', property, { required: true }), unitField), occupancyNote),
    section('Term', 'calendar-range', h('div.form-grid', field('Lease type', type), field('Signed on', signed)), h('div.form-grid', field('Start date', start, { required: true }), endField), termNote),
    section(
      'Tenants',
      'users',
      tenantList,
      picker,
      newList,
      h('div.row', h('button.btn.ghost.sm', { type: 'button', onClick: () => addNewTenant().first.focus() }, icon('user-plus', 14), 'Add a new tenant')),
      h('p.subtle.lf-note', 'New tenants are saved as tenant records when you save the lease.'),
    ),
    section(
      'Rent',
      'hand-coins',
      h('div.form-grid.three', field('Monthly rent', rent, { required: true }), field('Due on day', rentDay, { hint: 'Day of the month, 1 to 31' }), field('Start charging on', chargeStart, { hint: live ? 'Changes apply to charges not posted yet' : 'Earlier months are not charged' })),
      prorateRow,
      rentSummary,
    ),
    section(
      'Other monthly charges',
      'repeat',
      extraList,
      h('div.row', h('button.btn.ghost.sm', { type: 'button', onClick: () => addExtra().amount.focus() }, icon('plus', 14), 'Add a monthly charge')),
      h('p.subtle.lf-note', 'For example parking, pet rent, storage or utilities. Charged on the rent due day.'),
    ),
    section(
      'Security deposit',
      'vault',
      h('div.form-grid', field('Deposit amount', deposit)),
      !live && !renewing ? h('label.check', postDeposit, 'Charge the deposit to the tenant now so it can be collected') : null,
      renewing && renewDeposits ? h('label.check', carryDeposit, `Move the ${money(renewDeposits)} deposit held on the current lease to this one`) : null,
    ),
    section('Late fees', 'percent', lateCtl, h('p.subtle.lf-note', company.enabled ? `Company policy: ${company.kind === 'percent' ? `${company.percent}% of rent` : money(company.amount)} when rent is unpaid ${company.graceDays} days after it is due.` : 'Late fees are off in company settings.'), customFee),
  );

  const cancelHref = existing ? `#/leases/${existing.id}` : renewing ? `#/leases/${renewing.id}` : '#/leases';
  const actions = h(
    'div.lf-actions',
    h('a.btn', { href: cancelHref, onClick: () => (dirty = false) }, 'Cancel'),
    h('div.spacer'),
    !live ? h('button.btn', { type: 'button', onClick: () => save({ draft: true }) }, existing ? 'Save draft' : 'Save as draft') : null,
    h('button.btn.primary', { type: 'button', onClick: () => save({ draft: false }) }, live ? 'Save changes' : activating ? 'Activate lease' : renewing ? 'Save renewal' : 'Save lease'),
  );
  form.addEventListener('submit', (e) => (e.preventDefault(), save({ draft: false })));

  refreshTerm();
  refreshRent();
  refreshFee();
  checkOccupancy();

  // ---- Save ---------------------------------------------------------------------------------
  function fail(msg, el) {
    error.hidden = false;
    error.replaceChildren(icon('alert', 16), h('span', msg));
    if (el) {
      el.setAttribute('aria-invalid', 'true');
      el.focus();
    } else error.scrollIntoView?.({ block: 'center' });
    return false;
  }

  // Saving waits for a lease number from the server; a second click
  // meanwhile must not create a second lease.
  let saving = false;
  async function save(opts) {
    if (saving) return false;
    saving = true;
    const buttons = [...actions.querySelectorAll('button')];
    for (const b of buttons) b.disabled = true;
    try {
      return await saveNow(opts);
    } finally {
      saving = false;
      for (const b of buttons) b.disabled = false;
    }
  }

  async function saveNow({ draft }) {
    error.hidden = true;
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    if (!property.value) return fail('Choose a property.', property);
    if (!unit.value) return fail('Choose a unit.', unit);
    if (!start.value) return fail('Enter a start date.', start);
    if (type.value !== 'at-will' && end.value && end.value < start.value) return fail('The end date is before the start date.', end);
    if (type.value !== 'at-will' && !end.value) return fail('Enter an end date, or choose month-to-month.', end);
    const pending = newTenants.filter((r) => r.first.value.trim() || r.last.value.trim());
    if (!draft && !tenantIds.length && !pending.length) return fail('Add at least one tenant.', picker.input);
    if (!draft && !(rent.cents > 0)) return fail('Enter the monthly rent.', rent);

    // New tenants become tenant records.
    for (const r of pending) {
      const t = store.put('tenants', {
        firstName: r.first.value.trim(),
        lastName: r.last.value.trim(),
        emails: r.email.value.trim() ? [r.email.value.trim()] : [],
        phones: r.phone.value.trim() ? [r.phone.value.trim()] : [],
        ...(applicant && r === newTenants[0] ? { applicantId: applicant.id } : {}),
      });
      tenantIds.push(t.id);
    }
    newTenants.length = 0;
    newList.replaceChildren();

    const day = Math.min(31, Math.max(1, Number(rentDay.value) || 1));
    const p = !live && prorate.checked && !prorateRow.hidden ? prorationNow() : null;
    const rentStart = p ? p.firstDue : chargeStart.value || start.value;
    const leaseEnd = type.value === 'at-will' ? null : end.value;

    // Recurring items: keep ids and what has been posted on items that stay.
    // Build on the lease as it is now: charges may have posted (and moved
    // postedThrough on) while the form was open.
    const latest = existing ? store.get('leases', existing.id) || existing : null;
    const oldItems = latest?.recurring || [];
    const recurring = [];
    const oldRent = oldItems.find((r) => r.accountId === ACC.rent && r.id === rentSrc?.id);
    if (rent.cents > 0) {
      recurring.push(
        oldRent
          ? { ...oldRent, amount: rent.cents, day, start: oldRent.postedThrough ? oldRent.start : rentStart }
          : newRecurring({ accountId: ACC.rent, amount: rent.cents, day, start: rentStart, memo: 'Rent' }),
      );
    }
    // Rent items other than the edited one (past rent changes) are kept as they are.
    for (const r of oldItems) if (r.accountId === ACC.rent && r.id !== rentSrc?.id) recurring.push(r);
    for (const x of extras) {
      if (!(x.amount.cents > 0)) continue;
      const prev = x.item?.id ? oldItems.find((r) => r.id === x.item.id) : null;
      recurring.push(prev ? { ...prev, accountId: x.acc.value, amount: x.amount.cents, day, memo: x.memo.value.trim() } : newRecurring({ accountId: x.acc.value, amount: x.amount.cents, day, start: rentStart, memo: x.memo.value.trim() }));
    }
    // Extras removed in the form: stop them if they were already charged, otherwise drop them.
    for (const r of oldItems) {
      if (r.accountId === ACC.rent || recurring.some((x) => x.id === r.id)) continue;
      if (r.postedThrough) recurring.push({ ...r, end: r.end && r.end < today ? r.end : r.postedThrough });
    }

    const lateFee = lateMode === 'none' ? { enabled: false } : lateMode === 'company' ? {} : { enabled: true, graceDays: Number(grace.value) || 0, kind: feeKind.value, amount: feeAmount.cents, percent: Number(feePct.value) || 0 };

    const record = {
      ...(latest || {}),
      propertyId: property.value,
      unitId: unit.value,
      tenantIds: [...new Set(tenantIds)],
      type: type.value,
      start: start.value,
      end: leaseEnd,
      signedOn: signed.value || null,
      deposit: deposit.cents,
      recurring,
      lateFee,
      draft: !!draft,
    };
    if (renewing) record.renewsLeaseId = renewing.id;
    if (!existing) record.number = await store.nextNumber('leases');
    const saved = store.put('leases', record);

    const becameActive = !draft && (!existing || existing.draft);
    if (becameActive) {
      const chargeDate = signed.value && signed.value < start.value ? signed.value : start.value;
      if (postDeposit.checked && deposit.cents > 0 && !renewing) {
        store.put('transactions', buildCharge({ lease: saved, date: chargeDate <= today ? chargeDate : start.value, dueDate: start.value, memo: 'Security deposit', items: [{ accountId: ACC.depositsHeld, amount: deposit.cents }] }));
      }
      if (p) store.put('transactions', buildCharge({ lease: saved, date: p.from, dueDate: p.from, memo: `Prorated rent, ${date(p.from, { month: 'short', day: 'numeric' })} to ${date(p.to, { month: 'short', day: 'numeric' })}`, items: [{ accountId: ACC.rent, amount: p.amount }] }));
    }

    if (renewing && !draft) {
      // The old lease ends at the end of its term; the renewal takes over.
      store.patch('leases', renewing.id, (l) => {
        // Kept so deleting the renewal can put the lease back as it was.
        l.beforeRenewal = { type: l.type, end: l.end ?? null, renewal: l.renewal || null, recurring: (l.recurring || []).map((r) => ({ id: r.id, end: r.end ?? null })) };
        l.renewal = { ...(l.renewal || {}), status: 'accepted' };
        l.renewedByLeaseId = saved.id;
        const lastDay = addDays(saved.start, -1);
        l.end = l.type !== 'at-will' && l.end && l.end <= lastDay ? l.end : lastDay;
        l.type = 'fixed';
        l.recurring = (l.recurring || []).map((r) => (!r.end || r.end > lastDay ? { ...r, end: lastDay } : r));
        return l;
      });
      if (carryDeposit.checked && renewDeposits > 0) {
        // Balanced transfer of the held deposit from the old lease to the new one.
        const refs = { propertyId: saved.propertyId };
        store.put('transactions', {
          id: newId(),
          kind: 'journal',
          date: saved.start <= today ? saved.start : today,
          memo: 'Security deposit moved to the renewed lease',
          ref: '',
          leaseId: saved.id,
          propertyId: saved.propertyId,
          lines: [
            { accountId: ACC.depositsHeld, amount: renewDeposits, ...refs, unitId: renewing.unitId, leaseId: renewing.id },
            { accountId: ACC.depositsHeld, amount: -renewDeposits, ...refs, unitId: saved.unitId, leaseId: saved.id },
          ],
        });
      }
    }

    if (applicant && !draft) store.patch('applicants', applicant.id, { status: 'converted', leaseId: saved.id });
    else if (applicant) store.patch('applicants', applicant.id, { leaseId: saved.id });

    if (!draft) {
      try {
        postDue(store, { index: app.ledger(), settings: app.settings(), today: app.today() });
      } catch (err) {
        console.error(err);
      }
    }

    dirty = false;
    toast(draft ? 'Draft lease saved' : existing ? (activating ? 'Lease activated' : 'Lease updated') : renewing ? 'Lease renewed' : 'Lease created');
    navigate(`/leases/${saved.id}`);
    return true;
  }

  return {
    node: h('div.page.narrow', header, form, actions),
    title,
    dirty: () => dirty,
  };
}
