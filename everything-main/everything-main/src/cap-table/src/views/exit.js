import { el, append, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { viewHead, emptyState, field, segmented, flagInvalid } from '../ui/bits.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { store, isRefusal } from '../lib/store.js';
import { exitWaterfall, exitBreakevenPoints, fullyDiluted } from '../lib/captable.js';
import { capTableDigest, termDate } from '../lib/financing.js';
import {
  money, moneyWhole, moneyCompact, sharePrice, shares, sharesLabel, pct, currencySymbol, amountValue, percentValue,
} from '../lib/format.js';
import { parseNum, stillTyping, todayISO, takeHashParam } from '../lib/util.js';
import { ownershipChart } from '../charts/ownership.js';

/* Draft survives store-driven re-renders (module scope, not persisted). */
let draft = { name: '', exitValue: '' };
/* But not across a change of dataset: a sale price typed against one cap
   table would arrive over another one's waterfall, already distributed. Same
   reason the round model drops its terms. */
let draftEpoch = null;

/* Deal-structure assumptions, module scope like the draft. Unvested options
   participate by default - the historical behavior, and the right one when
   the deal rolls awards over. */
let changeOfControl = false;
let unvestedOptions = 'participate';

/**
 * Put a saved scenario back into the form - every input that decides its
 * waterfall, not only the two that show in its chip. The assumptions were
 * never saved and never restored, so a scenario modeled with unvested awards
 * cancelled came back with them participating and paid the whole option pool
 * out of a price that had been set on the understanding it would not.
 */
function loadScenario(scenario) {
  draft = { name: scenario.name, exitValue: amountValue(scenario.exitValue), asOf: scenario.asOf, basisDigest: scenario.basisDigest };
  unvestedOptions = scenario.unvestedOptions === 'cancel' ? 'cancel' : 'participate';
  changeOfControl = !!scenario.changeOfControl;
}

/**
 * Breakeven points depend on the cap table, not on the sale price being typed -
 * but finding them bisects the whole waterfall once per preferred class, which
 * is by far the most expensive thing on this view. So they are computed once
 * per cap table and reused while the exit value changes.
 *
 * The store replaces its collections rather than mutating them, so identity is
 * a sound cache key: a write of any kind produces new objects and a fresh
 * result.
 *
 * Every input the waterfall reads has to be in that key, the company record
 * included: a dated view unwinds the company's stock splits, which restate
 * every count and price the waterfall prices. The pool it holds no longer
 * enters - a SAFE's cap divides by the liquidity capitalization at an exit,
 * which leaves the unissued pool out - but the record did once, and keyed on
 * the collections alone this card quoted the breakevens of the table before
 * a change to it.
 *
 * And computed a point at a time, off the render path: every point is a
 * bisection of the whole waterfall, and a cap table with twenty SAFEs has
 * twenty of them, seconds of work that froze the view on the way in. The
 * view paints with the points found so far and a line saying more are
 * coming; the card fills in as they land, and stops asking for more the
 * moment nothing is showing them.
 */
let breakevenJob = null;
function breakevenJobFor(db, asOf) {
  const j = breakevenJob;
  if (j && j.company === db.company && j.classes === db.classes && j.securities === db.securities
    && j.asOf === asOf && j.changeOfControl === changeOfControl && j.unvestedOptions === unvestedOptions) {
    return j;
  }
  clearTimeout(j?.timer);
  breakevenJob = {
    company: db.company, classes: db.classes, securities: db.securities, asOf,
    changeOfControl, unvestedOptions,
    iterator: exitBreakevenPoints(db, { asOf, changeOfControl, unvestedOptions }),
    points: [], done: false, timer: null, watchers: new Set(),
  };
  return breakevenJob;
}
function stepBreakevens(job) {
  if (job.done || job.timer || !job.watchers.size) return;
  job.timer = setTimeout(() => {
    job.timer = null;
    /* The generator yields nothing between waterfall evaluations, so a
       point is taken in slices of about a frame: one bisection ran whole in
       a single tick, 400-650 ms at 5,000 securities, and the view stuttered
       for as long as the card took to fill. */
    const started = Date.now();
    let landed = false;
    while (!job.done && !landed && Date.now() - started < 12) {
      const { value, done } = job.iterator.next();
      if (done) job.done = true;
      else if (value) {
        job.points.push(value);
        job.points.sort((a, b) => a.exitValue - b.exitValue);
        landed = true;
      }
    }
    for (const watch of [...job.watchers]) watch();
    stepBreakevens(job);
  }, 0);
}

export function exitView() {
  if (draftEpoch !== store.dataEpoch) {
    draftEpoch = store.dataEpoch;
    draft = { name: '', exitValue: '' };
    // These terms belong to the same draft as its price. Carrying them
    // across companies applies the previous company's deal to a fresh one.
    changeOfControl = false;
    unvestedOptions = 'participate';
  }
  /* `#/exit?scenario=:id` loads that saved exit into the form - see the same
     hash on the round model. */
  const requested = takeHashParam('scenario');
  if (requested) {
    const scenario = store.exits.find((s) => s.id === requested);
    if (scenario) loadScenario(scenario);
  }

  const resultWrap = el('div');

  /* The day the sale closes: notes have accrued to it, dividends have
     accrued to it, and a certificate dated after it is not on the table. */
  const dateInput = el('input.input', { type: 'date', value: draft.asOf || todayISO(), 'aria-label': 'Exit model date', onchange: () => sync() });
  const nameInput = el('input.input', {
    type: 'text', value: draft.name, placeholder: 'Acquisition', maxlength: 80, 'aria-label': 'Scenario name',
  });
  const exitInput = el('input.input', {
    type: 'text', inputmode: 'numeric', value: draft.exitValue, placeholder: '60,000,000',
    'aria-label': 'Exit value',
  });

  const sync = () => {
    draft = { ...draft, name: nameInput.value, exitValue: exitInput.value, asOf: dateInput.value };
    renderResult();
  };
  for (const i of [nameInput, exitInput]) i.addEventListener('input', sync);

  const exitValue = () => Math.max(0, parseNum(exitInput.value) ?? 0);

  /**
   * A sale price the form can't take as typed - "60M", "60.000.000", a minus
   * sign - flagged on the field and named, the way the round model names its
   * own terms. It fell through as zero, and the panel answered by asking for
   * the price that was already in the box; Save said the same. The flag lifts
   * the moment the figure reads, and a thousands group still being typed is
   * not a mistake yet. Returns the message, or null when the figure reads.
   */
  function priceProblem() {
    const raw = exitInput.value.trim();
    const n = raw ? parseNum(raw) : 0;
    let message = null;
    if (n === null && !stillTyping(raw)) {
      message = `The exit value isn’t a number. Use digits, like ${exitInput.placeholder}`;
    } else if (n < 0) {
      message = 'The exit value can’t be negative';
    }
    if (message) exitInput.setAttribute('aria-invalid', 'true');
    else exitInput.removeAttribute('aria-invalid');
    return message;
  }

  function setExit(value) {
    /* Ceiling, not rounding. A breakeven is the price at which the waterfall
       starts behaving differently, and these land on fractions of a dollar -
       rounding one down puts the model just under its own threshold, so the
       card says "Series Seed Preferred converts" while the table right above
       it reads "Takes preference". */
    exitInput.value = amountValue(Math.ceil(value));
    /* The breakeven that was picked lives inside the results column that
       sync() is about to replace, so it would take keyboard focus down with
       it. The card is rebuilt from the same points, so the same row is there
       to hand it back to. */
    const key = resultWrap.contains(document.activeElement)
      ? document.activeElement.dataset?.focusKey : null;
    sync();
    if (key) resultWrap.querySelector(`[data-focus-key="${CSS.escape(key)}"]`)?.focus();
  }

  function renderResult() {
    const db = store.db;
    resultWrap.replaceChildren();
    try {
      termDate(dateInput.value, 'Model date');
    } catch (err) {
      resultWrap.append(el('div.card', {}, el('p.warn', {}, err.message)));
      return;
    }
    /* A saved exit remembers the table it was saved against; the figures
       below always read the table as it stands, and say so when it moved. */
    if (draft.basisDigest && draft.basisDigest !== capTableDigest(store.db)) {
      resultWrap.append(el('div.card', { style: { marginBottom: '16px' } },
        el('p.warn', { style: { marginBottom: '10px' } },
          'The cap table has changed since this scenario was saved. The figures below use the table as it stands now.'),
        el('button.btn', { type: 'button', onclick: saveScenario }, 'Refresh and save scenario')));
    }
    // Every render, so the flag lifts as soon as the figure reads again.
    const problem = priceProblem();

    /* Securities only: the unallocated pool is nobody's equity, and counted
       here it took a company with a pool and no shares past the empty state
       into a waterfall that shared the whole exit at $0.00 a share and then
       said nothing was left for equity holders. */
    if (fullyDiluted(db.securities, 0) <= 0) {
      resultWrap.append(el('div.card', {}, emptyState({
        icon: 'scale',
        title: 'Nothing to distribute yet',
        text: 'Issue shares first. An exit scenario divides the sale price across everyone who holds equity.',
      })));
      return;
    }
    if (problem) {
      resultWrap.append(el('div.card', {}, el('div.empty', {},
        el('div.empty-icon', { html: icon('alert', 26) }),
        el('h2', {}, 'Check the sale price'),
        el('p', {}, `${problem}.`)
      )));
      return;
    }

    const value = exitValue();
    if (value <= 0) {
      resultWrap.append(el('div.card', {}, el('div.empty', {},
        el('div.empty-icon', { html: icon('scale', 26) }),
        el('h2', {}, 'If we sell for X, who gets what'),
        el('p', {}, 'Enter a sale price. Notes are repaid and senior preferences come off the top, then whatever is left is shared - and each preferred class and SAFE takes whichever outcome pays it more.')
      )));
      return;
    }

    const result = exitWaterfall(db, {
      exitValue: value, asOf: dateInput.value, changeOfControl, unvestedOptions,
    });
    // Negotiated terms the waterfall cannot settle, said where the terms are typed.
    if (result.unsupported) {
      resultWrap.append(el('div.card', {}, el('div.empty', {},
        el('div.empty-icon', { html: icon('alert', 26) }),
        el('h2', {}, 'Review the exit terms'),
        el('p', {}, result.unsupported))));
      return;
    }
    const metric = (label, v) => el('div.round-metric', {}, el('span', {}, label), el('span.v', {}, v));

    // The helper, not the DOM method: a skipped card is null, and the DOM
    // method would render it as the literal text "null".
    append(resultWrap, [
      el('div.card', { style: { marginBottom: '16px' } },
        el('h2.card-title', { style: { marginBottom: '6px' } }, 'Waterfall summary'),
        el('div', {},
          metric('Exit value', moneyWhole(result.exitValue)),
          // Debt comes off the top, so it is named before the preferences.
          result.debtRepaid > 0
            ? metric('Repaid on convertible notes', moneyWhole(result.debtRepaid)) : null,
          metric('Paid on liquidation preferences', moneyWhole(result.preferencePaid)),
          result.cashedOut > 0
            ? metric('Paid to SAFEs taking money back', moneyWhole(result.cashedOut)) : null,
          metric('Shared with everyone else', moneyWhole(result.residual)),
          metric('Price per participating share', sharePrice(result.pricePerShare)))),
      result.classes.length ? classesCard(result) : null,
      ...result.classes.filter((c) => c.dividendBreakdown?.some((d) => d.balance || d.paid || d.declared)).map(dividendsCard),
      result.unallocated > 0.005
        ? el('div.card', { style: { marginBottom: '16px' } }, el('p.warn', {},
          `${moneyWhole(result.unallocated)} has no eligible recipient under these terms: every participating holder has reached their cap, and nothing else shares in the residual.`))
        : null,
      result.convertibles.length ? convertiblesCard(result) : null,
      result.awards.length ? awardsCard(result) : null,
      proceedsCard(result),
      /* The breakeven search walks the standard waterfall; a table with dated
         preferred terms or recorded dividend events is settled by the
         negotiated one, whose claims (a declared dividend paid off the top)
         the search does not sum, so its stack point read short. */
      db.classes.some((c) => c.preferredTerms?.length) || db.securities.some((s) => s.dividendEvents?.length)
        ? null : breakevensCard(db),
    ]);
  }

  /**
   * How each preferred class fared, and which way it elected.
   *
   * Both legs of the election and what the class actually took, exactly as
   * the convertibles card below reports a SAFE's. "Preference" is the claim,
   * not the payment: below the stack the money runs out mid-tier and every
   * class is paid pro rata, and without the last column the card reported a
   * $1.75M preference beside an outcome of "Takes preference" while the
   * holders underneath shared $843k, with nothing on the card to say which
   * class the shortfall fell on.
   */
  function classesCard(result) {
    /* Only classes with shares in them. The waterfall walks every preferred
       class on the books, and one created ahead of its round - a Series B
       with nothing issued yet - came out as a row of zeros electing to "take
       preference" over nothing, beside classes that actually stand to be
       paid. It has no election to report until it holds shares. */
    const classes = result.classes.filter((c) => c.shares > 0);
    if (!classes.length) return null;
    // What the class takes home: its share of the residual once converted,
    // the preference it was actually paid otherwise - plus the pro-rata
    // share on top, for a participating class that gets both.
    const took = (c) => c.proceeds ?? (c.converted
      ? c.asConverted
      : c.paid + (c.participating ? c.asConverted : 0));
    return el('div.card', { style: { marginBottom: '16px' } },
      el('h2.card-title', {}, 'Preferred classes'),
      el('p.card-sub', { style: { marginBottom: '10px' } },
        'Each class takes whichever pays more: its preference, or converting to common'),
      el('div.table-wrap', {
        tabindex: 0, role: 'region', 'aria-label': 'Preferred classes table', style: { border: 'none' },
      },
        el('table.data', { style: { minWidth: '560px' } },
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col' }, 'Class'),
            el('th', { scope: 'col' }, 'Terms'),
            el('th.num', { scope: 'col' }, 'Preference'),
            el('th.num', { scope: 'col' }, 'As converted'),
            el('th.num', { scope: 'col' }, 'Paid'),
            el('th', { scope: 'col' }, 'Outcome'))),
          el('tbody', {}, classes.map((c) => el('tr', {},
            el('td', { style: { fontWeight: '570' } }, c.name),
            el('td.small.muted', {},
              `${c.multiple}x${c.participating ? ' participating' : ''} · seniority ${c.seniority}${c.capBound ? ' · cap reached' : ''}${c.dividendClaim ? ` · dividends ${moneyWhole(c.dividendClaim)}` : ''}`),
            el('td.num', {}, el('div', {},
              el('div', {}, moneyWhole(c.preference)),
              /* Said in words rather than left to be spotted by comparing two
                 columns: a preference paid short is the whole story of an exit
                 below the stack. */
              !c.converted && c.preference - c.paid > 0.5
                ? el('div.small.warn', {}, `${moneyWhole(c.preference - c.paid)} short`)
                : null)),
            el('td.num', {}, moneyWhole(c.asConverted)),
            el('td.num', { style: { fontWeight: '620' } }, moneyWhole(took(c))),
            el('td', {}, el('span.badge', {},
              c.converted ? 'Converts to common'
                : c.participating ? 'Preference + participation'
                  : 'Takes preference'))
          ))))));
  }

  /**
   * Options, RSUs and warrants, each on its own row. Folded into their
   * holders' rows below, an award that has to be paid for and one that
   * settles for nothing look identical - and the difference is exactly what
   * a holder wants to know before the deal closes.
   */
  function awardsCard(result) {
    const AWARD_LABEL = { option: 'Options', rsu: 'RSU', warrant: 'Warrant' };
    return el('div.card', { style: { marginBottom: '16px' } },
      el('h2.card-title', {}, 'Options, RSUs, and warrants'),
      el('p.card-sub', { style: { marginBottom: '10px' } },
        'Options and warrants pay their strike to take part; RSUs settle at the price with nothing to pay'),
      el('div.table-wrap', {
        tabindex: 0, role: 'region', 'aria-label': 'Options, RSUs, and warrants table', style: { border: 'none' },
      },
        el('table.data', { style: { minWidth: '560px' } },
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col' }, 'Award'),
            el('th', { scope: 'col' }, 'Holder'),
            el('th.num', { scope: 'col' }, 'Shares'),
            el('th.num', { scope: 'col' }, 'Strike'),
            el('th.num', { scope: 'col' }, 'Cost to exercise'),
            el('th.num', { scope: 'col' }, 'Net proceeds'))),
          el('tbody', {}, result.awards.map((a) => el('tr', {},
            el('td', {},
              el('div', { style: { fontWeight: '570' } }, a.label),
              el('span.kind-pill', {}, AWARD_LABEL[a.kind] || a.kind)),
            el('td', {}, a.name),
            el('td.num', {}, shares(a.shares)),
            el('td.num', {}, a.kind === 'rsu' ? el('span.small.muted', {}, 'none') : sharePrice(a.strike)),
            el('td.num', {}, a.cost > 0 ? moneyWhole(a.cost) : '-'),
            el('td.num', { style: { fontWeight: '620' } }, a.inMoney
              ? moneyWhole(a.proceeds)
              : el('span.small.muted', {}, 'Out of the money'))
          ))))));
  }

  /* Per-holder proceeds, as a table and as a part-to-whole bar. */
  function proceedsCard(result) {
    if (!result.rows.length) {
      return el('div.card', { style: { marginBottom: '16px' } },
        el('h2.card-title', {}, 'Proceeds'),
        el('p.card-sub', {}, 'Nothing is left for equity holders at this exit value.'));
    }
    return el('div.card', { style: { marginBottom: '16px' } },
      el('h2.card-title', {}, 'Proceeds by holder'),
      el('p.card-sub', { style: { marginBottom: '12px' } },
        `${moneyWhole(result.distributed)} distributed across ${result.rows.length} holder${result.rows.length === 1 ? '' : 's'}`
        + ' · "off the top" is debt repaid, preferences, and SAFEs taking money back'),
      ownershipChart(
        result.rows.map((r) => ({ name: r.name, shares: r.proceeds, pct: r.pct })),
        { formatValue: moneyCompact, label: 'Share of proceeds' }),
      el('div.table-wrap', {
        tabindex: 0, role: 'region', 'aria-label': 'Proceeds by holder table',
        style: { border: 'none', marginTop: '14px' },
      },
        el('table.data', { style: { minWidth: '520px' } },
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col' }, 'Holder'),
            el('th.num', { scope: 'col' }, 'Shares'),
            el('th.num', { scope: 'col' }, 'Off the top'),
            el('th.num', { scope: 'col' }, 'Participation'),
            el('th.num', { scope: 'col' }, 'Total'),
            el('th.num', { scope: 'col' }, 'Share of proceeds'))),
          el('tbody', {}, result.rows.map((r) => el('tr', {},
            el('td', {}, r.name),
            el('td.num', {}, shares(r.shares)),
            el('td.num', {}, r.preference > 0 ? moneyWhole(r.preference) : '-'),
            el('td.num', {}, r.participation > 0 ? moneyWhole(r.participation) : '-'),
            el('td.num', { style: { fontWeight: '620' } }, moneyWhole(r.proceeds)),
            el('td.num', {}, pct(r.pct))
          ))))));
  }

  /* Outstanding SAFEs and notes, and which way each one went: a note is debt
     repaid off the top, a SAFE elects between its money back and converting.
     Same shape as the preferred classes card above, for the same reason -
     an election is only visible if both legs are shown. */
  function convertiblesCard(result) {
    const OUTCOME = {
      repaid: 'Repaid as debt',
      cash: 'Takes money back',
      converted: 'Converts to shares',
    };
    return el('div.card', { style: { marginBottom: '16px' } },
      el('h2.card-title', {}, 'SAFEs and notes'),
      el('p.card-sub', { style: { marginBottom: '10px' } },
        'Notes are repaid off the top; each SAFE takes whichever pays more, its money back or converting at the exit price'),
      el('div.table-wrap', {
        tabindex: 0, role: 'region', 'aria-label': 'SAFEs and notes table', style: { border: 'none' },
      },
        el('table.data', { style: { minWidth: '560px' } },
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col' }, 'Instrument'),
            el('th', { scope: 'col' }, 'Holder'),
            el('th.num', { scope: 'col' }, 'Money back'),
            el('th.num', { scope: 'col' }, 'As converted'),
            el('th.num', { scope: 'col' }, 'Paid'),
            el('th', { scope: 'col' }, 'Outcome'))),
          el('tbody', {}, result.convertibles.map((c) => el('tr', {},
            el('td', {},
              el('div', { style: { fontWeight: '570' } }, c.label),
              el('span.kind-pill', {}, c.kind === 'safe' ? 'SAFE' : 'Note')),
            el('td', {}, c.name),
            el('td.num', {}, el('div', {},
              el('div', {}, moneyWhole(c.value)),
              /* The same words the preferred card uses for the same fact. A
                 note paid $100,000 of its $156,734, or a SAFE that elected
                 its money back and found nothing left behind the preferred,
                 read "Repaid as debt" and "Takes money back" beside a Paid
                 column the reader had to subtract for themselves. */
              c.elected !== 'converted' && c.value - c.proceeds > 0.5
                ? el('div.small.warn', {}, `${moneyWhole(c.value - c.proceeds)} short`)
                : null)),
            el('td.num', {}, c.kind === 'note'
              ? el('span.small.muted', {}, 'debt, not equity')
              : el('div', {},
                el('div', {}, moneyWhole(c.asConverted)),
                c.shares > 0
                  ? el('div.small.muted', {}, `${sharesLabel(c.shares)} at ${sharePrice(c.conversionPrice)}`)
                  : null)),
            el('td.num', { style: { fontWeight: '620' } }, moneyWhole(c.proceeds)),
            el('td', {}, el('span.badge', {}, OUTCOME[c.elected]))
          ))))));
  }

  /* How each certificate's dividend claim was built: the principal it
     accrues on, each dated segment at its rate, what was declared and paid. */
  function dividendsCard(c) {
    return el('details.card', { style: { marginBottom: '16px' } },
      el('summary', {}, `${c.name}: how the dividends were calculated`),
      ...c.dividendBreakdown.map((d) => el('div', { style: { margin: '10px 0' } },
        el('p', {}, `${d.label || d.securityId}: accrues on ${moneyWhole(d.principal)}. `
          + `Accrued ${money(d.accrued)}, declared ${money(d.declared)}, paid ${money(d.paid)}; ${money(d.balance)} owed at this exit.`),
        ...d.breakdown.map((b) => el('p.small.muted', {},
          `${b.from} to ${b.to}: ${percentValue(b.rate)}% ${b.convention}, ${money(b.amount)}`)))));
  }

  /* The exit values where the waterfall changes character. */
  function breakevensCard(db) {
    const job = breakevenJobFor(db, dateInput.value);
    if (job.done && !job.points.length) return null;
    /* The rows are repainted as points arrive; the progress line is one
       node for the card's life, its text changed in place. Inserted afresh
       with each repaint, a live region already holding its text is read
       once per point by one screen reader and never by another - and when
       the job finished the line simply went, so nothing said the list was
       complete. */
    const rows = el('div');
    const status = el('p.small.muted', { role: 'status', style: { marginTop: '8px' } });
    const card = el('div.card', {}, rows, status);
    let progressShown = false;
    const paint = () => {
      /* A row under keyboard focus is rebuilt with the rest, which dropped
         focus on the document body mid-list; the same row is there afterwards
         to hand it back to, as setExit does. */
      const key = rows.contains(document.activeElement) ? document.activeElement.dataset?.focusKey : null;
      append(clear(rows), breakevenRows(job));
      if (key) rows.querySelector(`[data-focus-key="${CSS.escape(key)}"]`)?.focus();
      const n = job.points.length;
      if (!job.done) {
        progressShown = true;
        status.textContent = n ? 'Working out the remaining breakeven points…' : 'Working out the breakeven points…';
      } else {
        // Said for assistive tech, not shown: the finished list speaks for itself.
        status.className = 'visually-hidden';
        status.textContent = progressShown ? (n === 1 ? '1 breakeven point found' : `${n} breakeven points found`) : '';
      }
      // Finished with nothing to show: the card goes, as it never came for a cap table without any.
      if (job.done && !n) card.remove();
    };
    const watch = () => {
      // A card the view has since rebuilt or left behind stops asking.
      if (!card.isConnected) { job.watchers.delete(watch); return; }
      paint();
      if (job.done) job.watchers.delete(watch);
    };
    paint();
    if (!job.done) {
      job.watchers.add(watch);
      stepBreakevens(job);
    }
    return card;
  }

  function breakevenRows(job) {
    const { points } = job;
    return [
      el('h2.card-title', {}, 'Breakeven points'),
      el('p.card-sub', { style: { marginBottom: '4px' } },
        'Sale prices where the waterfall changes shape'),
      points.map((p) => el('button.check-item', {
        type: 'button',
        /* The whole dollar the row models when pressed - setExit rounds up,
           since a breakeven lands on a fraction of a dollar and the event has
           not happened at the dollar below it. Rounded to nearest, the row
           read "$8,538,160" while typing that exact figure into the field
           still showed the class taking its preference. */
        title: `Model an exit at ${moneyWhole(Math.ceil(p.exitValue))}`,
        dataset: { focusKey: `breakeven:${p.type}:${p.classId || p.securityId || ''}` },
        onclick: () => setExit(p.exitValue),
      },
        el('span.grow', {},
          el('div', {}, p.name),
          el('div.small.muted', {}, p.detail)),
        /* The exact figure: two neighbouring points read as the same "$2.2M"
           when they were $62,708 apart, with the difference in a tooltip. */
        el('span.small', { style: { fontWeight: '620', whiteSpace: 'nowrap' } }, moneyWhole(Math.ceil(p.exitValue))))),
    ];
  }

  async function saveScenario() {
    const problem = priceProblem();
    if (problem) {
      toast(problem, { icon: 'alert' });
      exitInput.focus();
      return;
    }
    const value = exitValue();
    if (value <= 0) {
      flagInvalid(exitInput);
      toast('Enter an exit value first', { icon: 'alert' });
      exitInput.focus();
      return;
    }
    /* Saving under a name already on the strip revises that scenario rather
       than minting a second one - the same rule the round model follows, and
       for the same reason: loading a saved exit, moving the sale price, and
       pressing Save is how this form is used. Rename first to keep both. */
    const name = nameInput.value.trim() || 'Untitled exit';
    const existing = store.exits.find((s) => s.name.toLowerCase() === name.toLowerCase());
    // Each save of a new name mints an id, so a second click before the first
    // write lands saves the same scenario twice.
    /* Disabling a focused button drops focus to the document body, and the
       write then re-renders the view - so the shell's focus-key hand-off
       never sees this button. Remembered here and put back by hand. */
    const hadFocus = document.activeElement === saveBtn;
    saveBtn.disabled = true;
    // Before the write, for the reason the round model's save gives.
    const previousDigest = draft.basisDigest;
    draft.basisDigest = capTableDigest(store.db);
    try {
      await store.saveExitScenario({
        id: existing?.id, name, exitValue: value, unvestedOptions, changeOfControl, asOf: dateInput.value,
      });
      toast(existing ? 'Scenario updated' : 'Scenario saved');
    } catch (err) {
      draft.basisDigest = previousDigest;
      console.error(err);
      toast(isRefusal(err) ? err.message : 'Couldn’t save. Check your connection',
        { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
    }
    saveBtn.disabled = false;
    if (hadFocus) document.querySelector('[data-focus-key="exit:save"]')?.focus();
  }

  function scenarioChips() {
    if (!store.exits.length) return null;
    return el('div', { style: { marginBottom: '14px' } },
      el('p.small.muted', { style: { marginBottom: '8px' } }, 'Saved exits'),
      el('div.row', { style: { flexWrap: 'wrap' } },
        store.exits.map((s) => el('span.scenario-chip', {},
          el('button.scenario-load', {
            type: 'button',
            title: `Load "${s.name}" into the form`,
            onclick: () => {
              loadScenario(s);
              nameInput.value = draft.name;
              exitInput.value = draft.exitValue;
              dateInput.value = draft.asOf || todayISO();
              /* The two assumption controls are already on screen, so they
                 are moved by hand rather than rebuilt - loading a chip left
                 whichever assumptions happened to be selected in place, and
                 the waterfall below it was not the one that was saved. */
              cocCheck.checked = changeOfControl;
              unvestedSeg.select(unvestedOptions);
              syncCocNote();
              sync();
            },
          },
            el('span', { html: icon('scale', 13, 2), style: { display: 'inline-flex' } }),
            ` ${s.name} · ${moneyCompact(s.exitValue)}`),
          el('button.scenario-x', {
            type: 'button',
            'aria-label': `Delete scenario ${s.name}`,
            html: icon('x', 13, 2.2),
            onclick: async () => {
              const ok = await confirmDialog({ title: `Delete "${s.name}"?`, message: 'This saved scenario is removed.', confirmLabel: 'Delete' });
              if (!ok) return;
              try {
                const { undo } = await store.deleteExitScenario(s.id);
                // Said, and undoable, as every other delete in the app is - see the round model's chips.
                toast('Scenario deleted', {
                  icon: 'trash',
                  action: {
                    label: 'Undo',
                    onClick: () => undo().catch((err) => toast(
                      isRefusal(err) ? err.message : 'Couldn’t undo. Check your connection',
                      { icon: isRefusal(err) ? 'alert' : 'wifiOff' })),
                  },
                });
              } catch (err) {
                console.error(err);
                toast(isRefusal(err) ? err.message : 'Couldn’t delete. Check your connection',
                  { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
              }
            },
          }))))
    );
  }

  /* Deal-structure assumptions: whether recorded acceleration fires, and
     what happens to unvested, unaccelerated options at close. */
  const cocCheck = el('input', {
    type: 'checkbox', checked: changeOfControl,
    onchange: (e) => { changeOfControl = e.target.checked; renderResult(); },
  });
  /* Acceleration is only ever read where unvested options are cancelled -
     when they all take part anyway, vesting a few of them early cannot
     change a single number. The checkbox stays usable (it is an assumption
     about the deal, and it holds while the other control is switched), but
     it says so rather than looking live and doing nothing. */
  const cocNote = el('p.field-hint', { style: { marginBottom: '14px' } });
  const syncCocNote = () => {
    cocNote.textContent = unvestedOptions === 'participate'
      ? 'Applies recorded acceleration terms. Nothing changes while every unvested award already takes part above - switch that to Cancelled to see acceleration bite.'
      : 'Applies recorded acceleration terms. A double trigger assumes the holder is also terminated at close; accelerated options vest and take part even when unvested ones are cancelled.';
  };

  const unvestedSeg = segmented([
    { value: 'participate', label: 'Participate' },
    { value: 'cancel', label: 'Cancelled' },
  ], {
    label: 'Unvested awards at close', value: unvestedOptions, wide: true,
    onSelect: (value) => {
      unvestedOptions = value;
      syncCocNote();
      renderResult();
    },
  });
  syncCocNote();

  // Focus key for the same reason the round model's Save carries one.
  const saveBtn = el('button.btn.btn-primary.btn-block', {
    onclick: saveScenario, style: { padding: '11px' }, dataset: { focusKey: 'exit:save' },
  }, 'Save scenario');

  const form = el('div.card', {},
    el('h2.card-title', { style: { marginBottom: '12px' } }, 'Terms'),
    field('Scenario name', nameInput),
    field('Model date', dateInput),
    field(`Exit value (${currencySymbol()})`, exitInput,
      'The total sale price, before escrow, fees, and tax - none of which are modeled.'),
    field('Unvested awards at close', unvestedSeg,
      'Whether unvested options and RSUs share in the proceeds (rolled over or cashed out) or are cancelled and get nothing.'),
    el('label.check-row', { style: { margin: '2px 0 4px' } }, cocCheck,
      el('span', {}, 'Assume a change of control')),
    cocNote,
    saveBtn
  );

  const root = el('div', {},
    viewHead('Exit scenarios', 'If we sell for this, who gets what'),
    scenarioChips(),
    el('div.round-layout', {}, form, resultWrap)
  );
  renderResult();
  return root;
}
