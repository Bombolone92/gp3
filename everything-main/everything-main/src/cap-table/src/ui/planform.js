/**
 * Equity incentive plans: the sheets that adopt one, resize its reserve,
 * move shares between two, retire one, and explain one's balances.
 *
 * A company used to have one option pool. A plan is that pool with a name,
 * an adoption date, the kinds of award it is written for, and rules for
 * where the shares an award gives back go - so a 2024 plan and its 2026
 * successor keep separate reserves, and cancelling a 2024 grant returns its
 * shares where the 2024 plan says, not wherever the newest plan happens to
 * be. The math lives in lib/captable.js (see the plans section); these
 * sheets only collect what it cannot know and say what it found.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { field, flagInvalid } from './bits.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store, isRefusal } from '../lib/store.js';
import {
  planBalances, planLedger, planReserve, planIsOpen, planAccepts, planLastActivity, plansOf, awardPlanId,
  PLAN_AWARD_TYPES, RECYCLING_EVENTS, RECYCLING_RULES, recyclingRule, PLAN_NAME_MAX, PLAN_REASON_MAX,
} from '../lib/captable.js';
import { shares, sharesLabel, countLabel, dateLong, amountValue, currencyCode } from '../lib/format.js';
import { parseNum, todayISO, toCSV, downloadFile } from '../lib/util.js';

/** "2024 Equity Incentive Plan (retired)": a plan's name as a picker option. */
export function planOptionLabel(plan) {
  if (!plan) return 'Outside any plan';
  return planIsOpen(plan) ? plan.name : `${plan.name} (retired)`;
}

/**
 * Where the shares an award hands back go, for the sheets that forfeit them
 * to say: back to the award's plan, kept drawn from it, poured over into a
 * successor, or - for an award outside every plan - nowhere. `event` is the
 * rule read, 'cancellation' or 'expiration'. `they` and `it` are the verb
 * phrase in the plural and the singular, for the caller's subject.
 */
export function forfeitureDestination(award, event = 'cancellation') {
  const plans = plansOf(store.company);
  const plan = plans.find((p) => p.id === awardPlanId(award, plans)) || null;
  if (!plan) {
    const noun = award?.kind === 'rsu' ? 'award' : 'grant';
    return { plan, rule: null, they: `return to no reserve, as the ${noun} is outside any plan`, it: `returns to no reserve, as the ${noun} is outside any plan` };
  }
  const rule = recyclingRule(plan, event);
  if (rule === 'retire') return { plan, rule, they: `stay drawn from ${plan.name}`, it: `stays drawn from ${plan.name}` };
  const successor = rule !== 'return' ? plans.find((p) => p.id === rule) : null;
  if (successor) return { plan, rule, they: `pour over into ${successor.name}`, it: `pours over into ${successor.name}` };
  return { plan, rule: 'return', they: `return to ${plan.name}`, it: `returns to ${plan.name}` };
}

/** What a recycling rule says, in a picker: the two standing choices, then every other plan by name. */
function ruleOptions(plan, plans, event, current) {
  const others = plans.filter((p) => p.id !== plan?.id && (planIsOpen(p) || p.id === current));
  return [
    ...RECYCLING_RULES.map((r) => el('option', { value: r.value, selected: current === r.value }, r.label)),
    ...others.map((p) => el('option', { value: p.id, selected: current === p.id }, `Pour over into ${planOptionLabel(p)}`)),
  ];
}

/* The refusal pattern every sheet here shares: flag, focus, say. */
const invalid = (control, message) => {
  flagInvalid(control, message);
  control?.focus();
  toast(message, { icon: 'alert' });
};

