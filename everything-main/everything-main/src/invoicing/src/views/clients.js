import { el, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openModal } from '../ui/modal.js';
import {
  field, selectWrap, emptyState, moneyLines, keepFocus, refocus, taxNoteControl,
} from '../ui/bits.js';
import { store } from '../lib/store.js';
import { clamp } from '../lib/util.js';
import { docTotals, CURRENCIES } from '../lib/money.js';
import { isOpenInvoice, MAX_TERM_DAYS } from '../lib/doc.js';
import { LANGS } from '../lib/i18n.js';
import { todayISO } from '../lib/dates.js';

/* Half-typed clients, kept across the navigation that swept their dialogs
   away: adding a client usually means going off to find the address or the
   tax ID to paste in, and coming back must not cost the fields already
   filled. One per target — '' for a new client, or the id of the one being
   edited — so a second sweep, on another client, never discards the first
   after promising to keep it. The next form opened for the same target
   starts from its draft; Save and a deliberate close — Escape, the scrim,
   the X, which are how "never mind" is said — both clear it. */
const sweptDrafts = new Map();   // forId -> form values

/** Add/edit client form in a modal. onSaved(client) fires after persisting. */
export function openClientForm(client = null, onSaved = null) {
  const forId = client?.id || '';
  const kept = sweptDrafts.get(forId) || null;
  // What the controls start from: the stored client with the swept edits
  // over it, or the swept draft alone for a new client.
  const seed = client ? (kept ? { ...client, ...kept } : client) : kept;
  const name = el('input.input', { value: seed?.name || '', autocomplete: 'name', required: true });
  const company = el('input.input', { value: seed?.company || '', autocomplete: 'organization' });
  const email = el('input.input', { type: 'email', value: seed?.email || '', autocomplete: 'email' });
  const phone = el('input.input', { type: 'tel', value: seed?.phone || '', autocomplete: 'tel' });
  const address = el('textarea.textarea', { rows: 2, value: seed?.address || '' });
  // Free text: tax ID formats differ per country, and the user knows their
  // client's number. Printed under the Bill-to block, like the business's own.
  const taxId = el('input.input', { value: seed?.taxId || '' });
  // The language their paperwork renders in: fixed labels and date format
  // only — everything typed on a document prints verbatim.
  const language = el('select.select', {},
    el('option', { value: '', selected: !seed?.language }, 'English (default)'),
    LANGS.filter((l) => l.code !== 'en').map((l) => el('option', {
      value: l.code, selected: seed?.language === l.code,
    }, l.label)));

  /* Billing overrides. Every one of these is optional: left empty, the
     client simply inherits Settings, which is how every existing client
     keeps behaving exactly as before. */
  const s = store.settings;
  const currency = el('select.select', {},
    el('option', { value: '' }, `Use my default (${s.currency})`),
    CURRENCIES.map((c) => el('option', {
      value: c.code, selected: c.code === (seed?.currency || ''),
    }, `${c.code} · ${c.name}`)));
  // Overrides are normalized on save (clientBilling), so pin each field when
  // it is left: the form must show the value that will actually be stored.
  // An empty field stays empty — that is "inherit", never 0.
  const terms = el('input.input', {
    type: 'number', min: '0', max: String(MAX_TERM_DAYS), step: '1', inputmode: 'numeric',
    placeholder: String(s.paymentTermsDays ?? 14),
    value: seed?.paymentTermsDays ?? '',
    onchange: (e) => {
      if (e.target.value === '') return;
      e.target.value = clamp(Math.round(Number(e.target.value) || 0), 0, MAX_TERM_DAYS);
    },
  });
  const taxRate = el('input.input', {
    type: 'number', min: '0', max: '100', step: 'any', inputmode: 'decimal',
    placeholder: String(s.taxRate || 0),
    value: seed?.taxRate ?? '',
    onchange: (e) => {
      if (e.target.value === '') return;
      e.target.value = clamp(Number(e.target.value) || 0, 0, 100);
    },
  });
  const notes = el('textarea.textarea', {
    rows: 2,
    placeholder: s.defaultNotes ? s.defaultNotes : 'Use my default notes',
    value: seed?.notes || '',
  });
  const payInstructions = el('textarea.textarea', {
    rows: 2,
    placeholder: s.paymentInstructions ? s.paymentInstructions : 'Use my default payment instructions',
    value: seed?.paymentInstructions || '',
  });

  /* Late-fee override: '' inherits the global policy; an explicit "no late
     fee" is a real answer (a client you would never charge) and must
     survive, exactly like a zero tax rate. */
  const clf = seed?.lateFee && seed.lateFee.type ? seed.lateFee : null;
  // Re-pinned when the policy switches too: a fixed 150 is out of range as
  // a percentage, and the stored override would be 100 while the field
  // kept showing 150.
  const pinLateFee = () => {
    if (lateFeeValue.value === '') return;
    const max = lateFeeKind.value === 'percent' ? 100 : Infinity;
    lateFeeValue.value = clamp(Number(lateFeeValue.value) || 0, 0, max);
  };
  // field() puts the label's `for` on the first control in the row, which is
  // the select; this box needs a name of its own (Settings' card has one).
  const lateFeeValue = el('input.input', {
    type: 'number', min: '0', step: 'any', inputmode: 'decimal',
    value: clf && clf.type !== 'none' ? clf.value : '', placeholder: '2',
    'aria-label': 'Late fee amount',
    onchange: pinLateFee,
  });
  const lateFeeKind = el('select.select', {
    onchange: () => { syncLateFee(); pinLateFee(); },
  },
    el('option', { value: '', selected: !clf }, 'Use my default'),
    el('option', { value: 'none', selected: clf?.type === 'none' }, 'No late fee'),
    el('option', { value: 'percent', selected: clf?.type === 'percent' }, '% of balance / month'),
    el('option', { value: 'fixed', selected: clf?.type === 'fixed' }, 'Fixed amount / month'));
  const lateFeeRow = el('div.duo', {}, selectWrap(lateFeeKind), lateFeeValue);
  function syncLateFee() {
    lateFeeValue.hidden = lateFeeKind.value === '' || lateFeeKind.value === 'none';
  }
  syncLateFee();

  /* Why this client's invoices carry no tax, when they carry none: a client
     marked as an EU business gets the reverse-charge sentence on every
     invoice without a thought. '' inherits the global wording. */
  const taxNote = taxNoteControl(seed?.taxNote, {
    inheritLabel: `Use my default${s.taxNote ? '' : ' (none)'}`,
  });

  const saveBtn = el('button.btn.btn-primary.btn-block', {
    onclick: async () => {
      if (!name.value.trim()) {
        toast('A name is required', { icon: 'alert' });
        name.focus();
        return;
      }
      // A chosen policy with no amount would normalize to "inherit" on
      // save — the form would claim an override that was never stored.
      if ((lateFeeKind.value === 'percent' || lateFeeKind.value === 'fixed')
        && !(Number(lateFeeValue.value) > 0)) {
        toast('Enter the late-fee amount, or choose "No late fee"', { icon: 'alert' });
        lateFeeValue.focus();
        return;
      }
      const note = taxNote.read();
      if (note.error) {
        toast(note.error, { icon: 'alert' });
        note.focus.focus();
        return;
      }
      saveBtn.disabled = true;
      saving = true;
      const data = {
        name: name.value.trim(),
        company: company.value.trim(),
        email: email.value.trim(),
        phone: phone.value.trim(),
        address: address.value.trim(),
        taxId: taxId.value.trim(),
        language: language.value,
        currency: currency.value,
        paymentTermsDays: terms.value,
        taxRate: taxRate.value,
        notes: notes.value,
        paymentInstructions: payInstructions.value,
        lateFee: lateFeeKind.value === '' ? ''
          : { type: lateFeeKind.value, value: Number(lateFeeValue.value) || 0 },
        taxNote: note.value,
      };
      try {
        let saved;
        if (client) {
          await store.updateClient(client.id, data);
          saved = store.client(client.id);
        } else {
          saved = await store.addClient(data);
        }
        wasSaved = true;
        // Cleared here, not by close(): a route change may have swept the
        // dialog while the write was in the air, and close() returns at once
        // for a dialog already closed — leaving a draft of a client that
        // now exists, to prefill the next form with it.
        sweptDrafts.delete(forId);
        modal.close();
        toast(client ? 'Client updated' : `${saved.name} added`);
        onSaved?.(saved);
      } catch (err) {
        console.error(err);
        // Swept mid-save, the draft was kept without a word (the write was
        // still going to decide); now that it has failed, say where it is.
        toast(swept
          ? `Could not save — ${client ? 'Edit on this client' : '“New client”'} picks up where you left off`
          : 'Could not save. Check your connection', { icon: 'wifiOff' });
        saveBtn.disabled = false;
        refocus(saveBtn);
      } finally {
        saving = false;
      }
    },
  }, client ? 'Save changes' : 'Add client');

  /* What the form holds right now, shaped like the client it would save.
     Raw values, not trimmed: this is a draft, and the save path normalizes. */
  const snapshot = () => ({
    name: name.value,
    company: company.value,
    email: email.value,
    phone: phone.value,
    address: address.value,
    taxId: taxId.value,
    language: language.value,
    currency: currency.value,
    paymentTermsDays: terms.value,
    taxRate: taxRate.value,
    notes: notes.value,
    paymentInstructions: payInstructions.value,
    lateFee: lateFeeKind.value === '' ? ''
      : { type: lateFeeKind.value, value: lateFeeValue.value },
    // The control's own state, representable as what taxNoteControl accepts
    // back; an empty custom box falls back to inherit, which is the only
    // state it cannot round-trip.
    taxNote: taxNote.select.value === 'custom' ? taxNote.custom.value.trim() : taxNote.select.value,
  });
  const openedWith = JSON.stringify(snapshot());
  let wasSaved = false;
  let saving = false;   // a write is in the air
  let swept = false;    // navigation closed the dialog over the user's head

  const modal = openModal({
    title: client ? 'Edit client' : 'New client',
    // Navigation sweeps every open dialog — and finding the details to paste
    // into this one is exactly why someone walks off mid-form. Keep what was
    // typed for the next opening, and say so; a deliberate close stays what
    // it always was, the way to throw the draft away.
    onClose: (reason) => {
      if (wasSaved || reason !== 'sweep') {
        // Only the stash this form owns: closing an Edit dialog must not
        // discard a half-typed *new* client waiting elsewhere.
        sweptDrafts.delete(forId);
        return;
      }
      const data = snapshot();
      if (!kept && JSON.stringify(data) === openedWith) return;
      sweptDrafts.set(forId, data);
      swept = true;
      // A save in flight decides what to say: success clears the draft and
      // announces the client, failure names the draft — "Not saved yet" a
      // moment before "Acme added" would be a contradiction.
      if (saving) return;
      toast(client
        ? 'Not saved yet — Edit on this client picks up where you left off'
        : 'Not saved yet — “New client” picks up where you left off',
      { icon: 'clients' });
    },
    content: el('div', {},
      field('Name', name),
      field('Company', company, { hint: '(optional)' }),
      el('div.field-grid', {},
        field('Email', email, { hint: '(optional)' }),
        field('Phone', phone, { hint: '(optional)' })),
      field('Address', address, { hint: '(optional)' }),
      field('Tax ID', taxId, { hint: '(VAT / GST / ABN, shown on documents)' }),
      field('Document language', selectWrap(language), { hint: '(their invoices and estimates)' }),
      el('h3.form-section', {}, 'Billing defaults'),
      el('p.card-sub', {}, 'How new documents for this client start out. Leave anything empty to use your own defaults.'),
      field('Currency', selectWrap(currency)),
      el('div.field-grid', {},
        field('Payment terms', terms, { hint: 'days until due' }),
        field('Tax rate', taxRate, { hint: '%' })),
      field('Default notes', notes, { hint: '(optional)' }),
      field('Payment instructions', payInstructions, { hint: '(printed while a balance is due)' }),
      field('Late fee', lateFeeRow, { hint: '(disclosed on their invoices)' }),
      field('Tax note', taxNote.node, {
        hint: '(printed when their documents charge no tax)', group: true,
      }),
      saveBtn),
  });
}

