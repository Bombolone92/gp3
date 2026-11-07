import '../../src/styles/index.css';
import { store, Store } from '../../src/lib/store.js';
import { dashboardView } from '../../src/views/dashboard.js';
import { roundsView } from '../../src/views/rounds.js';
import { exitView } from '../../src/views/exit.js';
import { hiringPlanCard } from '../../src/ui/hiringplan.js';
import { marketingData } from './sample-data.js';

const data = marketingData();
Object.assign(store, data, {
  company: Store.sanitizeCompany(data.company),
  settings: { theme: 'light', sampleData: true, onboarded: true },
});
const q = new URLSearchParams(location.search);
const feature = q.get('feature');
const format = q.get('format');
const detail = document.querySelector('#detail');
// Only the stage resets are custom. Every element inside #detail is an
// unmodified node returned by an actual application view, using its own CSS.
document.body.style.cssText = 'height:auto;background:#fdfdfd;overflow:hidden';
document.documentElement.style.height = 'auto';

if (feature === 'ownership') {
  const view = dashboardView({ navigate() {} });
  const chart = view.querySelector('.own-bar').parentElement;
  if (format === 'tablet') {
    [...chart.querySelector('.own-legend').children].slice(3).forEach(row => row.remove());
  }
  detail.append(chart);
} else if (feature === 'fundraising') {
  // The real cards provide space around endpoint dots. Keep that room in
  // this magnified excerpt so a 0% or 100% endpoint is captured in full.
  detail.style.paddingInline = '6px';
  history.replaceState(null, '', `${location.pathname}${location.search}#/rounds?scenario=series-a`);
  const view = roundsView();
  const legend = view.querySelector('.dilution-legend');
  const rows = [...view.querySelectorAll('.dilution-row')];
  // Desktop/tablet focus on founders; mobile also includes the investors.
  const mobileRows = rows.filter(row => ['Ada Chen', 'Grace Okafor', 'Nova Ventures', 'Beacon Angels', 'New investors'].includes(row.querySelector('.name').textContent));
  detail.append(legend, ...(format === 'mobile' ? mobileRows : rows.slice(0, 2)));
} else if (feature === 'hiring') {
  const card = hiringPlanCard();
  const chart = card.querySelector('.month-chart');
  const summary = chart.nextElementSibling;
  detail.append(chart);
  if (format !== 'tablet') detail.append(summary);
} else if (feature === 'exit') {
  history.replaceState(null, '', `${location.pathname}${location.search}#/exit?scenario=acquisition`);
  const view = exitView();
  const chart = view.querySelector('.own-bar').parentElement;
  // Keep the complete chart on desktop/mobile; tablet shows a close-up of
  // the four leading holder rows. No text is trimmed or values rewritten.
  if (format === 'tablet') {
    const legend = chart.querySelector('.own-legend');
    detail.append(...[...legend.children].slice(0, 4));
  } else detail.append(chart);
}
await document.fonts.ready;
window.assetReady = true;