const saveFailed = (err) => {
  console.error(err);
  toast(isRefusal(err) ? err.message : 'Couldn’t save. Check your connection',
    { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
};

/**
 * Adopt a plan, or edit one. The reserve is set here only when the plan is
 * new - its later changes are dated events of their own, made from the
 * reserve sheet, so the history stays a history.
 */
export function openPlanForm(existing = null) {
  const today = todayISO();
  const plans = plansOf(store.company);
  const nameInput = el('input.input', {
    type: 'text', value: existing?.name || '', maxlength: PLAN_NAME_MAX, required: true,
    placeholder: existing ? '' : `${new Date().getFullYear()} Equity Incentive Plan`, 'aria-label': 'Plan name',
  });
  const adoptedInput = el('input.input', {
    type: 'date', value: existing ? existing.adopted || '' : today, max: today, 'aria-label': 'Adoption date',
  });
  const expiresInput = el('input.input', {
    type: 'date', value: existing?.expires || '', 'aria-label': 'Expiration date',
  });
  const classSelect = el('select.select', { 'aria-label': 'Underlying share class' },
    el('option', { value: '', selected: !existing?.classId }, 'Not set'),
    store.classes.map((c) => el('option', { value: c.id, selected: c.id === existing?.classId }, c.name)));
  const typeChecks = PLAN_AWARD_TYPES.map((t) => ({
    value: t.value,
    input: el('input', { type: 'checkbox', checked: (existing?.awardTypes || ['option', 'rsu']).includes(t.value) }),
    label: t.label,
  }));
  const reserveInput = existing ? null : el('input.input', {
    type: 'text', inputmode: 'numeric', placeholder: '1,500,000', 'aria-label': 'Shares reserved',
  });
  /* The awards already on file that never named a plan - every award drew
     the one pool - are the first plan's to take on, or to leave outside. */
  const unassigned = existing || plans.length ? [] : store.securities
    .filter((s) => (s.kind === 'option' || s.kind === 'rsu') && !s.planId && !s.outsidePlan);
  const assignCheck = unassigned.length ? el('input', { type: 'checkbox', checked: true }) : null;

  const rules = Object.fromEntries(RECYCLING_EVENTS.map((event) => [event.value, el('select.select', {
    'aria-label': `Where shares go after ${event.label.toLowerCase()}`,
  }, ruleOptions(existing, plans, event.value, recyclingRule(existing, event.value)))]));

  const saveBtn = el('button.btn.btn-primary.btn-block', { type: 'submit', style: { padding: '12px' } },
    existing ? 'Save changes' : 'Adopt plan');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return invalid(nameInput, 'Name the plan');
      const twin = plans.find((p) => p.id !== existing?.id && p.name.trim().toLowerCase() === name.toLowerCase());
      if (twin) return invalid(nameInput, `${twin.name} is already a plan. Name this one differently`);
      const adopted = adoptedInput.value;
      if (!adopted && (!existing || existing.adopted)) return invalid(adoptedInput, 'Pick the date the plan was adopted');
      if (adopted > today) return invalid(adoptedInput, 'A plan can’t be adopted as of a future date');
      const awardTypes = typeChecks.filter((t) => t.input.checked).map((t) => t.value);
      if (!awardTypes.length) return invalid(typeChecks[0].input, 'Pick at least one kind of award the plan is written for');
      const expires = expiresInput.value;
      if (expires && adopted && expires <= adopted) return invalid(expiresInput, 'The expiration must be after the adoption date');
      let reserve = 0;
      if (reserveInput) {
        const raw = reserveInput.value.trim();
        reserve = raw ? parseNum(raw) : 0;
        if (reserve === null) return invalid(reserveInput, 'Enter the reserve in shares, like 1,500,000');
        if (!Number.isInteger(reserve) || reserve < 0) return invalid(reserveInput, 'A reserve is a whole number of shares');
        if (assignCheck?.checked) {
          const drawn = unassigned.reduce((a, s) => a + Math.max(0, s.quantity - (s.cancelled || 0)), 0);
          if (reserve < drawn) {
            return invalid(reserveInput, `The ${countLabel(unassigned.length, 'award')} this plan takes on already ${unassigned.length === 1 ? 'draws' : 'draw'} ${shares(drawn)}, so the reserve can’t be smaller than that`);
          }
          const early = unassigned.filter((s) => (s.grantDate || s.date) < adopted);
          if (early.length) {
            return invalid(adoptedInput, `${early[0].label} was granted on ${dateLong(early[0].grantDate || early[0].date)}, before this adoption date. Adopt the plan on or before its earliest award, or leave the existing awards outside it`);
          }
          const wrongKind = unassigned.find((s) => !awardTypes.includes(s.kind));
          if (wrongKind) {
            return invalid(typeChecks.find((t) => t.value === wrongKind.kind).input,
              `${wrongKind.label} is ${wrongKind.kind === 'rsu' ? 'an RSU award' : 'an option grant'}, so a plan that takes it on has to be written for those`);
          }
        }
      }
      const recycling = Object.fromEntries(RECYCLING_EVENTS.map((ev) => [ev.value, rules[ev.value].value]));
      const input = { name, adopted, classId: classSelect.value, awardTypes, expires, recycling };
      saveBtn.disabled = true;
      try {
        if (existing) {
          await store.updatePlan(existing.id, input);
          store.logActivity(`${name} updated`, 'pencil');
          toast('Plan updated');
        } else {
          await store.addPlan({ ...input, reserve }, { assignExisting: !!assignCheck?.checked });
          store.logActivity(`${name} adopted${reserve > 0 ? ` with ${sharesLabel(reserve)} reserved` : ''}`
            + (adopted !== today ? `, effective ${dateLong(adopted)}` : ''), 'wallet');
          toast('Plan adopted');
        }
        modal.close();
      } catch (err) {
        saveFailed(err);
        saveBtn.disabled = false;
      }
    },
  },
    field('Name', nameInput),
    el('div.form-grid', {},
      field('Adopted', adoptedInput, existing && !existing.adopted
        ? 'Not recorded for this plan. Awards dated before it are refused once one is set'
        : 'Awards dated before this are refused'),
      field('Expires', expiresInput, 'Optional. No new awards after this date')),
    field('Underlying share class', el('div.select-wrap', {}, classSelect),
      'The class options under this plan exercise into: proposed on the exercise and certificate sheets. An RSU award names the class it settles into when it is granted'),
    el('div.field', {},
      el('span.field-label', {}, 'Written for'),
      typeChecks.map((t) => el('label.check-row', { style: { marginBottom: '6px' } }, t.input, el('span', {}, t.label)))),
    reserveInput
      ? field('Shares reserved', reserveInput,
        'Typically 10 to 20 percent of fully diluted shares, dated the adoption. Resize it later from the plan’s own sheet, as of any date')
      : null,
    assignCheck
      ? el('div', {},
        el('label.check-row', { style: { margin: '2px 0 4px' } }, assignCheck,
          el('span', {}, `Take on the ${countLabel(unassigned.length, 'award')} already on file (${unassigned.map((s) => s.label).slice(0, 4).join(', ')}${unassigned.length > 4 ? '…' : ''})`)),
        el('p.field-hint', { style: { marginBottom: '12px' } },
          'Every award granted so far drew the company’s one pool. Ticked, they draw this plan; unticked, they are recorded as outside any plan and draw no reserve.'))
      : null,
    el('h3.card-title', { style: { margin: '6px 0 4px' } }, 'Where shares go afterwards'),
    el('p.field-hint', { style: { marginBottom: '10px' } },
      'The plan’s recycling rules, one per event. "Return" puts the shares back in this plan’s available reserve; '
      + '"leave the reserve for good" keeps them drawn; pouring over moves them into another plan. Applied to every award under the plan, past and future.'),
    RECYCLING_EVENTS.map((ev) => field(ev.label, el('div.select-wrap', {}, rules[ev.value]), ev.hint)),
    saveBtn,
    existing ? el('a.btn.btn-ghost.btn-block', {
      href: '#/history?record=company', html: icon('clock', 15, 2),
      style: { marginTop: '8px' }, onclick: () => modal.close(),
    }, ' View history') : null);

  const modal = openModal({ title: existing ? `Edit ${existing.name}` : 'Adopt an equity plan', content: form });
}

