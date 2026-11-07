/** Sign-in screen, error screen, and the first-run company setup. */
import { el, append } from '../ui/dom.js';
import { icon, appMark } from '../ui/icons.js';
import { openDialog } from '../ui/dialog.js';
import { field, textInput, selectInput, checkbox } from '../ui/fields.js';
import { monthName } from '../lib/dates.js';

export function authView({ onSignIn, error = null }) {
  const btn = el('button.btn.btn-primary.auth-cta', { type: 'button' }, 'Sign in');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Signing in';
    try {
      await onSignIn();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
  return el('main.auth', { id: 'main' },
    el('div.auth-card', {},
      el('div.auth-mark', { html: appMark(56) }),
      el('h1.auth-title', {}, 'Accounting'),
      el('p.auth-sub', {}, 'Invoices, bills, banking, reconciliation, and financial reports, in your own Puter cloud.'),
      error ? el('p.field-error', { role: 'alert' }, error) : null,
      btn,
      el('ul.auth-points', {},
        ['Double-entry books that always balance', 'Profit and loss, balance sheet, cash flow, and aging', 'Your data stays in your account'].map((t) => el('li', {}, el('span', { html: icon('check', 16) }), t))),
      el('p.auth-foot', {}, 'Powered by ', el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Puter'))));
}

export function errorView({ title, message, onRetry }) {
  return el('main.auth', { id: 'main' },
    el('div.auth-card', {},
      el('div.empty-icon', { html: icon('offline', 26) }),
      el('h1.auth-title', { style: { fontSize: '22px' } }, title),
      el('p.auth-sub', {}, message),
      el('button.btn.btn-primary.auth-cta', { type: 'button', onclick: onRetry }, 'Try again')));
}

export function bootView(text = 'Opening your books') {
  return el('div.boot', { role: 'status', 'aria-live': 'polite' }, el('div.boot-inner', {}, el('div', { html: appMark(48) }), el('div.boot-bar'), el('span', {}, text)));
}

/** First run: name the company and pick basics. Resolves { name, currency, fiscalStartMonth, dateStyle, sample }. */
export function onboarding({ defaultName = '' } = {}) {
  return new Promise((resolve) => {
    const o = { name: defaultName, currency: 'USD', fiscalStartMonth: 1, dateStyle: 'mdy', sample: false };
    const name = textInput({ value: o.name, autocomplete: 'organization' });
    const nameErr = el('span.field-error', { role: 'alert', hidden: true }, 'Enter a name for your company.');
    name.addEventListener('input', () => { o.name = name.value; nameErr.hidden = true; name.removeAttribute('aria-invalid'); });
    const currency = selectInput({ options: ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'JPY', 'CHF', 'INR', 'SGD', 'ZAR', 'MXN', 'BRL'].map((c) => [c, c]), value: o.currency, onChange: (v) => { o.currency = v; } });
    const fy = selectInput({ options: Array.from({ length: 12 }, (_, i) => [String(i + 1), monthName(i + 1)]), value: '1', onChange: (v) => { o.fiscalStartMonth = +v; } });
    const ds = selectInput({ options: [['mdy', 'MM/DD/YYYY'], ['dmy', 'DD/MM/YYYY'], ['ymd', 'YYYY-MM-DD']], value: o.dateStyle, onChange: (v) => { o.dateStyle = v; } });
    const sample = checkbox({ checked: false, label: 'Start with a sample company to explore', onChange: (v) => { o.sample = v; } });
    let done = false;
    const finish = () => {
      o.name = o.name.trim();
      if (!o.name) {
        nameErr.hidden = false;
        name.setAttribute('aria-invalid', 'true');
        name.focus();
        return;
      }
      done = true;
      dlg.close();
      resolve(o);
    };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(); });
    const dlg = openDialog({
      title: 'Set up your books',
      body: el('div.stack', {},
        el('p', {}, 'A standard chart of accounts is created for you. You can change any of this later in Settings.'),
        append(field('Company name', name, { required: true }), [nameErr]),
        el('div.form-grid', {}, field('Home currency', currency), field('Fiscal year starts in', fy), field('Date format', ds)),
        sample),
      footer: el('div.end', {}, el('button.btn.btn-primary', { type: 'button', onclick: finish }, 'Create my books')),
      initialFocus: name,
      onClose: () => { if (!done) resolve({ ...o, name: o.name.trim() || 'My Company' }); },
    });
  });
}
