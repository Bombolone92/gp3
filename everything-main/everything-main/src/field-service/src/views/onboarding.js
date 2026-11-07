/**
 * First sign-in: ask for the business name and offer sample data, so a new
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
  // (offline, timeout) must never be mistaken for a new business.
  const check = () => {
    const s = store.state;
    if (!s.synced) return false;
    unsub?.();
    if (s.remoteEmpty && !s.settings.onboarded && COLLECTIONS.every((c) => store.all(c).length === 0)) openOnboarding();
    return true;
  };
  let unsub = null;
  if (!check()) unsub = store.subscribe(() => check());
}

const INDUSTRIES = ['Lawn care and landscaping', 'Cleaning', 'HVAC', 'Plumbing', 'Electrical', 'Handyman', 'Painting', 'Pest control', 'Pool and spa', 'Window cleaning', 'Snow removal', 'Other'];

export function openOnboarding() {
  const store = app.store;
  const name = textInput({ name: 'name', placeholder: 'e.g. Riverside Home Services', autocomplete: 'organization' });
  const owner = textInput({ name: 'owner', value: app.user?.username || '', autocomplete: 'name' });
  const industry = select({ name: 'industry', value: INDUSTRIES[0], options: INDUSTRIES });
  const currency = select({
    name: 'currency',
    value: 'USD',
    options: ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD'].map((c) => ({ value: c, label: c })),
  });
  openDialog({
    title: 'Set up your business',
    body: h(
      'div.stack',
      h('p.muted', 'A few details so quotes and invoices look right. You can change all of this later in Settings.'),
      h(
        'div.form-grid',
        field('Business name', name, { span2: true }),
        field('Your name', owner),
        field('Industry', industry),
        field('Currency', currency),
      ),
      h(
        'div.notice.accent',
        icon('sparkles'),
        h('span', 'Want to look around first? Load sample data to see a busy week, then clear it from Settings when you are ready.'),
      ),
    ),
    footer: ({ close }) => [
      h(
        'button.btn',
        {
          type: 'button',
          onClick: async (e) => {
            const btn = e.currentTarget;
            // Loading the sample data takes a moment; a second click must not add it twice.
            if (btn.disabled) return;
            btn.disabled = true;
            let buildSampleData;
            try {
              ({ buildSampleData } = await import('../core/sample.js'));
            } catch {
              btn.disabled = false;
              toast('Sample data could not be loaded. Check your connection and try again.', { type: 'error' });
              return;
            }
            const data = buildSampleData(app.today());
            for (const [coll, recs] of Object.entries(data.collections)) store.bulkPut(coll, recs.map((r) => ({ ...r, sample: true })));
            store.saveSettings({ ...data.settings, sampleData: true, onboarded: true });
            close();
            toast('Sample data loaded. Clear it any time in Settings.');
          },
        },
        'Load sample data',
      ),
      h('div.spacer'),
      h(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            store.saveSettings({
              company: { name: name.value.trim() },
              currency: currency.value,
              industry: industry.value,
              onboarded: true,
            });
            if (owner.value.trim()) {
              store.put('team', { name: owner.value.trim(), email: '', role: 'owner', color: TEAM_COLORS[0], laborRate: 0, active: true });
            }
            close();
            toast('You are all set. Add your first client to get started.');
          },
        },
        'Get started',
      ),
    ],
  });
}
