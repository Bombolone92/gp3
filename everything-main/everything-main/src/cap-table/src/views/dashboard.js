import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { statTile, viewHead, segmented } from '../ui/bits.js';
import { openSecurityForm } from '../ui/securityform.js';
import { store } from '../lib/store.js';
import {
  fullyDiluted, sharesOutstanding, ownershipByClass, ownershipByStakeholder,
  poolRemaining, capitalRaised, impliedValuation, convertibles,
  unvestedTotal, fmvStatus, upcomingEvents, attentionItems, planBalances, plansOf, dbAsOf,
} from '../lib/captable.js';
import {
  sharesCompact, shares, moneyCompact, moneyWhole, sharePrice, pct, timeAgo, dateShort,
} from '../lib/format.js';
import { todayISO, daysBetween } from '../lib/util.js';
import { ownershipChart } from '../charts/ownership.js';
import { vestingForecastCard } from '../ui/vestingcard.js';
import { attentionCard } from '../ui/attention.js';

export function dashboardView({ navigate }) {
  const today = todayISO();
  const db = dbAsOf(store.db, today);
  const fd = fullyDiluted(db.securities, db.company);
  const outstanding = sharesOutstanding(db.securities);
  const pool = poolRemaining(db.company, db.securities);
  /* The plans whose unallocated shares the figure above holds: a retired
     plan's are not counted, so it is not one of the plans the shares sit
     across - the tile said "across 2 plans" over one plan's reserve. */
  const openPlans = planBalances(db).plans.filter((r) => r.eligible).length;
  const raised = capitalRaised(db.securities);
  const valuation = impliedValuation(db);
  const convs = convertibles(db.securities);
  const unvested = unvestedTotal(db.securities, today);
  const fmv = fmvStatus(db, today);

  const root = el('div', {},
    viewHead(
      db.company.name || 'Dashboard',
      db.company.name
        ? [db.company.entityType, db.company.jurisdiction].filter(Boolean).join(' · ')
          || 'An overview of your company’s equity'
        : 'An overview of your company’s equity',
      el('button.btn.btn-primary', {
        html: icon('plus', 15, 2.2),
        onclick: () => openSecurityForm(),
      }, ' Issue security')
    ),

    el('div.stat-grid', {},
      statTile({
        label: 'Fully diluted shares', icon: 'pie',
        value: sharesCompact(fd),
        sub: unvested > 0 ? `${shares(fd)} total · ${shares(unvested)} unvested` : `${shares(fd)} total`,
      }),
      statTile({
        label: 'Outstanding shares', icon: 'table',
        value: sharesCompact(outstanding),
        sub: fd > 0 ? `${pct(outstanding / fd)} of fully diluted` : 'No shares issued',
      }),
      statTile({
        label: 'Capital raised', icon: 'coins',
        value: moneyCompact(raised),
        sub: convs.length ? `Includes ${convs.length} convertible${convs.length === 1 ? '' : 's'}` : 'Priced shares and convertibles',
      }),
      valuation
        ? statTile({
          label: 'Implied valuation', icon: 'trending-up',
          value: moneyCompact(valuation),
          sub: 'Latest price × fully diluted',
        })
        : statTile({
          label: plansOf(db.company).length > 1 ? 'Plan reserves' : 'Option pool', icon: 'wallet',
          value: sharesCompact(pool),
          /* Read off the plans, not the aggregate reserve: a plan resized to
             nothing, or one adopted with no reserve yet, is still a plan. */
          sub: plansOf(db.company).length
            ? (openPlans > 1 ? `Unallocated across ${openPlans} plans` : 'Unallocated')
            : 'No plan adopted',
        }),
      fmvTile(fmv)
    ),

    el('div.dash-grid', {},
      el('div', { style: { display: 'grid', gap: '16px' } },
        ownershipCard(navigate, db),
        // The other thing on a cap table that moves over time, beside who
        // owns what: only worth a card once something is actually vesting.
        unvested > 0 ? vestingForecastCard({ securities: db.securities }) : null,
        checklistCard(navigate)
      ),
      el('div', { style: { display: 'grid', gap: '16px' } },
        /* Above what is coming up, because it is already late. Only when
           there is something to say: an empty "nothing needs attention" card
           belongs on the page that exists to answer that question, not on
           every visit to the dashboard. */
        attentionItems(db, { asOf: today }).length
          ? attentionCard({ db, limit: 4, onMore: () => navigate('#/attention') })
          : null,
        valuation ? poolCard(db) : null,
        upcomingCard(today),
        activityCard()
      )
    )
  );
  return root;
}

