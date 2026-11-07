import { el, clear, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store, annualByCurrency, TRASH_DAYS } from '../lib/store.js';
import { openTrash } from '../ui/trash.js';
import { openCsvImport, openRestore } from '../ui/import.js';
import { calendarFeedSection, downloadBookCalendar } from '../ui/calendar-settings.js';
import { applyTheme, currentTheme } from '../ui/theme.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { downloadBlob, formatMoney } from '../lib/util.js';
import { todayISO, formatDate } from '../lib/dates.js';
import { COMMON_CURRENCIES, normalizeCurrency, isCurrencyCode, sortedTotals, convertTotals } from '../lib/money.js';
import { sampleDataset, wipeSampleData } from '../lib/sample.js';
import { openOnboarding } from '../ui/onboarding.js';
import { avatar, field, textInput } from '../ui/bits.js';

/** Confirm-and-sign-out, shared by Settings and the sidebar user block. */
export async function confirmSignOut() {
  const ok = await confirmDialog({
    title: 'Sign out?',
    message: 'Your data stays safe in your Puter account.',
    confirmLabel: 'Sign out',
    danger: false,
  });
  if (!ok) return;
  puter.auth.signOut();
  location.reload();
}

export function settingsView() {
  const root = el('div.view');
  // Inside a Puter app the platform owns the session — no sign-out.
  const isApp = typeof puter !== 'undefined' && puter.env === 'app';

  root.append(
    el('div.page-head', {},
      el('div', {},
        el('h1.page-title', {}, 'Settings'),
        el('p.page-sub', {}, 'Account, appearance, and your data')
      )
    )
  );

  /* --- Account --- */
  const username = store.user?.username || 'Puter user';
  root.append(group('Account',
    el('div.user-chip', {},
      avatar(username),
      // min0, like every other row in the app: without it the name and the
      // line under it hold their full width, and the Sign out button beside
      // them is pushed out through the side of the card on a phone.
      el('div.grow.min0', {},
        el('div.row-title', {}, username),
        // A sentence, and the only place it is said: on a phone the one-line
        // cut left "Synced with …" beside the Sign out button.
        el('div.row-sub.wrap', {}, 'Synced with your Puter cloud')
      ),
      !isApp && el('button.btn.btn-ghost', { onclick: confirmSignOut }, 'Sign out')
    )
  ));

  /* --- Appearance --- */
  const themeSeg = el('div.segmented', { role: 'group', 'aria-label': 'Theme' });
  function renderTheme() {
    // Rebuilding drops focus; put keyboard users back on the active button.
    const hadFocus = themeSeg.contains(document.activeElement);
    clear(themeSeg);
    for (const [value, label, ic] of [['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['system', 'System', 'monitor']]) {
      themeSeg.append(el('button', {
        type: 'button',
        className: currentTheme() === value ? 'active' : '',
        'aria-pressed': String(currentTheme() === value),
        html: icon(ic, 15, 2),
        onclick: () => {
          const previous = currentTheme();
          applyTheme(value);
          renderTheme();
          // The store rolls the setting back on failure; put the visual
          // theme back too, or it silently reverts on the next boot.
          store.updateSettings({ theme: value }).catch(() => {
            applyTheme(previous);
            renderTheme();
            toast('Could not save. Check your connection', { icon: 'wifiOff' });
          });
        },
      }, ` ${label}`));
    }
    if (hadFocus) themeSeg.querySelector('button.active')?.focus();
  }
  renderTheme();
  root.append(group('Appearance', themeSeg));

  /* --- Defaults --- */
  const currencyList = el('datalist', { id: 'st-currency-codes' },
    COMMON_CURRENCIES.map((c) => el('option', { value: c })));
  const currencyInput = textInput({
    value: store.settings.currency, maxLength: 3, className: 'input code-input',
    autocomplete: 'off', spellcheck: false, list: 'st-currency-codes',
  });
  const noticeInput = textInput({
    value: store.settings.noticeDefault, type: 'number', min: '0', max: '365', inputmode: 'numeric',
  });
  const saveDefaults = async () => {
    const code = currencyInput.value.trim();
    // The same rule the reporting currency below already enforces. Without it
    // "12" saved happily, was then ignored by every contract (which normalize
    // back to USD) and printed raw on the dashboard as "12 0".
    if (code && !isCurrencyCode(code)) {
      toast('Use a three-letter currency code, e.g. USD', { icon: 'info' });
      currencyInput.focus();
      return;
    }
    const currency = normalizeCurrency(code);
    currencyInput.value = currency;
    const noticeDefault = Math.max(0, Math.min(365, Number(noticeInput.value) || 0));
    try {
      await store.updateSettings({ currency, noticeDefault });
      toast('Defaults saved');
    } catch {
      toast('Could not save. Check your connection', { icon: 'wifiOff' });
    }
  };
  root.append(group('Defaults',
    el('div.field-row', {},
      field('Currency code', currencyInput, { grow: true, hint: 'Prefilled on new contracts; existing ones keep theirs.' }),
      field('Notice period (days)', noticeInput, { grow: true, hint: 'Prefilled on new contracts.' })
    ),
    currencyList,
    el('button.btn.btn-primary', { onclick: saveDefaults }, 'Save defaults')
  ));

  /* --- Mixed-currency totals ---
     Totals stay per-currency by default. A single comparable figure is opt-in
     and built from rates the user types in, so no third party is involved and
     the number is never presented as more authoritative than its source. */
  const ratesWrap = el('div');
  const rateInputs = new Map();
  let reporting = normalizeCurrency(store.settings.reportingCurrency, '');

  const reportingInput = textInput({
    value: reporting, maxLength: 3, placeholder: 'e.g. USD',
    className: 'input code-input', autocomplete: 'off', spellcheck: false,
    list: 'st-currency-codes',
  });
  reportingInput.addEventListener('input', () => {
    const next = normalizeCurrency(reportingInput.value, '');
    if (next === reporting) return;
    reporting = next;
    renderRates();
  });

  /** Currencies actually in the book, so nobody types rates they don't need. */
  function currenciesInUse() {
    return sortedTotals(annualByCurrency(store.contracts)).map((t) => t.currency);
  }

  function renderRates() {
    clear(ratesWrap);
    rateInputs.clear();
    if (!reporting) {
      ratesWrap.append(el('p.quiet-note', {},
        'No reporting currency: each currency is totalled separately, which is always exact.'));
      return;
    }
    // Rates are expressed in the reporting currency, so switching it makes the
    // saved ones meaningless — start blank rather than silently reusing them.
    const saved = reporting === normalizeCurrency(store.settings.reportingCurrency, '')
      ? (store.settings.rates || {}) : {};
    const others = currenciesInUse().filter((c) => c !== reporting);
    if (!others.length) {
      ratesWrap.append(el('p.quiet-note', {},
        `Every priced contract is already in ${reporting}, so no rates are needed.`));
      return;
    }
    const preview = el('p.field-hint', { style: { marginTop: '10px' } });
    const updatePreview = () => {
      const { total } = convertTotals(annualByCurrency(store.contracts), reporting, ratesFromInputs(saved));
      preview.textContent = total !== null
        ? `Shows as ≈ ${formatMoney(total, reporting)} per year on the dashboard.`
        : 'Fill in every rate to get a single total on the dashboard.';
    };
    for (const code of others) {
      const input = textInput({
        value: saved[code]?.rate ?? '', type: 'number', min: '0', step: 'any',
        inputmode: 'decimal', placeholder: '0.00', 'aria-label': `Rate: 1 ${code} in ${reporting}`,
        oninput: () => updatePreview(),
      });
      rateInputs.set(code, input);
      ratesWrap.append(el('div.rate-row', {},
        el('span.rate-label', {}, `1 ${code} =`),
        input,
        el('span.rate-label', {}, reporting),
        saved[code]?.at
          ? el('span.rate-at', {}, `entered ${formatDate(saved[code].at)}`)
          : null
      ));
    }
    updatePreview();
    ratesWrap.append(preview);
  }

  function ratesFromInputs(saved = store.settings.rates || {}) {
    const out = {};
    for (const [code, input] of rateInputs) {
      const rate = Number(input.value);
      if (!Number.isFinite(rate) || rate <= 0) continue;
      // Keep the original date when the number hasn't changed: re-saving the
      // page shouldn't make a six-month-old rate look fresh.
      const at = Number(saved[code]?.rate) === rate && saved[code]?.at
        ? saved[code].at : todayISO();
      out[code] = { rate, at };
    }
    return out;
  }

  const saveRates = async () => {
    const code = reportingInput.value.trim();
    if (code && !isCurrencyCode(code)) {
      toast('Use a three-letter currency code, e.g. USD', { icon: 'info' });
      reportingInput.focus();
      return;
    }
    const next = normalizeCurrency(code, '');
    const saved = next === normalizeCurrency(store.settings.reportingCurrency, '')
      ? (store.settings.rates || {}) : {};
    try {
      await store.updateSettings({
        reportingCurrency: next || null,
        rates: next ? { ...saved, ...ratesFromInputs(saved) } : {},
      });
      renderRates();
      toast(next ? 'Conversion saved' : 'Conversion turned off');
    } catch {
      toast('Could not save. Check your connection', { icon: 'wifiOff' });
    }
  };

  renderRates();

  /*
   * Everything above was drawn from settings once. A restore replaces settings
   * wholesale — and Settings is the page it happens from — so the inputs went
   * on showing the values the backup had just replaced, and "Save defaults"
   * would have written them straight back over it. Loading the sample book has
   * the same problem one step removed: it brings in a second currency the rate
   * list had already decided nobody needed.
   *
   * Re-read only when what is stored actually differs from what is on screen,
   * so an unrelated save — a theme switch, an emptied trash — never clears a
   * rate somebody is halfway through typing.
   */
  const storedSnapshot = () => JSON.stringify([
    store.settings.currency,
    store.settings.noticeDefault,
    normalizeCurrency(store.settings.reportingCurrency, ''),
    store.settings.rates || {},
    currenciesInUse(),
  ]);
  let shownSnapshot = storedSnapshot();

  function syncStoredSettings() {
    const next = storedSnapshot();
    if (next === shownSnapshot) return;
    shownSnapshot = next;
    currencyInput.value = store.settings.currency;
    noticeInput.value = store.settings.noticeDefault;
    reporting = normalizeCurrency(store.settings.reportingCurrency, '');
    reportingInput.value = reporting;
    renderRates();
  }

  root.append(group('Totals across currencies',
    el('p.about-text', { style: { marginBottom: '14px' } },
      'Contracts are always totalled per currency. If you also want one comparable figure, name a reporting currency and enter the rates you want used. They are yours, kept as typed, and shown with the date you entered them.'),
    field('Reporting currency', reportingInput, { hint: 'Leave empty to keep every currency separate.' }),
    ratesWrap,
    el('button.btn.btn-primary', { style: { marginTop: '14px' }, onclick: saveRates }, 'Save conversion')
  ));

  /* --- Calendar ---
     The one channel that reaches the user when the app is closed. */
  const feedSection = calendarFeedSection();
  root.append(group('Calendar',
    el('p.about-text', { style: { marginBottom: '12px' } },
      'Renewal deadlines, notice dates and dated obligations, as calendar events with reminders 7 days and 1 day before.'),
    el('button.btn.btn-primary', {
      html: icon('calendar', 15, 2),
      onclick: downloadBookCalendar,
    }, ' Download .ics'),
    el('div', { style: { marginTop: '16px' } }, feedSection)
  ));

  /* --- Data --- */
  /* The sample-data row depends on the store, so it re-renders with it:
     otherwise a stale "Load sample data" row lingers after loading. */
  const dataRows = el('div.settings-list');
  function renderDataRows() {
    clear(dataRows);
    append(dataRows, [
      settingRow('download', 'Export everything', 'Contracts and contacts as a JSON file (documents stay in your cloud).', () => {
        const data = JSON.stringify(store.exportAll(), null, 2);
        downloadBlob(new Blob([data], { type: 'application/json' }), `contract-manager-export-${todayISO()}.json`);
      }),
      settingRow('upload', 'Import from a spreadsheet',
        'Bring in a CSV of contracts, mapping your columns to ours.', openCsvImport),
      settingRow('undo', 'Restore from a backup',
        'Read a JSON file this app exported, replacing what is here now.', openRestore),
      trashRow(),
      // Shown only once the permission exists, like the sample-data row below:
      // the one thing this app sends out of the user's own cloud has to be
      // takeable back, and somewhere they can find it.
      store.settings.ocrConsent
        ? settingRow('sparkle', 'Ask before AI reads a scan',
          'Scanned documents with no text in them are currently read by Puter\'s AI without asking each time.', async () => {
            try {
              await store.updateSettings({ ocrConsent: false });
              toast('You will be asked again next time');
            } catch {
              toast('Could not save. Check your connection', { icon: 'wifiOff' });
            }
          })
        : null,
      store.settings.sampleData
        ? settingRow('sparkle', 'Wipe sample data', 'Remove the demo contracts and start with your own.', async () => {
          const ok = await confirmDialog({
            title: 'Start fresh?',
            message: 'Everything currently in the app is removed: the sample data and anything you added while exploring.',
            confirmLabel: 'Wipe sample data',
          });
          if (!ok) return;
          try {
            await wipeSampleData(store);
            openOnboarding();
          } catch {
            toast('Could not wipe. Check your connection', { icon: 'wifiOff' });
          }
        })
        : (store.contracts.length === 0 && store.contacts.length === 0
          ? settingRow('sparkle', 'Load sample data', 'Explore the app with a demo contract book.', async () => {
            try {
              await store.importAll(sampleDataset(store));
              toast('Sample data loaded', { icon: 'sparkle' });
            } catch {
              toast('Could not load. Check your connection', { icon: 'wifiOff' });
            }
          })
          : null),
    ]);
  }
  renderDataRows();
  root.append(group('Your data', dataRows));
  /* Every block on this page is drawn from settings, so they all follow them:
     the theme's active pill (main.js has already applied the theme itself by
     the time this runs), the defaults, the rates, and the rows above. */
  const onStoreChange = () => {
    renderTheme();
    syncStoredSettings();
    renderDataRows();
  };
  store.addEventListener('change', onStoreChange);
  root.destroy = () => {
    store.removeEventListener('change', onStoreChange);
    feedSection.destroy?.();
  };

  /* --- About --- */
  root.append(group('About',
    el('p.about-text', {},
      'Contract Manager stores everything in your own Puter cloud: nothing is sent anywhere else. Obligation extraction sends the text you give it to the AI; a scan with no text in it is sent as page images, and only once you have agreed to that. Built on ',
      el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Puter'),
      '.')
  ));

  function group(title, ...children) {
    return el('section.card', {},
      el('h2.card-title', { style: { marginBottom: '12px' } }, title),
      ...children
    );
  }

  /** Always present, so the trash is somewhere you can look — not a surprise. */
  function trashRow() {
    const n = store.trashCount();
    return settingRow('trashBin', 'Trash',
      n
        ? `${n} deleted item${n === 1 ? '' : 's'}, removed for good after ${TRASH_DAYS} days.`
        : `Deleted items wait here for ${TRASH_DAYS} days before they are gone.`,
      openTrash);
  }

  function settingRow(ic, title, sub, onclick) {
    return el('button.settings-row', { type: 'button', onclick },
      el('span.settings-ic', { html: icon(ic, 18, 1.8) }),
      el('div.grow.min0', {},
        el('div.row-title', {}, title),
        el('div.row-sub.wrap', {}, sub)
      ),
      el('span.row-chev', { html: icon('chevR', 18) })
    );
  }

  return root;
}
