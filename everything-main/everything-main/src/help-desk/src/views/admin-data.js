/** Admin section: export the help desk's data, or delete the help desk. */
import { openDialog } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { plural, localDay } from '../ui/format.js';
import { STATUS_LABEL, PRIORITY_LABEL, TYPE_LABEL, CHANNEL_LABEL } from '../shared/model.js';
import { app } from '../app.js';
import { forgetDesk } from '../client/userdoc.js';
import { clearDesk } from '../client/cache.js';
import { h, uid, icon, sectionHead, panel, download, callout } from './admin-common.js';

/** One CSV cell, quoted when needed. Leading formula characters are neutralized. */
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : Array.isArray(value) ? value.join(' ') : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ticketsCsv(tickets, { userName, memberName, groupName, orgName }) {
  const iso = (ts) => (ts ? new Date(ts).toISOString() : '');
  const header = ['ID', 'Subject', 'Status', 'Priority', 'Type', 'Channel', 'Requester', 'Organization', 'Assignee', 'Group', 'Tags', 'Created', 'Updated', 'Solved', 'First reply', 'Satisfaction'];
  const rows = tickets
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((t) => [
      t.id, t.subject, STATUS_LABEL[t.status] || t.status, PRIORITY_LABEL[t.priority] || '', TYPE_LABEL[t.type] || '', CHANNEL_LABEL[t.via] || t.via,
      userName(t.requester), t.org ? orgName(t.org) : '', t.assignee ? memberName(t.assignee) : '', t.group ? groupName(t.group) : '',
      t.tags || [], iso(t.createdAt), iso(t.updatedAt), iso(t.solvedAt), iso(t.firstReplyAt), t.csat?.score || '',
    ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

function slug(name) {
  return String(name || 'help-desk').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'help-desk';
}

const stamp = () => localDay();

export function renderData(container) {
  const isOwner = app.me?.role === 'owner';
  const r = app.replica;
  const jsonBtn = h('button.btn', { type: 'button', onclick: () => exportJson() }, icon('download', { size: 15 }), 'Export everything (JSON)');
  const csvBtn = h('button.btn', { type: 'button', onclick: () => exportCsv() }, icon('download', { size: 15 }), 'Export tickets (CSV)');
  const progress = h('p.muted.export-progress', { role: 'status', 'aria-live': 'polite' });

  container.append(
    sectionHead('Data', 'Your help desk data belongs to you. Take a full copy at any time.'),
    panel('Export', `${plural(r.tickets.size, 'ticket')}, ${plural(r.users.size, 'customer')}, ${plural(r.orgs.size, 'organization')} and ${plural(r.articles.size, 'article')}.`,
      h('div.export-grid',
        h('div.export-card', h('div.export-icon', icon('file-text', { size: 18 })), h('div.grow', h('h3', 'Everything'), h('p.muted', 'Settings, agents, tickets with their full conversations, customers, organizations and article summaries, as one JSON file.')), jsonBtn),
        h('div.export-card', h('div.export-icon', icon('columns-3', { size: 18 })), h('div.grow', h('h3', 'Tickets spreadsheet'), h('p.muted', 'One row per ticket, ready for a spreadsheet app.')), csvBtn)),
      progress),
    isOwner
      ? panel('Delete help desk', null,
          h('div.danger-zone',
            h('div.grow', h('h3', 'Delete this help desk permanently'), h('p.muted', 'Removes every ticket, conversation, customer, article and setting, and ends access for all agents. Attachments in your Puter drive under help-desk/ stay until you delete them.')),
            h('button.btn.btn-danger', { type: 'button', onclick: () => deleteDialog() }, icon('trash', { size: 15 }), 'Delete help desk')))
      : null,
  );

  async function exportJson() {
    jsonBtn.disabled = true;
    try {
      const events = [];
      let cursor = null;
      do {
        const page = await app.api.get(`/export/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
        events.push(...(page.items || []));
        cursor = page.cursor;
        progress.textContent = `Collected ${plural(events.length, 'conversation event')}`;
      } while (cursor);
      const byTicket = new Map();
      for (const e of events) {
        if (!byTicket.has(e.ticket)) byTicket.set(e.ticket, []);
        byTicket.get(e.ticket).push(e);
      }
      for (const list of byTicket.values()) list.sort((a, b) => (a.id < b.id ? -1 : 1));
      const data = {
        format: 'help-desk-export',
        version: 1,
        exportedAt: new Date().toISOString(),
        desk: r.meta,
        members: Object.values(r.members),
        config: r.cfg,
        tickets: [...r.tickets.values()].sort((a, b) => a.id - b.id).map((t) => ({ ...t, events: byTicket.get(t.id) || [] })),
        customers: [...r.users.values()],
        organizations: [...r.orgs.values()],
        articles: [...r.articles.values()],
      };
      download(`${slug(r.meta?.name)}-${stamp()}.json`, JSON.stringify(data, null, 2));
      progress.textContent = '';
      toast('Export downloaded.', { kind: 'success' });
    } catch (e) {
      progress.textContent = '';
      toastError(e);
    } finally {
      jsonBtn.disabled = false;
    }
  }

  function exportCsv() {
    const csv = ticketsCsv([...r.tickets.values()].filter((t) => !t.deleted), {
      userName: (id) => app.userName(id),
      memberName: (id) => app.memberName(id),
      groupName: (id) => (r.cfg.groups || []).find((g) => g.id === id)?.name || '',
      orgName: (id) => r.orgs.get(id)?.name || '',
    });
    download(`${slug(r.meta?.name)}-tickets-${stamp()}.csv`, `﻿${csv}`, 'text/csv;charset=utf-8');
    toast('Spreadsheet downloaded.', { kind: 'success' });
  }

  function deleteDialog() {
    const name = r.meta?.name || '';
    const inputId = uid('confirm');
    const input = h(`input#${inputId}.input`, { autocomplete: 'off', spellcheck: false });
    const status = h('p.muted', { role: 'status', 'aria-live': 'polite' });
    let busy = false;
    const dlg = openDialog({
      title: 'Delete this help desk?',
      size: 'sm',
      body: h('div.stack',
        callout('error', 'triangle-alert', 'This cannot be undone. Export your data first if you might need it.'),
        h('div.field', h('label.field-label', { for: inputId }, 'Type ', h('strong', name), ' to confirm'), input),
        status),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Delete permanently', danger: true,
          run: async () => {
            if (busy) return false;
            if (input.value.trim() !== name) {
              input.setAttribute('aria-invalid', 'true');
              status.textContent = 'The name does not match.';
              input.focus();
              return false;
            }
            busy = true;
            try {
              let rounds = 0;
              for (;;) {
                const res = await app.api.del('');
                rounds++;
                status.textContent = `Deleting${'.'.repeat(rounds % 4)}`;
                if (!res?.remaining || rounds > 200) break;
              }
              const ref = app.ref;
              app.replica.close();
              await forgetDesk(ref).catch(() => {});
              await clearDesk(ref).catch(() => {});
              delete app.doc.desks[ref];
              toast(`${name} was deleted.`);
              const next = app.desks()[0];
              if (next) app.emit('switch', { server: next.server, desk: next.desk });
              else app.emit('create');
              return true;
            } catch (e) {
              busy = false;
              toastError(e);
              return false;
            }
          },
        },
      ],
    });
    void dlg;
  }
}
