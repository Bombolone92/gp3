/**
 * The vesting forecast card, shared by the dashboard (company-wide) and the
 * holder page (that holder's own awards, and the statement it prints as).
 *
 * `vestedQuantity` answers one date and the coming-up list answers the next
 * twelve months; this is the curve between them - how much vests in each of
 * the next two years, and how the vested share of what is on a schedule grows.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { segmented } from './bits.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { vestingForecast, FORECAST_MONTHS } from '../lib/captable.js';
import { shares, pct, monthLabel } from '../lib/format.js';
import { toCSV, downloadFile, todayISO } from '../lib/util.js';
import { monthlyVestingChart, cumulativeVestingChart } from '../charts/vesting.js';

/* Module scope, so the choice survives the store-driven re-renders that
   rebuild the whole view - the same way the ownership card's toggle does. */
let mode = 'monthly';

/**
 * `securities` is whatever slice the caller is forecasting: the company's
 * whole array, or one holder's. `scope` names it in the file and the copy.
 */
export function vestingForecastCard({ securities, scope = 'company', months = FORECAST_MONTHS } = {}) {
  const from = todayISO();
  const forecast = vestingForecast(securities, { from, months });

  if (!forecast.granted) {
    return el('div.card', {},
      el('h2.card-title', {}, 'Vesting forecast'),
      el('p.card-sub', {}, scope === 'company'
        ? 'Nothing here vests. Founder restricted stock, option grants, and RSU awards with a schedule show their curve here.'
        : 'Nothing this holder holds is still vesting.'));
  }

  const chartWrap = el('div');
  const caption = el('p.small.muted', { style: { marginTop: '10px' } });

  const renderChart = () => {
    chartWrap.replaceChildren(mode === 'monthly'
      ? monthlyVestingChart(forecast)
      : cumulativeVestingChart(forecast));
    const { peak, vestingTotal, granted, vestedNow, rows } = forecast;
    const last = rows[rows.length - 1];
    /* A peak is one month above the rest. The standard grant vests the same
       count every month past its cliff, and the caption named the first of
       twenty-four equal months as the peak - so a level schedule reads as
       level, and one with several equal highs names the figure alone. */
    const highs = peak && peak.vesting > 0 ? rows.filter((r) => r.vesting === peak.vesting).length : 0;
    const shape = !highs ? ''
      : highs === rows.length ? `, ${shares(peak.vesting)} a month`
        : highs > 1 ? `, up to ${shares(peak.vesting)} a month`
          : `, peaking at ${shares(peak.vesting)} in ${monthLabel(peak.month)}`;
    caption.textContent = mode === 'monthly'
      ? `${shares(vestingTotal)} vests over the next ${rows.length} months${shape}`
      : `${shares(vestedNow)} of ${shares(granted)} vested today (${pct(vestedNow / granted, 0)}); `
        + `${shares(last.vested)} by ${monthLabel(last.month)} (${pct(last.vested / granted, 0)})`;
  };

  const seg = segmented([
    { value: 'monthly', label: 'Per month' },
    { value: 'cumulative', label: 'Cumulative' },
  ], {
    label: 'Vesting forecast view', value: mode,
    onSelect: (value) => { mode = value; renderChart(); },
  });
  renderChart();

  function exportCSV() {
    const label = scope === 'company' ? (store.company.name || 'company') : scope;
    const slug = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'forecast';
    const rows = [
      [`${label} - vesting forecast from ${from}, ${forecast.rows.length} months`],
      [],
      ['Month', 'Vesting in month', 'Cumulative vested', 'Still unvested', 'On a vesting schedule'],
      ...forecast.rows.map((r) => [r.month, r.vesting, r.vested, r.unvested, forecast.granted]),
    ];
    downloadFile(`vesting-forecast-${slug}-${from}.csv`, toCSV(rows), 'text/csv');
    toast('Vesting forecast exported');
  }

  return el('div.card', {},
    el('div.card-head', {},
      el('div', {},
        el('h2.card-title', {}, 'Vesting forecast'),
        el('p.card-sub', {}, scope === 'company'
          ? `Shares vesting month by month over the next ${forecast.rows.length} months`
          : `What is still being earned over the next ${forecast.rows.length} months`)),
      el('div.no-print', {}, seg)),
    chartWrap,
    caption,
    el('div.row.row-end.no-print', { style: { marginTop: '10px' } },
      el('button.btn.btn-ghost', {
        html: icon('file-down', 15, 2), onclick: exportCSV,
      }, ' Export schedule')));
}