/**
 * Resize one plan's reserve as of a date. The size is in today's share
 * units, like every count typed into the app; the date says when the change
 * took effect, so earlier snapshots keep the reserve they had.
 */
export function openReserveForm(plan) {
  const today = todayISO();
  const balance = planBalances(store.db).plans.find((r) => r.planId === plan.id);
  const floor = balance ? Math.max(0, balance.reserve - balance.available) : 0;
  const input = el('input.input', {
    type: 'text', inputmode: 'numeric', value: planReserve(plan) !== 0 ? amountValue(planReserve(plan)) : '',
    placeholder: '1,500,000', 'aria-label': 'Shares reserved',
  });
  const dateInput = el('input.input', {
    type: 'date', value: today, max: today, ...(plan.adopted ? { min: plan.adopted } : {}), 'aria-label': 'Effective date',
  });
  const reasonInput = el('input.input', { type: 'text', maxlength: PLAN_REASON_MAX, placeholder: 'Board approval of the evergreen increase', 'aria-label': 'Reason' });
  const saveBtn = el('button.btn.btn-primary.btn-block', { type: 'submit', style: { padding: '12px' } }, 'Save reserve');
  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const raw = input.value.trim();
      const size = raw ? parseNum(raw) : 0;
      if (size === null) return invalid(input, 'Enter the reserve in shares, like 1,500,000');
      if (!Number.isInteger(size) || size < 0) return invalid(input, 'A reserve is a whole number of shares');
      if (size < floor) return invalid(input, `The reserve can’t be smaller than the ${shares(floor)} already committed under this plan`);
      const date = dateInput.value || today;
      if (date > today) return invalid(dateInput, 'A reserve can’t be resized as of a future date');
      if (plan.adopted && date < plan.adopted) return invalid(dateInput, `${plan.name} was adopted on ${dateLong(plan.adopted)}, so its reserve can’t change before that`);
      if (size === planReserve(plan)) {
        return invalid(input, `${plan.name} already reserves ${sharesLabel(size)}. The effective date applies to a change in size, so enter the new size first`);
      }
      saveBtn.disabled = true;
      try {
        await store.resizePlanReserve(plan.id, { size, date, reason: reasonInput.value.trim() });
        store.logActivity(`${plan.name} reserve set to ${sharesLabel(size)}${date !== today ? `, effective ${dateLong(date)}` : ''}`, 'wallet');
        toast('Reserve saved');
        modal.close();
      } catch (err) {
        saveFailed(err);
        saveBtn.disabled = false;
      }
    },
  },
    field('Shares reserved', input, balance
      ? `${shares(balance.committed)} committed under this plan today${balance.pouredIn || balance.pouredOut
        ? `, and ${shares(balance.authorized)} authorized once pour-overs are counted` : ''}. The reserve can’t fall below ${shares(floor)}`
      : null),
    field('Effective date', dateInput, 'Today or earlier. Snapshots before this date keep the previous reserve'),
    field('Reason', reasonInput, 'Optional. Kept on the plan’s history'),
    saveBtn);
  const modal = openModal({ title: `${plan.name} reserve`, content: form });
}

