/**
 * Closing a modeled round.
 *
 * This is the single most error-prone moment in the equity lifecycle, and it
 * is exactly the computation the app already performs - so the flow is a
 * two-step wizard over a `modelRound` result rather than a pile of manual
 * certificate entry. Step one collects what the model can't know (which
 * class, who the investors are, how the money splits); step two shows every
 * record that is about to be written, and only then does anything commit.
 */

import { el, clear, append } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { field, flagInvalid, holderOptionLabel, holderNamed } from './bits.js';
import { store, isRefusal } from '../lib/store.js';
import {
  STAKEHOLDER_KINDS, convertibleValue, antiDilutionAdjustments, issuedInClass,
  plansOf, planIsOpen, topUpReserve, planBalances, modelRound, dbAsOf, convertedAfter, adjustedAfter, convertibles,
} from '../lib/captable.js';
import { capTableDigest, ALLOCATION_TOLERANCE } from '../lib/financing.js';
import { preferredTermsEditor } from './financingterms.js';
import {
  shares as fmtShares, sharePrice, money, moneyWhole, dateLong, amountValue, currencySymbol, percentValue,
} from '../lib/format.js';
import { parseNum, parseMultiple, todayISO, uid } from '../lib/util.js';

const NEW_HOLDER = '__new__';
const NEW_CLASS = '__new__';

const textInput = (attrs = {}) => el('input.input', { type: 'text', autocomplete: 'off', ...attrs });

/**
 * @param result  the `modelRound` output being applied
 * @param terms   { name, preMoney, investment, poolPct, asOf } as entered in
 *                the form - what the base model is run from again when the
 *                closing date moves
 */
