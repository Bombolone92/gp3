/**
 * Organization profile: its details (saved as you edit), its customers and
 * all of their requests.
 */
import { h, clear, uid, preserveFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openMenu } from '../ui/popover.js';
import { confirmDialog } from '../ui/dialog.js';
import { statusBadge, tagsInput, field, emptyState, spinner } from '../ui/components.js';
import { toast, toastError } from '../ui/toast.js';
import { relTime, fullDate, shortDate, plural } from '../ui/format.js';
import { go } from '../ui/router.js';
import { isUnsolved, normDomain, STATUS_LABEL } from '../shared/model.js';
import { app } from '../app.js';
import { satisfaction } from './people-data.js';
import { dataTable, saveStatus, orgMark, personCell, segmented } from './people-ui.js';
import { newCustomerDialog } from './customers.js';

export function mount(main, { id }) {
  const page = h('div.page.profile-page');
  main.append(page);
  let tab = 'tickets';
  let table = null;
  let lastPaint = null;
  let shown = new Set();
  let shownPeople = new Set();
  let head = null;

  const org = () => app.replica.orgs.get(id) || null;
  const people = () => [...app.replica.users.values()].filter((u) => u.org === id);
  const tickets = () => app.replica.ticketsFor((t) => t.org === id && !t.deleted && !t.spam).sort((a, b) => b.updatedAt - a.updatedAt);

  function paint() {
    const o = org();
    clear(page);
    table?.destroy();
    table = null;
    if (!o && app.replica.status !== 'live') {
      page.append(h('div.page-inner.profile-loading', spinner('Loading organization')));
      return;
    }
    if (!o) {
      page.append(h('div.page-inner', emptyState({
        glyph: 'building', title: 'Organization not found',
        text: 'It may have been deleted, or the link is wrong.',
        action: h('a.btn', { href: '#/orgs' }, icon('arrow-left', { size: 14 }), 'All organizations'),
      })));
      return;
    }
    document.title = `${o.name} - Help Desk`;
    lastPaint = JSON.stringify(o);
    const status = saveStatus();
    const members = people();
    shownPeople = new Set(members.map((u) => u.id));
    const list = tickets();
    shown = new Set(list.map((t) => t.id));
    const open = list.filter((t) => isUnsolved(t.status)).length;
    const csat = satisfaction(list);

    const header = profileHead(o, status, members.length);

    const stats = h('div.profile-stats', { role: 'list', 'aria-label': 'Summary' },
      stat('Open tickets', open),
      stat('All tickets', list.length),
      stat('Customers', members.length),
      stat('Satisfaction', csat.percent === null ? '-' : `${csat.percent}%`, csat.rated ? plural(csat.rated, 'rating') : 'No ratings'));

    const body = h('div.profile-tab');
    const seg = segmented({
      label: 'Organization sections',
      value: tab,
      items: [{ value: 'tickets', label: `Tickets (${list.length})` }, { value: 'people', label: `Customers (${members.length})` }],
      onChange: (v) => {
        tab = v;
        paintTab();
      },
    });
    function paintTab() {
      clear(body);
      table?.destroy();
      table = null;
      if (tab === 'tickets') {
        if (!list.length) {
          body.append(emptyState({ glyph: 'inbox', title: 'No tickets yet', text: 'Requests from this organization\'s customers will show up here.' }));
          return;
        }
        table = dataTable({
          label: 'Tickets',
          href: (t) => `#/tickets/${t.id}`,
          onOpen: (t) => go(`/tickets/${t.id}`),
          sort: { id: 'updated', dir: 'desc' },
          columns: [
            { id: 'status', label: 'Status', width: 92, sort: (t) => Object.keys(STATUS_LABEL).indexOf(t.status), render: (t) => statusBadge(t.status) },
            { id: 'subject', label: 'Subject', sort: (t) => t.subject, render: (t) => h('a.row-link.subject-link', { href: `#/tickets/${t.id}`, tabindex: '-1' }, h('span.ellipsis', t.subject), h('span.subtle.mono', ` #${t.id}`)) },
            { id: 'requester', label: 'Requester', cls: 'hide-sm', width: 170, sort: (t) => app.userName(t.requester), render: (t) => h('span.ellipsis', app.userName(t.requester)) },
            { id: 'updated', label: 'Updated', cls: 'hide-sm', width: 120, defaultDir: 'desc', sort: (t) => t.updatedAt, render: (t) => h('span', { title: fullDate(t.updatedAt) }, relTime(t.updatedAt)) },
          ],
        });
        body.append(table.el);
        table.update(list);
      } else {
        if (!members.length) {
          body.append(emptyState({ glyph: 'users', title: 'No customers yet', text: (o.domains || []).length ? `Customers with an email address at ${o.domains.join(' or ')} join automatically.` : 'Add email domains so customers join automatically, or add customers yourself.', action: h('button.btn', { type: 'button', onclick: () => newCustomerDialog({ org: id, navigate: false }) }, icon('user-plus', { size: 14 }), 'Add customer') }));
          return;
        }
        // Counted once: per row (and per sort comparison) it scanned every ticket.
        const openBy = new Map();
        for (const t of list) if (isUnsolved(t.status)) openBy.set(t.requester, (openBy.get(t.requester) || 0) + 1);
        table = dataTable({
          label: 'Customers',
          href: (u) => `#/customers/${u.id}`,
          onOpen: (u) => go(`/customers/${u.id}`),
          sort: { id: 'name', dir: 'asc' },
          columns: [
            { id: 'name', label: 'Name', sort: (u) => u.name, render: (u) => h('a.row-link', { href: `#/customers/${u.id}`, tabindex: '-1' }, personCell(u.name, u.email || '')) },
            { id: 'email', label: 'Email', cls: 'hide-md', width: 240, sort: (u) => u.email || '', render: (u) => h('span.ellipsis', u.email || '-') },
            { id: 'open', label: 'Open tickets', numeric: true, width: 120, defaultDir: 'desc', sort: (u) => openBy.get(u.id) || 0, render: (u) => h('span', String(openBy.get(u.id) || 0)) },
          ],
        });
        body.append(table.el);
        table.update(members);
      }
    }
    paintTab();

    page.append(h('div.profile-inner', header, h('div.profile-grid',
      h('section.profile-main', { 'aria-label': 'Tickets and customers' }, stats, h('div.profile-tabs', seg), body),
      detailsPanel(o, status))));
  }

  /** The header: name, domains and actions. Repainted on its own after a save. */
  function profileHead(o, status, memberCount) {
    const moreBtn = app.isAdmin
      ? h('button.btn.icon-only', { type: 'button', 'aria-label': 'More actions', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => openMenu(moreBtn, [
          { label: 'Delete organization', icon: 'trash', danger: true, run: remove },
        ], { align: 'end' }) }, icon('ellipsis', { size: 18 }))
      : null;
    head = h('header.profile-head',
      h('a.back-link', { href: '#/orgs' }, icon('arrow-left', { size: 15 }), 'Organizations'),
      h('div.profile-id',
        orgMark(o.name, 'xl'),
        h('div.profile-name',
          h('h1', o.name),
          h('div.profile-sub',
            (o.domains || []).length ? h('span', icon('globe', { size: 14 }), o.domains.join(', ')) : h('span.subtle', 'No email domains'),
            h('span', icon('users', { size: 14 }), plural(memberCount, 'customer')))),
        h('div.profile-actions',
          status,
          h('button.btn', { type: 'button', onclick: () => newCustomerDialog({ org: id, navigate: false }) }, icon('user-plus', { size: 15 }), h('span.btn-text', 'Add customer')),
          moreBtn)));
    return head;
  }

  function stat(label, value, sub = '') {
    return h('div.pstat', { role: 'listitem' }, h('div.pstat-value', String(value)), h('div.pstat-label', label), sub ? h('div.pstat-sub', sub) : null);
  }

  async function save(patch, status) {
    status.set('saving');
    try {
      const res = await app.api.post(`/orgs/${id}`, patch);
      lastPaint = JSON.stringify(res.org);
      app.replica.upsert('o', res.org);
      status.set('saved');
      // The rest of the page is left alone while it is being edited, but the
      // header and title follow the saved name and domains at once.
      if (head?.isConnected) {
        document.title = `${res.org.name} - Help Desk`;
        const old = head;
        preserveFocus(old.parentNode, () => old.replaceWith(profileHead(res.org, status, people().length)));
      }
      return res.org;
    } catch (e) {
      status.set('error', e.message);
      throw e;
    }
  }

  function detailsPanel(o, status) {
    const ids = { name: uid('n'), domains: uid('d'), tags: uid('t'), notes: uid('notes') };
    const nameErr = h('p.field-error', { role: 'alert' });
    const nameIn = h(`input#${ids.name}.input`, { value: o.name, maxlength: 120, autocomplete: 'off' });
    nameIn.addEventListener('change', async () => {
      const v = nameIn.value.trim();
      if (!v) {
        nameErr.textContent = 'An organization needs a name';
        nameIn.value = org()?.name ?? o.name;
        return;
      }
      nameErr.textContent = '';
      if (v !== (org()?.name ?? o.name)) await save({ name: v }, status).catch((e) => { nameErr.textContent = e.message; });
    });
    const domains = tagsInput({ id: ids.domains, value: o.domains || [], label: 'Email domains', placeholder: 'example.com', normalize: normDomain, onChange: (v) => save({ domains: v }, status).catch(() => domains.setValue(org()?.domains || [])) });
    const tags = tagsInput({ id: ids.tags, value: o.tags || [], label: 'Tags', placeholder: 'Add tags', onChange: (v) => save({ tags: v }, status).catch(() => {}) });
    const notes = h(`textarea#${ids.notes}.textarea`, { rows: 5, maxlength: 4000, placeholder: 'Contract details, key contacts, anything your team should know' }, o.notes || '');
    notes.addEventListener('change', () => save({ notes: notes.value }, status).catch(() => {}));
    return h('aside.profile-details', { 'aria-label': 'Organization details' },
      h('div.card',
        h('div.card-head', h('h2', 'Details')),
        h('div.card-body.stack',
          field('Name', nameIn, { id: ids.name, error: nameErr }),
          field('Email domains', domains, { id: ids.domains, hint: 'New customers with an email address at these domains join this organization automatically.' }),
          field('Tags', tags, { id: ids.tags }),
          field('Notes', notes, { id: ids.notes }),
          h('p.field-hint', `Added ${shortDate(o.createdAt)}. Changes save automatically.`))));
  }

  async function remove() {
    const o = org();
    const n = people().length;
    const ok = await confirmDialog({
      title: `Delete ${o.name}?`,
      message: n ? `Its ${plural(n, 'customer')} and their tickets are kept, but they will no longer belong to an organization. This cannot be undone.` : 'This cannot be undone.',
      confirmLabel: 'Delete organization',
      danger: true,
    });
    if (!ok) return;
    try {
      await app.api.del(`/orgs/${id}`);
      app.replica.drop('o', id);
      toast(`${o.name} was deleted.`, { kind: 'success' });
      go('/orgs');
    } catch (e) {
      toastError(e);
    }
  }

  const onChange = (e) => {
    const k = e.detail?.kinds;
    if (k && !k.has('o') && !k.has('u') && !k.has('t')) return;
    const focused = document.activeElement;
    if (focused && page.contains(focused) && /INPUT|TEXTAREA/.test(focused.tagName)) return;
    const o = org();
    if (k?.has('o') && !k.has('u') && !k.has('t') && o && JSON.stringify(o) === lastPaint) return;
    // Only this organization, its customers and its tickets matter here.
    const ids = e.detail?.ids;
    if (ids && !ids.o?.has(id)
      && ![...(ids.u || [])].some((uid2) => shownPeople.has(uid2) || app.replica.users.get(uid2)?.org === id)
      && ![...(ids.t || [])].some((tid) => shown.has(tid) || app.replica.tickets.get(tid)?.org === id)) return;
    preserveFocus(page, paint);
  };
  app.replica.addEventListener('change', onChange);
  paint();
  return () => {
    app.replica.removeEventListener('change', onChange);
    table?.destroy();
    document.title = 'Help Desk';
  };
}
