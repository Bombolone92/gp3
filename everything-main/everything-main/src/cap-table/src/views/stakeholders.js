import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { viewHead, holderCell, emptyState } from '../ui/bits.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { openStakeholderForm } from '../ui/stakeholderform.js';
import { attachmentChoiceDialog } from '../ui/attachments.js';
import { store, isRefusal } from '../lib/store.js';
import { stakeholderKindInfo, ownershipByStakeholder, unvestedTotal, dbAsOf } from '../lib/captable.js';
import { shares, pct } from '../lib/format.js';
import { todayISO } from '../lib/util.js';
import { stakeholderView, stakeholderIdFromHash } from './stakeholder.js';

/** The stakeholders route covers both the list and one holder's detail. */
export function stakeholdersView({ navigate }) {
  const id = stakeholderIdFromHash();
  if (id) return stakeholderView({ navigate, id });

  const listWrap = el('div');

  function render() {
    const today = todayISO();
    const db = dbAsOf(store.db, today);
    listWrap.replaceChildren();

    if (!db.stakeholders.length) {
      listWrap.append(el('div.card', {}, emptyState({
        icon: 'users',
        title: 'No stakeholders yet',
        text: 'Founders, investors, employees, and advisors all live here. Add them, then issue securities to them.',
        cta: 'Add stakeholder',
        onCta: () => openStakeholderForm(),
      })));
      return;
    }

    const ownership = ownershipByStakeholder(db, { base: 'diluted', includePool: true });
    // Indexed once: the sort below asks for holdings twice per comparison,
    // and a linear find there is quadratic across a few hundred holders.
    const byHolder = new Map(ownership.rows.map((r) => [r.stakeholderId, r]));
    const holdings = (id) => byHolder.get(id);
    const heldByHolder = new Map();
    const recordCounts = new Map();
    for (const s of store.securities) recordCounts.set(s.stakeholderId, (recordCounts.get(s.stakeholderId) || 0) + 1);
    for (const s of db.securities) {
      const list = heldByHolder.get(s.stakeholderId);
      if (list) list.push(s);
      else heldByHolder.set(s.stakeholderId, [s]);
    }

    const table = el('table.data', {},
      el('caption.visually-hidden', {}, 'Stakeholders'),
      el('thead', {}, el('tr', {},
        el('th.col-holder', { scope: 'col' }, 'Name'),
        el('th', { scope: 'col' }, 'Type'),
        el('th.num', { scope: 'col' }, 'Securities'),
        el('th.num', { scope: 'col' }, 'Fully diluted shares'),
        el('th.num', { scope: 'col' }, 'Unvested'),
        el('th.num', { scope: 'col' }, 'Ownership'),
        el('th.no-print', { scope: 'col' }, el('span.visually-hidden', {}, 'Actions'))
      )),
      el('tbody', {}, [...store.stakeholders]
        .sort((a, b) => (holdings(b.id)?.shares || 0) - (holdings(a.id)?.shares || 0))
        .map((h) => {
          const own = holdings(h.id);
          const held = heldByHolder.get(h.id) || [];
          // The record count also appears in the delete confirmation, so it
          // includes future records even though ownership is as of today.
          const count = recordCounts.get(h.id) || 0;
          const unvested = unvestedTotal(held, today);
          const href = `#/stakeholders/${encodeURIComponent(h.id)}`;
          // The whole row opens the holder, but the name is a real link so
          // keyboard and screen-reader users get there the same way.
          return el('tr.rowlink', {
            onclick: (e) => { if (!e.target.closest('button, a')) navigate(href); },
          },
            el('td.col-holder', {}, holderCell(h, h.email || stakeholderKindInfo(h.kind).label, { href })),
            el('td', {},
              el('span.badge', {}, stakeholderKindInfo(h.kind).label),
              h.departed ? el('div.small.muted', { style: { marginTop: '2px' } }, h.departed > today ? 'Departing' : 'Departed') : null),
            el('td.num', {}, String(count)),
            el('td.num', {}, own ? shares(own.shares) : '-'),
            el('td.num', {}, unvested > 0 ? shares(unvested) : '-'),
            el('td.num', {}, own ? pct(own.pct) : '-'),
            el('td.no-print', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
              el('button.icon-btn', {
                html: icon('pencil', 16, 2), 'aria-label': `Edit ${h.name}`,
                onclick: () => openStakeholderForm(h),
              }),
              el('button.icon-btn', {
                html: icon('trash', 16, 2), 'aria-label': `Delete ${h.name}`,
                onclick: () => removeStakeholder(h, count),
              }))
          );
        }))
    );
    listWrap.append(el('div.table-wrap', { tabindex: 0, role: 'region', 'aria-label': 'Stakeholders table' }, table));
  }

  async function removeStakeholder(holder, securityCount) {
    /* Said before the confirm rather than after it: the store refuses the
       cascade while another holder's certificate came off one of these
       records, and the dialog promised a delete that then failed. */
    const refused = store.stakeholderDeleteRefusal(holder.id);
    if (refused) {
      toast(refused, { icon: 'alert' });
      return;
    }
    const held = store.securities.filter((s) => s.stakeholderId === holder.id);
    const attachments = held.flatMap((s) => s.attachments || []);
    const cascade = securityCount
      ? `This also deletes their ${securityCount} securit${securityCount === 1 ? 'y' : 'ies'} and changes your cap table.`
      : 'This stakeholder holds no securities.';
    /* Paper behind the records goes with them, so the same choice the
       securities list offers is offered here - a holder's deletion cascades
       to every security they hold, and the files behind those would otherwise
       be left in the user's cloud with nothing in the app pointing at them
       and no mention that they were there. */
    let deleteFiles = false;
    if (attachments.length) {
      const choice = await attachmentChoiceDialog({
        title: `Delete ${holder.name}?`,
        count: attachments.length,
        message: `${cascade} ${attachments.length === 1
          ? '1 attachment sits'
          : `${attachments.length} attachments sit`} behind those records in your Puter cloud. `
          + 'Undo restores the records, but never a deleted file.',
      });
      if (!choice) return;
      deleteFiles = choice === 'delete';
    } else {
      const ok = await confirmDialog({
        title: `Delete ${holder.name}?`,
        message: cascade,
        confirmLabel: 'Delete',
      });
      if (!ok) return;
    }
    try {
      const { undo } = await store.deleteStakeholder(holder.id);
      if (deleteFiles) await store.deleteAttachmentFiles(attachments);
      store.logActivity(`${holder.name} removed from the cap table`, 'users');
      toast('Stakeholder deleted', {
        icon: 'trash',
        /* The store's own reason when it declined - the cap table moved on, the
           company changed - rather than a connection message for both. */
        action: {
          label: 'Undo',
          // Logged, so the feed - and the holder's own History card - does
          // not go on saying they were removed.
          onClick: () => undo()
            .then(() => store.logActivity(`${holder.name} restored to the cap table`, 'refresh'))
            .catch((err) => toast(isRefusal(err) ? err.message : 'Couldn’t undo. Check your connection',
              { icon: isRefusal(err) ? 'alert' : 'wifiOff' })),
        },
      });
    } catch (err) {
      console.error(err);
      toast(isRefusal(err) ? err.message : 'Couldn’t delete. Check your connection',
        { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
    }
  }

  const root = el('div', {},
    viewHead('Stakeholders', 'Everyone who holds, or will hold, equity',
      el('button.btn.btn-primary', {
        html: icon('plus', 15, 2.2),
        onclick: () => openStakeholderForm(),
      }, ' Add stakeholder')),
    listWrap
  );
  render();
  return root;
}
