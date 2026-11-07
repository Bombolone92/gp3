import { preferredTermsEditor } from '../ui/financingterms.js';
import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { viewHead, emptyState, field, flagInvalid } from '../ui/bits.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { openSplitForm } from '../ui/split.js';
import { hiringPlanCard } from '../ui/hiringplan.js';
import {
  openPlanForm, openReserveForm, openTransferReserveForm, openRetirePlanForm, openPlanLedger, reopenPlan, removePlan,
} from '../ui/planform.js';
import { store, isRefusal } from '../lib/store.js';
import {
  issuedInClass, sharesOutstanding, planBalances, planIsOpen, plansOf, securityDate,
  ANTI_DILUTION_TERMS, hasAntiDilution, conversionPriceOf,
} from '../lib/captable.js';
import { shares, sharesLabel, sharePrice, dateLong, currencySymbol, amountValue, decimalValue, countLabel } from '../lib/format.js';
import { parseNum, parseMultiple, todayISO } from '../lib/util.js';

export function classesView({ navigate } = {}) {
  const listWrap = el('div');

  function render() {
    const db = store.db;
    listWrap.replaceChildren();

    if (!db.classes.length) {
      listWrap.append(el('div.card', {}, emptyState({
        icon: 'layers',
        title: 'No share classes yet',
        text: 'Most companies start with Common Stock, then add preferred classes as they raise priced rounds.',
        cta: 'Add share class',
        onCta: () => openClassForm(),
      })));
    } else {
      const table = el('table.data', {},
        el('caption.visually-hidden', {}, 'Share classes'),
        el('thead', {}, el('tr', {},
          el('th.col-class', { scope: 'col' }, 'Class'),
          el('th', { scope: 'col' }, 'Type'),
          el('th.num', { scope: 'col' }, 'Authorized'),
          el('th.num', { scope: 'col' }, 'Issued'),
          el('th.num', { scope: 'col' }, 'Price'),
          el('th', { scope: 'col' }, 'Preference'),
          el('th', { scope: 'col' }, el('span.visually-hidden', {}, 'Actions'))
        )),
        el('tbody', {}, db.classes.map((c) => {
          const issued = issuedInClass(db.securities, c.id);
          /* The store refuses to delete a class that any certificate record
             references - closed ones included, since the sanitizer would
             silently drop them on the next load, erasing transfer history.
             The button follows the same rule, or it offers a delete that can
             only ever fail (repurchase every share in a class and `issued`
             reads 0 while the certificates remain). */
          const certified = db.securities.some((s) => s.kind === 'shares' && s.classId === c.id);
          const warranted = db.securities.some((s) => s.kind === 'warrant' && s.classId === c.id);
          const awarded = db.securities.some((s) => s.kind === 'rsu' && s.classId === c.id);
          // A plan settles its awards into its class; the store refuses the delete, so the button does too.
          const planned = plansOf(db.company).some((p) => p.classId === c.id);
          return el('tr', {},
            el('td.col-class', { style: { fontWeight: '570' } }, c.name),
            el('td', {}, el('span.badge', {}, c.kind === 'preferred' ? 'Preferred' : 'Common')),
            el('td.num', {}, c.authorized > 0 ? shares(c.authorized) : '-'),
            /* Issuing past the authorized count is a charter problem, not a
               rounding one, and the table was showing both numbers without
               remarking on the contradiction. Said in words, not colour alone. */
            el('td.num', {}, c.authorized > 0 && issued > c.authorized
              ? el('div', {},
                el('div', {}, shares(issued)),
                el('div.small.warn', {}, `${shares(issued - c.authorized)} over authorized`))
              : shares(issued)),
            el('td.num', {}, c.pricePerShare > 0 ? sharePrice(c.pricePerShare) : '-'),
            /* The stored multiple verbatim - `|| 1` would dress an explicit
               0x preference up as the 1x standard, while the exit waterfall
               (correctly) pays that class nothing off the top. */
            el('td', {}, c.kind === 'preferred'
              ? el('div', {},
                el('div', {}, `${c.liquidationMultiple}x${c.participating ? ' participating' : ''}`),
                hasAntiDilution(c)
                  ? el('div.small.muted', {},
                    c.antiDilution === 'ratchet' ? 'Full ratchet' : 'Broad-based average')
                  : null,
                /* A conversion price below the issue price is the mark of a
                   down round that has already adjusted this class. */
                conversionPriceOf(c) < c.pricePerShare
                  ? el('div.small', {}, `Converts at ${sharePrice(conversionPriceOf(c))}`)
                  : null)
              : '-'),
            el('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
              el('button.icon-btn', {
                html: icon('pencil', 16, 2), 'aria-label': `Edit ${c.name}`,
                onclick: () => openClassForm(c),
              }),
              el('button.icon-btn', {
                html: icon('trash', 16, 2), 'aria-label': `Delete ${c.name}`,
                disabled: certified || warranted || awarded || planned,
                title: issued > 0 ? 'Classes with issued shares can’t be deleted'
                  : certified ? 'Closed certificates keep this class’s history'
                    : warranted ? 'Warrants are outstanding over this class'
                      : awarded ? 'RSU awards settle into this class'
                        : planned ? 'An equity plan settles its awards into this class' : undefined,
                onclick: () => removeClass(c),
              }))
          );
        }))
      );
      listWrap.append(el('div.table-wrap', { tabindex: 0, role: 'region', 'aria-label': 'Share classes table' }, table));
      /* This page reads the register: a certificate or grant dated ahead of
         today is issued and committed here from the day it was recorded,
         while the dashboard, cap table and holder pages count it from its
         date. Said once, where the two can disagree - the plan figures here
         and on Home differed by a future-dated grant with no word on either. */
      const today = todayISO();
      const ahead = db.securities.filter((s) => securityDate(s) > today).length;
      if (ahead) {
        listWrap.append(el('p.small.muted', { style: { margin: '8px 2px 0' } },
          // Not countLabel: "security" takes an irregular plural.
          `${shares(ahead)} ${ahead === 1 ? 'security is' : 'securities are'} dated after today and ${ahead === 1 ? 'counts' : 'count'} here already, `
          + 'as issued and committed; the dashboard and cap table count them from their dates.'));
      }
    }

    listWrap.append(plansCard(db));
    /* The plans' other half: what is left today, against what the hiring plan
       is going to ask for. */
    listWrap.append(hiringPlanCard({
      onCover: () => navigate('#/rounds?cover=pool'),
    }));
    listWrap.append(splitCard(db));
  }

  /* Stock splits: the recorded history, and the action to add one. */
  function splitCard(db) {
    const splits = db.company.splits || [];
    const canSplit = sharesOutstanding(db.securities) > 0;
    return el('div.card', { style: { marginTop: '16px' } },
      el('div.card-head', {},
        el('div', {},
          el('h2.card-title', {}, 'Stock splits'),
          el('p.card-sub', {}, splits.length
            ? 'Recorded splits restate every per-share number from their effective date'
            : 'Forward splits before a priced round, reverse splits to tidy the count')),
        el('button.btn.btn-ghost', {
          disabled: !canSplit,
          title: canSplit ? undefined : 'Issue shares first',
          onclick: () => openSplitForm(),
        }, 'Record split')),
      splits.length
        ? el('div', {}, [...splits].reverse().map((sp) => el('div.round-metric', {},
          el('span', {}, `${sp.num}-for-${sp.den} ${sp.num >= sp.den ? 'forward' : 'reverse'} split`),
          el('span.v', {}, dateLong(sp.date)))))
        : null);
  }

  /* The equity incentive plans: each a reserve of shares for awards, with
     its own dated history, and the company aggregate under them. */
  function plansCard(db) {
    const balances = planBalances(db);
    const plans = plansOf(db.company);
    const today = todayISO();
    const total = balances.total;
    const sub = plans.length
      ? `${shares(total.authorized)} reserved · ${shares(total.committed)} committed · ${shares(total.unallocated)} unallocated`
      : balances.outside.outstanding > 0
        ? `${shares(balances.outside.outstanding)} granted with no plan adopted yet`
        : 'Reserve shares for option grants and RSU awards';
    const head = el('div.card-head', {},
      el('div', {},
        el('h2.card-title', {}, plans.length === 1 ? 'Equity plan' : 'Equity plans'),
        el('p.card-sub', {}, sub)),
      el('div.row', {},
        plans.length > 1 && plans.some((p) => planIsOpen(p))
          ? el('button.btn.btn-ghost', { onclick: () => openTransferReserveForm() }, 'Move shares')
          : null,
        el('button.btn.btn-ghost', {
          html: plans.length ? icon('plus', 15, 2.2) : null,
          onclick: () => openPlanForm(),
        }, plans.length ? ' Add plan' : 'Adopt a plan')));
    if (!plans.length) {
      return el('div.card', { style: { marginTop: '16px' } }, head,
        el('p.small.muted', { style: { marginTop: '4px' } },
          balances.outside.outstanding > 0
            ? 'Adopt a plan to give the awards already granted a reserve to draw from, or leave them outside any plan.'
            : 'A plan names the shares set aside for awards, when it was adopted, and where the shares an award gives back go. A company with an older plan and a successor keeps one of each.'));
    }
    const table = el('table.data', {},
      el('caption.visually-hidden', {}, 'Equity incentive plans'),
      el('thead', {}, el('tr', {},
        el('th.col-class', { scope: 'col' }, 'Plan'),
        el('th', { scope: 'col' }, 'Status'),
        el('th.num', { scope: 'col' }, 'Authorized'),
        el('th.num', { scope: 'col' }, 'Committed'),
        el('th.num', { scope: 'col' }, 'Available'),
        el('th', { scope: 'col' }, el('span.visually-hidden', {}, 'Actions')))),
      el('tbody', {}, balances.plans.map((row) => {
        const plan = row.plan;
        const expired = planIsOpen(plan) && plan.expires && plan.expires < today;
        const written = plan.awardTypes.length === 2 ? 'Options and RSUs' : plan.awardTypes[0] === 'rsu' ? 'RSUs only' : 'Options only';
        return el('tr', {},
          el('td.col-class', {},
            el('div', { style: { fontWeight: '570' } }, plan.name),
            el('div.small.muted', {}, [
              plan.adopted ? `Adopted ${dateLong(plan.adopted)}` : 'Adoption date not recorded',
              written,
              plan.classId ? store.shareClass(plan.classId)?.name : null,
            ].filter(Boolean).join(' · '))),
          el('td', {},
            el('span.badge', {}, planIsOpen(plan) ? (expired ? 'Expired' : 'Active') : 'Retired'),
            !planIsOpen(plan) ? el('div.small.muted', {}, dateLong(plan.retiredAt))
              : plan.expires ? el(`div.small.${expired ? 'warn' : 'muted'}`, {}, `${expired ? 'Expired' : 'Expires'} ${dateLong(plan.expires)}`) : null),
          el('td.num', {},
            el('div', {}, shares(row.authorized)),
            row.pouredIn > 0 || row.pouredOut > 0
              ? el('div.small.muted', {}, `${shares(row.reserve)} reserved${row.pouredIn > 0 ? `, +${shares(row.pouredIn)} poured in` : ''}${row.pouredOut > 0 ? `, -${shares(row.pouredOut)} poured over` : ''}`)
              : null),
          el('td.num', {},
            el('div', {}, shares(row.committed)),
            row.awards ? el('div.small.muted', {}, countLabel(row.awards, 'award')) : null),
          /* Awards outrunning the reserve is a charter problem, not a
             rounding one: said in words, the way the class table says
             "over authorized". */
          el('td.num', {}, row.available < 0
            ? el('div', {},
              el('div', {}, shares(0)),
              el('div.small.warn', {}, `${shares(-row.available)} over the reserve`))
            : el('div', {},
              el('div', {}, shares(row.available)),
              !planIsOpen(plan) && row.available > 0 ? el('div.small.muted', {}, 'not counted, retired') : null)),
          /* Icon buttons with the plan's name in each label, the way the
             class rows above name theirs: four text buttons per row pushed
             the table past its card at desktop widths. */
          el('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
            el('button.icon-btn', {
              html: icon('activity', 16, 2), 'aria-label': `Movements of ${plan.name}`, title: 'Movements and balances',
              'aria-haspopup': 'dialog', onclick: () => openPlanLedger(plan),
            }),
            el('button.icon-btn', {
              html: icon('wallet', 16, 2), 'aria-label': `Resize the reserve of ${plan.name}`, title: 'Resize the reserve',
              'aria-haspopup': 'dialog', onclick: () => openReserveForm(plan),
            }),
            planIsOpen(plan)
              ? el('button.icon-btn', {
                html: icon('logout', 16, 2), 'aria-label': `Retire ${plan.name}`, title: 'Retire the plan',
                'aria-haspopup': 'dialog', onclick: () => openRetirePlanForm(plan),
              })
              : el('button.icon-btn', {
                html: icon('refresh', 16, 2), 'aria-label': `Reopen ${plan.name}`, title: 'Reopen the plan',
                onclick: () => reopenPlan(plan),
              }),
            el('button.icon-btn', {
              html: icon('pencil', 16, 2), 'aria-label': `Edit ${plan.name}`,
              onclick: () => openPlanForm(plan),
            }),
            el('button.icon-btn', {
              html: icon('trash', 16, 2), 'aria-label': `Delete ${plan.name}`,
              disabled: row.awards > 0,
              title: row.awards > 0 ? 'Plans with awards can’t be deleted; retire it instead' : undefined,
              onclick: () => removePlan(plan),
            })));
      })),
      plans.length > 1 ? el('tfoot', {}, el('tr', {},
        el('td', { colSpan: 2 }, 'All plans'),
        el('td.num', {}, shares(total.authorized)),
        el('td.num', {}, shares(total.committed)),
        el('td.num', {}, shares(total.unallocated)),
        el('td', {}))) : null);
    return el('div.card', { style: { marginTop: '16px' } }, head,
      el('div.table-wrap', { tabindex: 0, role: 'region', 'aria-label': 'Equity plans table' }, table),
      total.available !== total.unallocated && plans.some((p) => !planIsOpen(p) && (balances.plans.find((r) => r.planId === p.id)?.available || 0) > 0)
        ? el('p.small.muted', { style: { marginTop: '8px' } },
          'A retired plan’s available shares are not counted as fully diluted: nothing can be granted from them. Move them to an open plan, or reopen it.')
        : null,
      balances.outside.count > 0
        ? el('p.small.muted', { style: { marginTop: '8px' } },
          `${countLabel(balances.outside.count, 'award')} ${balances.outside.count === 1 ? 'sits' : 'sit'} outside every plan, holding ${sharesLabel(balances.outside.outstanding)}: counted as fully diluted, drawing no reserve.`)
        : null);
  }

  async function removeClass(c) {
    const ok = await confirmDialog({
      title: `Delete ${c.name}?`,
      message: 'This share class has no issued shares, so nothing else changes.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await store.deleteClass(c.id);
      store.logActivity(`Share class ${c.name} deleted`, 'layers');
      toast('Share class deleted', { icon: 'trash' });
    } catch (err) {
      console.error(err);
      // The store's reason (shares, warrants, or awards still reference the
      // class) in its own words; a failed write says so rather than showing
      // the platform's error text.
      toast(isRefusal(err) ? err.message : 'Couldn’t delete. Check your connection',
        { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
    }
  }

  const root = el('div', {},
    viewHead('Share classes', 'Common, preferred, and the equity plans',
      el('button.btn.btn-primary', {
        html: icon('plus', 15, 2.2),
        onclick: () => openClassForm(),
      }, ' Add share class')),
    listWrap
  );
  render();
  return root;
}

/* Exported for global search, which opens a class's own form - there is no
   detail view for a share class to jump to. */
export function openClassForm(existing = null) {
  const nameInput = el('input.input', {
    type: 'text', value: existing?.name || '', maxlength: 80, required: true,
    placeholder: existing ? '' : 'e.g. Series A Preferred', 'aria-label': 'Class name',
  });
  const kindSelect = el('select.select', { 'aria-label': 'Class type' },
    el('option', { value: 'common', selected: (existing?.kind || 'common') === 'common' }, 'Common'),
    el('option', { value: 'preferred', selected: existing?.kind === 'preferred' }, 'Preferred'));
  const authInput = el('input.input', {
    type: 'text', inputmode: 'numeric',
    value: existing?.authorized > 0 ? amountValue(existing.authorized) : '',
    placeholder: '10,000,000', 'aria-label': 'Authorized shares',
  });
  /* Said before the save, as the sheets that issue shares say it: a count
     typed under what the class has issued saved under "Share class updated"
     and the table read "over authorized" on the next visit. */
  const issuedNow = existing ? issuedInClass(store.securities, existing.id) : 0;
  const overNote = el('p.field-hint.warn', { role: 'status', style: { display: 'none', margin: '-4px 0 12px' } });
  const syncOver = () => {
    const n = parseNum(authInput.value);
    const over = existing && n !== null && n > 0 && issuedNow > n ? issuedNow - n : 0;
    overNote.style.display = over ? '' : 'none';
    const next = over
      ? `${existing.name} has ${shares(issuedNow)} shares issued, ${shares(over)} more than this count. `
        + 'They read as over authorized until the count is raised; that is what a charter amendment is for.'
      : '';
    if (overNote.textContent !== next) overNote.textContent = next;
  };
  authInput.addEventListener('input', syncOver);
  syncOver();
  const priceInput = el('input.input', {
    type: 'text', inputmode: 'decimal', value: existing?.pricePerShare ? decimalValue(existing.pricePerShare) : '',
    placeholder: '0.0001', 'aria-label': 'Original issue price',
  });
  const prefInput = el('input.input', {
    type: 'text', inputmode: 'decimal', value: existing?.liquidationMultiple ?? 1,
    placeholder: '1', 'aria-label': 'Liquidation multiple',
  });
  /* The waterfall pays higher seniority first, and closing a round stacks the
     new class above everything - so a hand-made class defaults the same way,
     rather than silently landing pari passu at 0 with no way to change it. */
  const nextSeniority = store.classes.reduce((a, c) => Math.max(a, c.seniority || 0), 0) + 1;
  const seniorityInput = el('input.input', {
    type: 'text', inputmode: 'numeric',
    value: existing ? (existing.seniority ?? 0) : nextSeniority,
    placeholder: '1', 'aria-label': 'Liquidation seniority',
  });
  const partCheck = el('input', { type: 'checkbox', checked: !!existing?.participating });
  /* Conversion-price protection: what happens to this class when a later
     round prices below what it paid. Almost every priced financing carries
     some form of it, and without it a down round models as though nobody
     held a ratchet. */
  const antiSelect = el('select.select', { 'aria-label': 'Anti-dilution protection' },
    ANTI_DILUTION_TERMS.map((t) => el('option', {
      value: t.value, selected: (existing?.antiDilution || 'none') === t.value,
    }, t.label)));
  const ANTI_HINT = {
    none: 'The class converts one for one however low a later round prices.',
    broad: 'The conversion price falls by the weighted average of the down round, counting every fully diluted share. The usual term.',
    ratchet: 'The conversion price falls all the way to the down round’s price, however few shares were sold at it.',
  };
  const antiHint = el('p.field-hint', {}, ANTI_HINT[existing?.antiDilution || 'none']);
  antiSelect.addEventListener('change', () => { antiHint.textContent = ANTI_HINT[antiSelect.value]; });
  const adjusted = existing && hasAntiDilution(existing)
    && conversionPriceOf(existing) < existing.pricePerShare
    ? el('p.field-hint', {},
      `A closed down round already lowered this class's conversion price to `
      + `${sharePrice(conversionPriceOf(existing))}, from an issue price of `
      + `${sharePrice(existing.pricePerShare)}. The next adjustment measures from there.`)
    : null;

  const negotiated = preferredTermsEditor(existing);
  /* Dated cap and dividend terms were written against this preference, rank
     and participation, and the store refuses moving any of them under such
     terms - said here, on the controls, rather than at save. */
  const frozen = !!existing?.preferredTerms?.length;
  const FROZEN_HINT = 'Dated cap and dividend terms are recorded against this preference, seniority and participation, so those stay as they are. Append an amendment below for what changed.';
  if (frozen) {
    for (const control of [kindSelect, prefInput, seniorityInput, partCheck]) {
      control.disabled = true;
      control.title = FROZEN_HINT;
    }
  }
  const prefRow = el('div', {},
    frozen ? el('p.field-hint', {}, FROZEN_HINT) : null,
    el('div.form-grid', {},
      field('Liquidation preference (x)', prefInput),
      field('Seniority', seniorityInput,
        'Higher is paid first at an exit; equal ranks share pro rata')),
    field('Participation',
      el('label.check-row', {}, partCheck, el('span', {}, 'Participating preferred'))),
    field('Anti-dilution', el('div.select-wrap', {}, antiSelect)),
    antiHint,
    adjusted,
    negotiated.node);
  const syncPref = () => { prefRow.style.display = kindSelect.value === 'preferred' ? '' : 'none'; };
  /* A common class is stored with a 0x preference at seniority 0 - the
     sanitizer writes both - so flipping one to preferred showed those zeros
     where a class created as preferred gets the 1x standard and the next rank.
     Saved as they stood, the class ranked at the bottom with nothing off the
     top at an exit. The fields take the new-class defaults on the flip, and
     only while they still hold the stored zeros: a value the user typed stays. */
  kindSelect.addEventListener('change', () => {
    if (kindSelect.value === 'preferred' && existing?.kind !== 'preferred') {
      if ((parseMultiple(prefInput.value) ?? 0) === 0) prefInput.value = 1;
      if ((parseNum(seniorityInput.value) ?? 0) === 0) seniorityInput.value = nextSeniority;
    }
    syncPref();
  });
  syncPref();

  const saveBtn = el('button.btn.btn-primary.btn-block', { type: 'submit', style: { padding: '12px' } },
    existing ? 'Save changes' : 'Add share class');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name) {
        // Said, not only flagged: a name of spaces satisfies `required` and landed here.
        flagInvalid(nameInput);
        nameInput.focus();
        toast('Name the share class', { icon: 'alert' });
        return;
      }

      const invalid = (control, message) => {
        flagInvalid(control, message);
        control.focus();
        toast(message, { icon: 'alert' });
      };
      /* A blank number field takes its documented default. A non-blank one
         that won't parse is a typo, and letting it fall through to that
         default files a number nobody typed: "2x" saved as the 1x standard,
         "10M" saved as no authorized shares. Both read back as if they were
         entered that way, and the first one quietly rewrites what this class
         is paid at an exit. */
      const numField = (control, fallback, parse = parseNum) => {
        const raw = control.value.trim();
        if (!raw) return fallback;
        const n = parse(raw);
        return n === null || n < 0 ? null : n;
      };
      const isPreferred = kindSelect.value === 'preferred';
      /* Whole numbers only for the two counts here: the sanitizer rounds a
         fraction on the way in, so "10,000,000.5" saved as 10,000,001 under
         a toast that said the class was saved as typed. */
      const authorized = numField(authInput, 0);
      if (authorized === null || !Number.isInteger(authorized)) {
        return invalid(authInput, 'Authorized shares must be a whole number, like 10,000,000');
      }
      const pricePerShare = numField(priceInput, 0);
      if (pricePerShare === null) {
        return invalid(priceInput, 'The issue price must be a number, like 0.0001');
      }
      const liquidationMultiple = isPreferred ? numField(prefInput, 1, parseMultiple) : 0;
      if (liquidationMultiple === null) {
        return invalid(prefInput, 'The liquidation preference must be a number, like 1 or 1.5');
      }
      // Only meaningful for preferred; a common class keeps whatever it had.
      const seniority = isPreferred ? numField(seniorityInput, 0) : (existing?.seniority ?? 0);
      if (seniority === null || !Number.isInteger(seniority)) {
        return invalid(seniorityInput, 'Seniority must be a whole number, like 1');
      }

      saveBtn.disabled = true;
      const input = {
        name,
        kind: kindSelect.value,
        authorized,
        pricePerShare,
        liquidationMultiple,
        participating: partCheck.checked,
        seniority,
        // Only preferred carries protection, and 'none' is the absent value -
        // so turning it off truly clears it.
        antiDilution: isPreferred ? antiSelect.value : 'none',
      };
      try {
        const terms = negotiated.read({ participating: partCheck.checked });
        if (terms !== undefined) input.preferredTerms = terms;
        if (existing) {
          await store.updateClass(existing.id, input);
          toast('Share class updated');
        } else {
          await store.addClass(input);
          store.logActivity(`Share class ${name} created`, 'layers');
          toast('Share class added');
        }
        modal.close();
      } catch (err) {
        console.error(err);
        toast(isRefusal(err) ? err.message : 'Couldn’t save. Check your connection',
          { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
        // The term editor flags the field at fault; focus goes there.
        if (isRefusal(err)) negotiated.node.querySelector('[aria-invalid="true"]')?.focus();
        saveBtn.disabled = false;
      }
    },
  },
    field('Name', nameInput),
    el('div.form-grid', {},
      field('Type', el('div.select-wrap', {}, kindSelect)),
      field('Authorized shares', authInput)),
    overNote,
    field(`Original issue price (${currencySymbol()})`, priceInput,
      'The price per share for this class, e.g. par value for common'),
    prefRow,
    saveBtn
  );

  const modal = openModal({ title: existing ? `Edit ${existing.name}` : 'Add share class', content: form });
  if (existing) {
    form.append(el('a.btn.btn-ghost.btn-block', {
      href: `#/history?record=${encodeURIComponent(existing.id)}`, html: icon('clock', 15, 2),
      style: { marginTop: '8px' }, onclick: () => modal.close(),
    }, ' View history'));
  }
}
