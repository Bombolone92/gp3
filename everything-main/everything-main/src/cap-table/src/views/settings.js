import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { viewHead, field, flagInvalid, segmented } from '../ui/bits.js';
import { confirmDialog, openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { openOnboarding } from '../ui/onboarding.js';
import { openCsvImport } from '../ui/csvimport.js';
import { openNewCompanyForm } from '../ui/companyform.js';
import { openAttachmentsModal, attachmentChoiceDialog } from '../ui/attachments.js';
import { openValuationForm } from '../ui/valuationform.js';
import { applyTheme, currentTheme } from '../ui/theme.js';
import { store, Store, CompanyChangedError, isRefusal } from '../lib/store.js';

/* A restore point's label starts a sentence ("Before Ada Chen departed"), and
   these buttons quote it mid-sentence. Only its first letter comes down: the
   whole label lowercased read holder names and certificate labels as common
   words, and a screen reader stopped spelling "CS-3". */
const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
import { isPuterApp } from '../lib/env.js';
import { fmvStatus, sharesOutstanding, fullyDiluted } from '../lib/captable.js';
import {
  sharePrice, dateLong, CURRENCIES, currencyLabel, shares, timeAgo,
} from '../lib/format.js';
import { downloadFile, todayISO } from '../lib/util.js';
import { pickBackupFile } from '../ui/backupfile.js';

/** "3 splits, latest 2-for-1 Jun 1, 2026", or nothing when there are none. */
function splitSummary(splits) {
  if (!splits.length) return null;
  const latest = splits.reduce((a, sp) => (a && a.date >= sp.date ? a : sp), null);
  const one = `${latest.num}-for-${latest.den} split ${dateLong(latest.date)}`;
  return splits.length === 1 ? one : `${splits.length} splits, latest ${one}`;
}

export function settingsView() {
  const row = (title, sub, control) => el('div.settings-row', {},
    el('div.grow', {},
      el('div.t', {}, title),
      sub ? el('div.s', {}, sub) : null),
    control);

  /* Appearance */
  const themeSeg = segmented([
    { value: 'light', label: ' Light', html: icon('sun', 14, 2) },
    { value: 'dark', label: ' Dark', html: icon('moon', 14, 2) },
    { value: 'system', label: ' System', html: icon('monitor', 14, 2) },
  ], {
    label: 'Theme',
    value: store.settings.theme || currentTheme(),
    onSelect: (value) => {
      applyTheme(value);
      // The write re-renders this whole view; the shell hands focus back to
      // the button that was pressed by its focus key.
      store.updateSettings({ theme: value }).catch(() => {
        /* The choice took effect here and is lost on the next load, where
           the stored setting wins - every other save in this view says so
           when it fails, and this one swallowed it. */
        toast('Couldn’t save the theme, so it goes back to the saved one on your next visit. Check your connection',
          { icon: 'wifiOff' });
      });
    },
  });

  /* Data */
  /* The backup carries the company's whole journal, read from the cloud a
     batch at a time, so a long history takes a moment: the button says how
     far along it is rather than sitting there as if nothing had happened,
     and cannot be pressed again meanwhile. */
  async function exportJSON(e) {
    const button = e.currentTarget;
    const label = button.querySelector('span');
    button.disabled = true;
    try {
      const backup = await store.exportBackup({
        onProgress: ({ read, loaded, total }) => {
          label.textContent = loaded ? ` Preparing ${loaded} of ${total}` : ` Reading ${read} of ${total}`;
        },
      });
      downloadFile(`captable-export-${todayISO()}.json`, JSON.stringify(backup, null, 2), 'application/json');
      toast('Export downloaded');
    } catch (err) {
      console.error(err);
      toast(isRefusal(err) ? err.message : 'Couldn’t export. Check your connection',
        { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
    } finally {
      label.textContent = ' Export';
      button.disabled = false;
    }
  }

  function importJSON() {
    pickBackupFile(chooseImportTarget);
  }

  /**
   * Where the file lands: over the current company, or into a brand-new
   * slot - never "the world", which is exactly one company now.
   */
  function chooseImportTarget(data) {
    const current = store.company.name || store.activeCompany?.label || 'the current company';
    let target = 'current';
    const seg = segmented([
      /* Not the company's name: in half of a phone-width sheet the name
         ellipsized to "Replace Acme Robo…", and the sentence above already
         says which company this is. */
      { value: 'current', label: 'Replace this company' },
      { value: 'new', label: 'A new company' },
    ], {
      label: 'Import into', value: target, wide: true,
      onSelect: (value) => { target = value; },
    });

    const targetField = field('Import into', seg);
    /* The slot is created and switched to before the file lands in it, so a
       retry after a failed import has to fill that slot rather than mint a
       second empty company - and the choice above is settled by then, since
       the new slot is now the current one either way. */
    let createdCompany = false;
    const createdNote = el('p.field-hint', { hidden: true },
      'The new company is ready but still empty. Retry to import the file into it.');

    const goBtn = el('button.btn.btn-primary.btn-block', { style: { padding: '12px' } }, 'Import');
    goBtn.addEventListener('click', async () => {
      goBtn.disabled = true;
      try {
        if (target === 'new' && !createdCompany) {
          /* The file is judged before a company is made for it. Created
             first, a file the import then refused - a security naming a
             holder it did not carry, more records than a company keeps -
             left an empty company behind, switched to, under the note
             below saying to retry the same file into it. */
          Store.prepareImport(data);
          const proposed = data?.company?.name;
          await store.createCompany(String(typeof proposed === 'string' ? proposed : '').slice(0, 120));
          createdCompany = true;
          targetField.hidden = true;
          createdNote.hidden = false;
          /* Built for the company that was current when the dialog opened;
             the store has switched to the new, empty one by now, which no
             import replaces and no restore point is taken for. */
          intro.textContent = 'The file goes into the new company, which is the current one now. Nothing is replaced.';
        }
        await store.importAll(data, {
          label: 'Before importing a backup',
          operation: 'importBackup',
          source: 'backup',
          settings: { onboarded: true, sampleData: false },
        });
        // What actually landed, so a file that parsed but held nothing usable
        // doesn't read as a success.
        const holders = store.stakeholders.length;
        const secs = store.securities.length;
        toast(`Import complete · ${holders} stakeholder${holders === 1 ? '' : 's'}, `
          + `${secs} securit${secs === 1 ? 'y' : 'ies'}`);
        modal.close();
      } catch (err) {
        console.error(err);
        toast(isRefusal(err) ? err.message : 'Couldn’t import. Check your connection',
          { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
        goBtn.disabled = false;
      }
    });

    const intro = el('p.confirm-message', {},
      /* Said of the company being replaced, not of the current one: with
         the file going into a new company nothing here is replaced, and
         the promised restore point of the current company is never taken. */
      `Importing replaces one company’s data with the file’s contents. This company is ${current}${/[.!?]$/.test(current) ? '' : '.'}`
      /* Promised only when one will be taken: the store snapshots nothing
         for a company that holds nothing, as the CSV wizard already says. */
      + (store.hasData
        ? ' Replacing it takes a restore point first, so that can be undone from Settings.'
        : ''));
    const modal = openModal({
      title: 'Import backup',
      content: el('div', {},
        intro,
        targetField,
        createdNote,
        goBtn),
    });
  }

  /**
   * Restore points: the snapshots the store takes before an operation that
   * rewrites the whole dataset. Each row carries the figures that let the
   * user recognize which moment it is - the label and the timestamp alone
   * describe two snapshots taken minutes apart equally well.
   */
  function openRestorePoints() {
    const list = el('div');

    const headline = (point) => {
      const { company, securities, stakeholders } = point.data;
      return [
        `${shares(sharesOutstanding(securities))} outstanding`,
        `${shares(fullyDiluted(securities, company))} fully diluted`,
        `${stakeholders.length} holder${stakeholders.length === 1 ? '' : 's'}`,
      ].join(' · ');
    };

    function renderList() {
      const points = store.restorePoints;
      if (!points.length) {
        list.replaceChildren(el('p.field-hint', {},
          'None yet. One is taken automatically before a round closes, a split is '
          + 'recorded, a backup or a CSV is imported, or data is deleted.'));
        return;
      }
      list.replaceChildren(el('div.settings-card', {}, points.map((point) => row(
        point.label,
        `${timeAgo(point.at)} · ${headline(point)}`,
        el('div.row', {},
          el('button.btn.btn-ghost', {
            // Named like the delete beside it: one "Restore" per row otherwise.
            'aria-label': `Restore the point from ${lowerFirst(point.label)}`,
            onclick: () => restore(point),
          }, 'Restore'),
          el('button.icon-btn', {
            html: icon('trash', 16, 2),
            'aria-label': `Delete the restore point from ${lowerFirst(point.label)}`,
            onclick: () => removePoint(point),
          }))))));
    }

    async function restore(point) {
      const ok = await confirmDialog({
        title: `Restore ${lowerFirst(point.label)}?`,
        message: 'Everything in this company - profile, share classes, stakeholders, '
          + 'securities, scenarios, and history - goes back to that snapshot.'
          /* Promised only when one will be taken: the store snapshots nothing
             for a company that holds nothing, which is the state a restore
             is most often asked from - right after a wipe. */
          + (store.hasData
            ? ' A restore point of the current state is taken first, so this is itself reversible.'
            : ''),
        confirmLabel: 'Restore',
        danger: false,
      });
      if (!ok) return;
      try {
        await store.restoreFromPoint(point.id);
        // The log is part of what was just restored, so this entry lands on
        // top of the restored history - which is exactly where it belongs.
        store.logActivity(`Restored the “${point.label}” snapshot`, 'refresh');
        toast('Restore complete');
        modal.close();
      } catch (err) {
        console.error(err);
        /* The store's own reason when it declined (the point is gone); the
           connection otherwise. Shown as it came, a failed write put the
           platform's error text on screen under a connection icon, and a
           refusal wore the connection icon too. */
        toast(isRefusal(err) ? err.message : 'Couldn’t restore. Check your connection',
          { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
      }
    }

    async function removePoint(point) {
      const ok = await confirmDialog({
        title: 'Delete this restore point?',
        message: 'The snapshot is removed. Whatever it held cannot be gone back to afterwards.',
        confirmLabel: 'Delete',
      });
      if (!ok) return;
      try {
        await store.deleteRestorePoint(point.id);
        const at = store.restorePoints.findIndex((p) => p.at < point.at);
        renderList();
        /* The rows are rebuilt, the delete button just pressed among them, and
           with the app inert behind the sheet focus fell to the document body.
           It moves to the button that took this row's place, or the last one,
           or the sheet itself once the list is empty - the same hand-off the
           tranche and attachment lists make. */
        const left = [...list.querySelectorAll('.icon-btn')];
        const next = left[at >= 0 ? Math.min(at, left.length - 1) : left.length - 1];
        (next || modal.panel).focus({ preventScroll: true });
        toast('Restore point deleted', { icon: 'trash' });
      } catch (err) {
        console.error(err);
        toast('Couldn’t delete. Check your connection', { icon: 'wifiOff' });
      }
    }

    renderList();
    const modal = openModal({
      title: 'Restore points',
      wide: true,
      content: el('div', {},
        el('p.confirm-message', {},
          `Cap Table keeps the last few snapshots of this company, taken automatically `
          + 'before an operation that rewrites everything at once. They live in your '
          + 'own Puter cloud beside the data, and they are not part of an export.'),
        list),
    });
  }

  async function removeCompany(c) {
    const active = c.id === store.activeCompanyId;
    const ok = await confirmDialog({
      title: `Delete ${c.label || 'this company'}?`,
      /* Which one, when two share a name: the creation time tells them apart,
         and when both were created in the same minute, whether it is the one
         on screen does. */
      message: `${active ? 'This is the company you are in now, created' : 'Created'} ${timeAgo(c.createdAt)}. Its cap table, permanent audit history, and attached files are permanently removed from your Puter cloud. Export its data and History JSON first if you need to retain them.`,
      confirmLabel: 'Delete company',
    });
    if (!ok) return;
    try {
      await store.deleteCompany(c.id);
      toast('Company deleted', { icon: 'trash' });
    } catch (err) {
      console.error(err);
      toast(isRefusal(err) ? err.message : 'Couldn’t delete. Check your connection',
        { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
    }
  }

  async function wipeAll() {
    const ok = await confirmDialog({
      title: 'Delete everything here?',
      message: 'This company’s profile, stakeholders, securities, and scenarios are removed from your Puter cloud. A restore point is taken first, so this can be undone from Settings. Permanent audit history is retained and records this deletion. Other companies are untouched.',
      confirmLabel: 'Delete everything',
    });
    if (!ok) return;
    try {
      await store.wipeAll();
    } catch (err) {
      console.error(err);
      toast('Couldn’t delete. Check your connection', { icon: 'wifiOff' });
      return;
    }
    toast('All data deleted', { icon: 'trash' });
    // A wipe resets the first-run flag, and onboarding is only checked at boot -
    // so without this the guided setup ambushes the user on their next visit
    // instead of picking up where the deletion left them. Same follow-on the
    // sample-data banner's "Start fresh" already does.
    openOnboarding();
  }

  /* Company profile modal */
  function editCompany() {
    const c = store.company;
    /* The company these fields were filled in from - the one whose data is
       loaded, which during a switch is not the one writes land on. This form
       saves whatever is in its boxes, so arriving after the swap it would
       write this profile into the company being opened. */
    const openedFor = store.loadedCompanyId;
    const nameInput = el('input.input', { type: 'text', value: c.name, maxlength: 120, required: true, 'aria-label': 'Company name' });
    const typeInput = el('input.input', { type: 'text', value: c.entityType, maxlength: 40, 'aria-label': 'Entity type' });
    const jurInput = el('input.input', { type: 'text', value: c.jurisdiction, maxlength: 60, 'aria-label': 'Jurisdiction' });
    const dateInput = el('input.input', { type: 'date', value: c.incorporated, 'aria-label': 'Incorporation date' });
    /* The currency every figure in the app is read back in. A company keeps
       one: nothing here converts between currencies, and figures already
       recorded are not restated when the code changes - they were always
       entered in the company's own money. */
    const currencySelect = el('select.select', { 'aria-label': 'Currency' },
      CURRENCIES.map((cur) => el('option', {
        value: cur.code, selected: cur.code === c.currency,
      }, `${cur.code} · ${cur.label}`)),
      // A code an import carried that the picker doesn't list stays selectable
      // rather than being silently switched to dollars on the next save.
      CURRENCIES.some((cur) => cur.code === c.currency)
        ? null
        : el('option', { value: c.currency, selected: true }, c.currency));
    const saveBtn = el('button.btn.btn-primary.btn-block', { type: 'submit', style: { padding: '12px' } }, 'Save profile');
    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!nameInput.value.trim()) {
          // Said, not only flagged: a name of spaces satisfies `required` and landed here.
          flagInvalid(nameInput);
          nameInput.focus();
          toast('Give the company a name', { icon: 'alert' });
          return;
        }
        saveBtn.disabled = true;
        try {
          await store.updateCompany({
            name: nameInput.value,
            entityType: typeInput.value,
            jurisdiction: jurInput.value,
            currency: currencySelect.value,
            incorporated: dateInput.value,
          }, { companyId: openedFor });
          toast('Company profile saved');
          modal.close();
        } catch (err) {
          console.error(err);
          const moved = err instanceof CompanyChangedError;
          toast(moved ? err.message : 'Couldn’t save. Check your connection',
            { icon: moved ? 'alert' : 'wifiOff' });
          if (moved) modal.close();
          else saveBtn.disabled = false;
        }
      },
    },
      field('Company name', nameInput),
      el('div.form-grid', {},
        field('Entity type', typeInput),
        field('Jurisdiction', jurInput)),
      el('div.form-grid', {},
        field('Incorporation date', dateInput),
        field('Currency', el('div.select-wrap', {}, currencySelect))),
      el('p.field-hint', { style: { marginBottom: '12px' } },
        'Every amount - prices, caps, valuations, proceeds - is read back in this currency. '
        + 'Figures already recorded are never converted.'),
      saveBtn);
    const modal = openModal({ title: 'Company profile', content: form });
  }

  /* 409A history: the numbers a valuation provider hands you, recorded so
     option strikes have something to be checked against. */
  function valuationsCard() {
    const today = todayISO();
    const { current, months, stale, roundSince } = fmvStatus(store.db, today);
    const list = store.company.valuations || [];

    /* Both triggers when both have fired, the round first - the order the
       needs-attention list and the dashboard tile use, so the three places
       name the same reasons for the same valuation. */
    const flag = !current ? null
      : roundSince ? `A priced round closed on ${dateLong(roundSince.date)}, after this 409A was set`
        + `${stale ? `, and it is ${months} months old` : ''}. Refresh before granting.`
        : stale ? `This 409A is ${months} months old. Twelve months is the usual refresh trigger.`
          : null;

    // Skip the one in force by id, not by position: history is sorted newest
    // first, so a valuation dated in the future sorts above the current one
    // without being it. Slicing the first row off would leave that record
    // invisible - and undeletable - while listing the current one twice.
    const history = list.filter((v) => v.id !== current?.id);
    const recordBtn = el('button.btn.btn-ghost', {
      html: icon('plus', 15, 2.2), onclick: () => openValuationForm(),
    }, ' Record');

    return el('div.settings-card', {},
      current
        ? row(`${sharePrice(current.fmvPerShare)} per share`,
          `Set ${dateLong(current.date)}${current.note ? ` · ${current.note}` : ''}`,
          valuationActions(current))
        : null,
      flag ? el('div.settings-row', {},
        el('span.warn', { html: icon('alert', 15, 2), style: { display: 'inline-flex' } }),
        el('span.grow.small.warn', {}, flag)) : null,
      ...history.map((v) => row(
        `${sharePrice(v.fmvPerShare)} per share`,
        [dateLong(v.date), v.date > today ? 'not in force yet' : null, v.note || null]
          .filter(Boolean).join(' · '),
        valuationActions(v))),
      /* Recording one is a card-level action, so it gets a row of its own -
         the way the Companies card's "New company" row does. Riding along in
         the row above it pushed that valuation's attachment and delete buttons
         a labelled button's width left of the identical pair on every row
         underneath, so the same control sat in two places in one list. */
      list.length
        ? row('Record a new 409A', 'Option strikes pre-fill from the one in force on the grant date', recordBtn)
        : row('No 409A on file',
          'Record the value your provider gave you so strikes can be checked against it',
          recordBtn)
    );
  }

  /* The actions every valuation row carries, in one place so the row in force
     and the history rows are identical clusters and line up down the card.
     The valuation in force is as deletable as the rest: a mistyped 409A
     shouldn't need a second, newer entry just to get the wrong one out of the
     way. */
  function valuationActions(v) {
    return el('div.row', {},
      valuationClipBtn(v),
      el('button.icon-btn', {
        html: icon('trash', 16, 2), 'aria-label': `Delete the ${dateLong(v.date)} valuation`,
        onclick: () => removeValuation(v),
      }));
  }

  /* The 409A report behind the number: attach, view, remove. */
  function valuationClipBtn(v) {
    const count = v.attachments?.length || 0;
    /* The count is in the name, not only in the colour and the tooltip: the
       securities and holdings tables print it beside their paperclip, and a
       screen reader or a touch screen gets neither the tint nor the hover. */
    return el('button.icon-btn', {
      html: icon('paperclip', 16, 2),
      'aria-label': count
        ? `Attachments for the ${dateLong(v.date)} valuation, ${count} attached`
        : `Attach the 409A report for the ${dateLong(v.date)} valuation`,
      title: count ? `${count} attachment${count === 1 ? '' : 's'}` : 'Attach the 409A report',
      style: count ? { color: 'var(--accent)' } : undefined,
      onclick: () => openAttachmentsModal({
        title: `409A ${dateLong(v.date)} attachments`,
        getAttachments: () => store.company.valuations.find((x) => x.id === v.id)?.attachments || [],
        upload: (file) => store.attachToValuation(v.id, file),
        remove: (att) => store.removeValuationAttachment(v.id, att.id),
      }),
    });
  }

  async function removeValuation(v) {
    // Same courtesy the securities list extends: a valuation carrying its
    // 409A report never deletes silently.
    let deleteFiles = false;
    if (v.attachments?.length) {
      /* Its own words: the dialog's default sentence promises that Undo
         restores the record, and a deleted valuation has no undo. */
      const n = v.attachments.length;
      const choice = await attachmentChoiceDialog({
        title: `Delete the ${dateLong(v.date)} valuation?`,
        count: n,
        message: `Option strikes are no longer checked against it, and deleting it can’t be undone. `
          + `${n === 1 ? 'Its 409A report sits' : `${n} files sit`} behind it in your Puter cloud.`,
      });
      if (!choice) return;
      deleteFiles = choice === 'delete';
    } else {
      const ok = await confirmDialog({
        title: `Delete the ${dateLong(v.date)} valuation?`,
        message: 'Option strikes are no longer checked against it.',
        confirmLabel: 'Delete',
      });
      if (!ok) return;
    }
    try {
      await store.deleteValuation(v.id);
      if (deleteFiles) await store.deleteAttachmentFiles(v.attachments);
      toast('Valuation deleted', { icon: 'trash' });
    } catch (err) {
      console.error(err);
      toast('Couldn’t delete. Check your connection', { icon: 'wifiOff' });
    }
  }

  const username = store.user?.username || 'Puter user';

  const root = el('div', {},
    viewHead('Settings', 'Company, appearance, and your data'),

    el('div.settings-section', {},
      el('h2', {}, 'Company'),
      el('div.settings-card', {},
        row(store.company.name || 'No company profile yet',
          store.company.name
            ? [
              store.company.entityType,
              store.company.jurisdiction,
              `${store.company.currency} (${currencyLabel(store.company.currency)})`,
              /* The count and the latest only: listed one by one, forty
                 splits made this line thirty rows tall on a phone. The share
                 classes view keeps the full history. */
              splitSummary(store.company.splits || []),
            ].filter(Boolean).join(' · ')
            : 'Set the name, entity type, currency, and incorporation date',
          el('button.btn.btn-ghost', { onclick: editCompany }, store.company.name ? 'Edit' : 'Set up'))
      )),

    el('div.settings-section', {},
      el('h2', {}, 'Companies'),
      el('div.settings-card', {},
        /* Every row says when its company was created. Two companies can
           carry one name - a backup imported as a new company arrives under
           the name of the one it copies - and the rows, their buttons' names
           and the delete confirm read identically, so the wrong one could be
           deleted for good with nothing to tell them apart. */
        ...store.companies.map((c) => row(
          c.label || 'Untitled company',
          [
            c.id === store.activeCompanyId ? 'Active' : null,
            `created ${timeAgo(c.createdAt)}`,
            c.id === store.activeCompanyId ? 'rename it by editing the company profile above' : null,
          ].filter(Boolean).join(' · '),
          el('div.row', {},
            c.id !== store.activeCompanyId ? el('button.btn.btn-ghost', {
              'aria-label': `Switch to ${c.label || 'the untitled company'}, created ${timeAgo(c.createdAt)}`,
              onclick: async () => {
                try {
                  await store.switchCompany(c.id);
                  toast(`Switched to ${c.label || 'the other company'}`);
                } catch (err) {
                  console.error(err);
                  toast(isRefusal(err) ? err.message : 'Couldn’t switch. Check your connection',
                    { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
                }
              },
            }, 'Switch') : null,
            store.companies.length > 1 ? el('button.icon-btn', {
              html: icon('trash', 16, 2),
              'aria-label': `Delete ${c.label || 'this company'}, ${c.id === store.activeCompanyId ? 'the company you are in now, ' : ''}created ${timeAgo(c.createdAt)}`,
              onclick: () => removeCompany(c),
            }) : null))),
        row('New company', 'A separate cap table under this account',
          el('button.btn.btn-ghost', { html: icon('plus', 15, 2.2), onclick: () => openNewCompanyForm() }, ' Create')))),

    el('div.settings-section', {},
      el('h2', {}, 'Fair market value (409A)'),
      valuationsCard()),

    el('div.settings-section', {},
      el('h2', {}, 'Appearance'),
      el('div.settings-card', {},
        row('Theme', 'System follows your device setting', themeSeg))),

    el('div.settings-section', {},
      el('h2', {}, 'Data'),
      el('div.settings-card', {},
        row('Export', 'Download this company as JSON, with its history',
          el('button.btn.btn-ghost', { html: icon('download', 15, 2), onclick: exportJSON }, el('span', {}, ' Export'))),
        row('Import', 'Restore a previous export, here or into a new company',
          el('button.btn.btn-ghost', { html: icon('upload', 15, 2), onclick: importJSON }, ' Import')),
        row('Import from CSV', 'Add stakeholders and securities from a spreadsheet, without wiping anything',
          el('button.btn.btn-ghost', { html: icon('upload', 15, 2), onclick: () => openCsvImport() }, ' Import CSV')),
        row('Restore points',
          store.restorePoints.length
            ? `${store.restorePoints.length} snapshot${store.restorePoints.length === 1 ? '' : 's'} · latest ${timeAgo(store.restorePoints[0].at)}`
            : 'Snapshots taken before a round close, a split, an import, or a wipe',
          el('button.btn.btn-ghost', {
            html: icon('refresh', 15, 2), onclick: openRestorePoints,
          }, ' Restore points')),
        row('Delete all data', 'Clear this company’s records; permanent audit history is retained',
          el('button.btn.btn-danger', { onclick: wipeAll }, 'Delete')))),

    el('div.settings-section', {},
      el('h2', {}, 'Account'),
      el('div.settings-card', {},
        row(username, 'Signed in with Puter',
          // Inside Puter (env 'app') the platform owns the session - no sign-out.
          isPuterApp() ? null : el('button.btn.btn-ghost', {
            html: icon('logout', 15, 2), onclick: confirmSignOut,
          }, ' Sign out')))),

    el('p.small.muted', { style: { textAlign: 'center', margin: '10px 0 20px' } },
      'Cap Table is a tool, not legal advice. Confirm anything that matters with your counsel.')
  );
  return root;
}

export async function confirmSignOut() {
  const ok = await confirmDialog({
    title: 'Sign out?',
    message: 'Your data stays safe in your Puter cloud and reappears when you sign back in.',
    confirmLabel: 'Sign out',
    danger: false,
  });
  if (!ok) return;
  puter.auth.signOut();
  location.reload();
}
