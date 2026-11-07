import { el, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { viewHead, emptyState, field, flagInvalid } from '../ui/bits.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { openCloseRound } from '../ui/closeround.js';
import { store, isRefusal } from '../lib/store.js';
import { modelRound, fullyDiluted, poolForecast, poolTargetToCover, convertedAfter, adjustedAfter } from '../lib/captable.js';
import { capTableDigest } from '../lib/financing.js';
import { financingEditor, financingBreakdown } from '../ui/financingterms.js';
import {
  moneyWhole, moneyCompact, sharePrice, shares, pct, currencySymbol, monthLabel,
  amountValue, dateLong,
} from '../lib/format.js';
import { parseNum, stillTyping, todayISO, clamp, round2, takeHashParam } from '../lib/util.js';

/* Draft survives store-driven re-renders (module scope, not persisted). */
const EMPTY_DRAFT = { name: '', preMoney: '', investment: '', poolPct: '' };
let draft = { ...EMPTY_DRAFT };
/* Terms belong to the cap table they were typed against. Carried across a
   company switch, a wipe, or an import, they arrive already filled in over a
   pro-forma table computed from the new dataset's shares - and "Close this
   round" would write another company's negotiation onto it. */
let draftEpoch = null;

/** The saved scenario's terms, in the shape the form's fields hold. */
function draftFromScenario(scenario) {
  return {
    name: scenario.name,
    /* The dated assumptions, and the fingerprint of the cap table the scenario
       was saved against - so the view can say when the table has moved. */
    asOf: scenario.asOf,
    financing: scenario.financing,
    basisDigest: scenario.basisDigest,
    // Grouped, the way the placeholders under these fields are written and
    // the way every other figure in the app reads - `parseNum` takes it back.
    preMoney: amountValue(scenario.preMoney),
    investment: amountValue(scenario.investment),
    // round2, not x100: a pool saved as 0.07 reads back as
    // 7.000000000000001 straight out of the multiplication.
    poolPct: scenario.poolPct ? String(round2(scenario.poolPct * 100)) : '',
  };
}

export function roundsView() {
  if (draftEpoch !== store.dataEpoch) {
    draftEpoch = store.dataEpoch;
    draft = { ...EMPTY_DRAFT };
  }
  /* `#/rounds?scenario=:id` loads that saved round into the form - the hash
     global search jumps to, since a scenario means nothing outside the model
     it drives. */
  const requested = takeHashParam('scenario');
  if (requested) {
    const scenario = store.scenarios.find((s) => s.id === requested);
    if (scenario) draft = draftFromScenario(scenario);
  }
  /* `#/rounds?cover=pool` is the hiring plan's own link: fill the target as
     soon as there are terms to solve it against, and otherwise leave the hint
     under the field to say what is missing. */
  const coverRequested = takeHashParam('cover') === 'pool';

  const resultWrap = el('div');

  const nameInput = el('input.input', { type: 'text', value: draft.name, placeholder: 'Series A', maxlength: 80, 'aria-label': 'Round name' });
  const preInput = el('input.input', { type: 'text', inputmode: 'numeric', value: draft.preMoney, placeholder: '18,000,000', 'aria-label': 'Pre-money valuation' });
  const investInput = el('input.input', { type: 'text', inputmode: 'numeric', value: draft.investment, placeholder: '5,000,000', 'aria-label': 'New investment' });
  const poolInput = el('input.input', { type: 'text', inputmode: 'decimal', value: draft.poolPct, placeholder: '10', 'aria-label': 'Post-round option pool percent' });

  /* The ceiling the model puts on a pool target, as the field reads it. */
  const MAX_POOL_PCT = 90;

  /**
   * Figures the form can't take as typed: "18M", "5.000.000", a minus sign,
   * a pool past the model's ceiling. Each is flagged on its field and named,
   * and the flag clears the moment the figure reads. They used to fall
   * through as zero - the panel asked for a valuation that was already in
   * the box, and a 95% pool quietly modeled as 90%.
   */
  function termProblems() {
    const problems = [];
    const check = (input, label, { max = null } = {}) => {
      const raw = input.value.trim();
      const n = raw ? parseNum(raw) : 0;
      let message = null;
      if (n === null && !stillTyping(raw)) message = `${label} isn’t a number. Use digits, like ${input.placeholder}`;
      else if (n < 0) message = `${label} can’t be negative`;
      else if (max !== null && n > max) message = `${label} can be at most ${max}%`;
      if (message) {
        input.setAttribute('aria-invalid', 'true');
        problems.push({ input, message });
      } else {
        input.removeAttribute('aria-invalid');
      }
    };
    check(preInput, 'Pre-money valuation');
    check(investInput, 'New investment');
    check(poolInput, 'Post-round option pool', { max: MAX_POOL_PCT });
    return problems;
  }

  /* Turn the hiring plan into the pool target that covers it. The target is
     solved in the lib, since the top-up moves the count it is measured
     against; this only decides what to say about the answer. */
  function coverHiringPlan() {
    const db = store.db;
    const forecast = poolForecast(db, store.hiring, { from: todayISO() });
    if (!forecast.planned) {
      toast('Add roles to the hiring plan first', { icon: 'alert' });
      return;
    }
    // Not the pool's own problems: that field is about to be written over.
    const problem = termProblems().find((p) => p.input !== poolInput);
    if (problem) {
      toast(problem.message, { icon: 'alert' });
      problem.input.focus();
      return;
    }
    let coverInputs;
    try { coverInputs = currentInputs(); } catch (err) { toast(err.message, { icon: 'alert' }); return; }
    const { preMoney, investment } = coverInputs;
    if (preMoney <= 0 || investment <= 0) {
      toast('Enter the pre-money valuation and investment first', { icon: 'alert' });
      preInput.focus();
      return;
    }
    const found = poolTargetToCover(db, {
      preMoney, investment, planned: forecast.planned, asOf: coverInputs.asOf, financing: coverInputs.financing,
    });
    if (found.poolPct === null) {
      /* Two different problems, and one message used to blame the top-up
         for both. Terms the model refuses before any top-up are what the
         result panel is already explaining. */
      toast(found.priceable
        ? 'This round can’t carry a top-up that large'
        : 'These terms can’t be priced yet. Fix what the model flags first',
      { icon: 'alert' });
      return;
    }
    // Already at the field's two decimals; round2 only takes the float
    // noise off the multiplication (0.1294 x 100 is 12.940000000000001).
    poolInput.value = String(round2(found.poolPct * 100));
    sync();
    poolInput.focus();
    toast(`Pool target set to cover ${shares(forecast.planned)} of planned grants`);
  }

  /* The plan's shortfall, said where the guess used to be typed. */
  function poolHint() {
    const forecast = poolForecast(store.db, store.hiring, { from: todayISO() });
    if (!forecast.planned) {
      return el('p.field-hint', {},
        'Target unallocated pool after close, topped up pre-money. Leave empty to skip. '
        + 'A hiring plan under Share classes turns this into a number rather than a guess.');
    }
    return el('div', {},
      el('p.field-hint', {},
        'Target unallocated pool after close, topped up pre-money. Leave empty to skip.'),
      el('p.field-hint', {},
        forecast.shortfall > 0
          ? `Your hiring plan needs ${shares(forecast.planned)} and ${shares(forecast.available)} `
            + `are unallocated: ${shares(forecast.shortfall)} short`
            + (forecast.dryMonth ? `, running dry in ${monthLabel(forecast.dryMonth)}.` : '.')
          : `Your hiring plan needs ${shares(forecast.planned)}, which today’s `
            + `${shares(forecast.available)} unallocated shares already cover.`),
      el('button.btn.btn-ghost', {
        type: 'button', style: { marginTop: '2px' },
        onclick: coverHiringPlan,
      }, 'Set the target to cover the plan'));
  }

  const sync = () => {
    draft = {
      ...draft,
      name: nameInput.value,
      preMoney: preInput.value,
      investment: investInput.value,
      poolPct: poolInput.value,
    };
    try { Object.assign(draft, assumptions.read()); } catch { /* renderResult explains invalid inputs */ }
    renderResult();
  };
  for (const i of [nameInput, preInput, investInput, poolInput]) i.addEventListener('input', sync);

  /* Model date, financing ID, round size and the elections - see financingEditor.
     Rebuilt when a saved scenario is loaded, so the rights it elected are
     read off the table as it stands. */
  let assumptions = financingEditor(store.db, draft, () => sync());
  /* The ID the editor minted for a fresh draft is the draft's from this
     render on. Captured only in sync(), on an input event, it was minted
     again by every store-driven re-render before anything was typed - and an
     ID copied off the screen into a right's financings list (a store write,
     which re-renders this view) came back different. */
  if (!draft.financing) {
    try { Object.assign(draft, assumptions.read()); } catch { /* the editor's own refusal shows in the panel */ }
  }
  const assumptionsWrap = el('div', {}, assumptions.node);

  function currentInputs() {
    return {
      ...assumptions.read(),
      preMoney: parseNum(preInput.value) ?? 0,
      investment: parseNum(investInput.value) ?? 0,
      poolPct: clamp((parseNum(poolInput.value) ?? 0) / 100, 0, MAX_POOL_PCT / 100),
    };
  }

  function renderResult() {
    const db = store.db;
    resultWrap.replaceChildren();
    let inputs;
    try {
      inputs = currentInputs();
    } catch (err) {
      // The assumptions editor's own refusal: an election that is not a number, a blank financing ID.
      resultWrap.append(el('div.card', {}, el('p.warn', {}, err.message)));
      return;
    }
    /* A saved scenario remembers the table it was saved against. Once that
       table has moved the figures below are still live - they always read
       the table as it stands - but closing waits for the scenario to be
       saved again, so that what closes is a scenario someone looked at over
       this table. */
    const stale = !!draft.basisDigest && draft.basisDigest !== capTableDigest(store.db);
    /* Two states the store would refuse at the very end of the close sheet,
       said here instead, with the Close button disabled: a financing whose ID
       already stamps certificates on the table has closed (refreshing a saved
       scenario re-enabled Close and the sheet ran to its last press), and a
       model dated before a recorded split prices in the units of that day,
       which the split guard refuses (the review read half the shares at
       twice the price before the toast said so). */
    const closedOn = inputs.financing?.id
      ? db.securities.filter((s) => s.roundId === inputs.financing.id).map((s) => s.date).sort()[0] : null;
    const splitAfter = inputs.asOf ? (db.company.splits || []).find((sp) => sp.date > inputs.asOf) : null;
    /* A down round on the books after the model date: the class it protected
       reads the price that round lowered it to, on a table without the shares
       it minted (see adjustedAfter), so the protection below is measured from
       a price not yet in force. The store refuses the close; said here. */
    const adjustedLater = !splitAfter && inputs.asOf ? adjustedAfter(db, inputs.asOf) : null;
    let blocked = closedOn
      ? `Financing ${inputs.financing.id} closed on ${dateLong(closedOn)}; its certificates carry the ID. Model the next round under a new financing ID.`
      : splitAfter
        ? `The model date is before the ${splitAfter.num}-for-${splitAfter.den} split of ${dateLong(splitAfter.date)}, so these figures are in that day’s units and the round can’t close on it. Move the model date on or after the split to close.`
        : adjustedLater
          ? `The model date is before the anti-dilution adjustment of ${dateLong(adjustedLater.date)}, so ${adjustedLater.cls?.name || 'the protected class'} reads a conversion price that was not yet in force and the round can’t close on it. Move the model date on or after that round to close.`
          : stale ? 'The cap table changed since this scenario was saved' : null;
    if (closedOn || splitAfter || adjustedLater) {
      resultWrap.append(el('div.card', { style: { marginBottom: '16px' } }, el('p.warn', {}, blocked)));
    } else if (stale) {
      resultWrap.append(el('div.card', { style: { marginBottom: '16px' } },
        el('p.warn', { style: { marginBottom: '10px' } },
          'The cap table has changed since this scenario was saved. The figures below use the table as it stands now; '
          + 'save the scenario again to refresh it before closing.'),
        el('button.btn', { type: 'button', onclick: saveScenario }, 'Refresh and save scenario')));
    }
    // Every render, so a flag lifts as soon as the figure reads again.
    const problems = termProblems();
    const { preMoney, investment, poolPct } = inputs;

    // Securities only - see the exit view: a pool alone is nothing to dilute.
    if (fullyDiluted(db.securities, 0) <= 0) {
      resultWrap.append(el('div.card', {}, emptyState({
        icon: 'trending-up',
        title: 'Nothing to model yet',
        text: 'Issue shares first. Round modeling shows how new money dilutes what exists.',
      })));
      return;
    }
    if (problems.length) {
      resultWrap.append(el('div.card', {}, el('div.empty', {},
        el('div.empty-icon', { html: icon('alert', 26) }),
        el('h2', {}, 'Check the terms'),
        problems.map((p) => el('p', {}, `${p.message}.`))
      )));
      return;
    }
    if (preMoney <= 0 || investment <= 0) {
      resultWrap.append(el('div.card', {}, el('div.empty', {},
        el('div.empty-icon', { html: icon('trending-up', 26) }),
        el('h2', {}, 'Model your next round'),
        el('p', {}, 'Enter a pre-money valuation and how much you’re raising. SAFEs and notes convert automatically; the pool top-up is optional.')
      )));
      return;
    }

    const result = modelRound(db, inputs);
    /* The model reads the table as of its date (see modelRound), and a date
       before the first issuance reads an empty one: nothing to dilute, so the
       model has nothing to say. It used to say nothing at all - the panel
       went blank the moment the date moved back too far, and the terms typed
       beside it looked ignored. */
    if (!result) {
      resultWrap.append(el('div.card', {}, el('div.empty', {},
        el('div.empty-icon', { html: icon('calendar', 26) }),
        el('h2', {}, 'Nothing on the cap table on that date'),
        el('p', {}, `No shares, awards or reserves were on the cap table on ${dateLong(inputs.asOf)}, so there is nothing for a round to dilute. Move the model date to the first issuance or later.`)
      )));
      return;
    }
    /* Post-money SAFE caps that together promise ~100%+ of the company have
       no meaningful model - almost always a mistyped cap. Say so instead of
       rendering runaway numbers (and offering to close on them). */
    /* A right or election the dated terms cannot honour, said where the
       terms are typed; the breakdown beneath names the allocation at fault. */
    if (result.unsupported) {
      resultWrap.append(el('div.card', { style: { marginBottom: '16px' } }, el('div.empty', {},
        el('div.empty-icon', { html: icon('alert', 26) }),
        el('h2', {}, 'Review the financing terms'),
        el('p', {}, result.unsupported))));
      const breakdown = financingBreakdown(result, db);
      if (breakdown) resultWrap.append(breakdown);
      return;
    }
    if (result.overclaim) {
      resultWrap.append(el('div.card', {}, el('div.empty', {},
        el('div.empty-icon', { html: icon('alert', 26) }),
        el('h2', {}, 'These SAFEs can’t all convert'),
        el('p', {}, `Your capped post-money SAFEs together promise holders ${pct(result.overclaim)} of the company, so no round price can satisfy them. Check each SAFE’s valuation cap and principal under Securities - a cap entered short by a few zeros is the usual culprit.`)
      )));
      return;
    }
    /* Same refusal for the discount leg: conversions that absorb (nearly)
       the whole pre-money leave no price that satisfies the model. */
    if (result.valueClaim) {
      resultWrap.append(el('div.card', {}, el('div.empty', {},
        el('div.empty-icon', { html: icon('alert', 26) }),
        el('h2', {}, 'These convertibles outweigh the pre-money'),
        el('p', {}, `Converting at their discounts, your outstanding SAFEs and notes absorb at least ${pct(result.valueClaim)} of this pre-money valuation, so no share price can satisfy the round. Raise the pre-money, or check each instrument’s principal and discount under Securities.`)
      )));
      return;
    }
    if (result.unpriceable) {
      resultWrap.append(el('div.card', {}, el('div.empty', {},
        el('div.empty-icon', { html: icon('alert', 26) }),
        el('h2', {}, 'No share price satisfies these terms'),
        el('p', {}, 'The pool top-up, converting instruments, and any anti-dilution adjustment would mint more new shares than this pre-money valuation can pay for. Raise the pre-money, lower the post-round pool target, or check the protection on your preferred classes.')
      )));
      return;
    }

    /* The price can be right and the cheque still buy nothing whole: on a
       one-share company a $250,000 investment at $875,000 a share rounds to
       no shares, and the summary offered a close the close sheet then
       refuses. Said here, where the terms are typed. */
    if (result.investorShares < 1) {
      resultWrap.append(el('div.card', {}, el('div.empty', {},
        el('div.empty-icon', { html: icon('alert', 26) }),
        el('h2', {}, 'This investment buys no whole share'),
        el('p', {}, `At ${sharePrice(result.pps)} a share, ${moneyWhole(investment)} rounds to no shares, so there is nothing to issue. Lower the pre-money valuation, raise the investment, or record a stock split first.`)
      )));
      return;
    }

    /* A model dated before a round already on the books reads the instruments
       that round converted as live again (see convertedAfter), and lists them
       converting a second time. The store refuses that close, but only at the
       sheet's last press - after the review had shown the conversion. Said
       here, with Close disabled, like the split and closed-ID cases above. */
    const reopened = blocked ? null : convertedAfter(result, inputs.asOf, db);
    if (reopened) {
      blocked = `${reopened.label} converted on ${dateLong(reopened.convertedAt)}, after this model date, so this round would convert it again. Move the model date on or after that round to close.`;
      resultWrap.append(el('div.card', { style: { marginBottom: '16px' } }, el('p.warn', {}, blocked)));
    }

    /* An optional second line under the label, for the one figure on the
       card that needs a word of explanation beside it. */
    const metric = (label, value, sub = null) => el('div.round-metric', {},
      el('div', {}, label, sub ? el('div.small.muted', {}, sub) : null),
      el('span.v', {}, value));

    // The helper, not the DOM method: a skipped card is null, and the DOM
    // method would render it as the literal text "null".
    append(resultWrap, [
      el('div.card', { style: { marginBottom: '16px' } },
        el('div.card-head', {},
          el('div', {}, el('h2.card-title', {}, 'Round summary'),
            blocked ? el('p.card-sub', {}, closedOn ? 'Already closed' : splitAfter ? 'Dated before a split' : adjustedLater ? 'Dated before an adjustment' : reopened ? 'Dated before a recorded round' : 'Refresh the scenario before closing') : null),
          el('button.btn.btn-primary', {
            html: icon('check', 15, 2.2), disabled: !!blocked,
            title: blocked,
            onclick: () => openCloseRound({
              result,
              terms: { ...inputs, name: nameInput.value, investment: result.financing?.investment ?? investment },
              onClosed: () => { draft = { ...EMPTY_DRAFT }; },
            }),
          }, ' Close this round')),
        el('div', {},
          metric('Price per share', sharePrice(result.pps)),
          metric('Post-money valuation', moneyWhole(result.postMoney)),
          metric('New investor shares', shares(result.investorShares)),
          metric('New investor ownership', pct(result.investorPct)),
          result.conversionShares > 0 ? metric('Shares from converting SAFEs / notes', shares(result.conversionShares)) : null,
          /* Its own line, never folded into the new money: these shares are
             minted for existing preferred holders, and they dilute everyone
             else - which is the thing a founder needs to see before signing. */
          result.antiDilutionShares > 0
            ? metric('Shares from anti-dilution adjustments', shares(result.antiDilutionShares))
            : null,
          result.poolAdd > 0 ? metric('Pool top-up (pre-money)', shares(result.poolAdd)) : null,
          /* The pool after close, top-up or not. A target under what the pool
             already holds asks for nothing, and with the top-up line gone the
             card said nothing at all about the number that had just been
             typed - it read as though the field were being ignored. */
          result.poolAfter > 0
            ? metric('Unallocated pool after close',
              `${shares(result.poolAfter)} (${pct(result.poolAfter / result.postFD)})`,
              poolPct > 0 && result.poolAdd === 0
                ? `Already above the ${round2(poolPct * 100)}% target, so nothing is topped up`
                : null)
            : null,
          metric('Fully diluted after close', shares(result.postFD))
        )
      ),
      financingBreakdown(result, db),
      result.conversions.length ? conversionsCard(result) : null,
      result.antiDilution.length ? antiDilutionCard(result) : null,
      dilutionCard(result),
    ]);
  }

  function conversionsCard(result) {
    return el('div.card', { style: { marginBottom: '16px' } },
      el('h2.card-title', {}, 'Convertible conversions'),
      el('p.card-sub', { style: { marginBottom: '10px' } },
        'Each converts at the better of its cap price and discount price'),
      el('div.table-wrap', {
        tabindex: 0, role: 'region', 'aria-label': 'Convertible conversions table', style: { border: 'none' },
      },
        el('table.data', { style: { minWidth: '460px' } },
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col' }, 'Instrument'),
            el('th.num', { scope: 'col' }, 'Value'),
            el('th.num', { scope: 'col' }, 'Conversion price'),
            el('th.num', { scope: 'col' }, 'Shares')
          )),
          el('tbody', {}, result.conversions.map((c) => el('tr', {},
            el('td', {},
              el('div', {}, `${c.label} · ${store.stakeholder(c.stakeholderId)?.name || 'Unknown'}`),
              c.kind === 'safe'
                ? el('div.small.muted', {}, `${c.safeType === 'post' ? 'Post' : 'Pre'}-money SAFE`)
                : null),
            el('td.num', {}, moneyWhole(c.value)),
            el('td.num', {}, sharePrice(c.price)),
            el('td.num', {}, shares(c.shares))
          )))
        ))
    );
  }

  /* What a down round does to protected classes: the conversion price falls,
     which mints shares for the holders who already own them. */
  function antiDilutionCard(result) {
    const TERM = { broad: 'Broad-based average', ratchet: 'Full ratchet' };
    return el('div.card', { style: { marginBottom: '16px' } },
      el('h2.card-title', {}, 'Anti-dilution adjustments'),
      el('p.card-sub', { style: { marginBottom: '10px' } },
        `This round prices below what these classes paid, so their conversion price falls and their shares multiply. The ${shares(result.antiDilutionShares)} new shares dilute everyone without protection.`),
      el('div.table-wrap', {
        tabindex: 0, role: 'region', 'aria-label': 'Anti-dilution adjustments table', style: { border: 'none' },
      },
        el('table.data', { style: { minWidth: '520px' } },
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col' }, 'Class'),
            el('th', { scope: 'col' }, 'Protection'),
            el('th.num', { scope: 'col' }, 'Conversion price'),
            el('th.num', { scope: 'col' }, 'New shares'))),
          el('tbody', {}, result.antiDilution.map((a) => el('tr', {},
            el('td', { style: { fontWeight: '570' } }, a.name),
            el('td.small.muted', {}, TERM[a.terms] || a.terms),
            el('td.num', {}, el('div', {},
              el('div', {}, `${sharePrice(a.conversionPriceBefore)} to ${sharePrice(a.conversionPriceAfter)}`),
              el('div.small.muted', {}, `issued at ${sharePrice(a.issuePrice)}`))),
            el('td.num', { style: { fontWeight: '620' } }, shares(a.shares))
          ))))));
  }

  /* Before → after ownership, one dumbbell row per holder. */
  function dilutionCard(result) {
    const maxPct = Math.max(...result.dilution.map((d) => Math.max(d.before, d.after)), 0.0001);
    const x = (v) => `${(v / maxPct) * 100}%`;
    return el('div.card', {},
      el('h2.card-title', { style: { marginBottom: '4px' } }, 'Dilution'),
      el('div.dilution-legend', {},
        el('span.key', {}, el('i', { style: { background: 'var(--series-mute)' } }), 'Before'),
        el('span.key', {}, el('i', { style: { background: 'var(--accent)' } }), 'After')),
      /* A sized container, so the rows lay themselves out for the width they
         actually have - see .dilution-list in charts.css. */
      el('div.dilution-list', {}, result.dilution.map((d) => {
        const delta = d.after - d.before;
        /* Rounded to the two decimals shown before the sign and colour are
           chosen from it: a move of a few thousandths of a point read as
           "(-0.00)" in red, or "(+0.00)" in green. */
        const points = Math.round(delta * 10000) / 100;
        const left = Math.min(d.before, d.after);
        const width = Math.abs(d.after - d.before);
        return el('div.dilution-row', {},
          el('span.name', { title: d.name }, d.name),
          el('div.dilution-track', {
            role: 'img',
            'aria-label': `${d.name}: ${pct(d.before)} before, ${pct(d.after)} after`,
          },
            el('span.rail'),
            el('span.link', { style: { left: x(left), width: `calc(${x(width)})` } }),
            el('span.dot.before', { style: { left: x(d.before) } }),
            el('span.dot.after', { style: { left: x(d.after) } })),
          el('span.delta', {},
            `${pct(d.after)} `,
            el('span', { className: points > 0 ? 'pos' : points < 0 ? 'neg' : null },
              `(${points > 0 ? '+' : ''}${points.toFixed(2)})`))
        );
      }))
    );
  }

  async function saveScenario() {
    const problem = termProblems()[0];
    if (problem) {
      toast(problem.message, { icon: 'alert' });
      problem.input.focus();
      return;
    }
    let inputs;
    try { inputs = currentInputs(); } catch (err) { toast(err.message, { icon: 'alert' }); return; }
    const { preMoney, investment, poolPct } = inputs;
    if (preMoney <= 0 || investment <= 0) {
      // Flagged and focused like every other refusal here, not toasted alone.
      const input = preMoney <= 0 ? preInput : investInput;
      flagInvalid(input);
      input.focus();
      toast('Enter a pre-money valuation and investment first', { icon: 'alert' });
      return;
    }
    /* Saving under a name already on the strip revises that scenario rather
       than minting a second one. Loading a saved round, moving the pre-money,
       and pressing Save is the ordinary way this form is used - and every one
       of those presses used to leave another chip behind, identically named,
       until the strip was a row of "Series A" nobody could tell apart. Rename
       first to keep both. */
    const name = nameInput.value.trim() || 'Untitled round';
    const existing = store.scenarios.find((s) => s.name.toLowerCase() === name.toLowerCase());
    // Each save of a new name mints an id, so a second click before the first
    // write lands saves the same terms twice.
    /* Disabling a focused button drops focus to the document body, and the
       write then re-renders the view - so the shell's focus-key hand-off
       never sees this button. Remembered here and put back by hand. */
    const hadFocus = document.activeElement === saveBtn;
    saveBtn.disabled = true;
    /* Saved against the table as it stands, which is what a refresh is. Set
       before the write: the store's change event re-renders this view while
       the save is still in flight, and a draft still carrying the old
       fingerprint drew the stale notice again over a scenario just saved. */
    const previousDigest = draft.basisDigest;
    draft.basisDigest = capTableDigest(store.db);
    try {
      await store.saveScenario({ id: existing?.id, name, ...inputs });
      toast(existing ? 'Scenario updated' : 'Scenario saved');
    } catch (err) {
      draft.basisDigest = previousDigest;
      console.error(err);
      toast(isRefusal(err) ? err.message : 'Couldn’t save. Check your connection',
        { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
    }
    saveBtn.disabled = false;
    if (hadFocus) document.querySelector('[data-focus-key="rounds:save"]')?.focus();
  }

  function scenarioChips() {
    if (!store.scenarios.length) return null;
    return el('div', { style: { marginBottom: '14px' } },
      el('p.small.muted', { style: { marginBottom: '8px' } }, 'Saved scenarios'),
      el('div.row', { style: { flexWrap: 'wrap' } },
        store.scenarios.map((s) => {
          /* A scenario whose financing has closed says so on its chip. Loaded,
             it can only show its terms - the view blocks a second close under
             that ID - and nothing on the strip told the two kinds apart. */
          const closedOn = s.financing?.id
            ? store.securities.filter((sec) => sec.roundId === s.financing.id).map((sec) => sec.date).sort()[0] : null;
          return el('span.scenario-chip', {},
          el('button.scenario-load', {
            type: 'button',
            title: closedOn ? `“${s.name}” closed on ${dateLong(closedOn)}. Load it to see its terms` : `Load “${s.name}” into the form`,
            onclick: () => {
              const loaded = draftFromScenario(s);
              draft = loaded;
              assumptions = financingEditor(store.db, loaded, () => sync());
              assumptionsWrap.replaceChildren(assumptions.node);
              nameInput.value = loaded.name;
              preInput.value = loaded.preMoney;
              investInput.value = loaded.investment;
              poolInput.value = loaded.poolPct;
              sync();
            },
          },
            el('span', { html: icon(closedOn ? 'check' : 'trending-up', 13, 2), style: { display: 'inline-flex' } }),
            ` ${s.name} · ${moneyCompact(s.preMoney)} pre${closedOn ? ' · closed' : ''}`),
          el('button.scenario-x', {
            type: 'button',
            'aria-label': `Delete scenario ${s.name}`,
            html: icon('x', 13, 2.2),
            onclick: async () => {
              const ok = await confirmDialog({ title: `Delete "${s.name}"?`, message: 'This saved scenario is removed.', confirmLabel: 'Delete' });
              if (!ok) return;
              try {
                const { undo } = await store.deleteScenario(s.id);
                /* Said, and undoable, as every other delete in the app is: the
                   chip vanished without a word, and a saved round is a few
                   figures someone typed that a Save cannot bring back. The
                   store's undo, not a fresh save: pressed after a company
                   switch, a save put the round into the other company. */
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
          }));
        }))
    );
  }

  /* The save re-renders the whole view; the focus key is how the shell hands
     focus back to this button afterwards rather than to the document body. */
  const saveBtn = el('button.btn.btn-primary.btn-block', {
    onclick: saveScenario, style: { padding: '11px' }, dataset: { focusKey: 'rounds:save' },
  }, 'Save scenario');

  const form = el('div.card', {},
    el('h2.card-title', { style: { marginBottom: '12px' } }, 'Terms'),
    field('Round name', nameInput),
    field(`Pre-money valuation (${currencySymbol()})`, preInput),
    field(`New investment (${currencySymbol()})`, investInput),
    field('Post-round option pool (%)', poolInput, poolHint()),
    assumptionsWrap,
    saveBtn
  );

  const root = el('div', {},
    viewHead('Round modeling', 'See dilution before the term sheet is signed'),
    scenarioChips(),
    el('div.round-layout', {}, form, resultWrap)
  );
  renderResult();
  if (coverRequested) {
    /* A microtask later either way: the shell appends this view once it is
       returned, and focus() on a field that is not in the document yet is a
       no-op - so with terms already typed, the pool target was filled and the
       toast fired while focus stayed on the document body. */
    queueMicrotask(() => {
      const { preMoney, investment } = currentInputs();
      if (preMoney > 0 && investment > 0) coverHiringPlan();
      else {
        // Said, as the in-page button says it: landing here with nothing typed left focus on a field and no word why.
        toast('Enter the pre-money valuation and investment first, then set the target to cover the plan', { icon: 'alert' });
        preInput.focus();
      }
    });
  }
  return root;
}