export function clientsView() {
  const root = el('div.view');

  function render() {
    const restoreFocus = keepFocus(root);
    clear(root);
    // A client from a restored backup may carry no name at all; the sort
    // (and the card below) must not be the one place that assumes one.
    const clients = [...store.clients].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const today = todayISO();

    // What each card shows, gathered in one pass over the documents: matching
    // every client against every document turns a few years of history into a
    // visibly slow grid, and a card only needs a count and its open balances.
    const summaries = new Map();
    for (const d of store.docs()) {
      let row = summaries.get(d.clientId);
      if (!row) summaries.set(d.clientId, row = { count: 0, open: {} });
      row.count++;
      if (!isOpenInvoice(d, today)) continue;
      const balance = docTotals(d).balance;
      row.open[d.currency] = Math.round(((row.open[d.currency] || 0) + balance) * 100) / 100;
    }

    root.append(el('div.page-head', {},
      el('div', {},
        el('h1.page-title', {}, 'Clients'),
        el('p.page-sub', {}, 'Who you work with')),
      el('div.page-actions', {},
        el('button.btn.btn-primary', {
          html: icon('plus', 16, 1.8),
          disabled: store.readOnly,
          title: store.readOnly ? 'Reconnect to add a client' : null,
          onclick: () => openClientForm(),
        }, ' New client'))));

    if (!clients.length) {
      root.append(emptyState('clients', 'No clients yet',
        'Clients you add appear on your invoices and estimates.',
        // Same rule as the New client button above: nothing to add from a
        // device showing a saved copy.
        store.readOnly ? null
          : el('button.btn.btn-primary', { onclick: () => openClientForm() }, 'Add your first client')));
      restoreFocus();
      return;
    }

    // Each card is one link to the client's page, where editing, deleting,
    // and starting a document now live: a card full of competing buttons
    // makes the grid harder to scan than the thing it is a doorway to.
    root.append(el('div.client-grid', {}, clients.map((c) => {
      const { count, open } = summaries.get(c.id) || { count: 0, open: {} };
      const hasOpen = Object.keys(open).length > 0;
      return el('a.card.client-card', { href: `#/client/${c.id}` },
        el('div.client-card-head', {},
          el('span.user-avatar', { 'aria-hidden': 'true' }, String(c.company || c.name || 'Client').charAt(0).toUpperCase()),
          el('div.grow', {},
            el('h2.client-name', {}, c.company || c.name || 'Client'),
            // The contact person, when the company holds the heading. A
            // client without a company needs no subtitle: their email and
            // phone already print in the meta rows below, and repeating the
            // email here showed it twice on the same card.
            c.company ? el('p.client-sub', {}, c.name) : null),
          el('span.client-chev', { html: icon('chevR', 17, 1.6) })),
        el('div.client-meta', {},
          // The text goes in a span of its own so it can be given an ellipsis;
          // see .client-meta-row in views.css.
          c.email && el('span.client-meta-row', { html: icon('mail', 14, 1.6) }, el('span', {}, c.email)),
          c.phone && el('span.client-meta-row', { html: icon('phone', 14, 1.6) }, el('span', {}, c.phone))),
        el('div.client-stats', {},
          el('span.client-stat', {},
            `${count} document${count === 1 ? '' : 's'}`),
          hasOpen && el('span.client-stat.owed', {}, moneyLines(open), ' open')));
    })));
    restoreFocus();
  }

  store.addEventListener('change', render);
  root.destroy = () => store.removeEventListener('change', render);
  render();
  return root;
}
