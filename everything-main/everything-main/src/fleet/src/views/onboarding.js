/**
 * First run for a new fleet: name, units, and currency, with the option to
 * start from the sample fleet. Shown once, only when the account is empty.
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog } from '../ui/dialog.js';
import { app } from '../app.js';
import { CURRENCIES } from '../core/settings.js';
import { toast } from '../ui/toast.js';
import { loadSampleData } from './sample-data.js';

export async function maybeOnboard() {
  const store = app.store;
  // Wait for the first complete load so an empty store means "new".
  for (let i = 0; i < 60 && !store.state.synced; i++) await new Promise((r) => setTimeout(r, 250));
  if (!store.state.synced || store.state.settings.onboarded) return;
  if (store.all('vehicles').length) {
    store.saveSettings({ onboarded: true });
    return;
  }
  const s = store.state.settings;
  const name = h('input.input', { type: 'text', value: s.company.name || '', placeholder: 'e.g. Riverside Logistics', autocomplete: 'organization', id: 'ob-name' });
  const distance = h('select.select', { id: 'ob-dist' }, h('option', { value: 'mi' }, 'Miles'), h('option', { value: 'km' }, 'Kilometers'));
  const volume = h('select.select', { id: 'ob-vol' }, h('option', { value: 'gal' }, 'Gallons (US)'), h('option', { value: 'L' }, 'Liters'));
  const currency = h('select.select', { id: 'ob-cur' }, CURRENCIES.map((c) => h('option', { value: c }, c)));
  const region = (() => {
    try {
      return new Intl.Locale(navigator.language).maximize().region;
    } catch {
      return 'US';
    }
  })();
  // The UK drives in miles but buys fuel in liters.
  const miles = ['US', 'LR', 'MM', 'GB'].includes(region);
  const gallons = ['US', 'LR', 'MM'].includes(region);
  // Settings always hold units (US by default), so suggest the locale's
  // unless the fleet already chose something else.
  distance.value = s.units?.distance && s.units.distance !== 'mi' ? s.units.distance : miles ? 'mi' : 'km';
  volume.value = s.units?.volume && s.units.volume !== 'gal' ? s.units.volume : gallons ? 'gal' : 'L';
  currency.value = s.currency || 'USD';

  const finish = (sample) => {
    store.saveSettings({ company: { name: name.value.trim() }, units: { distance: distance.value, volume: volume.value }, currency: currency.value, onboarded: true });
    if (sample) {
      loadSampleData();
      toast('Sample fleet loaded. You can remove it from Settings at any time.');
    }
  };

  openDialog({
    title: 'Set up your fleet',
    body: h(
      'div.stack',
      h('p.muted', 'A few basics so numbers show in your units. You can change these later in Settings.'),
      h('div.field', h('label', { for: 'ob-name' }, 'Fleet or company name'), name),
      h('div.form-grid.three', h('div.field', h('label', { for: 'ob-dist' }, 'Distance'), distance), h('div.field', h('label', { for: 'ob-vol' }, 'Fuel volume'), volume), h('div.field', h('label', { for: 'ob-cur' }, 'Currency'), currency)),
    ),
    footer: ({ close }) => [
      h('button.btn', { type: 'button', onClick: () => (finish(true), close()) }, icon('sparkles', 16), 'Start with sample data'),
      h('div.spacer'),
      h('button.btn.primary', { type: 'button', onClick: () => (finish(false), close()) }, 'Continue'),
    ],
    onClose: () => {
      if (!store.state.settings.onboarded) store.saveSettings({ onboarded: true });
    },
  });
}
