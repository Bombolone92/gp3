import { el, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store, contractStats, upcomingRenewals, dueObligations } from '../lib/store.js';
import { renewalInfo, formatDate, needsAttention } from '../lib/dates.js';
import { formatMoney, DOT } from '../lib/util.js';
import { sortedTotals, convertTotals, normalizeCurrency } from '../lib/money.js';
import { openModal } from '../ui/modal.js';
import { contractRow, emptyState, ownerBadge, attentionLine } from '../ui/bits.js';
import { openContractForm } from '../ui/contract-form.js';

const RENEWALS_LINK = { href: '#/renewals', label: 'View all renewals' };
const OBLIGATIONS_LINK = { href: '#/obligations', label: 'View all obligations' };

export function dashboardView() {
  const root = el('div.view');
  const body = el('div');

  function render() {
    clear(body);
    const stats = contractStats(store.contracts);
    const renewals = upcomingRenewals(store.contracts.filter((c) => c.status === 'active'));
    const obligations = dueObligations(store.contracts);

    if (!store.contracts.length) {
      body.append(emptyState({
        icon: 'scroll',
        title: 'No contracts yet',
        sub: 'Add your first agreement to start tracking renewals and obligations.',
        action: el('button.btn.btn-primary', { onclick: () => openContractForm() }, 'Add a contract'),
      }));
      return;
    }

    /* Stat tiles */
    body.append(el('div.stat-grid', {},
      stat('Active contracts', String(stats.active), 'file-text'),
      stat('Renewing in 60 days', String(stats.expiring60), 'calendar-clock',
        { tone: stats.expiring60 > 0 ? 'warn' : null }),
      stat('Open obligations', String(stats.openObligations), 'checklist'),
      valueTile(stats.annualByCurrency)
    ));

    /* Needs attention: renewals with no decision recorded yet */
    const urgent = store.contracts
      .map((c) => ({ contract: c, info: renewalInfo(c) }))
      .filter(({ contract, info }) => needsAttention(contract, info))
      .sort((a, b) => a.info.daysLeft - b.info.daysLeft);
    if (urgent.length) {
      body.append(section('Needs attention', RENEWALS_LINK,
        urgent.slice(0, 4).map(({ contract, info }) =>
          contractRow(contract, info, { sub: attentionLine(contract, info) }))));
    }

    /* Upcoming renewals */
    body.append(section('Upcoming renewals', RENEWALS_LINK,
      renewals.length
        ? renewals.slice(0, 5).map(({ contract, info }) => contractRow(contract, info))
        : el('p.quiet-note', {}, 'Nothing renews in the next 90 days.')));

    /* Obligations due soon */
    body.append(section('Obligations due soon', OBLIGATIONS_LINK,
      obligations.length
        ? obligations.slice(0, 6).map(({ contract, obligation, daysLeft }) =>
          el('a.list-row', { href: `#/contracts/${contract.id}` },
            el(`span.due-dot${daysLeft < 0 ? '.overdue' : ''}`, {
              html: icon(daysLeft < 0 ? 'alert' : 'clock', 16, 2),
            }),
            el('div.grow.min0', {},
              el('div.row-title', {}, obligation.text),
              el('div.row-sub', {}, `${contract.title}${DOT}${daysLeft < 0 ? 'overdue, was due' : 'due'} ${formatDate(obligation.due)}`)
            ),
            ownerBadge(obligation.owner)
          ))
        : el('p.quiet-note', {}, 'No dated obligations in the next 30 days.')));
  }

  /*
   * Three of these four tiles are figures and the fourth opens a breakdown,
   * and nothing on it said so: it sat in the row looking exactly like the
   * numbers beside it, so the only way to the per-currency detail was to
   * guess that this one could be pressed. It carries the chevron every other
   * row in the app uses to say the same thing.
   */
  function stat(label, value, ic, { tone = null, sub = null, onClick = null } = {}) {
    const spec = `${onClick ? 'button' : 'div'}.stat${tone ? `.stat-${tone}` : ''}${onClick ? '.stat-btn' : ''}`;
    return el(spec, onClick ? { type: 'button', onclick: onClick } : {},
      el('div.stat-top', { html: icon(ic, 16, 2) },
        el('span', {}, label),
        onClick && el('span.stat-chev', { html: icon('chevR', 15, 2.2) })),
      el('div.stat-value', {}, value),
      sub && el('div.stat-sub', {}, sub)
    );
  }

  /**
   * Yearly value, one figure per currency. The tile shows the largest and
   * says plainly that there is more — a single summed number across
   * currencies would be wrong, and wrong numbers end up in budgets.
   */
  function valueTile(byCurrency) {
    const totals = sortedTotals(byCurrency);
    const reporting = normalizeCurrency(store.settings.reportingCurrency, '');
    const converted = reporting
      ? convertTotals(byCurrency, reporting, store.settings.rates)
      : { total: null, missing: [] };

    const headline = totals.length
      ? formatMoney(totals[0].amount, totals[0].currency)
      : formatMoney(0, store.settings.currency);

    let sub = null;
    if (totals.length > 1) {
      if (converted.total !== null) {
        sub = `≈ ${formatMoney(converted.total, reporting)} in total`;
      } else {
        const second = formatMoney(totals[1].amount, totals[1].currency);
        sub = totals.length === 2
          ? `+ ${second}`
          : `+ ${second} and ${totals.length - 2} more`;
      }
    }

    return stat('Value per year', headline, 'money', {
      sub,
      onClick: totals.length > 1 ? () => openTotalsBreakdown(totals, reporting, converted) : null,
    });
  }

  function openTotalsBreakdown(totals, reporting, converted) {
    const rates = store.settings.rates || {};
    const content = el('div', {},
      el('p.modal-note', {}, 'Each currency is totalled on its own. Nothing is converted unless you have entered a rate for it.'),
      el('div.list', {}, totals.map(({ currency, amount }) =>
        el('div.list-row', {},
          el('span.badge.badge-muted', {}, currency),
          el('div.grow.min0', {}, el('div.row-title', {}, `${formatMoney(amount, currency)} per year`)),
          currency !== reporting && rates[currency]?.rate
            ? el('span.row-sub', {}, `1 ${currency} = ${rates[currency].rate} ${reporting}`)
            : null
        ))),
      reporting && converted.total !== null
        ? el('div.callout.callout-ok', { style: { marginTop: '16px' } },
          el('span', { html: icon('money', 18, 2) }),
          el('div', {},
            el('strong', {}, `≈ ${formatMoney(converted.total, reporting)} per year`),
            el('div.callout-sub', {}, ratesProvenance(totals, reporting, rates))
          ))
        : null,
      reporting && converted.missing.length
        ? el('p.quiet-note', { style: { marginTop: '12px' } },
          `No rate yet for ${converted.missing.join(', ')}, so there is no single total to show.`)
        : null,
      !reporting
        ? el('p.quiet-note', { style: { marginTop: '12px' } },
          'Want one comparable figure? Set a reporting currency and your own rates in Settings.')
        : null,
      el('a.btn.btn-ghost.btn-block', {
        href: '#/settings', style: { marginTop: '12px' },
        onclick: () => modal.close(),
      }, reporting ? 'Update rates in Settings' : 'Set up conversion in Settings')
    );
    const modal = openModal({ title: 'Yearly value by currency', content });
  }

  /** "Your rates, entered 6 Aug 2026" — with the oldest date, which is the honest one. */
  function ratesProvenance(totals, reporting, rates) {
    const dates = totals
      .filter(({ currency }) => currency !== reporting)
      .map(({ currency }) => rates[currency]?.at)
      .filter(Boolean)
      .sort();
    if (!dates.length) return 'Using the rates you entered.';
    const oldest = formatDate(dates[0]);
    return dates.length === 1 || dates[0] === dates[dates.length - 1]
      ? `Using your rates, entered ${oldest}.`
      : `Using your rates, oldest entered ${oldest}.`;
  }

  /*
   * The link carries the name of the page it goes to. On screen the heading
   * beside it says which list "View all" belongs to, but a screen reader
   * reading the links on their own got "View all" three times over, with
   * nothing to tell one from another.
   */
  function section(title, { href, label }, children) {
    return el('section.card', {},
      el('div.card-head', {},
        el('h2.card-title', {}, title),
        href && el('a.card-more', { href, 'aria-label': label }, 'View all')
      ),
      el('div.list', {}, children)
    );
  }

  root.append(
    el('div.page-head', {},
      el('div', {},
        el('h1.page-title', {}, 'Overview'),
        el('p.page-sub', {}, 'Where your agreements stand today')
      ),
      el('button.btn.btn-primary.head-add', {
        html: icon('plus', 16, 2.2),
        onclick: () => openContractForm(),
      }, ' New contract')
    ),
    body
  );

  render();
  store.addEventListener('change', render);
  root.destroy = () => store.removeEventListener('change', render);
  return root;
}
