/**
 * First-run onboarding: one decision — add a contract, load sample data, or
 * skip. Gated on an empty dataset; closing at any point marks onboarding
 * done so it never nags.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { sampleDataset } from '../lib/sample.js';
import { openContractForm } from './contract-form.js';

export function shouldOnboard(store) {
  return !store.settings.onboarded && !store.settings.sampleData
    && store.contracts.length === 0 && store.contacts.length === 0;
}

export function openOnboarding() {
  const markDone = () => {
    if (!store.settings.onboarded) {
      store.updateSettings({ onboarded: true }).catch(() => {});
    }
  };

  const sampleBtn = el('button.btn.btn-ghost.btn-block.btn-dashed', {
    type: 'button', html: icon('sparkle', 15, 2),
    onclick: async () => {
      sampleBtn.disabled = true;
      try {
        await store.importAll(sampleDataset(store));
      } catch (err) {
        console.error(err);
        toast('Could not load the sample data. Check your connection', { icon: 'wifiOff' });
        sampleBtn.disabled = false;
        return;
      }
      modal.close();
      toast('Sample data loaded. Wipe it anytime from the banner', { icon: 'sparkle' });
    },
  }, ' Explore with sample data');

  const body = el('div', {},
    el('div.empty.onboard-hero', {},
      el('img.onboard-logo', { src: './icon-128.png', width: 72, height: 72, alt: '' }),
      el('h3', {}, 'Every agreement, one calm place'),
      el('p', {}, 'Store contracts, get ahead of renewal deadlines, track who owes what to whom, and keep documents next to the people behind them. Everything lives in your own Puter cloud.')
    ),
    el('ul.onboard-points', {},
      point('calendar-clock', 'Renewal and notice-period tracking that warns you before deadlines'),
      point('checklist', 'Obligations extracted from contract text by AI, reviewed by you'),
      point('users', 'Contacts connected to every agreement and document')
    ),
    el('button.btn.btn-primary.btn-block', {
      type: 'button', style: { padding: '13px' },
      onclick: () => {
        markDone();
        modal.close();
        openContractForm();
      },
    }, 'Add my first contract'),
    sampleBtn,
    el('button.btn.btn-ghost.btn-block', {
      type: 'button', style: { marginTop: '10px' },
      onclick: () => { markDone(); modal.close(); },
    }, 'Skip for now')
  );

  const modal = openModal({ title: 'Welcome', content: body, onClose: markDone });

  function point(ic, text) {
    return el('li', { html: icon(ic, 18, 1.8) }, el('span', {}, text));
  }
}
