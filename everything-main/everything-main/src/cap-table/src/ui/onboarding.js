/**
 * First-run onboarding: one decision (set up the company / sample data /
 * skip) and one short company form. Gated on an empty dataset; closing at
 * any point marks onboarding done so it never nags.
 */

import { el, clear, append } from './dom.js';
import { icon } from './icons.js';
import { field, flagInvalid } from './bits.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { LOGO_HTML } from '../views/auth.js';
import { sampleDataset } from '../lib/sample.js';
import { parseNum, todayISO } from '../lib/util.js';

export function shouldOnboard(store) {
  return !store.settings.onboarded && !store.settings.sampleData
    && !store.company.name && store.securities.length === 0;
}

export function openOnboarding() {
  const body = el('div');

  const markDone = () => {
    if (!store.settings.onboarded) {
      store.updateSettings({ onboarded: true }).catch(() => {});
    }
  };
  /* Held open while the sample import is in flight. Closed meanwhile (the X,
     the scrim, Escape), the app came back into service with the import
     still queued: whatever the user then saved landed on top of the sample
     dataset, under the sample banner, a moment later. */
  let importing = false;
  const modal = openModal({ title: 'Welcome', content: body, onClose: markDone, canClose: () => !importing });

  const skipBtn = (label = 'Skip for now') => el('button.btn.btn-ghost.btn-block', {
    type: 'button', style: { marginTop: '10px' },
    onclick: () => { markDone(); modal.close(); },
  }, label);

  /* Step 0 - welcome */
  function renderWelcome() {
    clear(body);
    append(body, [
      el('div.onboard-hero', {},
        el('div.onboard-logo', { html: LOGO_HTML.replace('width="72" height="72"', 'width="60" height="60"') }),
        el('h3', {}, 'Your equity, in order'),
        el('p', {}, 'Track every share, option, and SAFE. Model your next round before you sign it. Stored in your own Puter account.')
      ),
      el('button.btn.btn-primary.btn-block', {
        type: 'button', style: { padding: '13px' },
        onclick: renderCompany,
      }, 'Set up my company'),
      el('button.btn.btn-ghost.btn-block', {
        type: 'button', style: { marginTop: '10px', border: '1px dashed var(--hairline-strong)' },
        html: icon('sparkle', 15, 2),
        onclick: useSampleData,
      }, ' Explore with sample data'),
      skipBtn()
    ]);
  }

  /* currentTarget, and held in a local: e.target is the icon when the click
     lands on it, and currentTarget is already null by the time the awaits
     below resolve - either way the button would never actually be disabled,
     and a second click would start a second import over the first. */
  async function useSampleData(e) {
    const btn = e.currentTarget;
    /* The whole step goes quiet, not only the button pressed. The import is
       two round trips, and "Set up my company" beside it stayed live for
       their length: pressed meanwhile, it swapped in the company form, which
       the import's own close then took away mid-typing - or, submitted
       first, wrote the typed name over the sample company's and left the
       sample banner over a dataset now carrying the user's own company name. */
    const step = [...body.querySelectorAll('button')];
    const closeBtn = modal.panel.querySelector('.modal-head .icon-btn');
    for (const b of step) b.disabled = true;
    importing = true;
    if (closeBtn) closeBtn.disabled = true;
    try {
      await store.importAll(sampleDataset(), {
        label: 'Before loading sample data',
        operation: 'loadSampleData',
        settings: { sampleData: true, onboarded: true },
      });
    } catch (err) {
      console.error(err);
      toast('Couldn’t load the sample data. Check your connection', { icon: 'wifiOff' });
      for (const b of step) b.disabled = false;
      importing = false;
      if (closeBtn) closeBtn.disabled = false;
      return;
    }
    importing = false;
    modal.close();
    toast('Sample data loaded. Wipe it anytime from the banner', { icon: 'sparkle' });
  }

  /* Step 1 - the company. Everything else lives in the dashboard checklist. */
  function renderCompany() {
    clear(body);
    const nameInput = el('input.input', {
      type: 'text', placeholder: 'Acme, Inc.', required: true,
      autocomplete: 'organization', maxlength: 120, 'aria-label': 'Company name',
    });
    const dateInput = el('input.input', { type: 'date', value: todayISO(), 'aria-label': 'Incorporation date' });
    const authInput = el('input.input', {
      type: 'text', inputmode: 'numeric', placeholder: '10,000,000',
      'aria-label': 'Authorized common shares',
    });
    const saveBtn = el('button.btn.btn-primary.btn-block', {
      type: 'submit', style: { padding: '13px' },
    }, 'Create company');

    /* A real <form>, like every other sheet in the app. As a bare button and
       three loose inputs, this step answered an empty company name with a red
       border and nothing else - `required` needs a form to mean anything, so
       nothing told the user what was wrong - and Enter in the name field did
       nothing at all, on the one screen where a new user is most likely to
       press it. */
    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const name = nameInput.value.trim();
        if (!name) {
          // Whitespace alone satisfies `required`, so this still has to be
          // caught here - as it is on the company profile, stakeholder, and
          // share class forms - and said, since a red border alone was the
          // whole answer to a name of spaces.
          flagInvalid(nameInput);
          nameInput.focus();
          toast('Give the company a name', { icon: 'alert' });
          return;
        }
        /* Blank means "no class yet, set it up from the checklist", and that
           is a real answer. A figure that will not parse is not: "10M", "ten"
           or a negative count fell straight through the `> 0` test into the
           same silent path, and onboarding finished reporting success with no
           Common Stock class and no mark on the field that was wrong. Read
           the way the share class form reads its own authorized field, and
           before anything is written. */
        const raw = authInput.value.trim();
        const authorized = raw ? parseNum(raw) : 0;
        if (authorized === null || authorized < 0 || !Number.isInteger(authorized)) {
          flagInvalid(authInput);
          authInput.focus();
          toast('Authorized shares must be a whole number, like 10,000,000', { icon: 'alert' });
          return;
        }
        saveBtn.disabled = true;
        try {
          await store.updateCompany({ name, incorporated: dateInput.value });
          /* Only what was typed: this step asks for the authorized count and
             nothing about par, and the class arrived with a $0.0001 issue
             price nobody had entered - which the share classes table then
             reported as a fact about the charter. Same rule the fallback
             class the issue sheet creates follows; the price is set under
             Share classes once it is known. */
          if (authorized > 0 && !store.classes.length) {
            await store.addClass({ name: 'Common Stock', kind: 'common', authorized, pricePerShare: 0 });
          }
          await store.updateSettings({ onboarded: true });
          store.logActivity(`Company profile created: ${name}`, 'building');
        } catch (err) {
          console.error(err);
          toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
          saveBtn.disabled = false;
          return;
        }
        modal.close();
        toast('Company created. The dashboard checklist covers the rest');
      },
    },
      field('Company name', nameInput),
      el('div.form-grid', {},
        field('Incorporation date', dateInput),
        field('Authorized common shares', authInput)
      ),
      saveBtn);

    append(body, [
      el('h3', { style: { fontSize: '18px', marginBottom: '4px' } }, 'About your company'),
      el('p', { style: { color: 'var(--ink-2)', fontSize: '13.5px', marginBottom: '16px' } },
        'Start with the basics. You can refine share classes, stakeholders, and the equity plan afterwards.'),
      form,
      skipBtn()
    ]);

    /* The step swap replaces the button that asked for it, so keyboard focus
       lands on the document body and a screen reader is left with nothing to
       read on the step it just moved to - the same trap the other wizards
       (close a round, import a CSV, mark a holder departed) sidestep.

       This step leads with the one field it is asking for, so it takes the
       rule openModal applies on first paint rather than their fall back to
       the dialog box: the field on a pointer-width screen, the dialog itself
       on a phone, where focusing a text box throws the keyboard over the
       sheet the moment it opens. */
    if (matchMedia('(min-width: 640px)').matches) nameInput.focus();
    else modal.panel.focus({ preventScroll: true });
  }

  renderWelcome();
}