/**
 * Move unallocated shares from one plan to another as of a date: the
 * pour-over a successor plan is written with, or a rebalancing. Both plans
 * record the same movement under one id.
 */
export function openTransferReserveForm({ from = null } = {}) {
  const today = todayISO();
  const plans = plansOf(store.company);
  const balances = planBalances(store.db);
  const available = (id) => balances.plans.find((r) => r.planId === id)?.available ?? 0;
  const fromSelect = el('select.select', { 'aria-label': 'From plan' },
    plans.map((p) => el('option', { value: p.id, selected: p.id === (from?.id || plans[0]?.id) }, `${planOptionLabel(p)} · ${shares(available(p.id))} available`)));
  // Open, and not past its expiration: the store refuses an expired destination, so the picker does not offer one.
  const open = plans.filter((p) => planIsOpen(p) && !(p.expires && p.expires < today));
  const toSelect = el('select.select', { 'aria-label': 'To plan' },
    open.map((p) => el('option', { value: p.id, selected: p.id === open.find((x) => x.id !== fromSelect.value)?.id }, p.name)));
  const qtyInput = el('input.input', { type: 'text', inputmode: 'numeric', placeholder: '25,000', 'aria-label': 'Shares to move' });
  const dateInput = el('input.input', { type: 'date', value: today, max: today, 'aria-label': 'Transfer date' });
  const reasonInput = el('input.input', { type: 'text', maxlength: PLAN_REASON_MAX, placeholder: 'Pour-over to the successor plan', 'aria-label': 'Reason' });
  const hint = el('p.field-hint', {});
  const syncHint = () => {
    const source = plans.find((p) => p.id === fromSelect.value);
    hint.textContent = source
      ? `${source.name} has ${shares(Math.max(0, available(source.id)))} available today. Backdated, the move is also held to what it had on that day.`
      : '';
  };
  fromSelect.addEventListener('change', syncHint);
  syncHint();
  const saveBtn = el('button.btn.btn-primary.btn-block', { type: 'submit', style: { padding: '12px' } }, 'Move shares');
  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const fromPlanId = fromSelect.value;
      const toPlanId = toSelect.value;
      if (!toPlanId) return invalid(toSelect, 'Adopt a second, open plan to move shares into');
      if (fromPlanId === toPlanId) return invalid(toSelect, 'Pick two different plans');
      const quantity = parseNum(qtyInput.value);
      if (!(quantity > 0)) return invalid(qtyInput, 'Enter how many shares move');
      if (!Number.isInteger(quantity)) return invalid(qtyInput, 'Shares move in whole numbers');
      if (quantity > available(fromPlanId)) {
        return invalid(qtyInput, `${plans.find((p) => p.id === fromPlanId)?.name} has ${shares(Math.max(0, available(fromPlanId)))} available to move`);
      }
      const date = dateInput.value || today;
      if (date > today) return invalid(dateInput, 'A transfer can’t be dated in the future');
      saveBtn.disabled = true;
      try {
        await store.transferReserve({ fromPlanId, toPlanId, quantity, date, reason: reasonInput.value.trim() });
        const fromName = plans.find((p) => p.id === fromPlanId)?.name;
        const toName = plans.find((p) => p.id === toPlanId)?.name;
        store.logActivity(`${sharesLabel(quantity)} moved from ${fromName} to ${toName}${date !== today ? `, effective ${dateLong(date)}` : ''}`, 'refresh');
        toast('Shares moved between plans');
        modal.close();
      } catch (err) {
        saveFailed(err);
        saveBtn.disabled = false;
      }
    },
  },
    el('p.confirm-message', {},
      'Unallocated shares leave one plan’s reserve and join another’s on the date given. The company’s total reserve and every holder’s ownership stay exactly as they are.'),
    field('From', el('div.select-wrap', {}, fromSelect), hint),
    field('To', el('div.select-wrap', {}, toSelect)),
    el('div.form-grid', {},
      field('Shares', qtyInput),
      field('Date', dateInput, 'Today or earlier')),
    field('Reason', reasonInput, 'Optional. Kept on both plans’ histories'),
    saveBtn);
  const modal = openModal({ title: 'Move shares between plans', content: form });
}

