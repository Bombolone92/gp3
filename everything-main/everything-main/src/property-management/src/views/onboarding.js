/**
 * First sign-in: ask for the company name and offer sample data, so a new
 * account never starts on a blank, confusing screen.
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog } from '../ui/dialog.js';
import { field, textInput, select } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { app } from '../app.js';
import { COLLECTIONS } from '../core/store.js';
import { TEAM_COLORS } from '../core/format.js';

export function maybeOnboard() {
  const store = app.store;
  // Only for a genuinely new account: the backend must have answered and
  // never been written to. An empty store because the first load failed
  // (offline, timeout) must never be mistaken for a new company.
  const check = () => {
    const s = store.state;
    if (!s.synced) return false;
    unsub?.();
    const empty = COLLECTIONS.every((c) => c === 'accounts' || store.all(c).length === 0);
    if (!s.settings.onboarded && empty) openOnboarding();
    return true;
  };
  let unsub = null;
  if (!check()) unsub = store.subscribe(() => check());
}

const PORTFOLIOS = ['My own rentals', 'Rentals I manage for owners', 'Both', 'Commercial properties'];

export function openOnboarding() {
  const store = app.store;
  const name = textInput({ name: 'name', placeholder: 'e.g. Riverside Rentals', autocomplete: 'organization' });
  const owner = textInput({ name: 'owner', value: app.user?.username || '', autocomplete: 'name' });
  const portfolio = select({ name: 'portfolio', value: PORTFOLIOS[0], options: PORTFOLIOS });
  const currency = select({
    name: 'currency',
    value: 'USD',
    options: ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD'].map((c) => ({ value: c, label: c })),
  });
  openDialog({
    title: 'Set up your company',
    body: h(
      'div.stack',
      h('p.muted', 'A few details for receipts, statements and reports. You can change all of this later in Settings.'),
      h('div.form-grid', field('Company name', name, { span2: true }), field('Your name', owner), field('What you manage', portfolio), field('Currency', currency)),
      h('div.notice.accent', icon('sparkles'), h('span', 'Want to look around first? Load a sample portfolio with a year of rent history, then clear it from Settings when you are ready.')),
    ),
    footer: ({ close }) => [
      h(
        'button.btn',
        {
          type: 'button',
          onClick: async () => {
            const { buildSampleData } = await import('../core/sample.js');
            const data = buildSampleData(app.today());
            for (const [coll, recs] of Object.entries(data.collections)) store.bulkPut(coll, recs.map((r) => (coll === 'accounts' ? r : { ...r, sample: true })));
            store.saveSettings({ ...data.settings, sampleData: true, onboarded: true });
            close();
            toast('Sample portfolio loaded. Clear it any time in Settings.');
          },
        },
        'Load sample portfolio',
      ),
      h('div.spacer'),
      h(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            store.saveSettings({ company: { name: name.value.trim() }, currency: currency.value, portfolio: portfolio.value, onboarded: true });
            if (owner.value.trim()) store.put('team', { name: owner.value.trim(), email: '', role: 'Owner', color: TEAM_COLORS[0], active: true });
            close();
            toast('You are all set. Add your first property to get started.', { action: { label: 'Add property', run: () => (location.hash = '#/properties/new') } });
          },
        },
        'Get started',
      ),
    ],
  });
}
