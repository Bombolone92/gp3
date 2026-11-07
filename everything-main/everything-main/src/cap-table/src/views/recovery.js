/**
 * The screen shown when the company could not be loaded: a record came back
 * unreadable, or one this version's sanitizers refuse. The boot stops there
 * rather than start on an empty cap table and save over the damaged record,
 * and this is where it stops.
 *
 * Before this it offered "Try again" and told the user to restore from a
 * backup export - in an app whose Settings screen, where restoring lives,
 * never mounts while the load fails. The ways back that need nothing of the
 * damaged record are offered here instead: the company's own restore
 * points, which stand under a key of their own; a backup file; and the
 * account's other companies. Each ends in a reload, so the company comes
 * back through the ordinary load. Nothing is written until one is confirmed.
 */
import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store, Store, isRefusal } from '../lib/store.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { pickBackupFile } from '../ui/backupfile.js';
import { timeAgo } from '../lib/format.js';

const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const counts = (data) => `${plural(data.stakeholders.length, 'holder', 'holders')} · ${plural(data.securities.length, 'security', 'securities')}`;

export function recoveryView({ title, message, onRetry, onRecovered }) {
  /* Known once the registry has been read, which is the first thing the
     load does: a company whose records failed still has an entry here. The
     registry itself unreadable, there is no company to offer a way back
     for, and only the retry is shown. */
  const company = store.companies.find((c) => c.id === store.activeCompanyId) || null;
  const name = company?.label || 'this company';
  const others = store.companies.filter((c) => c.id !== store.activeCompanyId);

  const root = el('div.auth-view.recovery-view', {},
    // Not the offline glyph: the connection is fine, a record is not.
    el('div.empty-icon', { html: icon('alert', 30) }),
    el('h1.auth-title', { style: { fontSize: '22px' } }, title),
    el('p.auth-sub', {}, `${message} ${company ? 'Try again, or use one of the ways back below.' : 'Try again.'}`),
    el('button.btn.btn-primary.auth-cta', { onclick: onRetry }, 'Try again'));
  if (!company) return root;

  const row = (heading, sub, control) => el('div.settings-row', {},
    el('div.grow', {},
      el('div.t', {}, heading),
      sub ? el('div.s', {}, sub) : null),
    control);

  /* One recovery at a time, and none after one has succeeded: the reload
     that follows is on its way, and a second write meanwhile would land on
     the company it is about to load. */
  let busy = false;
  async function attempt(run, failure) {
    if (busy) return;
    busy = true;
    const controls = [...root.querySelectorAll('button')];
    controls.forEach((button) => { button.disabled = true; });
    try {
      await run();
      onRecovered();
    } catch (err) {
      console.error(err);
      /* The store's own reason when it declined; the connection otherwise -
         the same split Settings makes for the same operations. */
      toast(isRefusal(err) ? err.message : failure, { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
      busy = false;
      controls.forEach((button) => { button.disabled = false; });
    }
  }

  /* Restore points. Read here, since the load never got to them; a list
     that cannot be read says so in its row rather than failing the screen. */
  const pointsStatus = el('div.s', { role: 'status' }, 'Looking for snapshots…');
  const points = el('div.settings-card', {},
    el('div.settings-row', {}, el('div.grow', {}, el('div.t', {}, 'Restore a snapshot'), pointsStatus)));
  store.loadRestorePoints().then((list) => {
    if (!list.length) {
      pointsStatus.textContent = 'None stored for this company. One is taken before a round closes, a split is recorded, a backup or a CSV is imported, or data is deleted.';
      return;
    }
    points.replaceChildren(...list.map((point) => row(
      point.label,
      `${timeAgo(point.at)} · ${counts(point.data)}`,
      el('button.btn.btn-ghost', {
        // Named like the rows in Settings: one "Restore" per row otherwise.
        'aria-label': `Restore the point from ${lowerFirst(point.label)}`,
        onclick: () => restore(point),
      }, 'Restore'))));
  }, (err) => {
    console.error(err);
    pointsStatus.textContent = err?.name === 'CorruptDataError'
      ? 'The snapshots of this company could not be read either.'
      : isRefusal(err) ? err.message : 'The snapshots could not be loaded. Check your connection and try again.';
  });

  async function restore(point) {
    if (busy) return;
    const ok = await confirmDialog({
      title: `Restore ${lowerFirst(point.label)}?`,
      message: `Everything in ${name} goes back to that snapshot: profile, share classes, stakeholders, `
        + 'securities, scenarios, and history. The record that could not be read is replaced along with the rest.',
      confirmLabel: 'Restore',
      danger: false,
    });
    if (!ok) return;
    await attempt(() => store.restoreFromPoint(point.id), 'Couldn’t restore. Check your connection');
  }

  /* A backup file. Judged on the file alone before anything is asked - see
     Store.prepareImport - so the confirm can say what the file holds. */
  function chooseBackup() {
    if (busy) return;
    pickBackupFile(async (data) => {
      let prepared;
      try {
        prepared = Store.prepareImport(data);
      } catch (err) {
        console.error(err);
        toast(isRefusal(err) ? err.message : 'That file couldn’t be read', { icon: 'alert' });
        return;
      }
      const exported = Date.parse(data?.exportedAt);
      const ok = await confirmDialog({
        title: 'Restore from this backup?',
        message: `The file holds ${prepared.company.name || 'an unnamed company'}: ${counts(prepared)}`
          + `${Number.isNaN(exported) ? '' : `, exported ${timeAgo(exported)}`}. Everything in ${name} is replaced with it.`,
        confirmLabel: 'Restore',
        danger: false,
      });
      if (!ok) return;
      await attempt(() => store.importAll(data, {
        label: 'Before restoring a backup',
        operation: 'importBackup',
        source: 'backup',
        settings: { onboarded: true, sampleData: false },
      }), 'Couldn’t restore. Check your connection');
    });
  }

  /* The other companies. Opening one moves the account's pointer to it, so
     the reload lands there; this company stays as it is, damaged record and
     all, until it can be read or restored. */
  const companies = others.length ? el('div.settings-card', {}, ...others.map((c) => row(
    c.label || 'Untitled company',
    `created ${timeAgo(c.createdAt)}`,
    el('button.btn.btn-ghost', {
      'aria-label': `Open ${c.label || 'the untitled company'}, created ${timeAgo(c.createdAt)}`,
      onclick: () => attempt(() => store.switchCompany(c.id), 'Couldn’t open that company. Check your connection'),
    }, 'Open')))) : null;

  root.append(el('div.recovery-ways', {},
    el('h2', {}, 'Ways back'),
    el('p.auth-sub', {}, `Each puts a readable copy in place of the damaged record, then loads ${name} again. Nothing is changed until you confirm.`),
    el('h3.recovery-sub', {}, 'Snapshots of this company'),
    points,
    el('h3.recovery-sub', {}, 'A backup file'),
    el('div.settings-card', {}, row('Restore from a backup file', 'A Cap Table export (.json) replaces everything in this company',
      el('button.btn.btn-ghost', { onclick: chooseBackup }, 'Choose file'))),
    companies ? el('h3.recovery-sub', {}, 'Other companies') : null,
    companies,
    companies ? el('p.field-hint', {}, `${name} stays as it is until it can be read or restored.`) : null));
  return root;
}