/**
 * The 409A tile only appears once one has been recorded - most companies
 * have none at the start, and an empty tile would just be noise. The sub
 * line carries the refresh triggers that have fired: a priced round closing
 * after the valuation was set, and age past a year. The round leads, as it
 * does on the needs-attention list - a round is the more decisive of the
 * two, and the tile used to name only the age whenever both applied, so
 * the two places gave two different reasons for the same valuation.
 */
function fmvTile({ current, months, stale, roundSince }) {
  if (!current) return null;
  const age = months <= 0 ? 'set this month'
    : months === 1 ? 'set 1 month ago'
      : `set ${months} months ago`;
  const reasons = [roundSince ? 'a round closed since' : null, stale ? age : null].filter(Boolean);
  return statTile({
    label: 'Fair market value', icon: 'scale',
    value: sharePrice(current.fmvPerShare),
    sub: reasons.length ? el('span.warn', {}, `Refresh due · ${reasons.join(' · ')}`) : `409A ${age}`,
  });
}

/* Module-level so the toggle survives store-driven re-renders. */
let ownershipMode = 'class';

/* Ownership card with a by-class / by-holder toggle. */
function ownershipCard(navigate, db) {
  const chartWrap = el('div');

  const seg = segmented([
    { value: 'class', label: 'By class' },
    { value: 'holders', label: 'By holder' },
  ], {
    label: 'Ownership grouping', value: ownershipMode,
    onSelect: (value) => { ownershipMode = value; renderChart(); },
  });

  function renderChart() {
    const data = ownershipMode === 'class'
      ? ownershipByClass(db, { base: 'diluted', includePool: true })
      : ownershipByStakeholder(db, { base: 'diluted', includePool: true });
    chartWrap.replaceChildren(ownershipChart(data.rows));
  }
  renderChart();

  return el('div.card', {},
    el('div.card-head', {},
      el('div', {},
        el('h2.card-title', {}, 'Ownership'),
        el('p.card-sub', {}, 'Fully diluted, including the unallocated pool')
      ),
      seg
    ),
    chartWrap,
    el('div.row.row-end', { style: { marginTop: '12px' } },
      el('button.btn.btn-ghost', { onclick: () => navigate('#/cap-table') }, 'Open cap table')
    )
  );
}

/* Plan reserve usage: one meter per plan that has anything reserved. */
function poolCard(db) {
  const rows = planBalances(db).plans.filter((r) => r.authorized > 0);
  if (!rows.length) return null;
  const meter = (r) => {
    /* The real committed count - option grants plus RSU awards, less what
       the plan's rules handed back - not authorized minus remaining: imports
       don't ration a reserve, and once awards outrun it that subtraction
       would quietly report the reserve size instead of the truth. */
    const usedPct = r.committed / r.authorized;
    return el('div', { style: { marginBottom: rows.length > 1 ? '12px' : '0' } },
      rows.length > 1 ? el('p.small', { style: { margin: '0 0 6px', fontWeight: '570' } },
        `${r.name}${r.eligible ? '' : ' (retired)'}`) : null,
      el('p.card-sub', { style: { marginBottom: '8px' } },
        `${shares(r.committed)} committed of ${shares(r.authorized)} authorized`),
      el('div.meter', { role: 'img', 'aria-label': `${r.name}: ${pct(usedPct)} committed` },
        el('div.meter-fill', { style: { width: `${Math.min(100, usedPct * 100)}%` } })),
      r.available < 0
        ? el('p.small.warn', { style: { marginTop: '8px' } },
          `${shares(-r.available)} committed over the reserve`)
        : el('p.small.muted', { style: { marginTop: '8px' } },
          `${shares(r.available)} available${r.eligible ? '' : ', not counted while retired'}`));
  };
  return el('div.card', {},
    el('h2.card-title', { style: { marginBottom: '10px' } }, rows.length > 1 ? 'Plan reserves' : rows[0].name),
    rows.map(meter));
}

/* Getting-started checklist - hidden once complete or when exploring sample data. */
function checklistCard(navigate) {
  const db = store.db;
  const items = [
    { done: !!db.company.name, label: 'Set up your company profile', go: '#/settings' },
    { done: db.classes.length > 0, label: 'Create a share class', go: '#/classes' },
    { done: db.securities.some((s) => s.kind === 'shares'), label: 'Issue founder shares', go: '#/securities' },
    { done: plansOf(db.company).length > 0, label: 'Adopt an equity plan and reserve shares', go: '#/classes' },
    { done: db.securities.some((s) => s.kind !== 'shares'), label: 'Grant options or add a SAFE', go: '#/securities' },
  ];
  const open = items.filter((i) => !i.done);
  if (!open.length || store.settings.sampleData) return null;

  return el('div.card', {},
    el('h2.card-title', {}, 'Getting started'),
    el('p.card-sub', { style: { marginBottom: '8px' } },
      `${items.length - open.length} of ${items.length} done`),
    items.map((i) => el(`button.check-item${i.done ? '.done' : ''}`, {
      type: 'button',
      onclick: () => navigate(i.go),
    },
      el('span.ring', { html: i.done ? icon('check', 12, 3) : '' }),
      /* The tick and the muted style are the only visible signs of a step
         being done, and neither is read aloud: every step announced as the
         same bare button. The state goes in the name. */
      el('span.grow', {}, i.label, el('span.visually-hidden', {}, i.done ? ', done' : ', to do')),
      !i.done ? el('span', { html: icon('chevR', 15, 2), style: { color: 'var(--ink-3)', display: 'inline-flex' } }) : null
    ))
  );
}