export function openCloseRound(opts) {
  const { terms, onClosed } = opts;
  /* Reassigned when the closing date moves - see remodel below. Every plan
     and figure in this sheet reads `result` at the moment it is asked for. */
  let { result } = opts;
  if (result.unsupported) {
    toast(result.unsupported, { icon: 'alert' });
    return;
  }
  /* A dated model (one run under financing assumptions - see modelRound) is
     what the store holds the close to: the same financing cannot close twice,
     and the table written has to be the one fingerprinted here. */
  const financingId = result.financing?.id || uid();
  const basisDigest = capTableDigest(store.db);
  const preferred = store.classes.filter((c) => c.kind === 'preferred');
  const seniority = store.classes.reduce((a, c) => Math.max(a, c.seniority || 0), 0) + 1;

  /* A preferred class already named after this round is the one it closes
     into - a second tranche of a series on the cap table. Defaulting to a new
     class minted a twin "Series A Preferred" beside the first: two identical
     options in every class picker from then on, and every CSV row naming the
     class refused as ambiguous. */
  const sameName = (name) => (c) => c.name.trim().toLowerCase() === name.trim().toLowerCase();
  const existing = terms.name ? preferred.find(sameName(terms.name)) : null;
  const openingDate = result.modelDate || terms.asOf || todayISO();
  const state = {
    step: 'setup',
    date: openingDate,
    classChoice: existing ? existing.id : NEW_CLASS,
    className: terms.name?.trim() || 'Series A Preferred',
    liquidationMultiple: '1',
    participating: false,
    /* The first row starts on "+ New investor…", same as added rows. Round
       leads are usually new to the cap table, and preselecting whoever
       happens to be first - typically a founder - would issue them the whole
       round if the default went unnoticed. */
    investors: [
      /* The elected pro-rata checks come first, each locked to its holder and
         amount: they were confirmed in the model, and the store refuses a
         close that changes them. The rest of the round is one open row. */
      ...(result.financing?.allocations || []).filter((a) => a.elected > 0).map((a) => ({
        key: uid(), stakeholderId: a.stakeholderId, newName: '', newKind: 'investor',
        amount: amountValue(a.elected), rightIds: [a.rightId],
      })),
      ...((result.financing?.remaining ?? terms.investment) > 0 ? [{
        key: uid(), stakeholderId: NEW_HOLDER, newName: '', newKind: 'investor',
        amount: amountValue(result.financing?.remaining ?? terms.investment),
      }] : []),
    ],
    /* The plan the pool top-up lands in: the most recently adopted open plan,
       or the one plan there is. A round tops up one reserve, once. */
    topUpPlanId: defaultTopUpPlan(openingDate)?.id || '',
  };
  /* The plans that can take a top-up on the closing day: open, and not past
     their expiry - an expired plan accepts no award dated after that day, so
     a top-up into it could never be granted (the store refuses it, as the
     reserve transfer does). Proposed by default, the picker offered one. */
  function openPlans(date = state.date) {
    return plansOf(store.company).filter((p) => planIsOpen(p) && !(p.expires && date > p.expires));
  }
  function defaultTopUpPlan(date = state.date) {
    return [...openPlans(date)].sort((a, b) => (b.adopted || '').localeCompare(a.adopted || ''))[0] || null;
  }

  /* Dated cap and dividend terms for a class the round creates. */
  const negotiated = preferredTermsEditor(null, { date: state.date });
  const body = el('div');
  const modal = openModal({ title: `Close ${terms.name?.trim() || 'this round'}`, content: body, wide: true });

  /* The cap table the round was modeled against. A toast's Undo is pressable
     while this sheet is up, and a record it puts back (a deleted SAFE, say)
     or takes away changes the price the model settled on and the conversions
     it lists - but `result` was computed before the sheet opened and would
     have been written as it stood. The departure flow re-plans at its
     confirm for the same reason; here the plan is the caller's, so a moved
     cap table sends the user back to model it again. Judged by the same
     fingerprint the store holds the close to (see capTableDigest): a
     hand-picked list of fields left the holders out, so a holder renamed in
     another tab passed this check and met the store's refusal at the last
     press, worded for a saved scenario nobody had saved. */
  function capTableMoved() {
    if (capTableDigest(store.db) === basisDigest) return false;
    toast('The cap table changed while this round was being closed. Model it again before closing', { icon: 'alert' });
    modal.close();
    return true;
  }

  const allocated = () => state.investors.reduce((a, r) => a + Math.max(0, parseNum(r.amount) ?? 0), 0);

  /* Shares follow from the modeled price, so the split is entered in dollars
     and the certificates fall out of it. */
  const investorPlan = () => state.investors
    .map((r) => ({
      row: r,
      amount: Math.max(0, parseNum(r.amount) ?? 0),
      quantity: Math.round(Math.max(0, parseNum(r.amount) ?? 0) / result.pps),
      name: r.stakeholderId === NEW_HOLDER
        ? r.newName.trim()
        : (store.stakeholder(r.stakeholderId)?.name || ''),
    }))
    .filter((p) => p.amount > 0);

  /* The conversion price is a negotiated term of the round - it was settled
     when the round was modeled and doesn't move. A note's balance is a fact
     about the calendar, so it is read on the day the round actually closes.
     The store stamps `convertedAt` with that date and every later view reports
     the balance as of it, so sizing the certificate off the day the model
     happened to be run would leave a note and the shares it became
     permanently disagreeing - by a month of interest on a round recorded a
     month after it closed. */
  const conversionPlan = () => result.conversions
    .map((c) => {
      const source = store.security(c.securityId);
      /* A dated model already read every note at the closing date, and the
         store holds the close to its counts, so its shares are taken as they
         are; the undated model's balances are re-read at the date typed here. */
      const value = result.modelInputs ? c.value : source ? convertibleValue(source, state.date) : c.value;
      return {
        securityId: c.securityId,
        quantity: result.modelInputs ? c.shares : c.price > 0 ? Math.round(value / c.price) : 0,
        pricePerShare: c.price,
        label: c.label,
        kind: c.kind,
        name: store.stakeholder(c.stakeholderId)?.name || 'Unknown holder',
      };
    })
    .filter((c) => c.quantity > 0);

  /* The instruments the round would convert that did not yet exist on the
     closing date. A convertible converts into the round that priced it, so a
     round closing before one was signed is not that round - the model, which
     knows nothing about dates, offers them all whatever date is typed here. */
  const prematureConversions = () => conversionPlan()
    .map((c) => store.security(c.securityId))
    .filter((s) => s && s.date && s.date > state.date);

  /** "1 SAFE", "2 SAFEs and 1 note" - what is actually converting, counted. */
  const convertingSummary = (list) => {
    const count = (kind, word) => {
      const n = list.filter((c) => c.kind === kind).length;
      return n ? `${n} ${word}${n === 1 ? '' : 's'}` : null;
    };
    return [count('safe', 'SAFE'), count('note', 'note')].filter(Boolean).join(' and ');
  };

  /**
   * The reserve the destination plan has to hold so that `result.poolAfter`
   * shares are actually left unallocated across every plan - see
   * topUpReserve. Adding the top-up to the plan's reserve is the same number
   * whenever the reserve still covers what has been granted, and short by
   * the overrun when it doesn't: an imported cap table whose awards outran
   * its pool (which the share classes page says out loud) closed the round
   * with the overrun's worth of unallocated shares missing - the review
   * promised a 1,779,302 pool and the cap table read 1,729,302 afterwards.
   */
  const poolTarget = () => (result.poolAdd > 0 && state.topUpPlanId
    ? topUpReserve(store.db, state.topUpPlanId, result.poolAfter)
    : null);
  const topUpPlan = () => plansOf(store.company).find((p) => p.id === state.topUpPlanId) || null;

  /* The anti-dilution adjustments the modeled price triggers, re-derived
     against the cap table as it stands right now: the model may have been run
     before a share was issued or a class edited, and what commits has to be
     what the review shows. Read as of the closing date, which is the table
     the price was solved on (see modelRound). Read live, a protected
     certificate dated after the close - a second closing already on the
     books - was minted adjustment shares the model had not priced, on shares
     that did not exist on the closing day, and the round wrote more of them
     than the review's own price accounted for. */
  const adjustmentPlan = () => (result.modelInputs
    // A dated model's own adjustments: the store checks the close against them.
    ? result.antiDilution
    : antiDilutionAdjustments(dbAsOf(store.db, state.date), { pps: result.pps, investment: terms.investment }));

  /**
   * The model is dated: a right is eligible or not on the day, an MFN
   * election is in force or not, a note has accrued to it - and the base
   * model reads the table as of the day too (see modelRound), in that day's
   * split units. So a closing date other than the modeled one prices the
   * round again on that day, and the review then shows the figures the store
   * will hold the close to. The base model was left as modeled while its
   * date moved: dated before a 2-for-1 split and closed after it, the round
   * wrote half the shares the money buys at twice the price into the
   * restated table, past a split guard that reads the closing date. A date
   * the terms refuse is declined here, with the reason, and the old one kept.
   */
  function remodel(date) {
    /* The store's split guard, applied where the date is typed: the review
       otherwise rendered a pre-split date's figures in that day's units and
       the refusal came at the last press. */
    const split = (store.company.splits || []).find((sp) => sp.date > date);
    if (split) {
      return `Closing before the ${split.num}-for-${split.den} split of ${dateLong(split.date)} is unsupported. Close on or after the split, or restore the table before it.`;
    }
    // And its sibling for a down round recorded after the day - see adjustedAfter.
    const adjusted = adjustedAfter(store.db, date);
    if (adjusted) {
      return `Closing before the anti-dilution adjustment of ${dateLong(adjusted.date)} is unsupported. Close on or after the round that adjusted ${adjusted.cls?.name || 'the class'}, or restore the table before it.`;
    }
    const inputs = result.modelInputs
      ? { ...result.modelInputs, asOf: date }
      : { preMoney: terms.preMoney, investment: terms.investment, poolPct: terms.poolPct, asOf: date };
    const next = modelRound(store.db, inputs);
    if (!next?.pps || next.unsupported || next.overclaim || next.valueClaim || next.unpriceable) {
      return next?.unsupported || 'The round cannot be priced on that date. Model it again from Round modeling.';
    }
    /* Dated before a round already on the books, the model reads that
       round's instruments as live again and lists them converting (see
       convertedAfter). The store refuses to convert one twice, but it said so
       at the last press, after the review had listed the conversion. */
    const reopened = convertedAfter(next, date, store.db);
    if (reopened) {
      return `${reopened.label} converted on ${dateLong(reopened.convertedAt)}, after ${dateLong(date)}, so this round cannot be the one it converts into. Close on or after that round, or restore the table before it.`;
    }
    result = next;
    state.date = date;
    return null;
  }

  /** Adjusted classes whose authorized count the new shares would exceed. */
  const overAuthorized = (adjustments) => adjustments
    .filter((a) => {
      const cls = store.shareClass(a.classId);
      if (!cls || !(cls.authorized > 0)) return false;
      return issuedInClass(store.securities, cls.id) + a.shares > cls.authorized;
    })
    .map((a) => a.name);

  /**
   * How far the round's own certificates would push its class past the
   * authorized count, or 0.
   *
   * A new class is sized to exactly what this round issues into it, so only
   * an existing one - a second tranche of a series already on the cap table -
   * can run over. That is the likelier charter problem of the two the review
   * can see, and it was the one it said nothing about.
   */
  const overAuthorizedRound = (shares) => {
    if (state.classChoice === NEW_CLASS) return 0;
    const cls = store.shareClass(state.classChoice);
    if (!cls || !(cls.authorized > 0)) return 0;
    return Math.max(0, issuedInClass(store.securities, cls.id) + shares - cls.authorized);
  };

  /* ---------- Step 1: what the model can't know ---------- */

  function renderSetup() {
    const metricValue = (read) => el('span.v', {}, read());
    const priceValue = metricValue(() => sharePrice(result.pps));
    const postMoneyValue = metricValue(() => moneyWhole(result.postMoney));
    const latestSplit = [...(store.company.splits || [])].sort((a, b) => b.date.localeCompare(a.date))[0];
    // The latest day a recorded adjustment was minted on, the other floor remodel holds the date to.
    const latestAdjustment = store.securities.filter((s) => s.antiDilution === true && s.date).map((s) => s.date).sort().at(-1);
    const floor = [latestSplit?.date, latestAdjustment].filter(Boolean).sort().at(-1);
    const dateInput = el('input.input', {
      type: 'date', value: state.date, 'aria-label': 'Closing date',
      // The picker's own floor matches the split and adjustment guards below.
      ...(floor ? { min: floor } : {}),
      onchange: (e) => {
        const refused = remodel(e.target.value || todayISO());
        if (refused) {
          e.target.value = state.date;
          flagInvalid(dateInput, refused);
          return toast(refused, { icon: 'alert' });
        }
        /* A cleared field closes on today: said in the field too, which
           otherwise stayed blank while the terms' dates and the review
           followed a day nobody could see. */
        e.target.value = state.date;
        // The price is the model's, and the model just moved with the date.
        priceValue.textContent = sharePrice(result.pps);
        postMoneyValue.textContent = moneyWhole(result.postMoney);
        negotiated.follow(state.date);
        syncTopUp();
        syncLater();
        renderRemainder();
      },
    });
    /* The convertibles the closing day leaves out: an instrument signed after
       the date was not on that day's table, so the model converts nothing of
       it and the review lists no row for it. Absent rows are easy to read
       past when the rounds page had shown the conversion a moment earlier, so
       the ones left outstanding are named under the date. */
    const laterLine = el('p.field-hint', { role: 'status' });
    const syncLater = () => {
      const later = convertibles(store.securities).filter((s) => s.date && s.date > state.date).map((s) => s.label);
      laterLine.textContent = later.length
        ? `${later.join(', ')} ${later.length === 1 ? 'is' : 'are'} dated after ${dateLong(state.date)} and ${later.length === 1 ? 'stays' : 'stay'} outstanding; `
          + `${later.length === 1 ? 'it converts' : 'they convert'} in a round closed on or after ${later.length === 1 ? 'its' : 'their'} date.`
        : '';
      laterLine.style.display = later.length ? '' : 'none';
    };
    syncLater();

    const classSelect = el('select.select', {
      'aria-label': 'Share class for this round',
      /* Only the new-class fields depend on this choice, so they toggle in
         place. Rebuilding the step - the pattern a step swap uses - took the
         select the user was in with it, scrolled the sheet to the top and
         dropped focus on the dialog box, once per option tried. */
      onchange: (e) => { state.classChoice = e.target.value; syncNewClass(); },
    },
      el('option', { value: NEW_CLASS, selected: state.classChoice === NEW_CLASS }, '+ New preferred class…'),
      preferred.map((c) => el('option', { value: c.id, selected: state.classChoice === c.id }, c.name)));

    const multipleInput = textInput({
      value: state.liquidationMultiple, inputmode: 'decimal', 'aria-label': 'Liquidation multiple',
      oninput: (e) => { state.liquidationMultiple = e.target.value; },
    });
    const classNameInput = textInput({
      value: state.className, maxlength: 80, 'aria-label': 'Class name',
      oninput: (e) => { state.className = e.target.value; },
    });
    const newClassFields = el('div', {},
      field('Class name', classNameInput),
      el('div.form-grid', {},
        field('Liquidation preference (x)', multipleInput, 'Standard is 1x'),
        field('Participation',
          el('label.check-row', {},
            el('input', {
              type: 'checkbox', checked: state.participating,
              onchange: (e) => { state.participating = e.target.checked; },
            }),
            el('span', {}, 'Participating')))),
      negotiated.node);
    const syncNewClass = () => {
      newClassFields.style.display = state.classChoice === NEW_CLASS ? '' : 'none';
    };
    syncNewClass();

    /* Where the top-up goes, when the model asks for one and there is more
       than one open plan to put it in. With one plan there is nothing to
       choose; with none the model's top-up has nowhere to land. Rebuilt when
       the closing date re-models the round: built once, the picker and its
       figure stayed after a date that asked for no top-up, and a date that
       did ask for one after opening without it had no picker at all. */
    const topUpField = el('div');
    const syncTopUp = () => {
      const plans = openPlans();
      if (!(result.poolAdd > 0) || plans.length <= 1) { topUpField.replaceChildren(); return; }
      if (!plans.some((p) => p.id === state.topUpPlanId)) state.topUpPlanId = defaultTopUpPlan()?.id || plans[0].id;
      const planSelect = el('select.select', {
        'aria-label': 'Plan the pool top-up goes into',
        onchange: (e) => { state.topUpPlanId = e.target.value; },
      }, plans.map((p) => el('option', { value: p.id, selected: p.id === state.topUpPlanId }, p.name)));
      topUpField.replaceChildren(field('Pool top-up goes into', el('div.select-wrap', {}, planSelect),
        `The model adds ${fmtShares(result.poolAdd)} to the reserve. Every other plan keeps its own`));
    };
    syncTopUp();

    // A live region: it changes under every keystroke in the amounts, and said nothing to a screen reader.
    const remainderLine = el('p.field-hint', { role: 'status' });
    const remainderText = () => {
      const left = terms.investment - allocated();
      return Math.abs(left) <= ALLOCATION_TOLERANCE
        ? `All ${moneyWhole(terms.investment)} allocated.`
        : left > 0
          ? `${moneyWhole(left)} of ${moneyWhole(terms.investment)} still unallocated.`
          : `${moneyWhole(-left)} over the modeled ${moneyWhole(terms.investment)}.`;
    };

    const rows = el('div.investor-rows');
    const renderRows = () => {
      append(clear(rows), state.investors.map((r, i) => {
        const holderSelect = el('select.select', {
          'aria-label': `Investor ${i + 1}`, disabled: !!r.rightIds?.length,
        },
          store.stakeholders.map((h) => el('option', { value: h.id, selected: h.id === r.stakeholderId }, holderOptionLabel(h))),
          el('option', { value: NEW_HOLDER, selected: r.stakeholderId === NEW_HOLDER }, '+ New investor…'));

        const nameInput = textInput({
          value: r.newName, placeholder: 'Investor name', maxlength: 120,
          'aria-label': `New investor ${i + 1} name`,
          oninput: (e) => { r.newName = e.target.value; },
        });

        /* The picker stays put and the new-holder fields appear underneath it,
           rather than replacing it: swapping the select out would strand
           anyone who picked "+ New investor…" by mistake, since the first row
           can't be removed either. */
        const newHolderFields = el('div.investor-new', {},
          nameInput,
          el('div.select-wrap', {}, el('select.select', {
            'aria-label': `New investor ${i + 1} type`,
            onchange: (e) => { r.newKind = e.target.value; },
          }, STAKEHOLDER_KINDS.map((k) => el('option', { value: k.value, selected: k.value === r.newKind }, k.label)))));
        const syncNewHolder = () => {
          newHolderFields.style.display = r.stakeholderId === NEW_HOLDER ? '' : 'none';
        };
        holderSelect.addEventListener('change', () => {
          r.stakeholderId = holderSelect.value;
          syncNewHolder();
          if (r.stakeholderId === NEW_HOLDER) nameInput.focus();
        });
        syncNewHolder();

        const amountInput = textInput({
          className: 'input investor-amount',
          value: r.amount, inputmode: 'numeric', placeholder: '1,000,000',
          'aria-label': `Investment amount ${i + 1} (${currencySymbol()})`, readOnly: !!r.rightIds?.length,
          oninput: (e) => {
            r.amount = e.target.value;
            renderRemainder();
          },
        });

        return el('div.investor-row', {},
          el('div.select-wrap', {}, holderSelect),
          amountInput,
          el('button.icon-btn', {
            type: 'button', html: icon('trash', 16, 2),
            'aria-label': `Remove investor ${i + 1}`,
            disabled: state.investors.length === 1 || !!r.rightIds?.length,
            onclick: () => {
              state.investors = state.investors.filter((x) => x.key !== r.key);
              renderRows();
              renderRemainder();
              /* The button that was just pressed went with its row, so focus
                 would drop to the document body mid-list. It moves to the
                 remove button that took this row's place, or the last one if
                 this was the bottom row; when a single row is left its own
                 button is disabled, and Add investor is then the nearest
                 thing that can hold focus at all. */
              const left = [...rows.querySelectorAll('.icon-btn:enabled')];
              (left[Math.min(i, left.length - 1)] || addBtn).focus();
            },
          }),
          newHolderFields);
      }));
    };
    const renderRemainder = () => {
      remainderLine.textContent = remainderText();
      remainderLine.classList.toggle('warn',
        Math.abs(terms.investment - allocated()) > ALLOCATION_TOLERANCE);
    };
    renderRows();
    renderRemainder();

    const nextBtn = el('button.btn.btn-primary.btn-block', { type: 'submit', style: { padding: '12px' } },
      'Review the close');

    /* Named because a removed row hands focus here when nothing else in the
       list can take it. */
    const addBtn = el('button.btn.btn-ghost', {
      type: 'button', html: icon('plus', 14, 2.2), style: { marginTop: '8px' },
      onclick: () => {
        state.investors = [...state.investors, {
          key: uid(), stakeholderId: NEW_HOLDER, newName: '', newKind: 'investor', amount: '',
        }];
        renderRows();
        renderRemainder();
        /* The row was asked for to be filled in, so its first control takes
           focus; left on the button, the next Tab skipped the new row. */
        rows.lastElementChild?.querySelector('select, input')?.focus();
      },
    }, ' Add investor');

    const form = el('form', {
      onsubmit: (e) => {
        e.preventDefault();
        if (capTableMoved()) return;
        if (state.classChoice === NEW_CLASS && !state.className.trim()) {
          flagInvalid(classNameInput);
          classNameInput.focus();
          return toast('Name the new share class', { icon: 'alert' });
        }
        /* A new class under a name already on the cap table is the twin
           holderNamed guards against for investors, for the same reason. */
        const twinClass = state.classChoice === NEW_CLASS ? store.classes.find(sameName(state.className)) : null;
        if (twinClass) {
          flagInvalid(classNameInput);
          classNameInput.focus();
          return toast(`${twinClass.name} is already a share class. `
            + `${twinClass.kind === 'preferred' ? 'Pick it from the list, or name' : 'Name'} the new class differently`, { icon: 'alert' });
        }
        if (state.classChoice === NEW_CLASS) {
          const multiple = parseMultiple(state.liquidationMultiple);
          if (multiple === null || multiple < 0) {
            flagInvalid(multipleInput);
            multipleInput.focus();
            return toast('Liquidation preference must be a number, like 1 or 1.5', { icon: 'alert' });
          }
        }
        /* A row with an investor on it and no usable amount - blank, negative,
           or "1.000.000" - dropped out of the plan without a word, and with
           the first row pre-filled with the whole round the allocation still
           balanced: the review showed one certificate for the whole round. */
        const unpriced = state.investors.find((r) => (r.stakeholderId !== NEW_HOLDER || r.newName.trim())
          && !(parseNum(r.amount) > 0));
        if (unpriced) {
          const input = rows.querySelectorAll('.investor-amount')[state.investors.indexOf(unpriced)];
          flagInvalid(input);
          input?.focus();
          const who = unpriced.stakeholderId === NEW_HOLDER
            ? unpriced.newName.trim() : (store.stakeholder(unpriced.stakeholderId)?.name || 'this investor');
          return toast(`Enter how much ${who} is investing, or remove the row`, { icon: 'alert' });
        }
        const plan = investorPlan();
        if (!plan.length) {
          // Nothing on the list to flag, so the way to add a row takes focus.
          addBtn.focus();
          return toast('Add at least one investor and their check size', { icon: 'alert' });
        }
        const unnamed = plan.find((p) => !p.name);
        if (unnamed) {
          // The empty name box, flagged and focused, like the amount above.
          const input = rows.querySelectorAll('.investor-row')[state.investors.indexOf(unnamed.row)]
            ?.querySelector('.investor-new input');
          flagInvalid(input);
          input?.focus();
          return toast('Every new investor needs a name', { icon: 'alert' });
        }
        /* A new investor already in the picker beside them, or entered as
           new on two rows at once - see holderNamed. Either way the close
           would issue the round to two records of one investor. */
        const named = new Set();
        for (const p of plan) {
          if (p.row.stakeholderId !== NEW_HOLDER) continue;
          const key = p.name.toLowerCase();
          const twin = holderNamed(p.name, store.stakeholders);
          const message = twin
            ? `${twin.name} is already on the cap table. Pick them from the list`
            : named.has(key) ? `${p.name} is entered as a new investor twice. Combine the two rows` : null;
          if (message) {
            const input = rows.querySelector(`[aria-label="New investor ${state.investors.indexOf(p.row) + 1} name"]`);
            flagInvalid(input);
            input?.focus();
            return toast(message, { icon: 'alert' });
          }
          named.add(key);
        }
        const tooSmall = plan.find((p) => !Number.isInteger(p.quantity) || p.quantity < 1);
        if (tooSmall) {
          const input = rows.querySelectorAll('.investor-amount')[state.investors.indexOf(tooSmall.row)];
          flagInvalid(input);
          input.focus();
          return toast(`${tooSmall.name} must receive at least one whole share. Adjust their allocation or remodel the round.`, { icon: 'alert' });
        }
        if (Math.abs(terms.investment - allocated()) > ALLOCATION_TOLERANCE) {
          /* The remainder line already reads in the warn colour; the first
             amount that can change is where the balancing starts, so it is
             flagged and focused like every other refusal here - not the
             elected check ahead of it, which is read-only and was flagged
             for a shortfall it cannot make up. */
          const input = rows.querySelector('.investor-amount:not([readonly])') || rows.querySelector('.investor-amount');
          flagInvalid(input);
          input?.focus();
          return toast('Allocate exactly the modeled investment before closing', { icon: 'alert' });
        }
        const early = prematureConversions();
        if (early.length) {
          flagInvalid(dateInput);
          dateInput.focus();
          return toast(`${early.map((s) => s.label).join(', ')} `
            + `${early.length === 1 ? 'was' : 'were'} issued after ${dateLong(state.date)}, `
            + 'so this round cannot be the one it converts into', { icon: 'alert' });
        }
        /* A top-up with nowhere to go: the model reserved shares the close
           cannot write. The plans page is where a plan is adopted. */
        if (result.poolAdd > 0 && !topUpPlan()) {
          return toast(`The model tops the pool up by ${fmtShares(result.poolAdd)}, and no open plan can take it. `
            + 'Adopt an equity plan under Share classes first, or model the round with no top-up', { icon: 'alert' });
        }
        const destination = result.poolAdd > 0 ? topUpPlan() : null;
        if (destination?.adopted && state.date < destination.adopted) {
          flagInvalid(dateInput);
          dateInput.focus();
          return toast(`${destination.name} was adopted on ${dateLong(destination.adopted)}, after this closing date, so it can’t take the top-up`, { icon: 'alert' });
        }
        try {
          state.preferredTerms = state.classChoice === NEW_CLASS ? negotiated.read({ participating: state.participating }) : undefined;
        } catch (err) {
          // The editor flags the field at fault; the sheet takes focus there, as every refusal above does.
          negotiated.node.querySelector('[aria-invalid="true"]')?.focus();
          return toast(err.message, { icon: 'alert' });
        }
        state.step = 'review';
        render();
      },
    },
      el('div.round-metric', {}, el('span', {}, 'Price per share'), priceValue),
      el('div.round-metric', {}, el('span', {}, 'New money'), el('span.v', {}, moneyWhole(terms.investment))),
      el('div.round-metric', { style: { marginBottom: '16px' } },
        el('span', {}, 'Post-money valuation'), postMoneyValue),

      field('Closing date', dateInput, laterLine),
      field('Share class', el('div.select-wrap', {}, classSelect)),
      newClassFields,
      topUpField,

      el('span.field-label', {}, 'Investors and check sizes'),
      rows,
      addBtn,
      remainderLine,
      el('div', { style: { height: '14px' } }),
      nextBtn);

    append(clear(body), [form]);
  }

  /* ---------- Step 2: exactly what will be written ---------- */

  function renderReview() {
    const plan = investorPlan();
    const conversions = conversionPlan();
    const adjustments = adjustmentPlan();
    const pool = poolTarget();
    /* Counted off the certificates actually about to be written rather than
       taken from the model: the investment is split across investors in
       dollars and rounded row by row, the conversions are re-read at the
       closing date, and the adjustments are re-derived against today's cap
       table - so all three can land a few shares either side of the modeled
       figure. The number under review should be the one the cap table will
       show afterwards. */
    const postFD = result.fdPre + result.poolAdd
      + plan.reduce((a, p) => a + p.quantity, 0)
      + conversions.reduce((a, c) => a + c.quantity, 0)
      + adjustments.reduce((a, x) => a + x.shares, 0);
    const className = state.classChoice === NEW_CLASS
      ? state.className.trim()
      : (store.shareClass(state.classChoice)?.name || 'the selected class');
    const roundOverAuthorized = overAuthorizedRound(
      plan.reduce((a, p) => a + p.quantity, 0) + conversions.reduce((a, c) => a + c.quantity, 0));
    const rounding = plan.reduce((a, p) => a + p.amount - p.quantity * result.pps, 0);

    const line = (left, right) => el('div.round-metric', {},
      el('span', {}, left), el('span.v', {}, right));

    const confirmBtn = el('button.btn.btn-primary.btn-block', { style: { padding: '12px' } },
      'Close the round');
    /* Held with the confirm button while the close is in flight. Only the
       button pressed was disabled, and the write takes two round trips (the
       restore point, then the round) - long enough on a slow connection to
       press Back, come forward again, and press a freshly built, enabled
       "Close the round" that issued every new-money certificate a second
       time and created the class twice. */
    const backBtn = el('button.btn.btn-ghost', {
      type: 'button', style: { flex: '1', padding: '12px' },
      onclick: () => { state.step = 'setup'; render(); },
    }, 'Back');

    confirmBtn.addEventListener('click', async () => {
      if (capTableMoved()) return;
      confirmBtn.disabled = true;
      backBtn.disabled = true;
      state.busy = true;
      try {
        await store.closeRound({
          /* Only a dated model is held to itself; an undated one closes as it
             always has. The sheet re-models on the date, so the inputs it
             hands over are the ones the figures under review came from. */
          ...(result.modelInputs ? { modeling: { id: financingId, basisDigest, inputs: { ...result.modelInputs, asOf: state.date } } } : {}),
          date: state.date,
          adjustments: adjustments.map((a) => ({
            classId: a.classId,
            conversionPrice: a.conversionPriceAfter,
            holders: a.holders,
          })),
          newClass: state.classChoice === NEW_CLASS ? {
            name: state.className.trim(),
            kind: 'preferred',
            authorized: plan.reduce((a, p) => a + p.quantity, 0) + conversions.reduce((a, c) => a + c.quantity, 0),
            pricePerShare: result.pps,
            liquidationMultiple: parseMultiple(state.liquidationMultiple) ?? 1,
            participating: state.participating,
            seniority,
            preferredTerms: state.preferredTerms,
          } : null,
          classId: state.classChoice === NEW_CLASS ? null : state.classChoice,
          investors: plan.map((p) => ({
            stakeholderId: p.row.stakeholderId === NEW_HOLDER ? null : p.row.stakeholderId,
            newHolder: p.row.stakeholderId === NEW_HOLDER
              ? { name: p.row.newName.trim(), kind: p.row.newKind }
              : null,
            quantity: p.quantity,
            amount: p.amount,
            rightIds: p.row.rightIds || [],
            pricePerShare: result.pps,
          })),
          conversions,
          topUp: pool !== null ? { planId: state.topUpPlanId, reserve: pool } : null,
        });
        store.logActivity(
          `${terms.name?.trim() || 'Round'} closed: ${moneyWhole(terms.investment)} at ${sharePrice(result.pps)} per share`,
          'trending-up');
        for (const a of adjustments) {
          store.logActivity(
            `${a.name} anti-dilution: conversion price cut to ${sharePrice(a.conversionPriceAfter)}, `
            + `${fmtShares(a.shares)} shares issued`, 'shield');
        }
        if (conversions.length) {
          store.logActivity(
            `${conversions.length} convertible${conversions.length === 1 ? '' : 's'} converted into ${className}`,
            'refresh');
        }
        toast('Round closed');
        modal.close();
        onClosed?.();
      } catch (err) {
        console.error(err);
        toast(isRefusal(err) ? err.message : 'Couldn’t close the round. Nothing was changed',
          { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
        state.busy = false;
        confirmBtn.disabled = false;
        backBtn.disabled = false;
      }
    });

    append(clear(body), [
      el('p.confirm-message', {},
        `Closing on ${dateLong(state.date)} writes the following to your cap table. Review it before confirming.`),

      el('h3.card-title', { style: { marginTop: '4px' } }, `New certificates in ${className}`),
      el('div.table-wrap', {
        tabindex: 0, role: 'region', 'aria-label': 'New certificates table', style: { margin: '8px 0 16px' },
      },
        el('table.data', { style: { minWidth: '420px' } },
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col' }, 'Holder'),
            el('th', { scope: 'col' }, 'Source'),
            el('th.num', { scope: 'col' }, 'Price'),
            el('th.num', { scope: 'col' }, 'Shares'))),
          el('tbody', {},
            plan.map((p) => el('tr', {},
              el('td', {}, p.name),
              el('td', {}, el('span.kind-pill', {}, 'New money')),
              el('td.num', {}, sharePrice(result.pps)),
              el('td.num', {}, fmtShares(p.quantity)))),
            conversions.map((c) => el('tr', {},
              el('td', {}, c.name),
              el('td', {}, el('span.kind-pill', {}, c.label)),
              el('td.num', {}, sharePrice(c.pricePerShare)),
              el('td.num', {}, fmtShares(c.quantity)))))
        )),

      conversions.length
        ? el('p.field-hint', { style: { marginBottom: '14px' } },
          `${convertingSummary(conversions)} will be marked converted and will stop appearing as outstanding convertibles.`)
        : null,

      /* Said here rather than left to the share classes table afterwards -
         the same courtesy the anti-dilution block below already extends. */
      roundOverAuthorized > 0
        ? el('p.field-hint.warn', { style: { margin: '-4px 0 14px' } },
          `${className} will hold ${fmtShares(roundOverAuthorized)} more ${roundOverAuthorized === 1 ? 'share' : 'shares'} than its `
          + `authorized count of ${fmtShares(store.shareClass(state.classChoice)?.authorized || 0)}. `
          + 'That is what a charter amendment is for; raise the authorized shares under '
          + 'Share classes once it is signed.')
        : null,

      /* Anti-dilution is the part of a down round nobody remembers until it
         is on the cap table, so the review names every share of it. */
      adjustments.length
        ? el('div', {},
          el('h3.card-title', {}, 'Anti-dilution adjustments'),
          el('p.field-hint', { style: { margin: '4px 0 8px' } },
            'This price is below what these classes paid, so their conversion price falls '
            + 'and the shares below are issued to the holders who already own them.'),
          /* An adjustment usually needs the charter amended, and the class
             table will say "over authorized" straight afterwards - better to
             hear it here, before the write, than to find it there. */
          overAuthorized(adjustments).length
            ? el('p.field-hint.warn', { style: { margin: '0 0 8px' } },
              `${overAuthorized(adjustments).join(' and ')} will hold more shares than `
              + 'its authorized count. That is what a charter amendment is for; raise the '
              + 'authorized shares under Share classes once it is signed.')
            : null,
          el('div.table-wrap', {
            tabindex: 0, role: 'region', 'aria-label': 'Anti-dilution adjustments table', style: { margin: '0 0 16px' },
          },
            el('table.data', { style: { minWidth: '420px' } },
              el('thead', {}, el('tr', {},
                el('th', { scope: 'col' }, 'Class'),
                el('th.num', { scope: 'col' }, 'Conversion price'),
                el('th.num', { scope: 'col' }, 'Shares issued'))),
              el('tbody', {}, adjustments.map((a) => el('tr', {},
                el('td', {}, a.name),
                el('td.num', {}, `${sharePrice(a.conversionPriceBefore)} to ${sharePrice(a.conversionPriceAfter)}`),
                el('td.num', {}, fmtShares(a.shares))))))))
        : null,

      el('div', {},
        state.classChoice === NEW_CLASS
          ? line('New class terms',
            `${parseMultiple(state.liquidationMultiple) ?? 1}x ${state.participating ? 'participating' : 'non-participating'}`)
          : null,
        // The date read the way every other date on this sheet reads, not as typed into the field.
        ...(state.preferredTerms || []).map((t) => line('Dated preferred terms',
          `${dateLong(t.date)} · ${t.cap ? `${t.cap.multiple}x participation cap` : 'no cap'} · ${t.dividends ? `${percentValue(t.dividends.rate)}% ${t.dividends.convention} dividends` : 'no dividends'}`)),
        /* Whole shares: what the checks add up to against what the shares
           they buy are worth at the price. Said only when they differ, and as
           a sentence, the way the breakdown card says it: a metric row keeps
           its figure on one line, and this one is two figures and a clause,
           which ran off the edge of the sheet on a phone. */
        Math.abs(rounding) >= 0.005
          ? el('p.field-hint', { style: { margin: '8px 0 0' } },
            `Whole shares: ${money(plan.reduce((a, p) => a + p.amount, 0))} in checks buys shares worth `
            + `${money(plan.reduce((a, p) => a + p.quantity * result.pps, 0))} at the round price; the difference is rounding.`)
          : null,
        line('Fully diluted after close', fmtShares(postFD)),
        pool !== null
          /* The increase in the reserve, not the top-up: where awards have
             outrun the plan the two differ by the overrun, and the figure
             beside a total has to be the difference from the old one. */
          ? line(`${topUpPlan()?.name || 'Plan'} reserve`,
            `${fmtShares(pool)} (+${fmtShares(pool - (planBalances(store.db).plans.find((r) => r.planId === state.topUpPlanId)?.reserve || 0))})`)
          : line('Plan reserves', fmtShares(store.company.poolAuthorized)),
        pool !== null && plansOf(store.company).length > 1
          ? line('Other plans', 'unchanged') : null,
        line('Unallocated after close', fmtShares(result.poolAfter))),

      el('p.field-hint.warn', { style: { margin: '14px 0' } },
        'This writes real records: certificates issued, convertibles marked converted, '
        + `${pool !== null ? 'the plan’s reserve resized' : 'no reserve resized'}. A restore point is taken first, so the whole close can be `
        + 'rolled back from Settings.'),

      /* Back carries the same padding as the step's primary action: the two
         sit side by side, and the default 9px left it 6px shorter than the
         button it is paired with. */
      el('div.row', {},
        backBtn,
        el('div', { style: { flex: '2' } }, confirmBtn)),
    ]);
  }

  function render() {
    // Nothing rebuilds under a commit in flight - see the Back button above.
    if (state.busy) return;
    if (state.step === 'setup') renderSetup();
    else renderReview();
    modal.panel.scrollTop = 0;
    /* A step swap replaces everything in the panel, the control that asked for
       it included - so keyboard focus lands on the document body, and a screen
       reader is left with nothing to read on the step it just moved to. The
       dialog itself is where to put it back: the next step's own first control
       is "Back", which is not where anyone means to be after pressing forward.
       Harmless on the first render, which openModal's own focus follows. */
    modal.panel.focus({ preventScroll: true });
  }

  render();
}