/**
 * Retire a plan as of a date: no new awards after it, its unallocated
 * shares out of the fully diluted count, its awards and history untouched.
 * The available shares can be poured into a successor on the way, and the
 * rules that returned shares to it pointed there too.
 */
export function openRetirePlanForm(plan) {
  const today = todayISO();
  const plans = plansOf(store.company);
  const last = planLastActivity(store.db, plan.id);
  const balance = planBalances(store.db).plans.find((r) => r.planId === plan.id);
  const successors = plans.filter((p) => p.id !== plan.id && planIsOpen(p));
  const dateInput = el('input.input', {
    type: 'date', value: today, max: today, ...(last ? { min: last } : {}), 'aria-label': 'Retirement date',
  });
  const pourSelect = el('select.select', { 'aria-label': 'Pour the available shares into' },
    el('option', { value: '' }, successors.length ? 'Leave them on the retired plan' : 'No open plan to receive them'),
    successors.map((p) => el('option', { value: p.id }, p.name)));
  const recycleCheck = el('input', { type: 'checkbox', checked: successors.length > 0 });
  const recycleRow = el('label.check-row', { style: { margin: '2px 0 4px' } }, recycleCheck,
    el('span', {}, 'Send later returns to that plan too'));
  const syncRecycle = () => { recycleRow.style.display = pourSelect.value ? '' : 'none'; };
  pourSelect.addEventListener('change', syncRecycle);
  syncRecycle();
  const saveBtn = el('button.btn.btn-danger.btn-block', { type: 'submit', style: { padding: '12px' } }, 'Retire plan');
  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const date = dateInput.value || today;
      if (date > today) return invalid(dateInput, 'A plan can’t be retired as of a future date');
      if (last && date < last) return invalid(dateInput, `${plan.name} has an award or reserve change dated ${dateLong(last)}, so it can’t be retired before that`);
      const pourOverTo = pourSelect.value || null;
      saveBtn.disabled = true;
      try {
        const { pouredOver } = await store.retirePlan(plan.id, {
          date, pourOverTo, recycleTo: pourOverTo && recycleCheck.checked ? pourOverTo : null,
        });
        const to = pourOverTo ? plans.find((p) => p.id === pourOverTo)?.name : '';
        store.logActivity(`${plan.name} retired${date !== today ? ` as of ${dateLong(date)}` : ''}`
          + (pouredOver > 0 ? `, ${sharesLabel(pouredOver)} poured over into ${to}` : ''), 'logout');
        toast('Plan retired');
        modal.close();
      } catch (err) {
        saveFailed(err);
        saveBtn.disabled = false;
      }
    },
  },
    el('p.confirm-message', {},
      `Nothing more is granted under ${plan.name} after this date. Its ${countLabel(balance?.awards || 0, 'award')} and its history stay exactly as they are, `
      + `and its ${shares(Math.max(0, balance?.available || 0))} unallocated shares leave the fully diluted count`
      + (successors.length ? ', unless they are poured into another plan below.' : '.')),
    field('Retirement date', dateInput, last ? `On or after ${dateLong(last)}, the plan’s latest award or reserve change` : 'Today or earlier'),
    field('Pour the available shares into', el('div.select-wrap', {}, pourSelect),
      'A dated, linked transfer of everything the plan has available on that day'),
    recycleRow,
    el('p.field-hint', { style: { marginBottom: '12px' } },
      'A retired plan’s awards can still be cancelled or exercised. Ticked, every rule that returned shares to this plan points at the successor instead, so a later forfeiture lands there.'),
    saveBtn);
  const modal = openModal({ title: `Retire ${plan.name}`, content: form });
}

