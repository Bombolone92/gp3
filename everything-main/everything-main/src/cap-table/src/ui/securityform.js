import { securityTermsEditor } from './financingterms.js';
/**
 * Issue / edit securities: share certificates, option grants, RSU awards,
 * warrants, SAFEs, and convertible notes. One modal, a kind switcher (locked
 * when editing), and per-kind fields. Stakeholders can be created inline so
 * issuing the first certificate never dead-ends.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { field, flagInvalid, segmented, holderOptionLabel, holderNamed, authorizedWarning } from './bits.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { attachmentsSection } from './attachments.js';
import { splitsSincePhrase } from './split.js';
import { store, MAX_VESTING_TRANCHES, isRefusal } from '../lib/store.js';
import {
  STAKEHOLDER_KINDS, hasVesting, grantOutstanding, grantExercised,
  currentFMV, isoOverLimitYears, isoBasisNote, ISO_ANNUAL_LIMIT,
  VESTING_FREQUENCIES, ACCELERATION_TRIGGERS, vestingTranches, vestingScheduleLimit,
  rsuSettled, rsuOutstanding, cancellationHistory, exerciseCutoff, warrantExercised,
  deadline83b, DAYS_83B, exerciseAheadOfVesting, vestingCeiling, vestingStopDate, MAX_VESTING_MONTHS, unsplitFactor,
  plansOf, planAccepts, planRefusal, planBalances, planIsOpen, planCapacityError,
} from '../lib/captable.js';
import { planOptionLabel } from './planform.js';
import { parseNum, todayISO, addMonthsISO } from '../lib/util.js';
import {
  shares as fmtShares, pct, sharePrice, moneyWhole, moneyUSD, dateLong, currencySymbol,
  amountValue, decimalValue, countLabel,
} from '../lib/format.js';

const KINDS = [
  { value: 'shares', label: 'Shares' },
  { value: 'option', label: 'Options' },
  { value: 'rsu', label: 'RSU' },
  { value: 'warrant', label: 'Warrant' },
  { value: 'safe', label: 'SAFE' },
  { value: 'note', label: 'Note' },
];

const NEW_HOLDER = '__new__';

/**
 * A stored figure, pre-filled the way the app writes every other number:
 * grouped. The placeholders under these very fields demonstrate grouping,
 * every count the app prints is grouped, and `parseNum` reads it straight
 * back - so a share count read back as a bare run of digits left the reader
 * counting them to tell 3.8 million from 380 thousand.
 *
 * Empty stays empty: a field with nothing in it is not a zero.
 */
const countValue = (n) => (n === null || n === undefined || n === '' ? '' : amountValue(n));

/**
 * The same, for a price or a strike: written out in full rather than grouped,
 * since these run to four decimals and below and there is nothing to group.
 * A price a forward split had taken under a millionth prefilled as "1e-7",
 * which parseNum refuses on purpose, so the form would not save its own
 * number back unchanged.
 */
const priceValue = (n) => (n === null || n === undefined || n === '' ? '' : decimalValue(n));

/** Standard option term: ten years from grant. */
const OPTION_TERM_MONTHS = 120;

const SAFE_TYPE_HINT = {
  post: 'The cap fixes the holder’s ownership of the company after every SAFE and note converts. The YC standard since 2018.',
  pre: 'The cap divides by today’s fully diluted shares, so SAFEs signed later dilute this one too.',
};

const OPTION_TYPE_HINT = {
  nso: 'Non-qualified stock option. The spread is taxed as income at exercise. Anyone can receive one.',
  iso: 'Incentive stock option. Tax-advantaged for the holder, but only employees can receive them and the $100K annual limit applies.',
};

/**
 * The class a certificate goes into when the cap table has none yet: the
 * common class, else the first one, else a Common Stock class created on the
 * spot so first-time issuance never dead-ends. A failed save on the same
 * sheet may already have created it, which is why an existing class is
 * looked for first rather than the picker's absence being trusted.
 *
 * Created with nothing filled in beyond its name and kind. It used to arrive
 * with ten million authorized shares and a par value nobody had typed, and
 * the share classes page then reported both as facts about the charter -
 * flagging the first founder issuance of twelve million shares as "2,000,000
 * over authorized" against a limit the user had never set.
 */
export async function ensureShareClass() {
  return store.classes.find((c) => c.kind === 'common') || store.classes[0]
    || store.addClass({ name: 'Common Stock', kind: 'common', authorized: 0, pricePerShare: 0 });
}

/**
 * `prefill` seeds a field on a new record without pretending to be one: the
 * hiring plan opens this form with a planned grant's size in it, and nothing
 * else about the planned row is a security.
 */