/* Everything the cap table already knows is coming: cliffs, full vests,
   note maturities, expirations. Almost all of it is computable from dates
   already on the records - it just was never surfaced anywhere. */
const HORIZON_MONTHS = 12;
const IMMINENT_DAYS = 30;
/* Rows before the card stops being a glance. What doesn't fit is counted
   underneath rather than dropped in silence: there is no fuller list of
   upcoming dates anywhere else, so a card that quietly showed eight of
   thirty read as "eight is all there is". */
const MAX_UPCOMING = 8;

const EVENT_ICON = {
  cliff: 'clock',
  tranche: 'clock',
  'vest-complete': 'check',
  maturity: 'coins',
  expiration: 'alert',
  '83b-deadline': 'alert',
  'form-3921': 'landmark',
};

function eventText(e) {
  switch (e.type) {
    case 'form-3921':
      return `Form 3921 due to holders for ${e.year}’s ${e.quantity} ISO exercise${e.quantity === 1 ? '' : 's'}`;
    case 'cliff':
      return `${e.label} cliff · ${shares(e.quantity)} vest for ${e.name}`;
    case 'tranche':
      return `${e.label} tranche · ${shares(e.quantity)} vest for ${e.name}`;
    case '83b-deadline':
      return `${e.label} 83(b) election due for ${e.name}`;
    case 'vest-complete':
      return `${e.label} finishes vesting for ${e.name}`;
    case 'maturity':
      return `${e.label} matures · ${moneyWhole(e.amount)} owed to ${e.name}`;
    default:
      return e.window
        ? `${e.label} exercise window closes · ${shares(e.quantity)} unexercised by ${e.name}`
        : `${e.label} expires · ${shares(e.quantity)} unexercised by ${e.name}`;
  }
}

function upcomingCard(today) {
  const all = upcomingEvents(store.db, { from: today, horizonMonths: HORIZON_MONTHS });
  const events = all.slice(0, MAX_UPCOMING);
  const more = all.length - events.length;

  return el('div.card', {},
    el('h2.card-title', {}, 'Coming up'),
    /* 83(b) windows are named here because the card lists them, and because
       they are the one deadline on it that cannot be extended by anyone. */
    el('p.card-sub', { style: { marginBottom: events.length ? '6px' : '0' } },
      `Cliffs, vesting, 83(b) deadlines, maturities, expirations, and filings in the next ${HORIZON_MONTHS} months`),
    events.length
      ? el('div.activity-list', {}, events.map((e) => {
        const days = daysBetween(today, e.date);
        const soon = days <= IMMINENT_DAYS;
        return el('div.activity-item', {},
          el('span.activity-ic', { html: icon(EVENT_ICON[e.type], 15, 1.9) }),
          el('span.grow', {}, eventText(e)),
          // Countdowns only stay meaningful up close; further out, the date
          // is what a founder actually wants to read.
          el(`span.activity-time${soon ? '.warn' : ''}`, {},
            !soon ? dateShort(e.date, today)
              : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`)
        );
      }))
      : el('p.muted.small', { style: { padding: '10px 0 4px' } },
        'Nothing due. Vesting cliffs, 83(b) deadlines, note maturities, expirations, and Form 3921 filings show up here as they approach.'),
    more > 0
      ? el('p.small.muted', { style: { marginTop: '8px' } },
        `${more} more ${more === 1 ? 'date' : 'dates'} in the next ${HORIZON_MONTHS} months`)
      : null
  );
}

/* Recent activity feed. */
function activityCard() {
  const entries = store.activity.slice(0, 8);
  return el('div.card', {},
    el('h2.card-title', { style: { marginBottom: '6px' } }, 'Recent activity'),
    entries.length
      ? el('div.activity-list', {}, entries.map((a) => el('div.activity-item', {},
        el('span.activity-ic', { html: icon(a.icon || 'activity', 15, 1.9) }),
        el('span.grow', {}, a.text),
        el('span.activity-time', {}, timeAgo(a.at))
      )))
      : el('p.muted.small', { style: { padding: '6px 0 10px' } },
        'Issue your first security and changes will show up here.')
  );
}