/** Reopen a retired plan after a confirm; nothing else about it changes. */
export async function reopenPlan(plan) {
  const ok = await confirmDialog({
    title: `Reopen ${plan.name}?`,
    message: `New awards can be granted under it again, and its unallocated shares count as fully diluted again. Its retirement on ${dateLong(plan.retiredAt)} comes off the record.`,
    confirmLabel: 'Reopen', danger: false,
  });
  if (!ok) return;
  try {
    await store.updatePlan(plan.id, { status: 'active' });
    store.logActivity(`${plan.name} reopened`, 'refresh');
    toast('Plan reopened');
  } catch (err) {
    saveFailed(err);
  }
}

/** Delete a plan nothing refers to, after a confirm; the store says why when something does. */
export async function removePlan(plan) {
  const ok = await confirmDialog({
    title: `Delete ${plan.name}?`,
    message: planReserve(plan) > 0
      ? `Its ${sharesLabel(planReserve(plan))} reserve and its history go with it. Retiring keeps both.`
      : 'No award draws from it, so nothing else changes.',
    confirmLabel: 'Delete',
  });
  if (!ok) return;
  try {
    await store.deletePlan(plan.id);
    store.logActivity(`${plan.name} deleted`, 'trash');
    toast('Plan deleted', { icon: 'trash' });
  } catch (err) {
    saveFailed(err);
  }
}

const LEDGER_KIND = {
  adoption: 'Reserve', resize: 'Reserve', 'top-up': 'Reserve', transfer: 'Transfer', split: 'Split', retirement: 'Reserve',
  grant: 'Grant', cancellation: 'Cancellation', expiration: 'Expiration', exercise: 'Exercise', settlement: 'Settlement',
  repurchase: 'Repurchase', 'pour-over': 'Pour-over',
};

/**
 * How a plan got where it is: its balances today, and every dated movement
 * of its authorized and committed counts with the running available after
 * each - in today's share units, so the rows add up to the figures on the
 * plan today whatever splits came between. Exportable.
 */