export function openSecurityForm({
  kind = 'shares', existing = null, prefill = null, onSaved = null,
} = {}) {
  let currentKind = existing?.kind || kind;
  /* New SAFEs default to post-money (the YC standard since 2018); stored
     records carry whichever type they were saved with. */
  let safeType = existing?.kind === 'safe' ? (existing.safeType || 'pre') : 'post';
  /* New grants default to NSO: an ISO is a specific tax election with
     eligibility rules, not something to assume. */
  let optionType = existing?.kind === 'option' && existing.optionType === 'iso' ? 'iso' : 'nso';
  /* Schedule shape, custom tranches, and acceleration are modal state like
     safeType: switching kinds re-renders the form, and rebuilding them from
     scratch would silently discard half-entered tranches. */
  let schedule = vestingTranches(existing || {})
    ? 'custom'
    : (existing?.vestingFrequency || 'monthly');
  /**
   * The stored record, for the time-based schedule fields only - null once a
   * custom tranche list is what the record actually carries.
   *
   * A grant or award on tranches stores `vestingMonths: 0, cliffMonths: 0`,
   * which is the same shape a grant with no schedule at all has. Read back
   * literally, switching the picker from "Custom tranches" to Monthly filled
   * both fields with 0 - so saving turned a half-vested award into a fully
   * vested one without a word, since zero months means nothing is left to
   * earn. The standard 48 and 12 are what a schedule the user is choosing
   * afresh should propose, exactly as they do on a certificate.
   */
  const timeSchedule = vestingTranches(existing || {}) ? null : existing;
  const tranches = (existing?.vestingTranches || []).map((t) => ({ ...t }));
  /**
   * The position a schedule is measured against, which is not always what the
   * certificate holds. A repurchase out of the unvested tail leaves the whole
   * schedule behind on a smaller position - the app writes a 900-share
   * remainder against the 1,000-share schedule it was earning, and
   * vestedQuantity clamps it - so a tranche list summing past the
   * certificate's size can be the app's own record, and refusing it meant
   * refusing to save a price change without rewriting the vesting.
   */
  const scheduleWrittenFor = (qtyVal) => vestingScheduleLimit(existing, qtyVal);
  /* The tranche rows that are part of the schedule: anything with a date, a
     count, or text typed into the count box. A row added and left blank is
     not. */
  const scheduleRows = () => tranches.filter((t) => t.date || Number(t.quantity) > 0 || String(t.raw ?? '').trim());
  /* Whether the rows differ from the schedule the record stores - or the
     quantity they cover does, since a quantity grown past the list rewrites
     the schedule as much as a new row does. A new record has nothing to be
     unchanged from. The save holds an under-sum list to its rule only when
     this is true (a record already stored that way stays editable), and the
     hint under the editor reads the same predicate, so it never announces a
     rule the save is not going to apply. */
  const scheduleChanged = (rows, qtyVal) => {
    if (!existing) return true;
    const stored = existing.vestingTranches || [];
    return stored.length !== rows.length
      || rows.some((t, i) => t.date !== stored[i]?.date || Number(t.quantity) !== Number(stored[i]?.quantity))
      || qtyVal !== Math.round(Number(existing.quantity) || 0);
  };
  let accelTrigger = existing?.accelTrigger || '';
  let accelPct = existing?.accelPct ?? 100;
  /* The holder choice and any half-typed new-holder details are modal state,
     like safeType: switching kinds re-renders the whole form, and a picker
     rebuilt from scratch would silently reset to the first stakeholder.

     Nobody is chosen for a new security until someone is. The picker used to
     open on whichever stakeholder happened to be first - a founder, on most
     cap tables - so a grant confirmed without touching it went to them, the
     same default the transfer sheet and the round close refuse to make for
     their recipient. With no one on the cap table yet the new-holder fields
     open straight away, so issuing the first certificate still never
     dead-ends. */
  let chosenHolder = existing?.stakeholderId || (store.stakeholders.length ? '' : NEW_HOLDER);
  const newHolder = { name: '', kind: STAKEHOLDER_KINDS[0].value };
  const body = el('div');
  /* The per-kind fields are rebuilt when the kind changes; the switcher above
     them is not, so it keeps focus (and its aria-pressed state) across the
     change it caused. role=group + aria-pressed, like every other segmented
     control here: tablist semantics would promise arrow-key navigation and
     tab panels this control doesn't have. */
  const formWrap = el('div');
  const kindSeg = existing ? null : segmented(KINDS, {
    label: 'Security type', value: currentKind, extraClass: 'seg-kinds',
    onSelect: (value) => { currentKind = value; render(); },
  });
  const modal = openModal({
    title: existing ? `Edit ${existing.label}` : 'Issue a security',
    content: body,
  });
  if (kindSeg) body.append(kindSeg);
  body.append(formWrap);

  const numInput = (attrs = {}) => el('input.input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off', ...attrs,
  });

  /* The hint under the acceleration picker: what each trigger means. */
  const ACCEL_HINT = {
    single: 'Everything below accelerates on a change of control alone.',
    double: 'Accelerates on a change of control plus an involuntary termination.',
  };

  /**
   * Schedule editor shared by option grants and vesting certificates: the
   * standard time-based shapes stay two fields, "Custom tranches" opens an
   * editable date → shares list, and acceleration terms ride along.
   */
  function scheduleEditor(controls, { startField = null, onChange = null } = {}) {
    const freqSelect = el('select.select', { 'aria-label': 'Vesting schedule' },
      VESTING_FREQUENCIES.map((f) => el('option', { value: f.value, selected: schedule === f.value }, f.label)),
      el('option', { value: 'custom', selected: schedule === 'custom' }, 'Custom tranches'));

    const timeFields = el('div', {},
      startField,
      el('div.form-grid', {},
        field('Vesting (months)', controls.vesting, 'Standard is 48'),
        field('Cliff (months)', controls.cliff, 'Standard is 12')));

    /* Custom tranche list. The rows have to add up to the security: a list
       that covers less leaves the rest unvested for good, and the save
       refuses it. The hint said the opposite - that the rest would vest
       once more rows were added - so the editor told the user two rules. */
    const rowsWrap = el('div');
    const totalHint = el('p.field-hint', { style: { margin: '2px 0 12px' } });
    const syncTotal = () => {
      const target = parseNum(controls.qty.value) ?? 0;
      const written = scheduleWrittenFor(target);
      const sum = tranches.reduce((a, t) => a + Math.max(0, Number(t.quantity) || 0), 0);
      /* A stored list that stops short is left as it stands unless it is
         touched - see collectSchedule - so the tail says what the shortfall
         is rather than promising a refusal that is not coming. */
      const short = scheduleChanged(scheduleRows(), target)
        ? `${fmtShares(target - sum)} still to add before saving`
        : `${fmtShares(target - sum)} unscheduled, and never vest as stored`;
      totalHint.textContent = tranches.length
        ? `${fmtShares(sum)} of ${fmtShares(target)} scheduled${sum > written
          ? ' - more than this security holds'
          : sum > target
            ? ' - the balance was bought back and never arrives'
            : sum < target ? ` - ${short}` : ''}`
        : 'No tranches yet. Add a row for each date shares vest on; together they cover the whole quantity.';
      onChange?.();
    };
    controls.syncTrancheTotal = syncTotal;
    controls.qty.addEventListener('input', syncTotal);
    /* Headings for the rows below, on the same grid so each one sits over the
       field it names. Hidden while the list is empty: headings over an empty
       list name nothing, and the hint under the Add button is what has
       something to say at that point. */
    const trancheHead = el('div.tranche-row', {},
      el('span.field-label', {}, 'Vests on'),
      el('span.field-label', {}, 'Shares'));
    const renderRows = () => {
      rowsWrap.replaceChildren(...tranches.map((t, i) => el('div.tranche-row', {},
        el('input.input', {
          type: 'date', value: t.date || '', 'aria-label': `Tranche ${i + 1} date`,
          onchange: (e) => { t.date = e.target.value; syncTotal(); },
        }),
        /* The text as typed rides beside the parsed count: parsed alone, a
           count parseNum refuses ("1e3", "-500") read as 0, and the next
           rebuild of the rows - a Remove on another row - drew the box empty
           with the typing gone, while the save's refusal said the row had
           no share count when the box visibly held one. */
        numInput({
          value: t.raw ?? countValue(t.quantity || ''), placeholder: '10,000', 'aria-label': `Tranche ${i + 1} shares`,
          oninput: (e) => { t.raw = e.target.value; t.quantity = parseNum(e.target.value) ?? 0; syncTotal(); },
        }),
        el('button.icon-btn', {
          type: 'button', 'aria-label': `Remove tranche ${i + 1}`, html: icon('x', 15, 2),
          onclick: () => {
            tranches.splice(i, 1);
            renderRows();
            /* The button just pressed went with its row, and with the app
               inert behind the dialog focus fell to the document body. It
               moves to the remove button that took this row's place, or the
               last one, or Add tranche once the list is empty - the same
               hand-off the round close gives its investor rows. */
            const left = [...rowsWrap.querySelectorAll('.icon-btn')];
            (left[Math.min(i, left.length - 1)] || addTrancheBtn).focus();
          },
        }))));
      trancheHead.hidden = tranches.length === 0;
      addTrancheBtn.disabled = tranches.length >= MAX_VESTING_TRANCHES;
      trancheLimit.hidden = tranches.length < MAX_VESTING_TRANCHES;
      syncTotal();
    };
    const addTrancheBtn = el('button.btn.btn-ghost', {
      type: 'button', html: icon('plus', 14, 2.2),
      onclick: () => {
        if (tranches.length >= MAX_VESTING_TRANCHES) return;
        tranches.push({ date: '', quantity: 0 }); renderRows();
        // The new row's date is what the press was for - see the round close's Add investor.
        rowsWrap.lastElementChild?.querySelector('input')?.focus();
      },
    }, ' Add tranche');
    const trancheLimit = el('p.field-hint', {},
      `Maximum ${MAX_VESTING_TRANCHES} tranches. Combine or remove a tranche to add another.`);
    const customFields = el('div', {},
      trancheHead,
      rowsWrap,
      addTrancheBtn,
      trancheLimit,
      totalHint);
    renderRows();

    /* Acceleration terms. The percentage only exists once there is a
       trigger to fire it. */
    controls.accelPct = numInput({ value: accelPct, 'aria-label': 'Acceleration percent' });
    controls.accelPct.addEventListener('input', () => { accelPct = controls.accelPct.value; });
    const accelHint = el('p.field-hint', { style: { display: accelTrigger ? '' : 'none', marginTop: '-8px' } },
      ACCEL_HINT[accelTrigger] || '');
    const accelPctField = field('Accelerates (%)', controls.accelPct, 'Of the unvested balance');
    const accelSelect = el('select.select', { 'aria-label': 'Acceleration trigger' },
      ACCELERATION_TRIGGERS.map((t) => el('option', { value: t.value, selected: accelTrigger === t.value }, t.label)));
    // Named so a refusal about the terms can point at the picker.
    controls.accelSelect = accelSelect;
    const accelRow = el('div.form-grid', {},
      field('Acceleration', el('div.select-wrap', {}, accelSelect)),
      accelPctField);
    const syncAccel = () => {
      accelPctField.style.display = accelTrigger ? '' : 'none';
      accelHint.style.display = accelTrigger ? '' : 'none';
      accelHint.textContent = ACCEL_HINT[accelTrigger] || '';
    };
    accelSelect.addEventListener('change', () => { accelTrigger = accelSelect.value; syncAccel(); });
    syncAccel();

    const syncMode = () => {
      timeFields.style.display = schedule === 'custom' ? 'none' : '';
      customFields.style.display = schedule === 'custom' ? '' : 'none';
    };
    freqSelect.addEventListener('change', () => { schedule = freqSelect.value; syncMode(); onChange?.(); });
    syncMode();

    return el('div', {},
      field('Vesting schedule', el('div.select-wrap', {}, freqSelect)),
      timeFields,
      customFields,
      accelRow,
      accelHint);
  }

  function vestingStartControl(controls) {
    controls.vestStart = el('input.input', {
      type: 'date', value: existing?.vestingStart || controls.dateInput.value || todayISO(),
      'aria-label': 'Vesting start date',
    });
    /* New schedules follow the grant/issue date until the user specifies a
       different service date. An explicit start survives date edits - and
       only a start that differs from the record's date is explicit: the
       sheet used to write the grant date into `vestingStart` on every save,
       so a mistyped grant date corrected on the next edit left the clock on
       the old day and every vested figure with it. */
    let edited = !!existing?.vestingStart && existing.vestingStart !== (existing.grantDate || existing.date);
    controls.vestStart.addEventListener('input', () => { edited = true; });
    controls.dateInput.addEventListener('change', () => {
      if (!edited && controls.dateInput.value) controls.vestStart.value = controls.dateInput.value;
    });
    return field('Vesting start', controls.vestStart,
      currentKind === 'shares' ? 'May differ from the share issue date' : 'May differ from the grant date to reflect credited service');
  }

  /* Certificates vest only when asked to (founder restricted stock), so the
     schedule stays folded away behind a checkbox and every other
     certificate keeps its two-field simplicity. */
  function certVestingBlock(controls) {
    const toggle = el('input', { type: 'checkbox', checked: hasVesting(existing || {}) });
    controls.vestToggle = toggle;
    const startField = vestingStartControl(controls);
    controls.vesting = numInput({ value: existing?.vestingMonths || 48, 'aria-label': 'Vesting months' });
    controls.cliff = numInput({ value: existing?.vestingMonths ? (existing.cliffMonths ?? 0) : 12, 'aria-label': 'Cliff months' });

    /* Reverse-vesting stock runs a 30-day 83(b) window from issuance, so the
       filing status lives right next to the schedule that causes it. */
    controls.filed83b = el('input', { type: 'checkbox', checked: !!existing?.filed83b });
    /* The filing date follows the issue date until someone types their own,
       the way the vesting start above does. It defaulted to today, so back-
       dated founder stock entered with "filed" ticked recorded an election
       filed years after its 30-day window - and printed it as filed.

       A transfer remainder's window ran from the original purchase, which it
       carries as `date83b`, so that is the day it opens on and the issue
       date has no say: opened on the transfer date, the default sat past the
       deadline the save then held it to, and the box could not be ticked
       without typing the date over. */
    const anchor83b = existing?.date83b || '';
    controls.filed83bDate = el('input.input', {
      type: 'date', value: existing?.filed83b || anchor83b || controls.dateInput.value || todayISO(),
      'aria-label': '83(b) filing date',
    });
    let filedEdited = !!existing?.filed83b;
    controls.filed83bDate.addEventListener('input', () => { filedEdited = true; });
    controls.dateInput.addEventListener('change', () => {
      if (!filedEdited && !anchor83b && controls.dateInput.value) {
        controls.filed83bDate.value = controls.dateInput.value;
      }
    });
    const filed83bField = field('Filed on', controls.filed83bDate);
    const sync83b = () => { filed83bField.style.display = controls.filed83b.checked ? '' : 'none'; };
    controls.filed83b.addEventListener('change', sync83b);
    sync83b();

    const fields = el('div', {},
      scheduleEditor(controls, {
        startField,
      }),
      el('label.check-row', { style: { margin: '2px 0 4px' } }, controls.filed83b,
        el('span', {}, '83(b) election filed')),
      el('p.field-hint', { style: { marginBottom: '10px' } },
        'Reverse-vesting stock starts a 30-day 83(b) window at issuance. Cap Table reminds; it never files.'),
      filed83bField);
    const sync = () => { fields.style.display = toggle.checked ? '' : 'none'; };
    toggle.addEventListener('change', sync);
    sync();

    return el('div', { style: { marginBottom: '4px' } },
      el('label.check-row', { style: { marginBottom: '10px' } }, toggle,
        el('span', {}, 'These shares vest (founder restricted stock)')),
      fields);
  }

  /* Pre vs post-money cap: the same cap number means very different
     dilution, so the switcher carries a one-line explanation of each. */
  function safeTypeField(controls) {
    const hint = el('p.field-hint', {}, SAFE_TYPE_HINT[safeType]);
    const seg = segmented([
      { value: 'post', label: 'Post-money' },
      { value: 'pre', label: 'Pre-money' },
    ], {
      label: 'Valuation cap type', value: safeType, wide: true,
      onSelect: (value) => {
        safeType = value;
        hint.textContent = SAFE_TYPE_HINT[safeType];
        controls.syncImplied?.();
      },
    });
    return el('div.field', {}, el('span.field-label', {}, 'Valuation cap type'), seg, hint);
  }

  /* ISO vs NSO changes what the holder owes and what the company must file,
     so the switcher explains each - and flipping it re-checks the
     eligibility and $100K warnings, which only exist for ISOs. */
  function optionTypeField(onChange) {
    const hint = el('p.field-hint', {}, OPTION_TYPE_HINT[optionType]);
    const seg = segmented([
      { value: 'nso', label: 'NSO' },
      { value: 'iso', label: 'ISO' },
    ], {
      label: 'Tax classification', value: optionType, wide: true,
      onSelect: (value) => {
        optionType = value;
        hint.textContent = OPTION_TYPE_HINT[optionType];
        onChange?.();
      },
    });
    return el('div.field', {}, el('span.field-label', {}, 'Tax classification'), seg, hint);
  }

  function render() {
    clear(formWrap);

    /* Stakeholder picker with inline creation */
    const holderSelect = el('select.select', { 'aria-label': 'Stakeholder' },
      existing || !store.stakeholders.length ? null
        : el('option', { value: '', disabled: true, selected: chosenHolder === '' }, 'Choose a stakeholder…'),
      store.stakeholders.map((h) => el('option', {
        value: h.id, selected: h.id === chosenHolder,
      }, holderOptionLabel(h))),
      el('option', { value: NEW_HOLDER, selected: chosenHolder === NEW_HOLDER }, '+ New stakeholder…'));
    const newHolderName = el('input.input', {
      type: 'text', value: newHolder.name, placeholder: 'Full name', maxlength: 120,
      'aria-label': 'New stakeholder name',
      oninput: (e) => { newHolder.name = e.target.value; },
    });
    const newHolderKind = el('select.select', {
      'aria-label': 'New stakeholder type',
      onchange: (e) => { newHolder.kind = e.target.value; },
    }, STAKEHOLDER_KINDS.map((k) => el('option', { value: k.value, selected: k.value === newHolder.kind }, k.label)));
    const newHolderRow = el('div.form-grid', { style: { display: chosenHolder === NEW_HOLDER ? undefined : 'none' } },
      field('Name', newHolderName),
      field('Type', el('div.select-wrap', {}, newHolderKind)));
    holderSelect.addEventListener('change', () => {
      chosenHolder = holderSelect.value;
      newHolderRow.style.display = chosenHolder === NEW_HOLDER ? '' : 'none';
      if (chosenHolder === NEW_HOLDER) newHolderName.focus();
    });

    /* Per-kind controls */
    /* A stored record shows the date it has - none, for a certificate an
       older backup left dateless - rather than today: opened and saved for a
       price correction, it was stamped with an invented issue date every
       chronology rule then measured against. Only a new record proposes today. */
    const dateVal = existing ? existing.date || existing.grantDate || '' : todayISO();
    const dateInput = el('input.input', { type: 'date', value: dateVal, 'aria-label': 'Date' });
    const controls = { dateInput };
    const sections = [];

    if (currentKind === 'shares' || currentKind === 'warrant' || currentKind === 'rsu') {
      if (!store.classes.length) {
        sections.push(el('p.field-hint', { style: { margin: '4px 0 12px' } },
          'No share classes yet. A Common Stock class is created for this one; set its authorized '
          + 'count and par value under Share classes.'));
      }
      /* A new record proposes the common class, whatever order the classes
         were stored in. The picker used to open on whichever class came
         first - the order they were created or imported in - so a company
         that had set up its preferred class before its common, or brought a
         backup in that way round, saw founder stock, RSU awards and warrants
         proposed into Series Seed Preferred. The exercise and settlement
         sheets already reach for common first; a stored record shows the
         class it holds. */
      const defaultClassId = existing?.classId
        || (store.classes.find((c) => c.kind === 'common') || store.classes[0])?.id;
      controls.classSelect = store.classes.length
        ? el('select.select', { 'aria-label': 'Share class' },
          store.classes.map((c) => el('option', { value: c.id, selected: c.id === defaultClassId }, c.name)))
        : null;
    }

    /* Which plan an option grant or RSU award draws from. The picker lists
       the plans that could hold an award of this kind on the date typed,
       and "Outside any plan" - so an award granted before a plan existed,
       or under none, is said rather than drawn from whichever reserve
       happened to be there. A stored award opens on the plan it names, or
       on "outside" when that is what it says; a new one proposes the most
       recently adopted open plan that could hold it. With no plan adopted
       at all there is nothing to pick, and the award waits for the first
       plan, which offers to take it on. */
    if (currentKind === 'option' || currentKind === 'rsu') {
      const plans = plansOf(store.company);
      if (plans.length) {
        const kind = currentKind;
        let chosen = existing?.planId || (existing?.outsidePlan ? '' : (prefill?.planId || null));
        const eligible = (date) => plans.filter((p) => planAccepts(p, kind, date) || p.id === existing?.planId);
        const proposed = (date) => {
          const open = eligible(date).filter((p) => planIsOpen(p));
          return open.length ? [...open].sort((a, b) => (b.adopted || '').localeCompare(a.adopted || ''))[0].id : '';
        };
        if (chosen === null) chosen = proposed(dateInput.value || todayISO());
        const planSelect = el('select.select', { 'aria-label': 'Equity plan' });
        const planHint = el('p.field-hint', {});
        const syncPlanHint = () => {
          const plan = plans.find((p) => p.id === planSelect.value);
          if (!plan) {
            planHint.textContent = 'Counts toward fully diluted shares and draws no plan reserve.';
            return;
          }
          const row = planBalances({ ...store.db, securities: store.securities.filter((x) => x.id !== existing?.id) }).plans
            .find((r) => r.planId === plan.id);
          planHint.textContent = row
            ? `${fmtShares(Math.max(0, row.available))} of ${fmtShares(row.authorized)} available in this plan${row.available < 0 ? `, ${fmtShares(-row.available)} over its reserve already` : ''}.`
            : '';
        };
        const fill = () => {
          const date = dateInput.value || todayISO();
          const list = eligible(date);
          if (chosen && !list.some((p) => p.id === chosen)) chosen = proposed(date);
          planSelect.replaceChildren(
            ...list.map((p) => el('option', { value: p.id, selected: p.id === chosen }, planOptionLabel(p))),
            el('option', { value: '', selected: !chosen }, 'Outside any plan'));
          syncPlanHint();
        };
        planSelect.addEventListener('change', () => { chosen = planSelect.value; syncPlanHint(); });
        dateInput.addEventListener('change', fill);
        fill();
        controls.planSelect = planSelect;
        controls.planField = field('Plan', el('div.select-wrap', {}, planSelect), planHint);
        planHint.id = `${planSelect.id}-hint`;
        planSelect.setAttribute('aria-describedby', planHint.id);
      }
    }

    if (currentKind === 'warrant') {
      controls.qty = numInput({ placeholder: '100,000', value: countValue(existing?.quantity), 'aria-label': 'Warrant shares' });
      controls.strike = numInput({ placeholder: '0.85', value: priceValue(existing?.strike), 'aria-label': 'Exercise price' });
      controls.expires = el('input.input', { type: 'date', value: existing?.expires || '', 'aria-label': 'Expiration date' });
      sections.push(
        controls.classSelect && field('Underlying share class', el('div.select-wrap', {}, controls.classSelect),
          'The class the holder receives on exercise'),
        el('div.form-grid', {},
          field('Warrant shares', controls.qty),
          field(`Exercise price (${currencySymbol()})`, controls.strike)),
        el('div.form-grid', {},
          field('Issue date', dateInput),
          field('Expiration date', controls.expires, 'Optional')),
        el('p.field-hint', { style: { margin: '-4px 0 12px' } },
          'Warrants count toward fully diluted shares and never draw down the employee option pool.')
      );
    } else if (currentKind === 'shares') {
      /* Both ends of a transfer have their size, class, and date settled: the
         closed source, because its successors were issued against them, and
         each successor, because it was sized and dated off the source in the
         same commit. The store holds them whatever is submitted; showing them
         locked is how the user finds that out before typing rather than after
         saving. */
      const settled = !!(existing?.closedAt || existing?.fromTransferId);
      controls.qty = numInput({ placeholder: '1,000,000', value: countValue(existing?.quantity), 'aria-label': 'Number of shares' });
      controls.pps = numInput({ placeholder: '0.0001', value: priceValue(existing?.pricePerShare), 'aria-label': 'Price per share' });
      if (settled) {
        controls.qty.disabled = true;
        dateInput.disabled = true;
        if (controls.classSelect) controls.classSelect.disabled = true;
      }
      /* A warrant's exercise certificate stays in the warrant's class - the
         store refuses any other - and its date inside the warrant's exercise
         window. The picker offered every class and the save failed with a
         toast pointing at nothing; locked, it reads the way a transfer leg's
         settled fields do, and the date is checked at the save below. */
      const fromWarrant = existing && !existing.fromTransferId && existing.fromWarrantId
        ? store.security(existing.fromWarrantId) : null;
      if (fromWarrant?.kind === 'warrant' && controls.classSelect && !settled) controls.classSelect.disabled = true;
      /* Said before the write, as the round close says it: a certificate
         that takes its class past the charter's authorized count was saved
         without a word, and the classes table said "over authorized" on the
         next visit. A settled certificate cannot change size or class, so
         there is nothing to warn about ahead of its save. */
      const overrun = authorizedWarning();
      const syncOverrun = () => {
        if (settled || !controls.classSelect) return;
        overrun.sync(store.db, controls.classSelect.value, parseNum(controls.qty.value) ?? 0, { excluding: existing?.id });
      };
      controls.qty.addEventListener('input', syncOverrun);
      controls.classSelect?.addEventListener('change', syncOverrun);
      syncOverrun();
      /* The transfer's own money: what the buyer paid, on the buyer's leg,
         and what the company paid, on a certificate a repurchase closed. Both
         were written once by the transfer sheet and shown everywhere after -
         and neither could be corrected, so a consideration mistyped there
         stood for good unless the whole transfer was undone and redone,
         which a leg since sold on or bought back does not even allow. The
         seller's remainder carries neither: its shares changed no hands. */
      const cameOff = existing?.fromTransferId ? store.security(existing.fromTransferId) : null;
      const buyerLeg = !!existing?.fromTransferId
        && (cameOff ? cameOff.stakeholderId !== existing.stakeholderId : existing.transferPricePerShare > 0);
      if (buyerLeg) {
        controls.paid = numInput({
          placeholder: '1.25', 'aria-label': 'Price paid per share',
          value: existing.transferPricePerShare > 0 ? decimalValue(existing.transferPricePerShare) : '',
        });
      }
      if (existing?.closedReason === 'repurchase') {
        controls.repurchasePrice = numInput({
          placeholder: '1.25', 'aria-label': 'Repurchase price per share',
          value: existing.repurchasePricePerShare > 0 ? decimalValue(existing.repurchasePricePerShare) : '',
        });
      }
      sections.push(
        controls.classSelect && field('Share class', el('div.select-wrap', {}, controls.classSelect)),
        fromWarrant?.kind === 'warrant' && !settled
          ? el('p.field-hint', { style: { margin: '-4px 0 12px' } },
            `Issued from ${fromWarrant.label}, so it stays in ${store.shareClass(fromWarrant.classId)?.name || 'the warrant’s class'}`
            + (fromWarrant.expires
              ? `, dated between ${dateLong(fromWarrant.date)} and ${dateLong(fromWarrant.expires)}.`
              : `, dated on or after ${dateLong(fromWarrant.date)}.`))
          : null,
        field('Number of shares', controls.qty),
        overrun.node,
        el('div.form-grid', {},
          field(`Price per share (${currencySymbol()})`, controls.pps),
          field('Issue date', dateInput)),
        /* The price is the one settled figure that stays editable, because it
           is the same number on every certificate of the transfer - the legs
           inherited the source's issue price - and a correction made on any
           of them carries to the rest (the store's rule). Said here, since
           the sheet shows one certificate and the change lands on others. */
        settled ? el('p.field-hint', { style: { margin: '-4px 0 12px' } },
          existing.closedAt
            ? `This certificate was closed by a ${existing.closedReason === 'repurchase' ? 'repurchase' : 'transfer'} on `
              + `${dateLong(existing.closedAt)}. Its size, class, and issue date are fixed - the certificates issued `
              + 'in its place were drawn from them. A change to its price per share carries to those certificates.'
            : `This certificate was issued by a transfer on ${dateLong(existing.date)}. Its size, class, and `
              + 'issue date are fixed - they were drawn from the certificate it came off. Its price per share is that '
              + 'certificate’s issue price, and a change here carries to it and to every other certificate issued off it.') : null,
        controls.paid
          ? field(`Price paid per share (${currencySymbol()})`, controls.paid,
            'What the buyer paid in the transfer. Blank is a gift; the preference keeps following the issue price above.')
          : null,
        controls.repurchasePrice
          ? field(`Repurchase price per share (${currencySymbol()})`, controls.repurchasePrice,
            `What the company paid for the ${existing.repurchasedQty > 0 ? countLabel(existing.repurchasedQty, 'share') : 'shares'} `
            + 'it retired. Blank is a repurchase for nothing.')
          : null,
        certVestingBlock(controls)
      );
    } else if (currentKind === 'rsu') {
      controls.qty = numInput({
        placeholder: '20,000',
        value: countValue(existing?.quantity ?? prefill?.quantity),
        'aria-label': 'Units granted',
      });
      const startField = vestingStartControl(controls);
      controls.vesting = numInput({ placeholder: '48', value: timeSchedule?.vestingMonths ?? 48, 'aria-label': 'Vesting months' });
      controls.cliff = numInput({ placeholder: '12', value: timeSchedule?.cliffMonths ?? 12, 'aria-label': 'Cliff months' });
      controls.liquidity = el('input', { type: 'checkbox', checked: !!existing?.liquidityCondition });
      sections.push(
        controls.planField || null,
        controls.classSelect && field('Settles into', el('div.select-wrap', {}, controls.classSelect),
          'The class the holder receives when units settle'),
        el('div.form-grid', {},
          field('Units granted', controls.qty),
          field('Grant date', dateInput)),
        el('p.field-hint', { style: { margin: '-4px 0 12px' } },
          'An RSU has no strike and nothing to exercise: vested units settle into shares. '
          + 'Unsettled units count toward fully diluted shares and draw their plan’s reserve, '
          + 'exactly as option grants do.'),
        scheduleEditor(controls, { startField }),
        el('label.check-row', { style: { margin: '2px 0 4px' } }, controls.liquidity,
          el('span', {}, 'Settles only on a liquidity event')),
        el('p.field-hint', { style: { marginBottom: '14px' } },
          'The double-trigger shape: units vest on the schedule above, and settle when the '
          + 'company has a liquidity event. Cap Table records the settlement when you do.')
      );
    } else if (currentKind === 'option') {
      /* Strikes must be set at or above fair market value, so a recorded
         409A becomes the default and anything under it is called out. The
         warning never blocks the save: sometimes the number really is right,
         and this app is a record, not a gatekeeper. */
      let fmv = currentFMV(store.company, dateVal);
      controls.qty = numInput({
        placeholder: '50,000',
        value: countValue(existing?.quantity ?? prefill?.quantity),
        'aria-label': 'Options granted',
      });
      controls.strike = numInput({
        placeholder: fmv ? decimalValue(fmv.fmvPerShare) : '0.10',
        value: priceValue(existing?.strike ?? (fmv ? fmv.fmvPerShare : '')),
        'aria-label': 'Strike price',
      });
      /* The figure itself, not only where it came from: on a new grant the
         strike is prefilled with it, but a stored grant shows the strike it
         was written at, and "409A in force on the grant date" under a $0.31
         strike read as though $0.31 were that valuation when the record said
         $0.09. */
      const strikeHint = el('p.field-hint', { style: { display: fmv ? '' : 'none' } });
      const syncStrikeHint = () => {
        strikeHint.textContent = fmv ? `409A in force on the grant date: ${sharePrice(fmv.fmvPerShare)}` : '';
        strikeHint.style.display = fmv ? '' : 'none';
      };
      syncStrikeHint();
      /* A status region, as is the ISO warning below: both appear as the
         user types, under a field that keeps focus, so without the role the
         warning showed on screen and was never announced. */
      const strikeWarning = el('p.field-hint.warn', { role: 'status', style: { display: 'none' } });
      const syncStrike = () => {
        const strike = parseNum(controls.strike.value);
        const low = fmv && strike !== null && strike < fmv.fmvPerShare;
        strikeWarning.style.display = low ? '' : 'none';
        /* Set only when the words change: replacing a live region's text
           with the same text is a mutation most screen readers read again,
           so the whole sentence was re-read on every digit typed. */
        const next = low
          ? `Below the fair market value of ${sharePrice(fmv.fmvPerShare)} in force on this grant date (set ${dateLong(fmv.date)}). Granting under FMV creates tax exposure for the holder.`
          : '';
        if (strikeWarning.textContent !== next) strikeWarning.textContent = next;
      };
      /* The 409A that governs a strike is the one in force on the grant
         date, not the day the form happens to be open - so the benchmark,
         and the default strike until someone types their own, both follow
         the date field. Same pattern as the expiration default below. */
      let strikeEdited = !!existing;
      controls.strike.addEventListener('input', () => { strikeEdited = true; syncStrike(); });
      dateInput.addEventListener('change', () => {
        fmv = currentFMV(store.company, dateInput.value || todayISO());
        /* Written out in full, the way the first render writes it: String()
           prints a price a forward split has taken under a millionth as
           "1e-7", which the form's own parser refuses on purpose - so moving
           the grant date back onto an old 409A filled the strike with a
           number the form then would not save. */
        controls.strike.placeholder = fmv ? decimalValue(fmv.fmvPerShare) : '0.10';
        if (!strikeEdited) controls.strike.value = fmv ? decimalValue(fmv.fmvPerShare) : '';
        syncStrikeHint();
        syncStrike();
      });
      syncStrike();
      const startField = vestingStartControl(controls);
      controls.vesting = numInput({ placeholder: '48', value: timeSchedule?.vestingMonths ?? 48, 'aria-label': 'Vesting months' });
      controls.cliff = numInput({ placeholder: '12', value: timeSchedule?.cliffMonths ?? 12, 'aria-label': 'Cliff months' });
      /* Grants run ten years from the grant date unless someone says
         otherwise, so a new grant's expiry follows the grant date until
         it's edited. A stored record shows exactly what it holds: filling
         the default into a grant whose expiry was deliberately left empty
         would write an expiration nobody set the next time it's edited. */
      controls.expires = el('input.input', {
        type: 'date',
        value: existing ? (existing.expires || '') : addMonthsISO(dateVal, OPTION_TERM_MONTHS),
        'aria-label': 'Expiration date',
      });
      let expiryEdited = !!existing;
      controls.expires.addEventListener('input', () => { expiryEdited = true; });
      dateInput.addEventListener('change', () => {
        if (!expiryEdited && dateInput.value) {
          controls.expires.value = addMonthsISO(dateInput.value, OPTION_TERM_MONTHS);
        }
      });
      /* Built here rather than beside its own label, because the warning
         below has to read it: an early-exercise grant is exercisable in full
         from the day it is granted, which is the whole of the ISO limit
         question for it. */
      controls.earlyEx = el('input', { type: 'checkbox', checked: !!existing?.earlyExercise });
      /* The post-termination window. The departure flow writes it, and a
         grant read as expired the day it closed - but boards extend these
         windows, and nothing let the extension be recorded: the flow cannot
         be re-run on a holder already departed, and the field was nowhere on
         this sheet. Offered once the holder has departed (or a deadline is
         already on the record, however it got there), never before: the
         departure is what starts the clock. */
      const holderNow = existing ? store.stakeholder(existing.stakeholderId) : null;
      const departedOn = existing?.kind === 'option' ? (holderNow?.departed || '') : '';
      if (existing?.kind === 'option' && (existing.exerciseBy || departedOn)) {
        controls.exerciseBy = el('input.input', {
          type: 'date', value: existing.exerciseBy || '', 'aria-label': 'Post-termination exercise deadline',
          ...(departedOn ? { min: departedOn } : {}),
        });
        controls.departedOn = departedOn;
        controls.departedName = holderNow?.name || 'the holder';
        /* A grant the departure flow never covered (added or backdated since)
           carries no vesting stop. The record reads a deadline with no stop as
           an older departure and stops the grant's vesting on the day the
           holder left (see sanitizeSecurities) - what the flow would have
           done - so the sheet says so, and writes it on purpose. */
        controls.stampsStop = !existing.vestingStoppedAt && !!departedOn
          && departedOn >= (existing.grantDate || existing.date || '');
        /* A departure recorded ahead of time (a notice period) is still to
           come, and the picker above already says "(departing)" for it -
           this hint and the refusal below said "departed" on the same sheet. */
        controls.departVerb = departedOn > todayISO() ? 'departs' : 'departed';
      }
      /* ISO guardrails, in the 409A warning's posture: informative, never
         blocking. Both rules are easy to trip without a tool watching -
         ISOs to a non-employee, and a year where the ISO strike value
         first becoming exercisable crosses $100K. */
      const isoWarning = el('p.field-hint.warn', { role: 'status', style: { display: 'none' } });
      const syncIso = () => {
        const problems = [];
        if (optionType === 'iso') {
          const holderKind = holderSelect.value === NEW_HOLDER
            ? newHolder.kind
            : store.stakeholder(holderSelect.value)?.kind;
          if (holderKind && holderKind !== 'employee' && holderKind !== 'founder') {
            problems.push('ISOs can only go to employees. Advisors, contractors, and entities must receive NSOs.');
          }
          const candidate = {
            id: existing?.id || '__candidate__',
            kind: 'option', optionType: 'iso',
            stakeholderId: holderSelect.value,
            quantity: parseNum(controls.qty.value) ?? 0,
            strike: parseNum(controls.strike.value) ?? 0,
            grantDate: dateInput.value || todayISO(),
            earlyExercise: controls.earlyEx.checked,
          };
          if (schedule === 'custom') {
            candidate.vestingTranches = tranches
              .filter((t) => t.date && Number(t.quantity) > 0)
              .slice()
              .sort((a, b) => a.date.localeCompare(b.date));
          } else {
            candidate.vestingStart = controls.vestStart.value || candidate.grantDate;
            candidate.vestingMonths = parseNum(controls.vesting.value) ?? 0;
            candidate.cliffMonths = parseNum(controls.cliff.value) ?? 0;
            candidate.vestingFrequency = schedule;
          }
          const rest = store.securities.filter((s) => s.id !== existing?.id);
          const over = isoOverLimitYears({ ...store.db, securities: [...rest, candidate] }, candidate.stakeholderId);
          if (over.length) {
            const worst = over.reduce((a, b) => (b.value > a.value ? b : a));
            problems.push(`This holder’s ISOs first exercisable in ${over.map((o) => o.year).join(', ')} exceed the ${moneyUSD(ISO_ANNUAL_LIMIT)} limit (${moneyWhole(worst.value)} in ${worst.year})${isoBasisNote(over)}. The excess is treated as an NSO by law.`);
          }
        }
        isoWarning.style.display = problems.length ? '' : 'none';
        // Only when the words change - see the strike warning above.
        const next = problems.join(' ');
        if (isoWarning.textContent !== next) isoWarning.textContent = next;
      };
      for (const input of [controls.qty, controls.strike, controls.vesting, controls.cliff, controls.vestStart]) {
        input.addEventListener('input', syncIso);
      }
      dateInput.addEventListener('change', syncIso);
      holderSelect.addEventListener('change', syncIso);
      newHolderKind.addEventListener('change', syncIso);
      controls.syncIso = syncIso;
      controls.earlyEx.addEventListener('change', syncIso);
      syncIso();
      /* The hint is the field's description: passed as one, the way every
         other hint in the sheet is, and linked by hand since field() only
         wires a plain string. Wrapped beside the control instead, the 409A
         figure sat under the box unannounced - a screen reader in forms mode
         heard "Strike price" and nothing about the number it is checked
         against. */
      const strikeField = field(`Strike price (${currencySymbol()})`, controls.strike, strikeHint);
      strikeHint.id = `${controls.strike.id}-hint`;
      controls.strike.setAttribute('aria-describedby', strikeHint.id);
      sections.push(
        controls.planField || null,
        el('div.form-grid', {},
          field('Options granted', controls.qty),
          strikeField),
        strikeWarning,
        optionTypeField(syncIso),
        isoWarning,
        scheduleEditor(controls, { startField, onChange: syncIso }),
        el('label.check-row', { style: { margin: '2px 0 4px' } }, controls.earlyEx,
          el('span', {}, 'Early exercise allowed')),
        el('p.field-hint', { style: { marginBottom: '14px' } },
          'Lets the holder exercise before vesting. The shares come out as reverse-vesting stock, which starts a 30-day 83(b) window.'),
        el('div.form-grid', {},
          field('Grant date', dateInput),
          field('Expires', controls.expires, 'Usually ten years out')),
        controls.exerciseBy
          ? field('Exercise deadline', controls.exerciseBy,
            `${departedOn ? `${holderNow.name} ${controls.departVerb} ${dateLong(departedOn)}. ` : ''}`
            + (controls.stampsStop ? 'Setting a deadline also stops this grant’s vesting on that day, as the departure did for the grants it covered. ' : '')
            + 'Vested options stay exercisable until this date. Empty leaves them exercisable for the grant’s full term.')
          : null
      );
    } else {
      controls.principal = numInput({ placeholder: '250,000', value: countValue(existing?.principal), 'aria-label': 'Principal amount' });
      /* Empty, not "0", for an uncapped instrument: the store writes every
         missing cap as 0, and the hint under this field says to leave it
         empty for uncapped. */
      controls.cap = numInput({
        placeholder: '8,000,000', value: existing?.valuationCap > 0 ? countValue(existing.valuationCap) : '',
        'aria-label': 'Valuation cap',
      });
      controls.discount = numInput({ placeholder: '20', value: existing?.discount ?? '', 'aria-label': 'Discount percent' });
      /* The terms a conversion was priced on are settled once it has happened,
         the way a transferred certificate's size and date are: the certificate
         was sized from the principal at the price the cap and discount set, so
         the store holds all of them whatever is typed. Shown locked, so that is
         found out before typing rather than after saving. */
      const converted = !!existing?.convertedAt;
      const became = converted ? store.security(existing.convertedToId) : null;
      if (converted) {
        for (const c of [controls.principal, controls.cap, controls.discount]) c.disabled = true;
      }
      if (currentKind === 'safe') {
        const typeField = safeTypeField(controls);
        if (converted) for (const b of typeField.querySelectorAll('button')) b.disabled = true;
        sections.push(typeField);
      }
      sections.push(
        field(`Principal (${currencySymbol()})`, controls.principal),
        el('div.form-grid', {},
          field(`Valuation cap (${currencySymbol()})`, controls.cap, 'Leave empty for uncapped'),
          field('Discount (%)', controls.discount, 'Off the next round’s price')),
        converted ? el('p.field-hint', { style: { margin: '-4px 0 12px' } },
          `This ${currentKind === 'safe' ? 'SAFE' : 'note'} converted on ${dateLong(existing.convertedAt)}`
          + `${became ? ` into ${became.label}` : ''}. Its principal, cap, discount, and `
          + `${currentKind === 'note' ? 'interest rate' : 'cap type'} are fixed: the certificate was sized from them. `
          + `${became ? `Delete ${became.label}` : 'Delete the certificate'} to reopen it as an outstanding convertible with every term editable.`)
          : null
      );
      if (currentKind === 'safe') {
        /* The percentage a post-money cap guarantees is the number founders
           actually negotiate, so it's shown live while they type. */
        // Live, like the strike and units hints: it follows the principal and cap as they are typed.
        const impliedLine = el('p.field-hint', { role: 'status', style: { marginTop: '-8px', marginBottom: '14px' } });
        const syncImplied = () => {
          const principal = parseNum(controls.principal.value) ?? 0;
          const cap = parseNum(controls.cap.value) ?? 0;
          /* Not once it has converted: the percentage is a promise about a
             round still to come, and this SAFE's round has closed. */
          const show = safeType === 'post' && principal > 0 && cap > 0 && !existing?.convertedAt;
          impliedLine.style.display = show ? '' : 'none';
          if (show) {
            impliedLine.textContent =
              `This SAFE converts into ${pct(principal / cap)} of the company, measured after every SAFE and note converts.`;
          }
        };
        controls.principal.addEventListener('input', syncImplied);
        controls.cap.addEventListener('input', syncImplied);
        controls.syncImplied = syncImplied;
        syncImplied();
        sections.push(impliedLine);
      }
      if (currentKind === 'note') {
        controls.interest = numInput({ placeholder: '8', value: existing?.interestRate ?? '', 'aria-label': 'Interest rate percent' });
        if (converted) controls.interest.disabled = true;
        controls.maturity = el('input.input', {
          type: 'date', value: existing?.maturityDate || '', 'aria-label': 'Maturity date',
        });
        sections.push(
          el('div.form-grid', {},
            field('Interest rate (% simple)', controls.interest),
            field('Issue date', dateInput)),
          field('Maturity date', controls.maturity, 'Optional, and typically 18 to 24 months out'));
      } else {
        sections.push(field('Signing date', dateInput));
      }
    }

    /* Every count and price is stored in today's units: a split restates
       every record, whatever its date, and the as-of view reads earlier dates
       back through it (see recordSplit) - so a record backfilled behind a
       split is typed as it reads today, not as the certificate of the day put
       it. Nothing on the sheet said so, and 100 shares at $1.00 typed off a
       pre-split certificate read 50 at $2.00 on their own date. Said under
       the date once it falls before a split, naming it, with the typed
       figures read back in the units of that day so the paper can be checked
       against them. A SAFE or a note is a dollar amount and reads the same
       either way. */
    if (currentKind !== 'safe' && currentKind !== 'note') {
      const words = {
        shares: { what: 'the share count and price', unit: 'share' },
        option: { what: 'the option count and strike', unit: 'option' },
        warrant: { what: 'the warrant shares and exercise price', unit: 'share' },
        rsu: { what: 'the unit count', unit: 'unit' },
      }[currentKind];
      const priceControl = controls.pps || controls.strike || null;
      const unitsHint = el('p.field-hint.warn', { role: 'status', style: { display: 'none', margin: '-4px 0 12px' } });
      const syncUnits = () => {
        const date = dateInput.value || '';
        const since = splitsSincePhrase(store.company, date);
        let next = '';
        if (since) {
          next = `Dated before ${since}: enter ${words.what} in today's post-split units.`;
          const qf = unsplitFactor(store.company, date);
          const count = parseNum(controls.qty.value);
          const price = priceControl ? parseNum(priceControl.value) : null;
          if (count > 0) {
            const then = Math.max(1, Math.round(count * qf));
            next += ` ${countLabel(count, words.unit)}${price > 0 ? ` at ${sharePrice(price)}` : ''} today `
              + `${count === 1 ? 'reads' : 'read'} as ${fmtShares(then)}${price > 0 ? ` at ${sharePrice(price / qf)}` : ''} `
              + `on ${dateLong(date)}.`;
          }
        }
        if (unitsHint.textContent !== next) unitsHint.textContent = next;
        unitsHint.style.display = next ? '' : 'none';
      };
      for (const evt of ['change', 'input']) dateInput.addEventListener(evt, syncUnits);
      controls.qty.addEventListener('input', syncUnits);
      priceControl?.addEventListener('input', syncUnits);
      syncUnits();
      // Under the date, whichever grid this kind lays it out in.
      const at = sections.findIndex((n) => n && n.contains?.(dateInput));
      sections.splice(at >= 0 ? at + 1 : sections.length, 0, unitsHint);
    }

    const negotiated = securityTermsEditor(store.db, existing, currentKind);
    const auditReason = el('textarea.input', { maxLength: 2000, rows: 2, placeholder: 'Optional explanation for this change' });
    const saveBtn = el('button.btn.btn-primary.btn-block', {
      type: 'submit', style: { padding: '12px', marginTop: '6px' },
    }, existing ? 'Save changes' : 'Issue security');

    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        await save();
      },
    },
      field('Stakeholder', el('div.select-wrap', {}, holderSelect)),
      newHolderRow,
      sections,
      negotiated.node,
      existing ? field('Reason for change', auditReason) : null,
      saveBtn,
      /* Under the primary action, the same way the class sheet places it: a
         link to this record's history, closing the sheet on the way. */
      existing ? el('a.btn.btn-ghost.btn-block', {
        href: `#/history?record=${encodeURIComponent(existing.id)}`, html: icon('clock', 15, 2),
        style: { marginTop: '8px' }, onclick: () => modal.close(),
      }, ' View history') : null);

    formWrap.append(form);

    /* The paper behind the record - only once it exists to attach to. File
       changes apply immediately, independent of the Save button. */
    if (existing) {
      formWrap.append(attachmentsSection({
        getAttachments: () => store.security(existing.id)?.attachments || [],
        upload: (file) => store.attachToSecurity(existing.id, file),
        remove: (att) => store.removeSecurityAttachment(existing.id, att.id),
      }));
    }

    async function save() {
      const invalid = (input, message) => {
        flagInvalid(input, message);
        input?.focus();
        toast(message, { icon: 'alert' });
      };

      /* A blank number field is a deliberate zero (an immediate-vesting
         grant, a zero-cost warrant). A non-blank one that doesn't parse, or
         parses negative, is a typo - storing 0 for it would silently rewrite
         a strike or mark a whole grant vested. Null means refuse the save. */
      const numField = (input) => {
        const raw = String(input?.value ?? '').trim();
        if (!raw) return 0;
        const n = parseNum(raw);
        return n === null || n < 0 ? null : n;
      };

      /**
       * A configured pool is a hard budget for plan awards - option grants and
       * RSU awards draw the same reserve - and it is the same rule the pool
       * form enforces when shrinking. No pool configured means no constraint.
       * Returns a message, or null when the award fits.
       */
      /* How much room an exercise or settlement certificate has to grow: what
         the award holds, less every other certificate already drawn off it.
         Zero for anything else, which has no award behind it. */
      const awardBudgetError = (qty) => {
        if (existing?.kind !== 'shares' || existing.fromTransferId) return null;
        const award = store.security(existing.fromOptionId || existing.fromRsuId || '');
        if (!award) return null;
        const units = award.kind === 'rsu';
        const held = units ? rsuOutstanding(award) : grantOutstanding(award);
        const others = (units ? rsuSettled(award) : grantExercised(award))
          - Math.max(0, Math.round(Number(existing.quantity) || 0));
        const room = Math.max(0, held - Math.max(0, others));
        if (qty <= room) return null;
        return `${award.label} has ${countLabel(room, units ? 'unit' : 'option')} `
          + `left to ${units ? 'settle' : 'exercise'}, so this certificate can’t hold more`;
      };

      /* The earliest certificate this award has already put shares into that
         a proposed date would come after, or null when the date is clear of
         them. An exercise and a settlement are both refused before the award
         they come out of, and moving the award's date is the other way to
         break that - the store refuses it too, but a form that saved first
         and reported a failure afterwards would say nothing about which
         certificate stood in the way. */
      const awardDrawnBefore = (date) => {
        if (!existing || (existing.kind !== 'option' && existing.kind !== 'rsu')) return null;
        if (date <= (existing.grantDate || existing.date || date)) return null;
        const drawn = store.securities.filter((s) => s.kind === 'shares'
          && !s.fromTransferId && s.date && s.date < date
          && (existing.kind === 'option' ? s.fromOptionId === existing.id : s.fromRsuId === existing.id));
        return drawn.length ? drawn.reduce((a, c) => (a.date <= c.date ? a : c)) : null;
      };

      /* Likewise a forfeiture already recorded on the award, and the
         post-termination deadline a departure set: both were dated against
         the award as it stood, and an award moved past them reads as
         forfeited, or expired, before it was granted. The store refuses it
         too; said here it points at the field. */
      const awardStoppedBefore = (date, deadline = existing?.exerciseBy || '') => {
        if (!existing || (existing.kind !== 'option' && existing.kind !== 'rsu')) return null;
        if (date <= (existing.grantDate || existing.date || date)) return null;
        const units = existing.kind === 'rsu';
        const forfeited = cancellationHistory(existing).find((c) => c.date && c.date < date);
        if (forfeited) {
          return `${countLabel(forfeited.quantity, units ? 'unit' : 'option')} `
            + `${forfeited.quantity === 1 ? 'was' : 'were'} cancelled on `
            + `${dateLong(forfeited.date)}, so the ${units ? 'award' : 'grant'} date can’t move past it`;
        }
        if (deadline && deadline < date) {
          return `The post-termination exercise deadline is ${dateLong(deadline)}, `
            + 'so the grant date can’t move past it';
        }
        return null;
      };

      /* Nor past the day its vesting stopped. A departure that cleared the
         deadline left only the stop behind, so the check above had nothing to
         point at, and the store refused the date with "Vesting cannot stop
         before the award was granted" and no field flagged. */
      const stoppedBefore = (date) => {
        if (!existing?.vestingStoppedAt || date <= (existing.grantDate || existing.date || date)) return null;
        if (date <= existing.vestingStoppedAt) return null;
        return `Vesting on this ${existing.kind === 'rsu' ? 'award' : 'grant'} stopped on ${dateLong(existing.vestingStoppedAt)}`
          + `${controls.departedName ? `, when ${controls.departedName} ${controls.departVerb}` : ''}, so its date can’t move past that`;
      };

      /* An award cannot be rewritten to vest less than has already left it.
         A schedule lengthened on a grant whose vesting a departure froze, or
         a tranche list that stops short, reads as the holder having bought
         (or settled) more than they would ever earn - the store refuses the
         same, and said here it points at the schedule. Only when the ceiling
         actually drops, so a record imported in that state stays editable;
         early exercise is exempt, since buying ahead is what it means. */
      const scheduleShortError = (next) => {
        if (!existing || (existing.kind !== 'option' && existing.kind !== 'rsu')) return null;
        if (next.kind === 'option' && next.earlyExercise) return null;
        const units = existing.kind === 'rsu';
        const claimed = units ? rsuSettled(existing) : grantExercised(existing);
        const ceiling = vestingCeiling(next);
        if (claimed <= ceiling || ceiling >= vestingCeiling(existing)) return null;
        const frozen = vestingStopDate(next);
        const reason = frozen && vestingCeiling({ ...next, cancelledDate: '', vestingStoppedAt: '' }) > ceiling
          ? `only ${fmtShares(ceiling)} would have vested by ${dateLong(frozen)}, when its vesting stopped`
          : `this schedule only ever reaches ${fmtShares(ceiling)}`;
        return `${fmtShares(claimed)} ${units ? 'units were already settled' : 'options were already exercised'}, but ${reason}`;
      };
      /* The control a schedule problem points at: the months field, or the
         last tranche's share count when the schedule is a custom list. */
      const scheduleControl = () => (schedule === 'custom'
        ? [...formWrap.querySelectorAll('.tranche-row input[inputmode="decimal"]')].at(-1) || controls.qty
        : controls.vesting);

      /**
       * A plan's reserve is a budget for the awards drawn under it - the rule
       * the reserve sheet enforces when shrinking, held here when granting.
       * Measured with the proposed award and its lifecycle in place, so an
       * edit is judged on what it adds. An award outside every
       * plan, or a company with no plan, has no budget to keep. Returns a
       * message, or null when the award fits.
       */
      const poolBudgetError = (qty) => {
        const planId = controls.planSelect ? controls.planSelect.value : (existing?.planId || '');
        if (!planId) return null;
        const plan = plansOf(store.company).find((p) => p.id === planId);
        if (!plan) return null;
        const candidate = { ...existing, kind: currentKind, quantity: qty, planId, outsidePlan: false,
          date: input.date, grantDate: input.date };
        if (qty !== existing?.quantity) delete candidate.preSplit;
        const securities = [...store.securities.filter((x) => x.id !== existing?.id), candidate];
        return planCapacityError(store.db, securities);
      };

      /* The plan has to be able to hold the award on the date typed: adopted
         by then, not expired, not retired. The store refuses the same once
         the plan or the date moves (#assertPlanFits), with no field to point
         at; and asked after the budget, a grant dated before the plan
         existed was blamed on the reserve instead. Said here first, at the
         date - or at the plan, when that is what changed. */
      const planFitError = (kind, date) => {
        if (!controls.planSelect || !controls.planSelect.value) return null;
        const planId = controls.planSelect.value;
        const plan = plansOf(store.company).find((p) => p.id === planId);
        if (!plan) return null;
        const moved = !existing || planId !== (existing.planId || '') || date !== (existing.grantDate || existing.date || '');
        if (!moved || planAccepts(plan, kind, date)) return null;
        return [existing && planId !== (existing.planId || '') ? controls.planSelect : dateInput, planRefusal(plan, kind, date)];
      };

      /* The plan picked, as the record spells it: the plan's id, or an
         explicit "outside every plan" - one field or the other, never both,
         so moving an award between them clears the one it leaves. */
      const planChoice = () => (controls.planSelect.value
        ? { planId: controls.planSelect.value, outsidePlan: false }
        : { planId: '', outsidePlan: true });

      /* A count typed with a fraction - "1,000.5" shares, "48.5" months - is
         a typo, and the sanitizer would round it on the way in: the record
         then held a number nobody typed while the toast said it was saved.
         Refused, like every other figure the form can't take as written. */
      const whole = (n) => Number.isInteger(n);

      /* Collect the schedule editor into `target`, or return [input, message]
         when it doesn't hold together. Shared by certificates and grants -
         the only difference is that a certificate's schedule, once toggled
         on, needs a length and a start date. */
      const collectSchedule = (target, qtyVal, { cert = false } = {}) => {
        if (schedule === 'custom') {
          const rows = tranches.filter((t) => t.date || Number(t.quantity) > 0 || String(t.raw ?? '').trim());
          /* Each refusal names the row it is about: the tranche inputs are the
             only controls these are ever about, and a toast alone left
             nothing flagged and focus on the Save button. */
          const rowInput = (row, which) => {
            // The header is a .tranche-row too, and carries no inputs.
            const rowEls = [...formWrap.querySelectorAll('.tranche-row')].filter((r) => r.querySelector('input'));
            return rowEls[tranches.indexOf(row)]?.querySelector(which === 'date' ? 'input[type="date"]' : 'input:not([type="date"])') || null;
          };
          const addButton = () => [...formWrap.querySelectorAll('button')].find((b) => /Add tranche/.test(b.textContent)) || null;
          if (rows.length > MAX_VESTING_TRANCHES) return [rowInput(rows[MAX_VESTING_TRANCHES], 'qty'), `A schedule can hold at most ${MAX_VESTING_TRANCHES} tranches`];
          if (!rows.length) return [rowInput(tranches[0], 'date') || addButton(), 'Add at least one vesting tranche'];
          const blank = rows.find((t) => !t.date || !(Number(t.quantity) > 0));
          if (blank) {
            // A box with text in it that does not read as a count is a typo, and is named as one.
            if (blank.date && String(blank.raw ?? '').trim()) {
              return [rowInput(blank, 'qty'),
                `Tranche ${tranches.indexOf(blank) + 1}’s share count must be a positive number, like 10,000`];
            }
            return [rowInput(blank, blank.date ? 'qty' : 'date'), 'Every tranche needs a date and a share count'];
          }
          const fraction = rows.find((t) => !whole(Number(t.quantity)));
          if (fraction) {
            return [rowInput(fraction, 'qty'), 'Tranche share counts must be whole numbers'];
          }
          const sum = rows.reduce((a, t) => a + Number(t.quantity), 0);
          const written = scheduleWrittenFor(qtyVal);
          if (sum > written) {
            /* The quantity box, unless it is locked - a closed source or a
               transfer leg - where flagging and focusing a disabled control
               does nothing and the tranche rows are what has to change. */
            return [controls.qty.disabled ? scheduleControl() : controls.qty, written > qtyVal
              ? `The tranches add up to ${fmtShares(sum)}, more than the ${fmtShares(written)} this schedule was written for`
              : `The tranches add up to ${fmtShares(sum)}, more than this security holds`];
          }
          /* And not less either: the remainder would never vest - unvested
             for good, on every forecast and in the diluted base, with the
             calendar announcing the whole award vesting on the last tranche.
             Only a schedule this save writes is held to it, so a record
             already stored that way stays editable. */
          /* A quantity grown past the list writes the schedule as much as a
             new tranche does: the rows stayed as stored, so nothing here read
             as changed, and a grant enlarged from 1,000 to 1,200 over tranches
             summing 1,000 saved with 200 options that would never vest. */
          const changed = scheduleChanged(rows, qtyVal);
          /* Held to what the certificate holds, not to the larger position a
             repurchase remainder's schedule was written for: a list rewritten
             to cover the 900 shares left is complete, and measuring it
             against the old 1,000 refused it while the quantity field that
             the message pointed at sat disabled on the remainder. */
          const floor = Math.min(written, qtyVal);
          if (sum < floor && changed) {
            return [rowInput(rows[rows.length - 1], 'qty'),
              `The tranches add up to ${fmtShares(sum)}, less than the ${fmtShares(floor)} `
              + `${floor < written ? 'this certificate holds' : 'this schedule covers'}. `
              + `Add the rest${controls.qty.disabled ? '' : ', or reduce the quantity'}`];
          }
          // The record keeps the date and the count; the typed text stays with the editor.
          target.vestingTranches = rows.map(({ date, quantity }) => ({ date, quantity }))
            .sort((a, b) => a.date.localeCompare(b.date));
          target.vestingMonths = 0;
          target.cliffMonths = 0;
          target.vestingFrequency = '';
          target.vestingStart = '';
        } else {
          const months = numField(controls.vesting);
          if (months === null || !whole(months)) {
            return [controls.vesting, 'Vesting months must be a whole number, like 48'];
          }
          // Said here rather than written down by the record without a word.
          if (months > MAX_VESTING_MONTHS) {
            return [controls.vesting, `Vesting runs over at most ${MAX_VESTING_MONTHS} months`];
          }
          if (cert && !(months > 0)) return [controls.vesting, 'Enter how many months these shares vest over'];
          /* Acceleration rides with a schedule: the record keeps the terms
             only on an award that vests over time (see the sanitizer), so an
             award vesting at once had its trigger and percentage validated
             here and then dropped on save, under a toast saying it was
             issued. Refused instead, pointing at the picker. */
          if (!(months > 0) && accelTrigger) {
            return [controls.accelSelect,
              'Acceleration needs a vesting schedule. Set the vesting months, or set acceleration to None'];
          }
          const cliff = numField(controls.cliff);
          if (cliff === null || !whole(cliff)) {
            return [controls.cliff, 'Cliff months must be a whole number, like 12'];
          }
          if (months > 0 && cliff > months) return [controls.cliff, 'The cliff can’t outlast the vesting period'];
          target.vestingTranches = [];
          target.vestingMonths = months;
          target.cliffMonths = cliff;
          target.vestingFrequency = schedule;
          // Written only when it differs from the date: a start equal to the
          // grant date is the default, and the default follows the grant date.
          const start = months > 0 ? controls.vestStart.value : '';
          target.vestingStart = start && start !== target.date ? start : '';
        }
        if (accelTrigger) {
          const pctVal = parseNum(controls.accelPct.value) ?? 0;
          // Whole percent: the record rounds, and 33.3 saved as 33 without a word.
          if (!(pctVal >= 1 && pctVal <= 100) || !whole(pctVal)) {
            return [controls.accelPct, 'Acceleration must be a whole number between 1 and 100 percent'];
          }
          target.accelTrigger = accelTrigger;
          target.accelPct = pctVal;
        } else {
          target.accelTrigger = '';
        }
        return null;
      };

      let stakeholderId = holderSelect.value;
      // The placeholder is not a person - see chosenHolder.
      if (!stakeholderId) return invalid(holderSelect, 'Pick who receives it');
      const needsNewHolder = stakeholderId === NEW_HOLDER;
      if (needsNewHolder && !newHolderName.value.trim()) {
        return invalid(newHolderName, 'Give the stakeholder a name');
      }
      /* Someone already in the picker above, typed in as new - see holderNamed. */
      const twin = needsNewHolder ? holderNamed(newHolderName.value, store.stakeholders) : null;
      if (twin) {
        return invalid(newHolderName,
          `${twin.name} is already on the cap table. Pick them from the stakeholder list above`);
      }

      // A cleared date on a stored record keeps the date it had; a new record gets today.
      const input = { kind: currentKind, date: dateInput.value || (existing ? existing.date || existing.grantDate || '' : todayISO()) };
      if (currentKind === 'shares') {
        const award = existing && !existing.fromTransferId
          ? store.security(existing.fromOptionId || existing.fromRsuId) : null;
        const granted = award?.grantDate || award?.date;
        if (granted && input.date !== existing.date && input.date < granted) {
          return invalid(dateInput, `The certificate date can’t precede its source award (${dateLong(granted)})`);
        }
        /* Nor follow the day the options stopped being exercisable - the
           store refuses this too, and said here it points at the field. */
        const cutoff = award?.kind === 'option' ? exerciseCutoff(award) : '';
        if (cutoff && input.date !== existing.date && input.date > cutoff) {
          const clock = award.exerciseBy && cutoff === award.exerciseBy ? 'exercise deadline' : 'expiration';
          return invalid(dateInput, `${award.label}’s ${clock} was ${dateLong(cutoff)}, so nothing could be exercised after it`);
        }
        /* Nor the SAFE or note it converted from - the store refuses this
           too, and said here it points at the field. */
        const source = existing && !existing.fromTransferId && existing.fromConvertibleId
          ? store.security(existing.fromConvertibleId) : null;
        if (source?.date && input.date !== existing.date && input.date < source.date) {
          return invalid(dateInput, `The certificate date can’t precede the ${source.kind === 'safe' ? 'SAFE' : 'note'} `
            + `it converted from (${dateLong(source.date)})`);
        }
        /* Nor leave the exercise window of the warrant it came off - the
           store refuses this too, and said here it points at the field. */
        const warrant = existing && !existing.fromTransferId && existing.fromWarrantId
          ? store.security(existing.fromWarrantId) : null;
        if (warrant?.kind === 'warrant' && input.date !== existing.date
          && ((warrant.date && input.date < warrant.date) || (warrant.expires && input.date > warrant.expires))) {
          return invalid(dateInput, warrant.expires
            ? `${warrant.label} could be exercised between ${dateLong(warrant.date)} and ${dateLong(warrant.expires)}`
            : `${warrant.label} was issued on ${dateLong(warrant.date)} and could not be exercised before it`);
        }
        const qty = parseNum(controls.qty.value);
        // A box with something unreadable in it is a typo, not a blank: "1e6" got the empty-field answer.
        if (qty === null && controls.qty.value.trim()) return invalid(controls.qty, 'The share count must be a number, like 1,000,000');
        if (!qty || qty <= 0) return invalid(controls.qty, 'Enter how many shares to issue');
        if (!whole(qty)) return invalid(controls.qty, 'Shares are issued in whole numbers');
        /* An exercise or settlement certificate is the other half of its
           award's counter, which moves with it on save - so it cannot grow
           past what the award has left. Said here rather than left to the
           store, which refuses the same edit without pointing at the field. */
        const awardError = awardBudgetError(qty);
        if (awardError) return invalid(controls.qty, awardError);
        /* Nor can it be edited into an exercise the grant could not have
           made: moved to a day before the options it covers had vested, or
           grown past the balance vested on its day. The exercise form refuses
           both on the way in, and so does the store on the way back - said
           here it points at the field that moved. The same for a settlement
           certificate and the units vested on its day. Only a grant without
           early exercise, and only when the edit creates the problem. */
        if (award && (award.kind === 'rsu' || (award.kind === 'option' && !award.earlyExercise))
          && (input.date < existing.date || qty > existing.quantity)
          && !exerciseAheadOfVesting(award, store.securities)) {
          const edited = { ...existing, date: input.date, quantity: qty };
          const ahead = exerciseAheadOfVesting(award,
            store.securities.map((s) => (s.id === existing.id ? edited : s)));
          if (ahead) {
            return invalid(input.date < existing.date ? dateInput : controls.qty,
              `Only ${fmtShares(ahead.vested)} of ${award.label} had vested by ${dateLong(ahead.certificate.date)}, `
              + `so ${fmtShares(ahead.exercised)} can’t have been ${award.kind === 'rsu' ? 'settled' : 'exercised'} by then`);
          }
        }
        input.quantity = qty;
        const pps = numField(controls.pps);
        if (pps === null) return invalid(controls.pps, 'Price per share must be a number, like 0.0001');
        input.pricePerShare = pps;
        // The transfer's consideration, on the certificates that carry it.
        // Zero clears the record the way the transfer sheet writes a gift.
        if (controls.paid) {
          const paid = numField(controls.paid);
          if (paid === null) return invalid(controls.paid, 'The price paid must be a number, like 1.25');
          input.transferPricePerShare = paid;
        }
        if (controls.repurchasePrice) {
          const paid = numField(controls.repurchasePrice);
          if (paid === null) return invalid(controls.repurchasePrice, 'The repurchase price must be a number, like 1.25');
          input.repurchasePricePerShare = paid;
        }
        if (controls.vestToggle.checked) {
          const err = collectSchedule(input, qty, { cert: true });
          if (err) return invalid(err[0], err[1]);
          if (controls.filed83b.checked) {
            const filed = controls.filed83bDate.value || input.date;
            /* The window is statutory and never extends. A date outside it is
               a typo or a late election, and either way not a filing the
               record should report as made. */
            const deadline = deadline83b({ date: input.date, date83b: existing?.date83b });
            if (filed < (existing?.date83b || input.date)) {
              return invalid(controls.filed83bDate, 'The 83(b) can’t be filed before the shares were issued');
            }
            if (deadline && filed > deadline) {
              return invalid(controls.filed83bDate,
                `An 83(b) election is filed within ${DAYS_83B} days of issuance, by ${dateLong(deadline)}`);
            }
            input.filed83b = filed;
          } else {
            input.filed83b = '';
          }
        } else {
          // Explicit zeros so unticking the box clears a stored schedule.
          input.vestingMonths = 0;
          input.cliffMonths = 0;
          input.vestingStart = '';
          input.vestingTranches = [];
          input.accelTrigger = '';
          input.filed83b = '';
        }
      } else if (currentKind === 'option') {
        const qty = parseNum(controls.qty.value);
        if (!qty || qty <= 0) return invalid(controls.qty, 'Enter how many options to grant');
        if (!whole(qty)) return invalid(controls.qty, 'Options are granted in whole numbers');
        /* A grant can't shrink below what has already left it. Those options
           were bought - possibly into a certificate that still says so - or
           handed back to the pool, and the record would otherwise be clamped
           down to fit without a word. */
        if (existing?.kind === 'option') {
          const bought = grantExercised(existing);
          const returned = Math.max(0, Math.round(Number(existing.cancelled) || 0));
          const floor = bought + returned;
          if (qty < floor) {
            const gone = [
              bought > 0 ? `${fmtShares(bought)} exercised` : null,
              returned > 0 ? `${fmtShares(returned)} cancelled` : null,
            ].filter(Boolean).join(' and ');
            return invalid(controls.qty,
              `${gone} already, so this grant can’t go below ${fmtShares(floor)}`);
          }
        }
        const fit = planFitError('option', input.date || todayISO());
        if (fit) return invalid(fit[0], fit[1]);
        const poolError = poolBudgetError(qty);
        if (poolError) return invalid(controls.qty, poolError);
        const err = collectSchedule(input, qty);
        if (err) return invalid(err[0], err[1]);
        // The post-termination deadline as this save leaves it.
        const deadline = controls.exerciseBy ? controls.exerciseBy.value : (existing?.exerciseBy || '');
        /* The same date the record is stamped with above: a cleared field on
           a stored grant keeps the grant's own date. Read off the field
           instead, an emptied box saved a grant dated 2024 with a grant date
           of today - the list went on showing 2024 while the schedule
           quietly restarted from the day of the edit. */
        const grantDate = input.date || todayISO();
        if (controls.expires.value && controls.expires.value <= grantDate) {
          return invalid(controls.expires, 'The expiration date must be after the grant date');
        }
        if (controls.exerciseBy && deadline) {
          // The same two floors the departure flow holds the deadline to.
          if (controls.departedOn && deadline < controls.departedOn) {
            return invalid(controls.exerciseBy, `The exercise deadline can’t precede ${controls.departedName}’s departure on ${dateLong(controls.departedOn)}`);
          }
          if (deadline <= grantDate) return invalid(controls.exerciseBy, 'The exercise deadline must be after the grant date');
        }
        /* Nor may the window close before an exercise already recorded: the
           grant would read as expired at the moment its own certificate says
           it was exercised. The window is the earlier of the expiration and
           the deadline, and it is checked when it actually moves - the rule
           the store enforces; said here it points at the field that closed
           it. */
        const cutoff = [controls.expires.value, deadline].filter(Boolean).sort()[0] || '';
        if (existing?.kind === 'option' && cutoff && cutoff !== exerciseCutoff(existing)) {
          const late = store.securities
            .filter((s) => s.kind === 'shares' && !s.fromTransferId && s.fromOptionId === existing.id
              && s.date && s.date > cutoff)
            .reduce((a, c) => (a && a.date <= c.date ? a : c), null);
          if (late) {
            const onDeadline = !!controls.exerciseBy && cutoff === deadline && cutoff !== controls.expires.value;
            return invalid(onDeadline ? controls.exerciseBy : controls.expires,
              `${late.label} was exercised from this grant on ${dateLong(late.date)}, so `
              + `${onDeadline ? 'the exercise deadline can’t fall before that' : 'it can’t expire before that'}`);
          }
        }
        const drawnBefore = awardDrawnBefore(grantDate);
        if (drawnBefore) {
          return invalid(dateInput, `${drawnBefore.label} was exercised out of this grant on `
            + `${dateLong(drawnBefore.date)}, so the grant date can’t move past it`);
        }
        // Against the deadline as this save leaves it, not the stored one.
        const stopped = awardStoppedBefore(grantDate, deadline);
        if (stopped) return invalid(dateInput, stopped);
        /* Nor past the departure that set that deadline: a grant fully vested
           by the departure carried only the window, which the check above
           lets the date walk up to. The store refuses the same; said here it
           points at the field, as every sibling rule in this block does.
           Only when the date moves later, as the store's rule does: a grant
           issued to a departed holder after their departure has a date past
           it from the start, and setting its deadline was refused as moving
           a date that had not moved. */
        if (controls.departedOn && deadline && controls.departedOn < grantDate
          && grantDate > (existing?.grantDate || existing?.date || grantDate)) {
          return invalid(dateInput, `${controls.departedName} ${controls.departVerb} on ${dateLong(controls.departedOn)}, `
            + 'which set this exercise deadline, so the grant date can’t move past it');
        }
        const frozen = stoppedBefore(grantDate);
        if (frozen) return invalid(dateInput, frozen);
        /* The stop a deadline writes onto a grant the departure never covered
           (see stampsStop): refused here, at the field, when it would freeze
           vesting below what was exercised - the store refuses the same,
           in words about a stop nobody typed. Written explicitly otherwise. */
        if (controls.stampsStop && deadline && controls.departedOn >= grantDate) {
          if (!controls.earlyEx.checked) {
            const bought = grantExercised(existing);
            const frozenCeiling = vestingCeiling({ ...existing, ...input, quantity: qty, grantDate, vestingStoppedAt: controls.departedOn });
            if (bought > frozenCeiling) {
              return invalid(controls.exerciseBy, `${fmtShares(bought)} options were exercised from this grant, but only ${fmtShares(frozenCeiling)} `
                + `had vested when ${controls.departedName} ${controls.departVerb} on ${dateLong(controls.departedOn)}, so a deadline would stop `
                + 'its vesting below what was bought. Correct the exercise first');
            }
          }
          input.vestingStoppedAt = controls.departedOn;
        }
        /* Early exercise can't be switched off behind an exercise that used
           it: the certificate would then say options were bought before they
           had vested on a grant that no longer allows that, and the next
           cancellation would be refused for freezing vesting below what was
           bought. The store refuses it too; said here it points at the box. */
        if (existing?.kind === 'option' && existing.earlyExercise && !controls.earlyEx.checked) {
          const ahead = exerciseAheadOfVesting({ ...existing, ...input, quantity: qty, grantDate }, store.securities);
          if (ahead) {
            return invalid(controls.earlyEx, `${ahead.certificate.label} was exercised early on ${dateLong(ahead.certificate.date)}, `
              + `when only ${fmtShares(ahead.vested)} of the ${fmtShares(ahead.exercised)} bought had vested, `
              + 'so early exercise can’t be turned off while it stands');
          }
          /* The counter too, for an exercise recorded without its certificate
             - the store refuses the same; said here it points at the box. */
          const claimedNow = grantExercised(existing);
          const ceilingNow = vestingCeiling({ ...existing, ...input, quantity: qty, grantDate });
          if (claimedNow > ceilingNow) {
            return invalid(controls.earlyEx, `${fmtShares(claimedNow)} options were exercised from this grant, but its schedule `
              + `only ever reaches ${fmtShares(ceilingNow)}, so early exercise can’t be turned off while they stand`);
          }
        }
        input.quantity = qty;
        const strike = numField(controls.strike);
        if (strike === null) return invalid(controls.strike, 'The strike price must be a number, like 0.10');
        input.strike = strike;
        input.grantDate = grantDate;
        if (controls.planSelect) Object.assign(input, planChoice());
        input.expires = controls.expires.value;
        // Written whenever the field was offered, so an emptied deadline
        // clears the stored one rather than leaving it behind.
        if (controls.exerciseBy) input.exerciseBy = deadline;
        // 'nso' is the absent-field default, so flipping ISO off truly
        // clears it rather than leaving the old value behind.
        input.optionType = optionType;
        input.earlyExercise = controls.earlyEx.checked;
        const short = scheduleShortError({ ...existing, ...input });
        if (short) return invalid(scheduleControl(), short);
      } else if (currentKind === 'rsu') {
        const qty = parseNum(controls.qty.value);
        if (!qty || qty <= 0) return invalid(controls.qty, 'Enter how many units to grant');
        if (!whole(qty)) return invalid(controls.qty, 'Units are granted in whole numbers');
        /* Same floor an option grant has: an award can't shrink below what
           already left it - units settled into shares, or forfeited back to
           the pool - or the record would be clamped down to fit in silence. */
        if (existing?.kind === 'rsu') {
          const settled = rsuSettled(existing);
          const returned = Math.max(0, Math.round(Number(existing.cancelled) || 0));
          const floor = settled + returned;
          if (qty < floor) {
            const gone = [
              settled > 0 ? `${fmtShares(settled)} settled` : null,
              returned > 0 ? `${fmtShares(returned)} cancelled` : null,
            ].filter(Boolean).join(' and ');
            return invalid(controls.qty,
              `${gone} already, so this award can’t go below ${fmtShares(floor)}`);
          }
        }
        const fit = planFitError('rsu', input.date || todayISO());
        if (fit) return invalid(fit[0], fit[1]);
        const poolError = poolBudgetError(qty);
        if (poolError) return invalid(controls.qty, poolError);
        const err = collectSchedule(input, qty);
        if (err) return invalid(err[0], err[1]);
        input.quantity = qty;
        // Off the record's own date, as the option branch reads its grant date.
        const awardDate = input.date || todayISO();
        const settledBefore = awardDrawnBefore(awardDate);
        if (settledBefore) {
          return invalid(dateInput, `${settledBefore.label} was settled out of this award on `
            + `${dateLong(settledBefore.date)}, so the award date can’t move past it`);
        }
        const stopped = awardStoppedBefore(awardDate);
        if (stopped) return invalid(dateInput, stopped);
        const frozen = stoppedBefore(awardDate);
        if (frozen) return invalid(dateInput, frozen);
        input.grantDate = awardDate;
        if (controls.planSelect) Object.assign(input, planChoice());
        // Absent means "settles on vesting alone", so the flag is written
        // either way rather than left behind when it is turned off.
        input.liquidityCondition = controls.liquidity.checked;
        const short = scheduleShortError({ ...existing, ...input });
        if (short) return invalid(scheduleControl(), short);
      } else if (currentKind === 'warrant') {
        const qty = parseNum(controls.qty.value);
        if (!qty || qty <= 0) return invalid(controls.qty, 'Enter how many shares the warrant covers');
        if (!whole(qty)) return invalid(controls.qty, 'A warrant covers a whole number of shares');
        const expires = controls.expires.value;
        if (expires && expires <= input.date) {
          return invalid(controls.expires, 'The expiration date must be after the issue date');
        }
        /* The store holds a warrant to its exercises and cancellations, but
           its refusals speak of those records ("A warrant cancellation must
           fall between its issue and expiration dates"); said here, at the
           field, in terms of the edit being made. */
        if (existing?.kind === 'warrant') {
          const exercised = warrantExercised(existing, store.securities);
          const cancelled = cancellationHistory(existing).reduce((n, c) => n + c.quantity, 0);
          if (qty < exercised + cancelled) {
            return invalid(controls.qty, `${existing.label} has ${fmtShares(exercised)} shares exercised and ${fmtShares(cancelled)} cancelled, `
              + `so it can’t cover fewer than ${fmtShares(exercised + cancelled)}`);
          }
          const certs = store.certificatesFrom(existing.id).filter((c) => !c.fromTransferId);
          const movements = [...certs.map((c) => c.date), ...cancellationHistory(existing).map((c) => c.date)].filter(Boolean).sort();
          if (movements.length && input.date > movements[0]) {
            return invalid(dateInput, `${existing.label} was exercised or cancelled on ${dateLong(movements[0])}, so its issue date can’t move past that`);
          }
          if (expires && movements.length && expires < movements[movements.length - 1]) {
            return invalid(controls.expires, `${existing.label} was exercised or cancelled on ${dateLong(movements[movements.length - 1])}, so it can’t expire before that`);
          }
          if (certs.length && controls.classSelect && controls.classSelect.value !== existing.classId) {
            return invalid(controls.classSelect, `${certs.map((c) => c.label).join(', ')} ${certs.length === 1 ? 'was' : 'were'} issued in this class from the warrant’s exercise, so the class can’t change`);
          }
        }
        input.quantity = qty;
        const strike = numField(controls.strike);
        if (strike === null) return invalid(controls.strike, 'The strike price must be a number, like 1.50');
        input.strike = strike;
        input.expires = expires;
      } else {
        /* A converted instrument cannot be dated after the round that
           converted it: the shares it became would then predate it. */
        if (existing?.convertedAt && input.date !== existing.date && input.date > existing.convertedAt) {
          return invalid(dateInput,
            `${existing.label} converted on ${dateLong(existing.convertedAt)}, so its date can’t move past it`);
        }
        const principal = parseNum(controls.principal.value);
        if (!principal || principal <= 0) return invalid(controls.principal, 'Enter the investment amount');
        input.principal = principal;
        const cap = numField(controls.cap);
        // Null covers garbage and negatives alike: "8M" parsing to a 0 cap
        // would silently store an uncapped SAFE.
        if (cap === null) return invalid(controls.cap, 'The valuation cap must be a number, like 8,000,000');
        input.valuationCap = cap;
        /* Said out loud rather than silently clamped on save: a cap typed
           into the discount box ("8,000,000") would otherwise be stored as a
           99% discount without a word. */
        const discount = numField(controls.discount);
        // Above 99, not at or above 100: 99.5 passed and was stored as 99 without a word.
        if (discount === null || discount > 99) {
          return invalid(controls.discount, 'Enter a discount between 0 and 99 percent');
        }
        input.discount = discount;
        if (currentKind === 'safe') input.safeType = safeType;
        if (currentKind === 'note') {
          if (controls.maturity.value && controls.maturity.value <= input.date) {
            return invalid(controls.maturity, 'The maturity date must be after the issue date');
          }
          const interest = numField(controls.interest);
          if (interest === null || interest > 50) {
            return invalid(controls.interest, 'Enter an interest rate between 0 and 50 percent');
          }
          input.interestRate = interest;
          input.maturityDate = controls.maturity.value;
          /* A new maturity date reopens the question of whether it was met.
             The record of the old one being settled stayed behind, so a note
             extended through this form read "Matured, settled" beside a
             maturity still in the future, and the new date was never flagged
             when it came due. The attention flow clears it the same way. */
          if (existing?.maturedAt && controls.maturity.value !== (existing.maturityDate || '')) {
            input.maturedAt = '';
          }
        }
      }

      /* The type switcher above the form goes quiet with the Save button: a
         save can take three writes (a new holder, a missing class, the
         security), and switching type meanwhile rebuilt the form with a
         fresh, enabled Save that issued a second security of the new type. */
      const setBusy = (busy) => {
        saveBtn.disabled = busy;
        for (const b of kindSeg?.querySelectorAll('button') || []) b.disabled = busy;
      };
      setBusy(true);
      try {
        if (needsNewHolder) {
          const holder = await store.addStakeholder({
            name: newHolderName.value, kind: newHolderKind.value,
          });
          stakeholderId = holder.id;
          /* The holder is committed even if the security write below fails,
             and this modal never re-renders - so adopt them into the picker
             like any existing stakeholder. A retry then reuses them instead
             of creating a twin. */
          chosenHolder = holder.id;
          holderSelect.insertBefore(el('option', { value: holder.id }, holder.name), holderSelect.lastElementChild);
          holderSelect.value = holder.id;
          newHolderRow.style.display = 'none';
        }
        input.stakeholderId = stakeholderId;
        Object.assign(input, negotiated.read());

        if (currentKind === 'shares' || currentKind === 'warrant' || currentKind === 'rsu') {
          // A missing class is auto-created so first-time issuance just works.
          if (controls.classSelect) {
            input.classId = controls.classSelect.value;
          } else {
            input.classId = (await ensureShareClass()).id;
          }
        }

        if (existing) {
          /* The fields a transfer or a conversion settles are locked as the
             record stood when this sheet opened, and the store holds them
             whatever is sent. A toast's Undo can close the source or
             re-convert the instrument under the open sheet - the fields
             stay live here while the store now holds them, so a figure typed
             after that was dropped under "Security updated". Re-read at the
             save, as the cancel sheet re-reads its grant. */
          const now = store.security(existing.id);
          if (now && ((now.closedAt && !existing.closedAt) || (now.convertedAt && !existing.convertedAt))) {
            toast(`${existing.label} ${now.closedAt && !existing.closedAt ? 'was closed by a transfer' : 'converted'} `
              + 'while this sheet was open, which fixes some of these fields. Open it again to see what can still change', { icon: 'alert' });
            /* The sheet goes with the toast's advice. Left open, it sat with
               Save disabled for good: the return skipped the re-enable in the
               catch, and every press would have ended here anyway. */
            modal.close();
            return;
          }
          await store.updateSecurity(existing.id, { ...input, auditReason: auditReason.value });
          store.logActivity(`${existing.label} updated`, 'pencil');
          toast('Security updated');
        } else {
          const sec = await store.addSecurity(input);
          const holderName = store.stakeholder(stakeholderId)?.name || 'stakeholder';
          const what = currentKind === 'shares' ? countLabel(sec.quantity, 'share')
            : currentKind === 'option' ? countLabel(sec.quantity, 'option')
              : currentKind === 'rsu' ? countLabel(sec.quantity, 'unit')
                : currentKind === 'warrant' ? `${fmtShares(sec.quantity)} warrant ${sec.quantity === 1 ? 'share' : 'shares'}`
                  : moneyWhole(sec.principal);
          store.logActivity(`${sec.label} issued to ${holderName} (${what})`, 'file-text');
          toast(`${sec.label} issued`);
        }
        modal.close();
        onSaved?.();
      } catch (err) {
        console.error(err);
        // The store's own reason when it declined; the connection otherwise.
        toast(isRefusal(err) ? err.message : 'Couldn’t save. Check your connection',
          { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
        // A term editor's refusal flags its field; focus goes there, as the sheet's own refusals do.
        if (isRefusal(err)) negotiated.node.querySelector('[aria-invalid="true"]')?.focus();
        setBusy(false);
      }
    }
  }

  render();
}
