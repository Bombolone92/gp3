/**
 * First run for a new firm: name the firm, add yourself as the first firm
 * user, and get a trust and an operating account set up. Never shown in the
 * demo or to members of someone else's firm.
 */
import '../styles/settings.css';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { openDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { navigate } from '../ui/router.js';
import { field, textInput, select, moneyInput } from '../ui/components.js';
import { USER_ROLES } from '../core/settings.js';
import { PALETTE } from '../core/format.js';
import { isFirmEmpty } from '../core/settings-backup.js';
import { CURRENCIES } from './settings-currencies.js';

function needsOnboarding() {
  const s = app.store.state;
  return !app.demo && (!app.team || app.team.role === 'owner') && s.synced && !s.settings.onboarded && !app.store.all('users').length;
}

export function maybeOnboard() {
  if (app.demo || (app.team && app.team.role !== 'owner')) return;
  if (app.store.state.synced) {
    if (needsOnboarding()) open();
    return;
  }
  // Wait for the first full load so an existing firm is never mistaken for a new one.
  const off = app.store.subscribe(() => {
    if (!app.store.state.synced) return;
    off();
    if (needsOnboarding()) open();
  });
}

/** Create the first user and default accounts, and mark the firm set up. */
export function setUpFirm({ firmName, currency, name, role, rateCents }) {
  const store = app.store;
  const username = app.user?.username || '';
  store.put('users', {
    name: name || username || 'Me',
    email: '',
    role: role || 'lawyer',
    rateCents: Number(rateCents) || 0,
    targetHours: role === 'lawyer' ? 120 : 0,
    color: PALETTE[0],
    puterUsername: username,
    active: true,
  });
  if (!store.all('accounts').some((a) => a.type === 'trust'))
    store.put('accounts', { name: 'Client trust account', type: 'trust', institution: '', last4: '', openingBalanceCents: 0, isDefault: true });
  if (!store.all('accounts').some((a) => a.type === 'operating'))
    store.put('accounts', { name: 'Operating account', type: 'operating', institution: '', last4: '', openingBalanceCents: 0, isDefault: true });
  store.saveSettings({ firm: { name: firmName || '' }, currency: currency || store.state.settings.currency, onboarded: true });
}

function open() {
  let step = 1;
  let finished = false;
  const firm = textInput({ name: 'firm', value: '', placeholder: 'For example, Rivera Law Group', autocomplete: 'organization' });
  const currency = select({ name: 'currency', value: app.settings().currency || 'USD', options: CURRENCIES.map(([c, n]) => ({ value: c, label: `${c}, ${n}` })) });
  const name = textInput({ name: 'name', value: '', placeholder: 'Your full name', autocomplete: 'name' });
  const role = select({ name: 'role', value: 'lawyer', options: USER_ROLES.map((r) => ({ value: r.id, label: r.label })) });
  const rate = moneyInput({ name: 'rate', cents: 25000 });
  const progress = h('div.onboard-steps', { 'aria-hidden': 'true' }, h('span.on'), h('span'));
  const stepLabel = h('p.subtle.small', { role: 'status', 'aria-live': 'polite' });
  const body = h('div.stack');
  const backBtn = h('button.btn', { type: 'button', onClick: () => go(1) }, 'Back');
  const nextBtn = h('button.btn.primary', { type: 'button', onClick: () => next() });
  const sampleBtn = h('button.btn.ghost', { type: 'button', onClick: () => loadSample() }, icon('database', 16), 'Explore with sample data');

  function go(n) {
    step = n;
    progress.children[1].classList.toggle('on', step === 2);
    stepLabel.textContent = `Step ${step} of 2`;
    backBtn.hidden = step === 1;
    sampleBtn.hidden = step !== 1;
    nextBtn.textContent = step === 1 ? 'Continue' : 'Finish setup';
    if (step === 1) {
      body.replaceChildren(
        h(
          'div.onboard-hero',
          h('img', { src: './icons/icon.svg', alt: '' }),
          h('div', h('h3', 'Welcome. Let’s set up your firm.'), h('p.subtle', 'This takes a minute. You can change everything later in Settings.')),
        ),
        field('Firm name', firm, { required: true }),
        field('Currency', currency, { hint: 'Used for rates, bills, and trust funds.' }),
      );
      firm.focus();
    } else {
      body.replaceChildren(
        h('p', 'Now add yourself. You are the first firm user; colleagues can be added later.'),
        field('Your name', name, { required: true }),
        h('div.grid-2', field('Role', role), field('Your hourly rate', rate)),
      );
      name.focus();
    }
  }

  function next() {
    if (step === 1) {
      if (!firm.value.trim()) {
        firm.setAttribute('aria-invalid', 'true');
        firm.focus();
        return;
      }
      firm.removeAttribute('aria-invalid');
      go(2);
      return;
    }
    if (!name.value.trim()) {
      name.setAttribute('aria-invalid', 'true');
      name.focus();
      return;
    }
    setUpFirm({ firmName: firm.value.trim(), currency: currency.value, name: name.value.trim(), role: role.value, rateCents: rate.cents });
    finished = true;
    api.close();
    toast(`${firm.value.trim()} is ready. Create your first matter to get started.`, { action: { label: 'New matter', run: () => navigate('/matters/new') } });
  }

  async function loadSample() {
    if (!isFirmEmpty((c) => app.store.all(c))) return;
    const { buildSampleData } = await import('../core/sample.js');
    const sample = buildSampleData(app.today());
    for (const [c, recs] of Object.entries(sample.collections)) app.store.bulkPut(c, recs);
    app.store.saveSettings({ ...sample.settings, onboarded: true });
    finished = true;
    api.close();
    toast('Sample firm loaded. Delete it any time from Settings, Data and backup.');
    navigate('/');
  }

  const api = openDialog({
    title: 'Set up your firm',
    body: h('div.stack', progress, stepLabel, body),
    footer: () => [sampleBtn, h('div.spacer'), backBtn, nextBtn],
    onClose: () => {
      if (finished) return;
      // Skipping still leaves the firm usable: you become its first user.
      setUpFirm({ firmName: firm.value.trim(), currency: currency.value, name: name.value.trim(), role: role.value, rateCents: rate.cents });
      toast('Setup skipped. You can finish it any time in Settings.', { type: 'info' });
    },
  });
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      next();
    }
  });
  go(1);
}