export function openPlanLedger(plan) {
  const ledger = planLedger(store.db, plan.id);
  const balance = planBalances(store.db).plans.find((r) => r.planId === plan.id);
  if (!ledger || !balance) return toast(`${plan.name} is no longer on file`, { icon: 'alert' });
  const signed = (n) => (n > 0 ? `+${shares(n)}` : n < 0 ? `-${shares(-n)}` : '');
  const metric = (label, value) => el('div.round-metric', {}, el('span', {}, label), el('span.v', {}, value));
  const restated = (store.company.splits || []).length > 0;

  const rows = ledger.rows.map((r) => el('tr', {},
    el('td', { style: { whiteSpace: 'nowrap' } }, r.date ? dateLong(r.date) : 'No date'),
    el('td', {},
      el('div', {}, r.label),
      r.detail ? el('div.small.muted', {}, r.detail) : null),
    el('td', {}, el('span.kind-pill', {}, LEDGER_KIND[r.kind] || r.kind)),
    el('td.num', { style: { whiteSpace: 'nowrap' } }, signed(r.authorized) || (r.informational ? el('span.muted', {}, '0') : '')),
    el('td.num', { style: { whiteSpace: 'nowrap' } }, signed(r.committed) || (r.informational ? el('span.muted', {}, '0') : '')),
    el('td.num', { style: { whiteSpace: 'nowrap' } }, shares(r.balance.available))));

  const exportBtn = el('button.btn.btn-ghost', {
    type: 'button', html: icon('file-down', 14, 2),
    onclick: () => {
      const out = [
        [`${store.company.name || 'Company'} - ${plan.name} reserve movements as of ${todayISO()} - share counts in today's units - amounts in ${currencyCode()}`],
        [],
        ['Date', 'Movement', 'Detail', 'Kind', 'Authorized change', 'Committed change', 'Authorized after', 'Committed after', 'Available after'],
        ...ledger.rows.map((r) => [r.date, r.label, r.detail, LEDGER_KIND[r.kind] || r.kind, r.authorized, r.committed,
          r.balance.authorized, r.balance.committed, r.balance.available]),
        [],
        ['Closing', '', '', '', '', '', ledger.closing.authorized, ledger.closing.committed, ledger.closing.available],
      ];
      downloadFile(`plan-${plan.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plan'}-${todayISO()}.csv`, toCSV(out), 'text/csv');
      toast('Movements exported');
    },
  }, ' Export CSV');

  const content = el('div', {},
    el('div', { style: { marginBottom: '14px' } },
      metric('Reserved by the plan', shares(balance.reserve)),
      balance.pouredIn > 0 ? metric('Poured in from other plans', `+${shares(balance.pouredIn)}`) : null,
      balance.pouredOut > 0 ? metric('Poured over into other plans', `-${shares(balance.pouredOut)}`) : null,
      metric('Authorized', shares(balance.authorized)),
      metric('Committed', shares(balance.committed)),
      metric('Available', shares(balance.available)),
      !planIsOpen(plan) ? metric('Counted as fully diluted', '0 (retired)') : null),
    el('p.field-hint', { style: { marginBottom: '10px' } },
      `Opening ${shares(0)} authorized and ${shares(0)} committed, plus every movement below, ${ledger.reconciles ? 'comes to exactly' : 'does not come to'} `
      + `the ${shares(ledger.closing.authorized)} authorized and ${shares(ledger.closing.committed)} committed on the plan today.`
      + (restated ? ' Every count is in today’s share units; a split appears with the rounding it left.' : '')),
    ledger.rows.length
      ? el('div.table-wrap', { tabindex: 0, role: 'region', 'aria-label': `${plan.name} movements table` },
        el('table.data', { style: { minWidth: '760px' } },
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col' }, 'Date'),
            // The movement names the award and what happened to it: it gets the room.
            el('th', { scope: 'col', style: { minWidth: '280px' } }, 'Movement'),
            el('th', { scope: 'col' }, 'Kind'),
            el('th.num', { scope: 'col' }, 'Authorized'),
            el('th.num', { scope: 'col' }, 'Committed'),
            el('th.num', { scope: 'col' }, 'Available after'))),
          el('tbody', {}, rows)))
      : el('p.small.muted', {}, 'Nothing has moved yet: no reserve, no awards.'),
    el('div.row.row-end', { style: { marginTop: '12px' } }, exportBtn));
  openModal({ title: `${plan.name} movements`, content, wide: true });
}

